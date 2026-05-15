import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APP_TEST_HOST_DOCKER_CONFIG,
  APP_TEST_TESTRUN_COMMAND_CONFIG,
  NPM_SCRIPTS_STARRED_CONFIG,
  appTestTerminalArgs,
  createService,
  inspectNpmScripts,
  findAvailablePort,
  npmScriptCommandPreview,
  npmScriptTerminalArgs,
  resetStarredNpmScripts,
  saveStarredNpmScripts,
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

async function writePackageJson(root, scripts) {
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "npm-script-target",
      private: true,
      scripts
    }, null, 2),
    "utf8"
  );
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
    assert.ok(args.includes("jskit_ai_studio_tool_home:/home/studio"));
    assert.match(args.at(-1), /GH_CONFIG_DIR=\/home\/studio\/\.config\/gh/);
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
    assert.ok(args.includes("jskit_ai_studio_tool_home:/home/studio"));
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

test("npm scripts default starred names resolve from package scripts when config is missing", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      build: "vite build",
      devlinks: "jskit app link-local-packages",
      "jskit:update": "jskit app update-packages",
      preview: "vite preview",
      server: "node server.js",
      test: "node --test",
      verify: "jskit app verify"
    });

    const result = await inspectNpmScripts(root);

    assert.equal(result.ok, true);
    assert.equal(result.config.source, "default");
    assert.deepEqual(result.starredScriptNames, ["jskit:update", "devlinks", "build", "server", "verify"]);
    assert.deepEqual(
      result.scripts.filter((script) => script.starred).map((script) => script.name).sort(),
      ["build", "devlinks", "jskit:update", "server", "verify"].sort()
    );
  });
});

test("npm scripts blank starred config means no starred scripts", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      dev: "vite",
      test: "node --test"
    });
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    await writeFile(path.join(root, NPM_SCRIPTS_STARRED_CONFIG), "\n", "utf8");

    const result = await inspectNpmScripts(root);

    assert.equal(result.ok, true);
    assert.equal(result.config.source, "config");
    assert.deepEqual(result.starredScriptNames, []);
    assert.deepEqual(result.scripts.filter((script) => script.starred), []);
  });
});

test("npm scripts configured starred names preserve order and filter missing scripts", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      build: "vite build",
      dev: "vite",
      lint: "eslint ."
    });
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    await writeFile(
      path.join(root, NPM_SCRIPTS_STARRED_CONFIG),
      "lint\nmissing\ndev\nlint\n",
      "utf8"
    );

    const result = await inspectNpmScripts(root);

    assert.equal(result.ok, true);
    assert.deepEqual(result.starredScriptNames, ["lint", "dev"]);
  });
});

test("npm scripts starred persistence writes full newline-delimited list", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      dev: "vite",
      lint: "eslint .",
      preview: "vite preview"
    });

    const result = await saveStarredNpmScripts(root, {
      scriptNames: ["lint", "dev"]
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.starredScriptNames, ["lint", "dev"]);
    assert.equal(await readFile(path.join(root, NPM_SCRIPTS_STARRED_CONFIG), "utf8"), "lint\ndev\n");
  });
});

test("npm scripts starred reset deletes the override and restores defaults", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      build: "vite build",
      devlinks: "jskit app link-local-packages",
      "jskit:update": "jskit app update-packages",
      lint: "eslint .",
      server: "node server.js",
      verify: "jskit app verify"
    });
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    const configPath = path.join(root, NPM_SCRIPTS_STARRED_CONFIG);
    await writeFile(configPath, "lint\n", "utf8");

    const result = await resetStarredNpmScripts(root);

    assert.equal(result.ok, true);
    assert.deepEqual(result.starredScriptNames, ["jskit:update", "devlinks", "build", "server", "verify"]);
    await assert.rejects(access(configPath), {
      code: "ENOENT"
    });
  });
});

test("npm scripts reject unknown star and run names without side effects", async () => {
  await withTemporaryRoot(async (root) => {
    await writePackageJson(root, {
      dev: "vite"
    });

    const starred = await saveStarredNpmScripts(root, {
      scriptNames: ["dev", "missing"]
    });
    assert.equal(starred.ok, false);
    assert.equal(starred.errors[0].code, "unknown_npm_script");
    await assert.rejects(access(path.join(root, NPM_SCRIPTS_STARRED_CONFIG)), {
      code: "ENOENT"
    });

    const terminal = await createService({
      appRoot: root
    }).startNpmScriptTerminal({
      scriptName: "missing"
    });
    assert.equal(terminal.ok, false);
    assert.equal(terminal.errors[0].code, "unknown_npm_script");
  });
});

test("npm script terminal args use npm run preview and preserve Docker toolchain options", async () => {
  await withTemporaryRoot(async (root) => {
    const args = npmScriptTerminalArgs({
      containerName: "npm-script",
      hostDocker: true,
      scriptName: "test:client",
      targetRoot: root,
      terminalId: "terminal",
      workdir: root
    });

    assert.equal(npmScriptCommandPreview("test:client"), "npm run test:client");
    assert.ok(args.includes("jskit-ai-studio.kind=npm-script-terminal"));
    assert.ok(args.includes(`${root}:/workspace`));
    assert.ok(args.includes(`${root}:${root}`));
    assert.ok(args.includes("DOCKER_HOST=unix:///var/run/docker.sock"));
    assert.ok(args.includes("JSKIT_STUDIO_SKIP_STALE_TERMINAL_CLEANUP=1"));
    assert.ok(args.includes("/var/run/docker.sock:/var/run/docker.sock"));
    assert.ok(args.includes("--user"));
    assert.match(args.at(-1), /npm run test:client/);
    assert.match(args.at(-1), /docker_group_args="--groups \$docker_sock_gid"/);
  });
});
