import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_BRAINFLOW_URL,
  isServiceHealthy,
  requireDevService,
  resolveDevServiceUrl,
  standaloneServiceInstructions,
} from '../brainflow-dev-service.mjs';

const HOSTED = 'https://hosted-brainflow.example.com';
const dirs = [];

function project(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bf-dev-'));
  dirs.push(root);
  const cwd = join(root, 'app');
  mkdirSync(cwd);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
  return cwd;
}

const healthy = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('resolveDevServiceUrl', () => {
  it('defaults to the local service and ignores the tracked production .env', () => {
    const cwd = project({ '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}\n` });
    expect(resolveDevServiceUrl({ cwd, env: {} })).toEqual({ url: LOCAL_BRAINFLOW_URL, source: 'local default', isLocalDefault: true });
  });

  it('uses the tracked .env only when the production backend is requested', () => {
    const cwd = project({ '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}/\n` });
    expect(resolveDevServiceUrl({ cwd, env: {}, productionBackend: true }).url).toBe(HOSTED);
    expect(() => resolveDevServiceUrl({ cwd: project(), env: {}, productionBackend: true })).toThrow(/tracked \.env/);
  });

  it('prefers the environment, then local override files in Vite order', () => {
    const cwd = project({
      '.env': `VITE_BRAINFLOW_SERVICE_URL=${HOSTED}\n`,
      '.env.development': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8003\n',
      '.env.local': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8002\n',
      '.env.development.local': 'VITE_BRAINFLOW_SERVICE_URL=http://127.0.0.1:8001\n',
    });
    expect(resolveDevServiceUrl({ cwd, env: { VITE_BRAINFLOW_SERVICE_URL: 'http://127.0.0.1:9000' } }).source).toBe('the environment');
    expect(resolveDevServiceUrl({ cwd, env: {}, productionBackend: true })).toMatchObject({ url: 'http://127.0.0.1:8001', source: '.env.development.local' });
    rmSync(join(cwd, '.env.development.local'));
    expect(resolveDevServiceUrl({ cwd, env: {} })).toMatchObject({ url: 'http://127.0.0.1:8002', source: '.env.local' });
    rmSync(join(cwd, '.env.local'));
    expect(resolveDevServiceUrl({ cwd, env: {} })).toMatchObject({ url: 'http://127.0.0.1:8003', source: '.env.development' });
  });

  it('rejects malformed or non-HTTP URLs with their source', () => {
    expect(() => resolveDevServiceUrl({ cwd: project(), env: { VITE_BRAINFLOW_SERVICE_URL: 'not a url' } })).toThrow(/the environment is not a valid URL/);
    const cwd = project({ '.env.local': 'VITE_BRAINFLOW_SERVICE_URL=ftp://127.0.0.1\n' });
    expect(() => resolveDevServiceUrl({ cwd, env: {} })).toThrow(/\.env\.local must use HTTP or HTTPS/);
  });
});

describe('health and instructions', () => {
  it('requires HTTP success and status ok', async () => {
    expect(await isServiceHealthy(LOCAL_BRAINFLOW_URL, { fetchHealth: healthy() })).toBe(true);
    const degraded = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'degraded' }) });
    expect(await isServiceHealthy(LOCAL_BRAINFLOW_URL, { fetchHealth: degraded })).toBe(false);
    expect(await isServiceHealthy(LOCAL_BRAINFLOW_URL, { fetchHealth: vi.fn().mockRejectedValue(new Error('refused')) })).toBe(false);
  });

  it('names a sibling brainflow-service checkout only when it exists', () => {
    const cwd = project();
    expect(standaloneServiceInstructions({ cwd })).toContain('<your brainflow-service checkout>');
    const sibling = join(cwd, '..', 'brainflow-service', 'brainflow_service');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'app.py'), '');
    expect(standaloneServiceInstructions({ cwd })).toContain(join(cwd, '..', 'brainflow-service'));
  });

  it('explains how to start the standalone service when the local default is down', async () => {
    const fetchHealth = vi.fn().mockRejectedValue(new Error('refused'));
    await expect(requireDevService({ cwd: project(), env: {}, fetchHealth, hostedAlternative: 'Or: npm run dev:render' }))
      .rejects.toThrow(/No healthy BrainFlow service at http:\/\/127\.0\.0\.1:8000[\s\S]*uv run uvicorn brainflow_service\.app:app[\s\S]*npm run dev:render/);
    expect(fetchHealth).toHaveBeenCalledWith(`${LOCAL_BRAINFLOW_URL}/health`, expect.any(Object));
  });

  it('returns the checked service when healthy', async () => {
    await expect(requireDevService({ cwd: project(), env: {}, fetchHealth: healthy() }))
      .resolves.toMatchObject({ url: LOCAL_BRAINFLOW_URL, isLocalDefault: true });
  });
});
