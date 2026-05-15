import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APP_TEST_HOST_DOCKER_CONFIG,
  APP_TEST_TESTRUN_COMMAND_CONFIG,
  appTestTerminalArgs,
  findAvailablePort,
  resolveAppTestConfig
} from "../../packages/current-app/src/server/service.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-studio-config-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

test("app-test config defaults to a single build-and-server test run command", async () => {
  await withTemporaryRoot(async (root) => {
    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, "legacy_split_commands");
    assert.equal(config.hostDocker, false);
    assert.equal(config.testrunCommand, "npm run build;npm run server");
    assert.equal(config.preferredPort, 4100);
  });
});

test("app-test config reads testrun_command from .jskit config", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    await writeFile(
      path.join(root, APP_TEST_TESTRUN_COMMAND_CONFIG),
      "npm run build;npm run server -- --bypass-localhost-check\n",
      "utf8"
    );

    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, APP_TEST_TESTRUN_COMMAND_CONFIG);
    assert.equal(config.hostDocker, false);
    assert.equal(config.testrunCommand, "npm run build;npm run server -- --bypass-localhost-check");
    assert.equal(config.buildCommand, "");
    assert.equal(config.serverCommand, "");
  });
});

test("app-test config can opt into host Docker passthrough", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    await writeFile(path.join(root, APP_TEST_HOST_DOCKER_CONFIG), "1\n", "utf8");

    const config = await resolveAppTestConfig(root);
    assert.equal(config.hostDocker, true);
    assert.equal(config.hostDockerSource, APP_TEST_HOST_DOCKER_CONFIG);

    const args = appTestTerminalArgs({
      containerName: "app-test",
      hostDocker: config.hostDocker,
      port: 4100,
      targetRoot: root,
      terminalId: "terminal",
      testrunCommand: "npm run server",
      workdir: root
    });
    assert.ok(args.includes("DOCKER_HOST=unix:///var/run/docker.sock"));
    assert.ok(args.includes("JSKIT_STUDIO_SKIP_STALE_TERMINAL_CLEANUP=1"));
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
    assert.ok(args.includes("--user"));
    assert.match(args.at(-1), /docker_group_args="--groups \$docker_sock_gid"/);
    assert.match(args.at(-1), /\$\(id -u\)" = "0"/);
  });
});

test("app-test terminal mounts linked worktree owner roots", async () => {
  await withTemporaryRoot(async (root) => {
    const worktreeRoot = path.join(root, ".jskit", "sessions", "active", "example", "worktree");
    const gitDir = path.join(root, ".git", "worktrees", "example");

    await mkdir(worktreeRoot, {
      recursive: true
    });
    await mkdir(gitDir, {
      recursive: true
    });
    await writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");

    const args = appTestTerminalArgs({
      containerName: "app-test",
      port: 4100,
      targetRoot: worktreeRoot,
      terminalId: "terminal",
      testrunCommand: "npm run server",
      workdir: worktreeRoot
    });

    assert.ok(args.includes(`${root}:${root}`));
    assert.ok(args.includes(`${worktreeRoot}:/workspace`));
    assert.ok(args.includes(`${worktreeRoot}:${worktreeRoot}`));
  });
});

test("app-test port selection skips ports already published by Docker", async () => {
  const checkedPorts = [];
  const port = await findAvailablePort(4100, {
    hasDockerPublishedPort: async (candidate) => [4100, 4101].includes(candidate),
    isLocalPortAvailable: async (candidate) => {
      checkedPorts.push(candidate);
      return true;
    }
  });

  assert.equal(port, 4102);
  assert.deepEqual(checkedPorts, [4100, 4101, 4102]);
});

test("app-test config keeps legacy split command files as fallback", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(path.join(root, "config"), {
      recursive: true
    });
    await writeFile(path.join(root, "config", "build_command"), "npm run compile\n", "utf8");
    await writeFile(path.join(root, "config", "server_command"), "npm run serve\n", "utf8");

    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, "legacy_split_commands");
    assert.equal(config.buildCommand, "npm run compile");
    assert.equal(config.serverCommand, "npm run serve");
    assert.equal(config.testrunCommand, "npm run compile;npm run serve");
  });
});
