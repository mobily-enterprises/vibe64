import assert from "node:assert/strict";
import test from "node:test";

import {
  targetScriptStartupScript,
  targetScriptTerminalArgs
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  assertDockerEnv,
  assertDockerGroupAdd,
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
  const browserVolumeMount = `${STUDIO_PLAYWRIGHT_BROWSERS_PATH}:${STUDIO_PLAYWRIGHT_BROWSERS_PATH}`;

  assertDockerVolumeMount(args, STUDIO_PLAYWRIGHT_BROWSERS_PATH, STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assertDockerEnv(args, "PLAYWRIGHT_BROWSERS_PATH", STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assert.ok(args.indexOf(browserVolumeMount) < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));
  assertDockerVolumeMount(args, targetRoot, targetRoot);
  assert.equal(args.includes(`${targetRoot}:/workspace`), false);
  assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), [
    "-w",
    targetRoot
  ]);
});

test("target script terminals pass and preserve host supplementary groups", () => {
  const originalGetgroups = process.getgroups;
  process.getgroups = () => [3333, 4444, 3333];
  try {
    const args = targetScriptTerminalArgs({
      adapterId: "node-web",
      command: "npm run build",
      containerName: "vibe64-node-web-target-script-groups",
      targetRoot: "/srv/vibe64/projects/project",
      terminalId: "unit-terminal"
    });
    const startupScript = targetScriptStartupScript("npm run build");

    assertDockerGroupAdd(args, "3333");
    assertDockerGroupAdd(args, "4444");
    assert.match(startupScript, /id -G/u);
    assert.match(startupScript, /awk -v primary="\$VIBE64_HOST_GID"/u);
    assert.match(startupScript, /setpriv --reuid "\$VIBE64_HOST_UID" --regid "\$VIBE64_HOST_GID" \$docker_group_args/u);
  } finally {
    process.getgroups = originalGetgroups;
  }
});
