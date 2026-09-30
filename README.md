# Neurasticity

Neurasticity connects a Muse Athena directly from the user's Chrome or Edge
browser. It can send the browser-collected EEG windows to its BrainFlow
analysis service for the shared smoothing, mindfulness, restfulness, fit, and
training calculations. The service never attempts to use Bluetooth itself.

## Local development

Neurasticity's current Vite toolchain requires Node.js 20.19+ (or 22.12+).
Install the web app dependencies:

```bash
npm install
```

The BrainFlow analysis backend is the standalone
[`brainflow-service`](https://github.com/rosscolborne/brainflow-service)
repository (Python 3.11+ with `uv`). Clone it next to this repository and start
it in its own terminal:

```bash
cd ../brainflow-service
uv sync --extra test        # first time only
uv run uvicorn brainflow_service.app:app --host 127.0.0.1 --port 8000
```

Then start the frontend:

```bash
npm run dev
```

`npm run dev` health-checks the BrainFlow service, prints which one it is
using, and starts Vite (normally `http://localhost:5173`) pointed at it. It
never starts, stops or restarts a backend, and it exits with instructions if
the service is not healthy. `npm run brainflow` prints the same status and
start instructions without starting anything. Press `Ctrl+C` to stop Vite.

Which service `npm run dev` uses, first match wins:

1. `VITE_BRAINFLOW_SERVICE_URL` set in the shell;
2. `VITE_BRAINFLOW_SERVICE_URL` in `.env.development.local`, `.env.local` or
   `.env.development` (untracked local overrides);
3. otherwise the local service at `http://127.0.0.1:8000`.

To run the local frontend against the hosted Render service instead (no local
backend needed; BrainFlow-direct hardware paths then do not work), use:

```bash
npm run dev:render
```

The tracked `.env` holds the hosted Render URL that production builds use; the
dev launchers deliberately ignore it unless `npm run dev:render` is used.
`npm run dev:web` starts Vite alone with Vite's normal environment resolution,
which picks up that hosted URL.

The embedded `brainflow_service/` directory is an older copy of the backend,
kept temporarily as a rollback. `npm run brainflow:embedded` still runs it on
port 8000 if ever needed; do not develop against or change it.

## EEG acquisition console

The development-only EEG Acquisition Console is a separate page for raw EEG
acquisition, hardware-provider validation, recording, replay, live plots, and
signal-quality debugging. It uses the same BrainFlow service as
Neurasticity, but does not form part of the patient or clinician UI.

Start the standalone `brainflow-service` as above, then:

```bash
npm run debug_console
```

This opens the console at `http://127.0.0.1:5174/debug-console.html`. It uses
the same service resolution as `npm run dev` (normally the local service) and
exits with instructions if that service is not healthy. It has no hosted
option: BrainFlow-direct Muse acquisition needs the service running on the
same machine as the headset. Stop it with `Ctrl+C`.

## Vercel + Render deployment

The hosted backend is the Render service `neurasticity-brainflow`
(`https://neurasticity-brainflow.onrender.com`), deployed from the
`brainflow-service` repository (see its README; this repository's
`render.yaml` is no longer used by that service). Add
`VITE_BRAINFLOW_SERVICE_URL` to the Vercel project's environment variables,
using that public HTTPS URL, and redeploy the frontend.
The URL is included when Vite builds the app, so setting it without a new
deployment does not update an already-published site.

The app verifies the Render service before opening the Chrome Bluetooth chooser.
If Render is unavailable, the headset connection does not start and no local or
browser-derived metrics are substituted.

## Checks

```bash
npm run build
npm test                 # offline Vitest suite
npm run test:python      # tests the embedded rollback copy only
```

The backend's own tests run in the `brainflow-service` repository.

`npm test` excludes the two service-backed Vitest files by name:
`backendFitE2E.test.ts` and `eegPipelineIntegration.test.ts`. They remain in
the dedicated BrainFlow integration suite. To run them, start the standalone
`brainflow-service` on port 8000 (see Local development) and run:

```bash
npm run test:brainflow:integration
```

The dedicated command checks `/health` first and fails with a clear error if
the service is unavailable; it never silently skips either file. It uses
`http://127.0.0.1:8000` by default, regardless of `.env` or
`VITE_BRAINFLOW_SERVICE_URL`. For a service on another local port, set
`BRAINFLOW_TEST_URL=http://127.0.0.1:<port>` for that command. Only HTTP
loopback origins are accepted. The simulated BLE test does not use hardware.

Browser integration tests have their own service and environment requirements.

## BrainFlow service

The FastAPI service lives in the standalone
[`brainflow-service`](https://github.com/rosscolborne/brainflow-service)
repository, which documents its endpoints and signal processing. The
`brainflow_service/` directory here is a temporary rollback copy and is not
maintained.
