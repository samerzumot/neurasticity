import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Chooses the BrainFlow service a local development server talks to.
 *
 * The backend is the standalone `brainflow-service` repository. These launchers
 * never start, stop, restart or replace a backend process, and never touch
 * whatever is listening on a port.
 *
 * Order, first usable wins:
 * 1. An explicit override: VITE_BRAINFLOW_SERVICE_URL in the shell, or in
 *    .env.development.local / .env.local / .env.development (Vite's order).
 *    It must be healthy; there is no silent fallback away from an override.
 * 2. A healthy local service at http://127.0.0.1:8000 (the standalone
 *    brainflow-service, started deliberately for backend work).
 * 3. The configured hosted service: VITE_BRAINFLOW_SERVICE_URL in the tracked
 *    `.env`, the same Render URL production builds use.
 * Otherwise it fails with an error that covers both local and hosted.
 *
 * `hostedOnly` (npm run dev:render) skips step 2.
 */

export const LOCAL_BRAINFLOW_URL = 'http://127.0.0.1:8000';
export const LOCAL_OVERRIDE_FILES = ['.env.development.local', '.env.local', '.env.development'];
const VARIABLE = 'VITE_BRAINFLOW_SERVICE_URL';
const HOSTED_SOURCE = '.env (configured hosted service)';

function readVariable(file) {
  if (!existsSync(file)) return undefined;
  const value = parseEnv(readFileSync(file, 'utf8'))[VARIABLE]?.trim();
  return value || undefined;
}

export function normalizeServiceUrl(value, source) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${VARIABLE} from ${source} is not a valid URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${VARIABLE} from ${source} must use HTTP or HTTPS.`);
  }
  return value.trim().replace(/\/+$/, '');
}

/** @returns {{ url: string, source: string } | undefined} */
export function resolveExplicitOverride({ cwd = process.cwd(), env = process.env } = {}) {
  const fromProcess = env[VARIABLE]?.trim();
  if (fromProcess) return { url: normalizeServiceUrl(fromProcess, 'the environment'), source: 'the environment' };
  for (const name of LOCAL_OVERRIDE_FILES) {
    const value = readVariable(resolve(cwd, name));
    if (value) return { url: normalizeServiceUrl(value, name), source: name };
  }
  return undefined;
}

/** @returns {{ url: string, source: string } | undefined} */
export function resolveConfiguredHosted({ cwd = process.cwd() } = {}) {
  const value = readVariable(resolve(cwd, '.env'));
  return value ? { url: normalizeServiceUrl(value, HOSTED_SOURCE), source: HOSTED_SOURCE } : undefined;
}

export async function isServiceHealthy(baseUrl, { timeoutMs = 3000, fetchHealth = fetch } = {}) {
  try {
    const response = await fetchHealth(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.status === 'ok';
  } catch {
    return false;
  }
}

/** How to start the standalone service; names a sibling checkout only if one exists. */
export function standaloneServiceInstructions({ cwd = process.cwd() } = {}) {
  const sibling = resolve(cwd, '..', 'brainflow-service');
  const location = existsSync(resolve(sibling, 'brainflow_service', 'app.py'))
    ? sibling
    : '<your brainflow-service checkout>';
  return [
    'To use a local service, start the standalone brainflow-service in another terminal:',
    `  cd ${location}`,
    '  uv run uvicorn brainflow_service.app:app --host 127.0.0.1 --port 8000',
    '(first time: uv sync --extra test; see the brainflow-service README).',
  ].join('\n');
}

/**
 * Picks a healthy service in the order above. Throws a readable error when
 * none is usable; the caller decides whether to exit.
 *
 * @returns {Promise<{ url: string, source: string, kind: 'override' | 'local' | 'hosted' }>}
 */
export async function chooseDevService({
  cwd = process.cwd(), env = process.env, hostedOnly = false, fetchHealth, log = console.log,
} = {}) {
  const override = resolveExplicitOverride({ cwd, env });
  if (override) {
    if (await isServiceHealthy(override.url, { timeoutMs: 90_000, fetchHealth })) return { ...override, kind: 'override' };
    throw new Error([
      `No healthy BrainFlow service at ${override.url} (explicit override from ${override.source}).`,
      `Check that service, or remove ${VARIABLE} from ${override.source} to use the local or hosted default.`,
    ].join('\n'));
  }

  const problems = [];
  if (!hostedOnly) {
    if (await isServiceHealthy(LOCAL_BRAINFLOW_URL, { timeoutMs: 1500, fetchHealth })) {
      return { url: LOCAL_BRAINFLOW_URL, source: 'local brainflow-service', kind: 'local' };
    }
    problems.push(`No healthy local BrainFlow service at ${LOCAL_BRAINFLOW_URL} (anything else on that port is left alone).`);
  }

  const hosted = resolveConfiguredHosted({ cwd });
  if (!hosted) {
    problems.push(`No hosted service configured: ${VARIABLE} is missing from the tracked .env.`);
  } else {
    // A free-plan hosted service that has spun down can take about a minute to wake.
    log(`Checking ${hosted.url} (a sleeping hosted service can take up to a minute to wake)...`);
    if (await isServiceHealthy(hosted.url, { timeoutMs: 90_000, fetchHealth })) return { ...hosted, kind: 'hosted' };
    problems.push(`No healthy hosted BrainFlow service at ${hosted.url} (from ${hosted.source}).`);
  }

  throw new Error([...problems, standaloneServiceInstructions({ cwd })].join('\n'));
}

// `npm run brainflow`: report which service local development would use and
// how to start the standalone one. Exits non-zero when none is usable.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('The BrainFlow backend runs from the standalone brainflow-service repository,');
  console.log('not from this one. The embedded brainflow_service/ copy is kept only as a');
  console.log('rollback (npm run brainflow:embedded).\n');
  try {
    const service = await chooseDevService();
    console.log(`npm run dev would use ${service.url} (${service.source}).`);
    if (service.kind !== 'local') console.log(`\n${standaloneServiceInstructions()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
