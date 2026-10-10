import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";

import {
  agentSessionCommandEnvironmentIsHealthy,
  closeAgentSessionCommandEnvironment,
  prepareAgentSessionCommandEnvironment
} from "../../packages/vibe64-terminals/src/server/agentCommandEnvironment.js";
import {
  genesisCommandShimDirectory
} from "../../packages/vibe64-genesis/src/server/index.js";

test("assistant engines share one complete session command environment", async () => {
  const calls = [];
  const service = (name) => ({ name });
  const prepared = await prepareAgentSessionCommandEnvironment({
    agentDatabaseCommand: service("database-service"),
    agentEnvCommand: service("environment-service"),
    agentPreviewCommand: service("preview-service"),
    agentSessionCommand: service("session-command-service"),
    env: { LIVE_ENV: "yes", GENESIS_PARSER_ROOT: "/release/genesis-parsers", GENESIS_PARSER_AUTO_INSTALL: "0" },
    gitCommand: service("git-service"),
    gitEnvironment: { ATTACHMENT_ENV: "yes" },
    prepareDatabaseCommand: async (input) => {
      calls.push(["database", input]);
      return { env: { DATABASE_BOUNDARY: "ready" }, ok: true };
    },
    prepareEnvironmentCommand: async (input) => {
      calls.push(["environment", input]);
      return { env: { ENV_BOUNDARY: "ready" }, ok: true };
    },
    prepareGitCommand: async (input) => {
      calls.push(["git", input]);
      return {
        env: { GIT_BOUNDARY: "ready" },
        hostWrapperDir: "/managed/session-wrappers",
        ok: true
      };
    },
    preparePreviewCommand: async (input) => {
      calls.push(["preview", input]);
      return { env: { PREVIEW_BOUNDARY: "ready" }, ok: true };
    },
    prepareHelperCommand: async (input) => {
      calls.push(["helper", input]);
      return { ok: true };
    },
    prepareSessionCommand: async (input) => {
      calls.push(["session", input]);
      return { env: { SESSION_BOUNDARY: "ready" }, ok: true };
    },
    project: { slug: "catalogue" },
    runtime: { stateRoot: "/managed/project-state", store: { paths: (id) => ({ dropZoneRoot: `/managed/project-state/sessions/active/${id}/drop-zone` }) } },
    sessionId: "session-1",
    worktreePath: "/managed/session/source"
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "git",
    "session",
    "preview",
    "environment",
    "database",
    "helper"
  ]);
  assert.equal(calls[0][1].env.ATTACHMENT_ENV, "yes");
  assert.deepEqual(calls.find(([name]) => name === "helper")[1].env,
    { LIVE_ENV: "yes", GENESIS_PARSER_ROOT: "/release/genesis-parsers", GENESIS_PARSER_AUTO_INSTALL: "0" });
  for (const [name, input] of calls.slice(1)) {
    assert.equal(input.wrapperHostDir, "/managed/session-wrappers");
    if (name !== "helper") {
      assert.equal(input.sessionId, "session-1");
    }
  }
  assert.deepEqual(prepared, {
    env: {
      GENESIS_PARSER_ROOT: "/release/genesis-parsers",
      GENESIS_PARSER_AUTO_INSTALL: "0",
      DATABASE_BOUNDARY: "ready",
      ENV_BOUNDARY: "ready",
      GIT_BOUNDARY: "ready",
      PREVIEW_BOUNDARY: "ready",
      SESSION_BOUNDARY: "ready",
      VIBE64_DROP_ZONE: "/managed/project-state/sessions/active/session-1/drop-zone"
    },
    hostWrapperDir: "/managed/session-wrappers",
    ok: true,
    shimDirs: [
      "/managed/session-wrappers",
      genesisCommandShimDirectory()
    ]
  });
});

test("a configured assistant command boundary fails closed when preparation is incomplete", async () => {
  await assert.rejects(
    prepareAgentSessionCommandEnvironment({
      agentDatabaseCommand: {},
      gitCommand: {},
      prepareDatabaseCommand: async () => ({ env: {}, ok: false }),
      prepareGitCommand: async () => ({
        env: {},
        hostWrapperDir: "/managed/session-wrappers",
        ok: true
      }),
      sessionId: "session-1"
    }),
    {
      boundary: "database",
      code: "vibe64_agent_command_boundary_unavailable"
    }
  );
});

test("the shared command environment requires the helper dispatcher to be installed", async () => {
  await assert.rejects(prepareAgentSessionCommandEnvironment({
    gitCommand: {},
    prepareGitCommand: async () => ({ ok: true, hostWrapperDir: "/managed/session-wrappers" }),
    prepareHelperCommand: async () => ({ ok: false }),
    sessionId: "session-1"
  }), { boundary: "helper", code: "vibe64_agent_command_boundary_unavailable" });
});


test("session cleanup drains admitted preparation, rejects overlapping acquisition and coalesces closes", async () => {
  const calls = [];
  let release;
  let started;
  const preparing = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const options = {
    sessionId: "closing-command-environment", gitCommand: {},
    prepareGitCommand: async () => { calls.push("prepare"); started(); await gate; return { ok: true, hostWrapperDir: "/tmp/example", env: {} }; },
    prepareHelperCommand: async () => ({ ok: true })
  };
  const preparation = prepareAgentSessionCommandEnvironment(options);
  await preparing;
  const closed = closeAgentSessionCommandEnvironment(options.sessionId, async () => { calls.push("close"); return "closed"; });
  const duplicate = closeAgentSessionCommandEnvironment(options.sessionId, async () => { throw new Error("duplicate close"); });
  await assert.rejects(prepareAgentSessionCommandEnvironment(options), { code: "vibe64_agent_command_boundary_unavailable" });
  assert.deepEqual(calls, ["prepare"]);
  release();
  await preparation;
  assert.equal(await closed, "closed");
  assert.equal(await duplicate, "closed");
  assert.deepEqual(calls, ["prepare", "close"]);
  await prepareAgentSessionCommandEnvironment(options);
  assert.deepEqual(calls, ["prepare", "close", "prepare"]);
});

test("readiness proves live control identity and lifecycle logs exclude credentials", async () => {
  const { createAgentEnvCommandService, prepareAgentEnvCommand } = await import("../../packages/vibe64-terminals/src/server/agentEnvCommand.js");
  const { subscribeUnixCommandControlChanges } = await import("../../packages/vibe64-terminals/src/server/unixJsonCommand.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-controls-"));
  const entries = [];
  const changes = [];
  const logger = { info: (event) => entries.push(event), warn: (event) => entries.push(event) };
  const service = createAgentEnvCommandService({ logger, projectService: {
    readCurrentProject: async () => ({ slug: "control-test" }),
    readEnv: async () => ({}), saveEnvUserValues: async () => ({}),
    runInProjectContext: async (_slug, operation) => operation()
  } });
  const stop = subscribeUnixCommandControlChanges((event) => changes.push(event));
  try {
    const prepared = await prepareAgentEnvCommand({ commandService: service, sessionId: "health-session", wrapperHostDir: root });
    assert.equal(await agentSessionCommandEnvironmentIsHealthy(prepared.env), true);
    assert.equal(await agentSessionCommandEnvironmentIsHealthy({ ...prepared.env, VIBE64_AGENT_ENV_COMMAND_GENERATION: "00000000-0000-4000-8000-000000000000" }), false);
    assert.equal(await agentSessionCommandEnvironmentIsHealthy({ ...prepared.env, VIBE64_AGENT_ENV_COMMAND_TOKEN: "wrong" }), false);
    assert.equal(await agentSessionCommandEnvironmentIsHealthy({ VIBE64_AGENT_ENV_COMMAND_SESSION_ID: "health-session" }), false);
    assert.ok(changes.some((event) => event.reason === "ready"));
    assert.equal(changes.filter((event) => event.reason === "rejected").length, 1, "wrong credentials cannot trigger recovery");
    await service.closeAllForSession("health-session");
    assert.equal(await agentSessionCommandEnvironmentIsHealthy(prepared.env), false);
    assert.ok(entries.some((event) => event.reason === "session-closed"));
    const serialized = JSON.stringify(entries);
    assert.ok(!serialized.includes(prepared.env.VIBE64_AGENT_ENV_COMMAND_TOKEN));
    assert.ok(!serialized.includes('"token"'));
  } finally {
    stop();
    await service.closeAllForSession("health-session");
    await rm(root, { recursive: true, force: true });
  }
});

test("managed Training authoring delegates exact arguments with ordinary shell identity and refuses operator commands", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-shim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "installed app's $(unchanged)");
  const sourceRoot = path.join(root, "assigned source");
  const wrappers = path.join(root, "wrappers");
  await mkdir(path.join(appRoot, "bin"), { recursive: true });
  await mkdir(sourceRoot);
  await writeFile(path.join(appRoot, "package.json"), '{"type":"module"}');
  // This fixture observes the existing entrypoint boundary, not a second CLI.
  // The original Training content file exercises the delegated authoring effects.
  await writeFile(path.join(appRoot, "bin", "run.js"), `
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(),
  uid: process.getuid(), gid: process.getgid(), home: process.env.HOME,
  path: process.env.PATH, marker: process.env.TRAINING_EXISTING_ENV,
  appRoot: process.env.VIBE64_APP_ROOT, node: process.execPath }));
if (process.env.TRAINING_TEST_EXIT) {
  console.error("original CLI failure");
  process.exitCode = Number(process.env.TRAINING_TEST_EXIT);
}
`);
  await writeFile(path.join(sourceRoot, "keep.txt"), "original assigned bytes");
  assert.equal((await prepareAgentHelperCommand({ wrapperHostDir: wrappers,
    env: { VIBE64_APP_ROOT: appRoot } })).ok, true);
  const childEnv = { ...process.env, HOME: path.join(root, "ordinary-home"),
    TRAINING_EXISTING_ENV: "same ordinary Env", VIBE64_APP_ROOT: "/child-env-does-not-select-cli" };
  const run = promisify(execFile);
  const commands = [
    ["validate", "topic's $(literal)"],
    ["bundle", "topic", "../new output"],
    ["publish-manifest", "../course.json", "topic-one", "topic-two"]
  ];
  for (const name of ["vibe64", "vibe64-helper"]) {
    const command = path.join(wrappers, name);
    assert.equal((await stat(command)).mode & 0o777, 0o755);
    const help = await run(command, ["training", "--help"], { cwd: sourceRoot, env: childEnv });
    assert.match(help.stdout, /validate <topic-directory>/u);
    assert.equal(help.stderr, "");
    for (const args of commands) {
      const { stdout, stderr } = await run(command, ["training", ...args], { cwd: sourceRoot, env: childEnv });
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout), { args: ["training", ...args], cwd: sourceRoot,
        uid: process.getuid(), gid: process.getgid(), home: childEnv.HOME,
        path: childEnv.PATH, marker: childEnv.TRAINING_EXISTING_ENV,
        appRoot: childEnv.VIBE64_APP_ROOT, node: process.execPath });
    }
    for (const operation of ["install-topic", "installed-courses", "enable-course", "disable-course"]) {
      await assert.rejects(run(command, ["training", operation, "topic", "/operator-root"],
        { cwd: sourceRoot, env: childEnv }), error => {
        assert.equal(error.code, 2);
        assert.equal(error.stdout, "", "operator refusal must precede the original entrypoint");
        assert.match(error.stderr, /Only training validate, bundle and publish-manifest/u);
        return true;
      });
    }
  }
  await assert.rejects(run(path.join(wrappers, "vibe64"), [], { cwd: sourceRoot, env: childEnv }), { code: 2 });
  await assert.rejects(run(path.join(wrappers, "vibe64"), ["training", "validate", "topic"],
    { cwd: sourceRoot, env: { ...childEnv, TRAINING_TEST_EXIT: "42" } }), error => {
    assert.equal(error.code, 42);
    assert.equal(error.stderr, "original CLI failure\n");
    assert.deepEqual(JSON.parse(error.stdout).args, ["training", "validate", "topic"]);
    return true;
  });
  assert.equal(await readFile(path.join(sourceRoot, "keep.txt"), "utf8"), "original assigned bytes");
});
