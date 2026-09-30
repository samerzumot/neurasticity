import { spawn } from "node:child_process";
import { requireDevService } from "./brainflow-dev-service.mjs";

// Starts the Vite dev server against an already-running BrainFlow service.
// The backend is the standalone brainflow-service repository; this script
// never starts, stops or restarts a backend process. See README.md.
//
//   npm run dev          local service (http://127.0.0.1:8000 unless overridden)
//   npm run dev:render   the hosted service production builds use (tracked .env)

const productionBackend = process.argv.includes("--production-backend");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let frontend;
let stopping = false;

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") child.kill("SIGTERM");
  else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
}

function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stop(frontend);
  process.exitCode = exitCode;
}
process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());

try {
  const service = await requireDevService({
    productionBackend,
    hostedAlternative: "Or run against the hosted service instead: npm run dev:render",
  });
  console.log(`Using BrainFlow service ${service.url} (from ${service.source}).`);
  // A variable already in the environment takes precedence over every .env
  // file, so the dev server uses exactly the service checked above.
  frontend = spawn(npmCommand, ["run", "dev:web"], {
    detached: process.platform !== "win32",
    stdio: "inherit",
    env: { ...process.env, VITE_BRAINFLOW_SERVICE_URL: service.url },
  });
  frontend.on("exit", (code) => stopChildren(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopChildren(1);
}
