import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Chooses the BrainFlow service a local development server talks to.
 *
 * The backend is the standalone `brainflow-service` repository, run separately
 * (normally on http://127.0.0.1:8000). These launchers never start, stop or
 * restart a backend process, and never touch whatever is listening on a port.
 *
 * Resolution, first match wins:
 * 1. VITE_BRAINFLOW_SERVICE_URL in the process environment;
 * 2. VITE_BRAINFLOW_SERVICE_URL in a developer-local override file:
 *    .env.development.local, .env.local, .env.development (Vite's order);
 * 3. with `productionBackend`, the value in the tracked `.env` — the hosted
 *    service production builds use;
 * 4. otherwise the local default, http://127.0.0.1:8000.
 *
 * The tracked `.env` is deliberately skipped unless asked for: production
 * builds (Vercel, Xcode Cloud) read the hosted URL from it, so it cannot also
 * be the local-development default.
 */

export const LOCAL_BRAINFLOW_URL = 'http://127.0.0.1:8000';
export const LOCAL_OVERRIDE_FILES = ['.env.development.local', '.env.local', '.env.development'];
const VARIABLE = 'VITE_BRAINFLOW_SERVICE_URL';

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

/** @returns {{ url: string, source: string, isLocalDefault: boolean }} */
export function resolveDevServiceUrl({ cwd = process.cwd(), env = process.env, productionBackend = false } = {}) {
  const fromProcess = env[VARIABLE]?.trim();
  if (fromProcess) {
    return { url: normalizeServiceUrl(fromProcess, 'the environment'), source: 'the environment', isLocalDefault: false };
  }
  for (const name of LOCAL_OVERRIDE_FILES) {
    const value = readVariable(resolve(cwd, name));
    if (value) return { url: normalizeServiceUrl(value, name), source: name, isLocalDefault: false };
  }
  if (productionBackend) {
    const value = readVariable(resolve(cwd, '.env'));
    if (!value) throw new Error(`--production-backend needs ${VARIABLE} in the tracked .env file.`);
    return { url: normalizeServiceUrl(value, '.env (production default)'), source: '.env (production default)', isLocalDefault: false };
  }
  return { url: LOCAL_BRAINFLOW_URL, source: 'local default', isLocalDefault: true };
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
    'Start the standalone BrainFlow service in another terminal:',
    `  cd ${location}`,
    '  uv run uvicorn brainflow_service.app:app --host 127.0.0.1 --port 8000',
    '(first time: uv sync --extra test; see the brainflow-service README).',
  ].join('\n');
}

/**
 * Resolves and health-checks the service. Throws a readable error when it is
 * unavailable; the caller decides whether to exit.
 */
export async function requireDevService({
  cwd = process.cwd(), env = process.env, productionBackend = false, fetchHealth, hostedAlternative,
} = {}) {
  const resolved = resolveDevServiceUrl({ cwd, env, productionBackend });
  // A hosted free-plan service that has spun down can take about a minute to wake.
  const timeoutMs = resolved.isLocalDefault ? 3000 : 90_000;
  if (!resolved.isLocalDefault) {
    console.log(`Checking ${resolved.url} (a sleeping hosted service can take up to a minute to wake)...`);
  }
  if (await isServiceHealthy(resolved.url, { timeoutMs, fetchHealth })) return resolved;

  const lines = [`No healthy BrainFlow service at ${resolved.url} (from ${resolved.source}).`];
  if (resolved.isLocalDefault) {
    lines.push(standaloneServiceInstructions({ cwd }));
    if (hostedAlternative) lines.push(hostedAlternative);
  } else {
    lines.push(`Check that service, or unset ${VARIABLE} in ${resolved.source} to use a local one.`);
  }
  throw new Error(lines.join('\n'));
}

// `npm run brainflow`: report which service local development would use and
// how to start the standalone one. Exits non-zero when it is not healthy.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log('The BrainFlow backend runs from the standalone brainflow-service repository,');
  console.log('not from this one. The embedded brainflow_service/ copy is kept only as a');
  console.log('rollback (npm run brainflow:embedded).\n');
  try {
    const service = await requireDevService();
    console.log(`Local development will use ${service.url} (from ${service.source}): healthy.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
