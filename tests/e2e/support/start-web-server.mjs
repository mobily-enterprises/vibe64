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
// state and project folders.
function isolatedServerRoots() {
  const root = mkdtempSync(path.join(os.tmpdir(), "vibe64-e2e-"));
  process.once("exit", () => rmSync(root, { force: true, recursive: true }));
  return {
    managedSourceRoot: path.join(root, "projects"),
    systemRoot: path.join(root, "state")
  };
}

async function main() {
  await startServer({
    ...playwrightServerStartOptions(),
    ...isolatedServerRoots()
  });
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
