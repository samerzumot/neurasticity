import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_BRAINFLOW_URL,
  chooseDevService,
  isServiceHealthy,
  resolveConfiguredHosted,
  resolveExplicitOverride,
  standaloneServiceInstructions,
} from '../brainflow-dev-service.mjs';

const HOSTED = 'https://hosted-brainflow.example.com';
const OVERRIDE = 'http://127.0.0.1:8123';
const dirs = [];

function project(files = { '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}/\n` }) {
  const root = mkdtempSync(join(tmpdir(), 'bf-dev-'));
  dirs.push(root);
  const cwd = join(root, 'app');
  mkdirSync(cwd);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
  return cwd;
}

/** A fake network where only the listed base URLs answer /health with status ok. */
function network(...healthyBases) {
  return vi.fn(async (url) => {
    if (healthyBases.some((base) => url === `${base}/health`)) return { ok: true, json: async () => ({ status: 'ok' }) };
    throw new Error('connection refused');
  });
}

const quiet = { log: () => {} };

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('chooseDevService', () => {
  it('uses the configured hosted service when no local service is running', async () => {
    const fetchHealth = network(HOSTED);
    await expect(chooseDevService({ cwd: project(), env: {}, fetchHealth, ...quiet }))
      .resolves.toMatchObject({ url: HOSTED, kind: 'hosted' });
    expect(fetchHealth).toHaveBeenNthCalledWith(1, `${LOCAL_BRAINFLOW_URL}/health`, expect.any(Object));
  });

  it('prefers a healthy local service over the hosted one', async () => {
    const fetchHealth = network(LOCAL_BRAINFLOW_URL, HOSTED);
    await expect(chooseDevService({ cwd: project(), env: {}, fetchHealth, ...quiet }))
      .resolves.toMatchObject({ url: LOCAL_BRAINFLOW_URL, kind: 'local' });
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });

  it('falls back to hosted when something unhealthy answers on port 8000', async () => {
    const fetchHealth = vi.fn(async (url) => (url.startsWith(LOCAL_BRAINFLOW_URL)
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, json: async () => ({ status: 'ok' }) }));
    await expect(chooseDevService({ cwd: project(), env: {}, fetchHealth, ...quiet }))
      .resolves.toMatchObject({ url: HOSTED, kind: 'hosted' });
  });

  it('uses an explicit override without probing local or hosted', async () => {
    const fetchHealth = network(OVERRIDE, LOCAL_BRAINFLOW_URL, HOSTED);
    await expect(chooseDevService({ cwd: project(), env: { VITE_BRAINFLOW_SERVICE_URL: OVERRIDE }, fetchHealth, ...quiet }))
      .resolves.toMatchObject({ url: OVERRIDE, source: 'the environment', kind: 'override' });
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });

  it('does not silently fall back away from an unhealthy override', async () => {
    const cwd = project({ '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}\n`, '.env.local': `VITE_BRAINFLOW_SERVICE_URL=${OVERRIDE}\n` });
    await expect(chooseDevService({ cwd, env: {}, fetchHealth: network(LOCAL_BRAINFLOW_URL, HOSTED), ...quiet }))
      .rejects.toThrow(/No healthy BrainFlow service at http:\/\/127\.0\.0\.1:8123 \(explicit override from \.env\.local\)/);
  });

  it('skips the local service when hosted-only is requested', async () => {
    await expect(chooseDevService({ cwd: project(), env: {}, hostedOnly: true, fetchHealth: network(LOCAL_BRAINFLOW_URL, HOSTED), ...quiet }))
      .resolves.toMatchObject({ url: HOSTED, kind: 'hosted' });
  });

  it('fails clearly when neither local nor hosted is usable', async () => {
    await expect(chooseDevService({ cwd: project(), env: {}, fetchHealth: network(), ...quiet }))
      .rejects.toThrow(/No healthy local BrainFlow service[\s\S]*No healthy hosted BrainFlow service at https:\/\/hosted-brainflow\.example\.com[\s\S]*uv run uvicorn brainflow_service\.app:app/);
    await expect(chooseDevService({ cwd: project({}), env: {}, fetchHealth: network(), ...quiet }))
      .rejects.toThrow(/No hosted service configured/);
  });
});

describe('configuration', () => {
  it('reads overrides from the environment, then local files in Vite order, never the tracked .env', () => {
    const cwd = project({
      '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}\n`,
      '.env.development': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8003\n',
      '.env.local': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8002\n',
      '.env.development.local': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8001\n',
    });
    expect(resolveExplicitOverride({ cwd, env: { VITE_BRAINFLOW_SERVICE_URL: 'http://127.0.0.1:9000/' } })).toEqual({ url: 'http://127.0.0.1:9000', source: 'the environment' });
    expect(resolveExplicitOverride({ cwd, env: {} })).toMatchObject({ source: '.env.development.local' });
    rmSync(join(cwd, '.env.development.local'));
    expect(resolveExplicitOverride({ cwd, env: {} })).toMatchObject({ source: '.env.local' });
    rmSync(join(cwd, '.env.local'));
    expect(resolveExplicitOverride({ cwd, env: {} })).toMatchObject({ source: '.env.development' });
    rmSync(join(cwd, '.env.development'));
    expect(resolveExplicitOverride({ cwd, env: {} })).toBeUndefined();
    expect(resolveConfiguredHosted({ cwd })).toMatchObject({ url: HOSTED });
  });

  it('rejects malformed or non-HTTP URLs with their source', () => {
    expect(() => resolveExplicitOverride({ cwd: project(), env: { VITE_BRAINFLOW_SERVICE_URL: 'not a url' } })).toThrow(/the environment is not a valid URL/);
    const cwd = project({ '.env.local': 'VITE_BRAINFLOW_SERVICE_URL=ftp://127.0.0.1\n' });
    expect(() => resolveExplicitOverride({ cwd, env: {} })).toThrow(/\.env\.local must use HTTP or HTTPS/);
  });

  it('requires HTTP success and status ok for health', async () => {
    const degraded = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'degraded' }) });
    expect(await isServiceHealthy(LOCAL_BRAINFLOW_URL, { fetchHealth: degraded })).toBe(false);
    expect(await isServiceHealthy(LOCAL_BRAINFLOW_URL, { fetchHealth: network(LOCAL_BRAINFLOW_URL) })).toBe(true);
  });

  it('names a sibling brainflow-service checkout only when it exists', () => {
    const cwd = project();
    expect(standaloneServiceInstructions({ cwd })).toContain('<your brainflow-service checkout>');
    const sibling = join(cwd, '..', 'brainflow-service', 'brainflow_service');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'app.py'), '');
    expect(standaloneServiceInstructions({ cwd })).toContain(join(cwd, '..', 'brainflow-service'));
  });
});
