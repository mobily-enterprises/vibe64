import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_DATABASE_COMMAND_NAME,
  VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV,
  createAgentDatabaseCommandService,
  prepareAgentDatabaseCommand
} from "../../packages/vibe64-terminals/src/server/agentDatabaseCommand.js";

function projectService() {
  const state = {
    contexts: [],
    currentProject: {
      projectRoot: "/srv/projects/catalogue",
      slug: "catalogue"
    }
  };
  return {
    state,
    async readCurrentProject() {
      return state.currentProject;
    },
    async runInProjectContext(slug, operation) {
      state.contexts.push(slug);
      return operation();
    }
  };
}

function run(command, args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
    child.stdin.end(input);
  });
}

test("agent database command refreshes only its bound session schema", async () => {
  const project = projectService();
  const refreshes = [];
  const command = createAgentDatabaseCommandService({ projectService: project });
  command.setDatabaseToolsProvider({
    async refreshSchema(input) {
      refreshes.push(input);
      return {
        ok: true,
        schema: {
          refreshedAt: "2026-08-25T00:00:00.000Z",
          tables: [{}, {}, {}]
        }
      };
    }
  });
  await command.bindSession("database-session");

  const result = await command.run({
    args: ["refresh", "--json"],
    sessionId: "database-session"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    refreshedAt: "2026-08-25T00:00:00.000Z",
    tableCount: 3
  });
  assert.deepEqual(refreshes, [{ sessionId: "database-session", source: "agent" }]);
  assert.deepEqual(project.state.contexts, ["catalogue"]);

  const otherSession = await command.run({
    args: ["refresh"],
    sessionId: "other-session"
  });
  assert.equal(otherSession.ok, false);
  assert.equal(otherSession.code, "vibe64_agent_database_command_session_unbound");
});

test("agent database overview exposes schema and authoring guidance only for its bound session", async () => {
  const project = projectService();
  const command = createAgentDatabaseCommandService({ projectService: project });
  const reads = [];
  command.setDatabaseToolsProvider({
    refreshSchema() { assert.fail("Overview should use the existing snapshot"); },
    async readOverview(input) { reads.push(input); return { ok: true, schema: { tables: [] }, coverage: { total: 0 }, instructions: "Group main actors" }; }
  });
  await command.bindSession("overview-session");
  const result = await command.run({ args: ["overview", "--json"], sessionId: "overview-session" });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.stdout).instructions, "Group main actors");
  assert.deepEqual(reads, [{ sessionId: "overview-session" }]);
  const denied = await command.run({ args: ["overview", "--json"], sessionId: "not-bound" });
  assert.equal(denied.code, "vibe64_agent_database_command_session_unbound");
  assert.equal(reads.length, 1);
});

test("agent database command refuses a stale project binding", async () => {
  const project = projectService();
  const command = createAgentDatabaseCommandService({ projectService: project });
  command.setDatabaseToolsProvider({
    async refreshSchema() {
      assert.fail("a stale project must not reach the database provider");
    }
  });
  await command.bindSession("stale-database-session");
  project.state.currentProject = {
    projectRoot: "/srv/projects/recreated-catalogue",
    slug: "catalogue"
  };

  const result = await command.run({
    args: ["refresh"],
    sessionId: "stale-database-session"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_database_command_project_binding_changed");
});

test("agent ERD wrapper reads geometry and submits stdin moves only to its bound session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-erd-command-"));
  const command = createAgentDatabaseCommandService({ projectService: projectService() });
  const calls = [];
  command.setDatabaseToolsProvider({
    refreshSchema() { assert.fail("ERD commands do not refresh the schema"); },
    async readErd(input) { calls.push(input); return { ok: true, revision: 7, nodes: [], connections: [] }; },
    async moveErdTables(input) { calls.push(input); return { ok: true, revision: 8, previousMoves: [] }; }
  });
  try {
    const prepared = await prepareAgentDatabaseCommand({ commandService: command, sessionId: "erd-session", wrapperHostDir: root });
    const env = { ...process.env, ...prepared.env };
    const read = await run(prepared.hostWrapperPath, ["erd", "--json"], env);
    assert.equal(read.code, 0, read.stderr);
    assert.equal(JSON.parse(read.stdout).revision, 7);
    assert.deepEqual(calls, [{ sessionId: "erd-session" }]);
    const changes = { revision: 7, moves: [{ table: "public.items", x: 200, y: 300 }] };
    const applyArguments = [
      ["erd", "apply", "--json"],
      ["--json", "erd", "apply"],
      ["erd", "--json", "apply"]
    ];
    for (const args of applyArguments) {
      const moved = await run(prepared.hostWrapperPath, args, env, JSON.stringify(changes));
      assert.equal(moved.code, 0, moved.stderr);
      assert.equal(JSON.parse(moved.stdout).revision, 8);
      assert.deepEqual(calls.at(-1), { sessionId: "erd-session", changes }, args.join(" "));
    }
    assert.equal(calls.length, 4);
    const invalid = await run(prepared.hostWrapperPath, ["erd", "apply"], env, "not JSON");
    assert.equal(invalid.code, 1);
    assert.equal(calls.length, 4);
    const denied = await command.run({ args: ["erd", "apply"], sessionId: "other-session", changes });
    assert.equal(denied.code, "vibe64_agent_database_command_session_unbound");
    assert.equal(calls.length, 4);
  } finally {
    await command.closeAllForSession("erd-session");
    await rm(root, { force: true, recursive: true });
  }
});

test("agent database wrapper authenticates to its session socket", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-database-command-"));
  const project = projectService();
  const command = createAgentDatabaseCommandService({ projectService: project });
  const sessionId = "database-wrapper-session";
  command.setDatabaseToolsProvider({
    async refreshSchema() {
      return { ok: true, schema: { refreshedAt: "now", tables: [{}, {}] } };
    }
  });
  try {
    const prepared = await prepareAgentDatabaseCommand({
      commandService: command,
      sessionId,
      wrapperHostDir: root
    });

    assert.equal(prepared.ok, true);
    assert.equal((await stat(path.join(root, AGENT_DATABASE_COMMAND_NAME))).isFile(), true);
    assert.equal(prepared.env[VIBE64_AGENT_DATABASE_COMMAND_SESSION_ID_ENV], sessionId);
    assert.equal(prepared.env[VIBE64_AGENT_DATABASE_COMMAND_CONTRACT_VERSION_ENV], "1");
    assert.match(prepared.env[VIBE64_AGENT_DATABASE_COMMAND_SOCKET_ENV], /database-command\.sock$/u);
    assert.match(prepared.env[VIBE64_AGENT_DATABASE_COMMAND_TOKEN_ENV], /^[a-f0-9]{16}$/u);

    const executed = await run(prepared.hostWrapperPath, ["refresh"], {
      ...process.env,
      ...prepared.env
    });
    assert.equal(executed.code, 0);
    assert.equal(executed.stderr, "");
    assert.match(executed.stdout, /2 tables\/views/u);
  } finally {
    await command.closeAllForSession(sessionId);
    await rm(root, { force: true, recursive: true });
  }
});
