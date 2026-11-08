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

// Every stop ends in that exit. JSKIT's browser-test launcher starts one of
// these per worker (playwright.config.mjs), with PORT and HOST and no stdin,
// and stops it with SIGTERM: the server's own shutdown handles it once
// started, and this harness until then.
async function main() {
  const exitOnStopSignal = (signal) => process.exit(128 + os.constants.signals[signal]);
  for (const signal of STOP_SIGNALS) process.once(signal, exitOnStopSignal);
  try {
    await startServer({
      ...playwrightServerStartOptions(),
      ...isolatedServerRoots(),
      // Specs open browser contexts of their own, which carry no access
      // cookie; the access key has its own TCP server test.
      localAccessKey: false
    });
    // The server's shutdown handles the first stop signal and forces its own
    // exit when it overruns. A later one (Playwright signals the whole process
    // group, and the launcher passes the stop on) must not end the process
    // before that shutdown has removed the temporary folder.
    for (const signal of STOP_SIGNALS) process.on(signal, ignoreRepeatedStop);
  } finally {
    for (const signal of STOP_SIGNALS) process.off(signal, exitOnStopSignal);
  }
}

function ignoreRepeatedStop() {}

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
