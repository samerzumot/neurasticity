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

Start the app:

```bash
npm run dev
```

`npm run dev` picks a BrainFlow analysis service, prints which one it is
using, and starts Vite (normally `http://localhost:5173`) pointed at it. First
usable wins:

1. an explicit override: `VITE_BRAINFLOW_SERVICE_URL` set in the shell, or in
   the untracked `.env.development.local`, `.env.local` or `.env.development`
   (it must be healthy; there is no fallback away from an override);
2. a healthy local [`brainflow-service`](https://github.com/rosscolborne/brainflow-service)
   at `http://127.0.0.1:8000`;
3. the hosted Render service configured in the tracked `.env` (the same URL
   production builds use).

With no local service running, `npm run dev` therefore uses Render, as it
always has. It exits with a clear error only if none of these is healthy. It
never starts, stops, restarts or replaces a backend, and leaves anything else
listening on port 8000 alone. Press `Ctrl+C` to stop Vite.

To debug the backend locally, run the standalone service (Python 3.11+ with
`uv`) from its own checkout, then start `npm run dev`; it prefers the local
service automatically:

```bash
cd ../brainflow-service
uv sync --extra test        # first time only
uv run uvicorn brainflow_service.app:app --host 127.0.0.1 --port 8000
```

`npm run dev:render` skips the local service and uses the hosted one even when
a local service is running. `npm run brainflow` prints which service
`npm run dev` would use and how to start the local one, without starting
anything. `npm run dev:web` starts Vite alone with Vite's normal environment
resolution (the hosted URL from the tracked `.env`).

The embedded `brainflow_service/` directory is an older copy of the backend,
kept temporarily as a rollback. `npm run brainflow:embedded` still runs it on
port 8000 if ever needed; do not develop against or change it.

## EEG acquisition console

The development-only EEG Acquisition Console is a separate page for raw EEG
acquisition, hardware-provider validation, recording, replay, live plots, and
signal-quality debugging. It uses the same BrainFlow service as
Neurasticity, but does not form part of the patient or clinician UI.

```bash
npm run debug_console
```

This opens the console at `http://127.0.0.1:5174/debug-console.html`. It picks
its BrainFlow service the same way as `npm run dev` (override, else a healthy
local service, else the hosted one). BrainFlow-direct Muse acquisition only
works with a local `brainflow-service` on the same machine as the headset, so
start it first for that. Stop the console with `Ctrl+C`.

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
