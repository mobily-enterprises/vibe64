import assert from "node:assert/strict";
import test from "node:test";

import {
  targetScriptTerminalArgs
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  assertDockerEnv,
  assertDockerVolumeMount
} from "./dockerArgsTestHelpers.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

test("target script terminals use the shared Playwright browser cache", () => {
  const targetRoot = "/srv/vibe64/projects/project";
  const args = targetScriptTerminalArgs({
    adapterId: "node-web",
    command: "npm run dev",
    containerName: "vibe64-node-web-target-script-unit",
    extraDockerArgs: ["-e", "PLAYWRIGHT_BROWSERS_PATH=/tmp/project-playwright"],
    targetRoot,
    terminalId: "unit-terminal"
  });
  const browserVolumeMount = `${STUDIO_PLAYWRIGHT_BROWSERS_VOLUME}:${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`;

  assertDockerVolumeMount(args, STUDIO_PLAYWRIGHT_BROWSERS_VOLUME, STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assertDockerEnv(args, "PLAYWRIGHT_BROWSERS_PATH", STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assert.ok(args.indexOf(browserVolumeMount) < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));
  assertDockerVolumeMount(args, targetRoot, targetRoot);
  assert.equal(args.includes(`${targetRoot}:/workspace`), false);
  assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), [
    "-w",
    targetRoot
  ]);
});
