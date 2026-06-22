import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  githubSshToHttpsGitEnv
} from "@local/studio-terminal-core/server/gitGithubTransport";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR,
  STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL,
  STUDIO_GITHUB_PROVIDER_HOME_PATH,
  STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS,
  STUDIO_PLAYWRIGHT_BROWSERS_PATH,
  STUDIO_PLAYWRIGHT_BROWSERS_VOLUME,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  STUDIO_TOOL_HOME_VOLUME
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  assertDockerEnv,
  assertDockerVolumeMount
} from "./dockerArgsTestHelpers.js";

function assertPlaywrightBrowserCache(args) {
  assertDockerVolumeMount(args, STUDIO_PLAYWRIGHT_BROWSERS_VOLUME, STUDIO_PLAYWRIGHT_BROWSERS_PATH);
  assertDockerEnv(args, "PLAYWRIGHT_BROWSERS_PATH", STUDIO_PLAYWRIGHT_BROWSERS_PATH);
}

function assertGithubSshTransportRewrite(args) {
  for (const [key, value] of Object.entries(githubSshToHttpsGitEnv())) {
    assertDockerEnv(args, key, value);
  }
}

test("doctor toolchain commands run with the shared Studio tool-home ownership contract", () => {
  const args = buildDoctorToolchainArgs(["npm", "prefix", "-g"]);

  assert.deepEqual(args.slice(0, 1 + STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS.length), [
    "run",
    ...STUDIO_MANAGED_TOOLCHAIN_DOCKER_RUN_PULL_ARGS
  ]);
  assertPlaywrightBrowserCache(args);
  assertGithubSshTransportRewrite(args);
  assert.ok(args.includes(`HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(args.includes(`VIBE64_HOST_UID=${process.getuid()}`));
  assert.ok(args.includes(`VIBE64_HOST_GID=${process.getgid()}`));

  const imageIndex = args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE);
  assert.notEqual(imageIndex, -1);
  assert.deepEqual(args.slice(imageIndex + 1, imageIndex + 3), ["bash", "-lc"]);

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.match(startupScript, /chown -R "\$VIBE64_HOST_UID:\$VIBE64_HOST_GID" "\$HOME"/u);
  assert.match(startupScript, /setpriv --reuid "\$VIBE64_HOST_UID" --regid "\$VIBE64_HOST_GID"/u);
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
  assertGithubSshTransportRewrite(args);
  assert.equal(args.includes(`${STUDIO_TOOL_HOME_VOLUME}:${STUDIO_TOOL_HOME_PATH}`), false);
  assert.equal(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`), false);
  assert.ok(args.includes("HOME=/tmp/studio-home"));

  const startupScript = args.at(-1);
  assert.match(startupScript, /export HOME=\/tmp\/studio-home/u);
  assert.match(startupScript, /mkdir -p "\$HOME"/u);
  assert.doesNotMatch(startupScript, /chown -R/u);
  assert.doesNotMatch(startupScript, /setpriv/u);
  assert.match(startupScript, /npm install/u);
});

test("doctor toolchain can mount an explicit managed tool home source", () => {
  const toolHomeSource = "/tmp/vibe64-terminal-home";
  const githubToolHomeSource = "/tmp/vibe64-provider-home";
  const args = buildDoctorToolchainArgs(["gh", "auth", "status"], {
    githubToolHomeSource,
    toolHomeSource
  });

  assertDockerVolumeMount(args, toolHomeSource, STUDIO_TOOL_HOME_PATH);
  assertDockerVolumeMount(args, githubToolHomeSource, STUDIO_GITHUB_PROVIDER_HOME_PATH);
  assert.ok(args.includes(`HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(args.includes(`GH_CONFIG_DIR=${STUDIO_GITHUB_PROVIDER_GH_CONFIG_DIR}`));
  assert.ok(args.includes(`GIT_CONFIG_GLOBAL=${STUDIO_GITHUB_PROVIDER_GIT_CONFIG_GLOBAL}`));
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.match(startupScript, /ln -sfn "\$GH_CONFIG_DIR" "\$HOME\/\.config\/gh"/u);
  assert.match(startupScript, /gh auth status/u);
});
