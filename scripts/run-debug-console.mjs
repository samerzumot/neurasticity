import { spawn } from "node:child_process";
import { requireDevService } from "./brainflow-dev-service.mjs";

// Starts the development-only EEG Acquisition Console against an
// already-running local BrainFlow service (the standalone brainflow-service
// repository, normally on http://127.0.0.1:8000). BrainFlow-direct Muse
// acquisition needs the service on the same machine as the headset, so there
// is no hosted-service option here. This script never starts, stops or
// restarts a backend process.

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let consoleServer;
let stopping = false;

function stop(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function stopChildren(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  stop(consoleServer);
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stopChildren());
process.on("SIGTERM", () => stopChildren());

try {
  const service = await requireDevService();
  console.log(`Using BrainFlow service ${service.url} (from ${service.source}).`);
  // Overrides the hosted URL in the tracked .env for this console only.
  consoleServer = spawn(npmCommand, ["run", "debug_console:web"], {
    detached: process.platform !== "win32",
    stdio: "inherit",
    env: { ...process.env, VITE_BRAINFLOW_SERVICE_URL: service.url },
  });
  consoleServer.on("exit", (code) => stopChildren(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopChildren(1);
}
