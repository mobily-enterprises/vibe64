import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applyLocalCliRuntimeNamespace,
  isDirectServerExecution,
  parseStartupArgs,
  serverStartOptions
} from "../../../bin/server.js";
import { startServer } from "../../../server.js";

const PLAYWRIGHT_SERVER_ENTRYPOINT = fileURLToPath(import.meta.url);
const STOP_SIGNALS = ["SIGINT", "SIGTERM"];

function playwrightServerStartOptions({
  cwd = process.cwd(),
  env = process.env
} = {}) {
  const startup = parseStartupArgs(["--no-open", cwd]);
  applyLocalCliRuntimeNamespace({
    env,
    runtimeMode: startup.runtimeMode
  });
  return {
    ...serverStartOptions({
      ...startup,
      env
    }),
    browserLifecycleShutdown: false
  };
}

// Specs mock the API they exercise; everything else reaches this server, so it
// keeps its state in a throwaway folder instead of the person's own Vibe64
// state and project folders. The folder goes when the process exits.
function isolatedServerRoots() {
  const root = mkdtempSync(path.join(os.tmpdir(), "vibe64-e2e-"));
  process.once("exit", () => rmSync(root, { force: true, recursive: true }));
  return {
    managedSourceRoot: path.join(root, "projects"),
    systemRoot: path.join(root, "state")
  };
}

// Every stop ends in that exit. Playwright stops this server with SIGTERM (the
// config's gracefulShutdown): the server's own shutdown handles it once
// started, and this harness until then. If Playwright dies without stopping it
// (a timeout's SIGTERM, which Playwright does not handle), the stdin pipe
// Playwright holds closes, and that stops the server the same way.
async function main() {
  const exitOnStopSignal = (signal) => process.exit(128 + os.constants.signals[signal]);
  for (const signal of STOP_SIGNALS) process.once(signal, exitOnStopSignal);
  process.stdin.once("end", () => process.kill(process.pid, "SIGTERM"));
  process.stdin.resume();
  process.stdin.unref?.();
  try {
    await startServer({
      ...playwrightServerStartOptions(),
      ...isolatedServerRoots()
    });
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, exitOnStopSignal);
  }
}

if (isDirectServerExecution({
  entrypointPath: PLAYWRIGHT_SERVER_ENTRYPOINT
})) {
  main().catch((error) => {
    console.error("Failed to start the Vibe64 Playwright server:", error);
    process.exitCode = 1;
  });
}

export {
  playwrightServerStartOptions
};
