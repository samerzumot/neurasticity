import { spawn } from "node:child_process";
import { chooseDevService } from "./brainflow-dev-service.mjs";

// Starts the development-only EEG Acquisition Console against a BrainFlow
// service chosen like `npm run dev`: an explicit override, else a healthy local
// brainflow-service on http://127.0.0.1:8000, else the hosted service from the
// tracked .env. BrainFlow-direct Muse acquisition only works with a local
// service on the same machine as the headset. This script never starts, stops,
// restarts or replaces a backend process.

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
  const service = await chooseDevService();
  console.log(`Using BrainFlow service ${service.url} (from ${service.source}).`);
  // Passed explicitly so the console uses exactly the service checked above.
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
