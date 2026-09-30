import { spawn } from "node:child_process";
import { chooseDevService } from "./brainflow-dev-service.mjs";

// Starts the Vite dev server against a BrainFlow service: an explicit
// VITE_BRAINFLOW_SERVICE_URL override, else a healthy local brainflow-service on
// http://127.0.0.1:8000, else the hosted Render service from the tracked .env.
// This script never starts, stops, restarts or replaces a backend process.
// See README.md and scripts/brainflow-dev-service.mjs.
//
//   npm run dev          override, else local if running, else hosted
//   npm run dev:render   override, else hosted (skips the local service)

const hostedOnly = process.argv.includes("--hosted");
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
  const service = await chooseDevService({ hostedOnly });
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
