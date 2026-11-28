import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { createServiceCommandServices } from "../../packages/vibe64-terminals/src/server/serviceCommandServices.js";
import { createServiceHostSlots } from "../../packages/vibe64-terminals/src/server/serviceHostSlots.js";
import { createServiceState } from "../../packages/vibe64-terminals/src/server/serviceState.js";
import { Vibe64TerminalsFeature } from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsFeature.js";

// A session's AI controls the servers the host runs for its project: `vibe64-helper services` lists them with their
// state, reads their recent logs, restarts, stops or starts one, and on the session's own databases lists the
// connections, who waits on whom, and ends one, for the project's development or, with --staging, its Staging. Each
// call reaches the host's service control only through the session control, for the session's own project and
// session, never ones the caller names; the AI never gets a database login. A database server every project shares is
// restarted or stopped only while the session's Need help is raised: the command checks the flag, gives it to the
// host, and adds what was done to it. Without a host, Vibe64 runs no such servers and says so.

function run(command, args, { env, cwd }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
}

/** The session's Need help as its feature fills the slot: raised or not, and the follow-ups added to it. */
function needHelpService() {
  const needHelp = {
    flag: null,
    raised: [],
    async read(sessionId) {
      return { ok: true, sessionId, needHelp: needHelp.flag, text: "" };
    },
    async raise(sessionId, input) {
      needHelp.raised.push([sessionId, input]);
      return { ok: true };
    }
  };
  return needHelp;
}

/**
 * A session whose agent commands are prepared as an engine prepares them, from the terminals' command services as the
 * terminals service composes them, with the host's `serviceControl` and the Need help feature's slot filled.
 * @param {import("node:test").TestContext} t
 * @param {object} [serviceControl]
 */
async function fixture(t, serviceControl) {
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-services-command-")));
  cleanups.push(() => rm(root, { force: true, recursive: true }));
  // The editor's TMPDIR, a short folder of its own under /tmp, which holds the session's sockets.
  const editorTemp = await realpath(await mkdtemp("/tmp/v64-sc-"));
  cleanups.push(() => rm(editorTemp, { force: true, recursive: true }));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  cleanups.push(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });
  const sessionId = "session-1";
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  const wrapperHostDir = path.join(root, "wrappers");
  await mkdir(sourceRoot, { recursive: true });
  const descriptor = {
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" },
    sessionId
  };
  const routing = { status: "working", turnId: "turn-7", submittedBy: { id: "person-1" } };
  const store = {
    async readSessionSourceDescriptor() { return descriptor; },
    async readMetadataValue(_sessionId, name) {
      return name === "assistant_routing_request" ? JSON.stringify(routing) : "";
    }
  };
  const state = createServiceState({ readClaudeAccountStatus: async () => ({ loggedIn: false }) });
  const needHelp = needHelpService();
  createServiceHostSlots({ state }).setNeedHelp(needHelp);
  const { agentSessionCommand: service } = createServiceCommandServices({
    env: {},
    inspectAssistantAccess: async () => ({}),
    logger: silentLogger,
    stagingEnvironmentProvider: {},
    project: {
      createSessionStore: async () => store,
      async readCurrentProject() { return { slug: "shop", projectRoot: path.join(root, "project") }; },
      runInProjectContext: (_slug, operation) => operation()
    },
    projectServices: { assertOpen() {}, ensure: async () => ({}) },
    publishAgentSessionChanged: async () => {},
    publishSessionChanged: { outputTarget: async () => {} },
    recordWorkflowOutcome: async () => ({}),
    runCodexGitGatewayCommand: async () => ({}),
    savedEnvValueLinks: {},
    ...(serviceControl ? { serviceControl } : {}),
    sendAgentMessage: async () => ({}),
    sessionAccess: {},
    state,
    workspacePreparation: {}
  });
  cleanups.push(() => service.closeAllForSession(sessionId));
  await service.bindSession(sessionId, { wrapperHostDir });
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId, wrapperHostDir });
  assert.equal(prepared.ok, true);
  assert.deepEqual(await prepareAgentHelperCommand({ env: process.env, wrapperHostDir, sessionGroups: service.helperGroups }), { ok: true });
  const env = { ...process.env, ...prepared.env, PATH: [wrapperHostDir, process.env.PATH].join(path.delimiter) };
  const helper = (args) => run(path.join(wrapperHostDir, "vibe64-helper"), args, { cwd: sourceRoot, env });
  return { helper, needHelp, service, sessionId, sourceRoot };
}

const MARIADB = { id: "mariadb", label: "MariaDB", state: "active", shared: true, detail: "every project on the workspace shares it" };
const POSTGRESQL = { id: "postgresql", label: "PostgreSQL", state: "active", shared: true };
const REDIS = { id: "redis-development-0123456789abcdef", label: "Redis (shop, development)", state: "inactive", shared: false, detail: "starts at its next use" };
const APP = { id: "app", label: "Staging app (shop)", state: "active", shared: false, detail: "the project's Staging app" };
const connection = (id, state, seconds, query = "") => ({ id, database: "v64_shop_s1", user: "v64_shop", seconds, state, query });

/** The host's control of the shop's servers, recording what it was asked, without the signal. */
function shopServiceControl() {
  const calls = [];
  const servers = { development: [MARIADB, REDIS], staging: [APP, MARIADB] };
  const record = (name, request) => {
    const { signal, ...rest } = request;
    assert.ok(signal instanceof AbortSignal, `${name} gets the caller's signal`);
    calls.push([name, rest]);
  };
  const holder = connection(40, "Sleep", 300);
  const waiter = connection(41, "Query: Waiting for table metadata lock", 30, "ALTER TABLE orders\n  ADD COLUMN noted INT");
  const control = {
    servers,
    async listServices(request) {
      record("listServices", request);
      return { services: servers[request.target] };
    },
    async readServiceLogs(request) {
      record("readServiceLogs", request);
      return { service: MARIADB, state: "active", source: "the server's own log", lines: ["third", "second", "first"].slice(0, request.lines) };
    },
    async controlService(request) {
      record("controlService", request);
      if (request.serviceId === REDIS.id && request.action === "stop") {
        return { service: REDIS, outcome: "required", ok: false, message: "Redis (shop, development) was not stopped: the Staging app of shop needs it." };
      }
      const service = [MARIADB, POSTGRESQL, REDIS, APP].find((entry) => entry.id === request.serviceId);
      return { service, outcome: `${request.action}ed`, message: `${service.label} ${request.action === "stop" ? "stopped" : `${request.action}ed`}.` };
    },
    async listDatabaseSessions(request) {
      record("listDatabaseSessions", request);
      return { service: MARIADB, running: true, connections: [holder, waiter] };
    },
    async listDatabaseLocks(request) {
      record("listDatabaseLocks", request);
      return { service: MARIADB, running: true, waits: [{ waiting: waiter, blockers: [{ ...holder, lock: "metadata" }], elsewhere: 1 }] };
    },
    async endDatabaseConnection(request) {
      record("endDatabaseConnection", request);
      return { service: MARIADB, connection: { id: request.connectionId, database: "v64_shop_s1" }, outcome: "ended",
        message: `Connection ${request.connectionId} on v64_shop_s1 ended.`, ok: true };
    }
  };
  return { calls, control };
}

const BOUND = { actor: { id: "person-1" }, projectSlug: "shop", sessionId: "session-1", turnId: "turn-7" };

test("vibe64-helper lists services among its own groups, and its help reaches no host", async (t) => {
  const { calls, control } = shopServiceControl();
  const f = await fixture(t, control);
  assert.equal(f.service.helperGroups[0].name, "services", "the terminals' command services serve it first");
  const listed = await f.helper(["--help"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, / {2}services {5}The project's servers: state, logs, restart, stop, start, and its database connections and locks\n/u);
  for (const args of [["services"], ["services", "--help"], ["services", "-h"]]) {
    const help = await f.helper(args);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /^Usage: vibe64-helper services list \[--staging\] \[--json\]\n/u);
    assert.match(help.stdout, /vibe64-helper services db end <connection id> \[--service <service>\] \[--staging\]/u);
    assert.match(help.stdout, /run only while\nthis session's Need help is raised/u);
    assert.match(help.stdout, /raise Need help saying what you will restart and why, then vibe64-helper services db restart\./u);
    // No SQL of the AI's own, and no administrator's password (PostgreSQL is a name, not SQL).
    assert.doesNotMatch(help.stdout, /\bsql\b|\bSQL\b|administrator's password/u);
  }
  assert.deepEqual(calls, []);
  assert.equal(Vibe64TerminalsFeature.optional.serviceControl, "vibe64.terminals.service-control");
});

test("list, logs, restart, stop, start and db sessions, locks and end reach the host for the session's own project and target, and print its answers", async (t) => {
  const { calls, control } = shopServiceControl();
  const f = await fixture(t, control);
  const call = (name, extra, target = "development") => [name, { ...BOUND, sourceRoot: f.sourceRoot, target, ...extra }];

  const listed = await f.helper(["services", "list"]);
  assert.deepEqual([listed.code, listed.stderr], [0, ""]);
  assert.equal(listed.stdout, [
    "mariadb                             MariaDB                    active    shared  every project on the workspace shares it",
    "redis-development-0123456789abcdef  Redis (shop, development)  inactive          starts at its next use",
    ""
  ].join("\n"));
  const json = await f.helper(["services", "list", "--staging", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).services.map((service) => service.id), ["app", "mariadb"]);

  const logs = await f.helper(["services", "logs", "mariadb", "--lines", "2"]);
  assert.deepEqual([logs.code, logs.stdout], [0, "MariaDB (mariadb): active. Its last 2 log lines, newest first, from the server's own log.\nthird\nsecond\n"]);
  assert.equal((await f.helper(["services", "logs", "app", "--staging", "--lines=3"])).code, 0);

  // A service no other project shares, and a start, need no Need help.
  assert.deepEqual([(await f.helper(["services", "start", "mariadb"])).stdout, (await f.helper(["services", "restart", "app", "--staging"])).stdout],
    ["MariaDB started.\n", "Staging app (shop) restarted.\n"]);
  // A service the host left as it was: its reason, and a failure status.
  const kept = await f.helper(["services", "stop", REDIS.id]);
  assert.deepEqual([kept.code, kept.stdout], [1, "Redis (shop, development) was not stopped: the Staging app of shop needs it.\n"]);

  const sessions = await f.helper(["services", "db", "sessions"]);
  assert.deepEqual([sessions.code, sessions.stdout], [0, [
    "MariaDB (mariadb): 2 connections on this session's databases.",
    "ID  DATABASE     SECONDS  STATE                                   STATEMENT",
    "40  v64_shop_s1  300      Sleep                                   (no statement)",
    "41  v64_shop_s1  30       Query: Waiting for table metadata lock  ALTER TABLE orders ADD COLUMN noted INT",
    ""
  ].join("\n")]);
  const locks = await f.helper(["services", "db", "locks", "--service", "mariadb"]);
  assert.deepEqual([locks.code, locks.stdout], [0, [
    "MariaDB (mariadb): 1 connection waits.",
    "41 (v64_shop_s1, 30 s, Query: Waiting for table metadata lock): ALTER TABLE orders ADD COLUMN noted INT",
    "  waits on 40 (metadata lock; Sleep, 300 s): (no statement)",
    "  and on 1 connection on another project's database, which this session can't see or end",
    ""
  ].join("\n")]);
  assert.deepEqual(JSON.parse((await f.helper(["services", "db", "locks", "--staging", "--json"])).stdout).waits[0].blockers[0].id, 40);
  const ended = await f.helper(["services", "db", "end", "40", "--staging"]);
  assert.deepEqual([ended.code, ended.stdout], [0, "Connection 40 on v64_shop_s1 ended.\n"]);

  assert.deepEqual(calls, [
    call("listServices"),
    call("listServices", {}, "staging"),
    call("readServiceLogs", { serviceId: "mariadb", lines: 2 }),
    call("readServiceLogs", { serviceId: "app", lines: 3 }, "staging"),
    call("controlService", { serviceId: "mariadb", action: "start", needHelp: { raised: false } }),
    call("listServices", {}, "staging"),
    call("controlService", { serviceId: "app", action: "restart", needHelp: { raised: false } }, "staging"),
    call("listServices"),
    call("controlService", { serviceId: REDIS.id, action: "stop", needHelp: { raised: false } }),
    call("listDatabaseSessions", { serviceId: "" }),
    call("listDatabaseLocks", { serviceId: "mariadb" }),
    call("listDatabaseLocks", { serviceId: "" }, "staging"),
    call("endDatabaseConnection", { serviceId: "", connectionId: 40 }, "staging")
  ]);
  assert.deepEqual(f.needHelp.raised, [], "nothing shared was restarted or stopped");
});

test("a shared database server restarts or stops only while the session's Need help is raised, which the host is given, and what was done is added to it", async (t) => {
  const { calls, control } = shopServiceControl();
  const f = await fixture(t, control);
  for (const args of [["services", "restart", "mariadb"], ["services", "stop", "mariadb", "--staging"], ["services", "db", "restart"]]) {
    const refused = await f.helper(args);
    assert.equal(refused.code, 1, args.join(" "));
    assert.match(refused.stderr, /^MariaDB \(mariadb\) was not (restarted|stopped): every project on this workspace shares it, so it is (restarted|stopped) only while this session's Need help is raised\. Raise it saying what you will do and why \(vibe64-helper need-help raise "<message>"\), then run this again\.\n$/u);
  }
  assert.deepEqual(calls.map(([name]) => name), ["listServices", "listServices", "listServices"], "the host is never asked to act");

  f.needHelp.flag = { id: "need-help-1" };
  calls.length = 0;
  const restarted = await f.helper(["services", "db", "restart"]);
  assert.deepEqual([restarted.code, restarted.stdout], [0, "MariaDB restarted.\n"]);
  const stopped = await f.helper(["services", "stop", "mariadb", "--staging"]);
  assert.deepEqual([stopped.code, stopped.stdout], [0, "MariaDB stopped.\n"]);
  assert.deepEqual(calls.filter(([name]) => name === "controlService").map(([, request]) => [request.serviceId, request.action, request.target, request.needHelp]), [
    ["mariadb", "restart", "development", { raised: true, id: "need-help-1" }],
    ["mariadb", "stop", "staging", { raised: true, id: "need-help-1" }]
  ]);
  assert.deepEqual(f.needHelp.raised, [
    ["session-1", { text: "This session's AI ran services restart of MariaDB (mariadb): MariaDB restarted.", from: "agent", actor: { id: "person-1" } }],
    ["session-1", { text: "This session's AI ran services stop of MariaDB (mariadb) for its Staging: MariaDB stopped.", from: "agent", actor: { id: "person-1" } }]
  ]);

  // db restart names the project's database server: --service when it uses more than one.
  control.servers.development = [MARIADB, POSTGRESQL, REDIS];
  const ambiguous = await f.helper(["services", "db", "restart"]);
  assert.deepEqual([ambiguous.code, ambiguous.stderr], [1, "This project uses more than one database server (mariadb, postgresql): name one with --service.\n"]);
  assert.equal((await f.helper(["services", "db", "restart", "--service", "postgresql"])).stdout, "PostgreSQL restarted.\n");
  const notOne = await f.helper(["services", "db", "restart", "--service", REDIS.id]);
  assert.match(notOne.stderr, /^This project uses no database server "redis-development-0123456789abcdef" the host runs: vibe64-helper services list shows its servers\.\n$/u);
  control.servers.development = [REDIS];
  assert.match((await f.helper(["services", "db", "restart"])).stderr, /^This project uses no database server the host runs/u);
});

test("words the commands do not take are refused with the usage, before the host is asked", async (t) => {
  const { calls, control } = shopServiceControl();
  const f = await fixture(t, control);
  for (const [args, message] of [
    [["services", "drop", "mariadb"], /vibe64-helper services has no drop command\./u],
    [["services", "sql", "mariadb", "-e", "SELECT 1"], /vibe64-helper services has no sql command\./u],
    [["services", "restart"], /services restart needs one service's id, as services list shows it\./u],
    [["services", "restart", "../mariadb"], /needs one service's id/u],
    [["services", "restart", "mariadb", "redis"], /needs one service's id/u],
    [["services", "restart", "mariadb", "--now"], /services restart takes --staging, not --now\./u],
    [["services", "restart", "mariadb", "--json"], /services restart takes --staging, not --json\./u],
    [["services", "list", "--all"], /services list takes --staging, --json, not --all\./u],
    [["services", "list", "mariadb"], /services list takes no mariadb\./u],
    [["services", "logs", "mariadb", "--lines", "0"], /--lines is a whole number from 1 to 2000\./u],
    [["services", "logs", "mariadb", "--lines=2001"], /--lines is a whole number from 1 to 2000\./u],
    [["services", "logs", "mariadb", "--lines", "1e3"], /--lines is a whole number from 1 to 2000\./u],
    [["services", "logs", "mariadb", "--follow"], /services logs takes --staging, --lines, not --follow\./u],
    [["services", "db"], /services db takes sessions, locks, end or restart\./u],
    [["services", "db", "kill", "40"], /vibe64-helper services db has no kill command\./u],
    [["services", "db", "end"], /services db end needs one connection's id, as services db sessions lists it\./u],
    [["services", "db", "end", "40; KILL 50"], /needs one connection's id/u],
    [["services", "db", "end", "0"], /needs one connection's id/u],
    [["services", "db", "sessions", "--service", "../x"], /--service names a service by its id/u],
    [["services", "db", "sessions", "--database", "v64_other"], /services db sessions takes --staging, --json, --service, not --database\./u],
    [["services", "db", "restart", "--json"], /services db restart takes --staging, --service, not --json\./u]
  ]) {
    const refused = await f.helper(args);
    assert.equal(refused.code, 2, args.join(" "));
    assert.match(refused.stderr, message, args.join(" "));
    assert.match(refused.stderr, /Usage: vibe64-helper services list/u);
  }
  assert.deepEqual(calls, []);
});

test("a host's refusal reaches the AI as its message, with a failure status", async (t) => {
  const refuse = (message) => async () => { throw new Error(message); };
  const f = await fixture(t, {
    listServices: refuse("AI sessions may not use this project's staging: the workspace owner turns that on."),
    readServiceLogs: refuse("This project uses no service \"postgresql\" that Vibe64 runs."),
    controlService: refuse("unreached"),
    listDatabaseSessions: refuse("This project uses mariadb and postgresql: name one with --service."),
    listDatabaseLocks: refuse("This workspace has not made MariaDB."),
    endDatabaseConnection: refuse("Connection 50 is not on this project's databases on MariaDB, or it has ended.")
  });
  for (const [args, message] of [
    [["services", "list", "--staging"], "AI sessions may not use this project's staging: the workspace owner turns that on.\n"],
    [["services", "logs", "postgresql"], "This project uses no service \"postgresql\" that Vibe64 runs.\n"],
    [["services", "restart", "mariadb"], "AI sessions may not use this project's staging: the workspace owner turns that on.\n"],
    [["services", "db", "sessions"], "This project uses mariadb and postgresql: name one with --service.\n"],
    [["services", "db", "locks"], "This workspace has not made MariaDB.\n"],
    [["services", "db", "end", "50"], "Connection 50 is not on this project's databases on MariaDB, or it has ended.\n"]
  ]) {
    const refused = await f.helper(args);
    assert.deepEqual([refused.code, refused.stdout, refused.stderr], [1, "", message], args.join(" "));
  }
});

test("without a host, Vibe64 runs none of the project's servers: list says so and every other command is refused with why", async (t) => {
  const f = await fixture(t);
  const listed = await f.helper(["services", "list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /^This Vibe64 runs none of the project's servers itself: its database server and any other server it uses are the person's own/u);
  assert.deepEqual(JSON.parse((await f.helper(["services", "list", "--json"])).stdout), { services: [] });
  for (const args of [["services", "logs", "mariadb"], ["services", "start", "mariadb"], ["services", "db", "sessions"],
    ["services", "db", "locks"], ["services", "db", "end", "4"]]) {
    const refused = await f.helper(args);
    assert.equal(refused.code, 1, args.join(" "));
    assert.match(refused.stderr, /This Vibe64 runs none of the project's servers itself/u, args.join(" "));
  }
  assert.match((await f.helper(["services", "db", "restart"])).stderr, /^This project uses no database server the host runs/u);
});

test("the terminals feature refuses a host's service control that lacks an operation, before anything starts", async () => {
  await assert.rejects(Vibe64TerminalsFeature.setup({ serviceControl: { listServices() {}, readServiceLogs() {}, controlService() {} } }, {}),
    /A host's service control needs listDatabaseSessions, listDatabaseLocks, endDatabaseConnection\./u);
});
