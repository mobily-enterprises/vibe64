import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  assertDockerEnv,
  assertDockerVolumeMount
} from "./dockerArgsTestHelpers.js";

function assertPlaywrightBrowserCache(args) {
  assertDockerVolumeMount(args, STUDIO_PLAYWRIGHT_BROWSERS_VOLUME, STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assertDockerEnv(args, "PLAYWRIGHT_BROWSERS_PATH", STUDIO_PLAYWRIGHT_BROWSERS_PATH);
}

test("doctor toolchain commands run with the shared Studio tool-home ownership contract", () => {
  const args = buildDoctorToolchainArgs(["npm", "prefix", "-g"]);

  assertPlaywrightBrowserCache(args);
  assert.ok(args.includes(`HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(args.includes(`AI_STUDIO_HOST_UID=${process.getuid()}`));
  assert.ok(args.includes(`AI_STUDIO_HOST_GID=${process.getgid()}`));

  const imageIndex = args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE);
  assert.notEqual(imageIndex, -1);
  assert.deepEqual(args.slice(imageIndex + 1, imageIndex + 3), ["bash", "-lc"]);

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.match(startupScript, /chown -R "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID" "\$HOME"/u);
  assert.match(startupScript, /setpriv --reuid "\$AI_STUDIO_HOST_UID" --regid "\$AI_STUDIO_HOST_GID"/u);
  assert.match(startupScript, /npm prefix -g/u);
});

test("doctor toolchain host-user commands use a temporary writable home", () => {
  const args = buildDoctorToolchainArgs(["npm", "install"], {
    extraArgs: [
      "-u",
      `${process.getuid()}:${process.getgid()}`,
      "-e",
      "PLAYWRIGHT_BROWSERS_PATH=/tmp/project-playwright"
    ]
  });

  assertPlaywrightBrowserCache(args);
  assert.equal(args.includes("ai_studio_tool_home:/home/studio"), false);
  assert.equal(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`), false);
  assert.ok(args.includes("HOME=/tmp/studio-home"));

  const startupScript = args.at(-1);
  assert.match(startupScript, /export HOME=\/tmp\/studio-home/u);
  assert.match(startupScript, /mkdir -p "\$HOME"/u);
  assert.doesNotMatch(startupScript, /chown -R/u);
  assert.doesNotMatch(startupScript, /setpriv/u);
  assert.match(startupScript, /npm install/u);
});
