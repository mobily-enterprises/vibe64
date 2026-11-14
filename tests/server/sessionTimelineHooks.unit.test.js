import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";
import { VIBE64_PROJECT_ROUTE_BASE, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { flushSessionTimeline } from "@local/vibe64-core/server/sessionTimeline";
import { readSessionTimeline, runSessionTimelineCli } from "@local/vibe64-core/server/sessionTimelineCli";
import { createProjectWatchActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { createRepositoryUpdates } from "../../packages/vibe64-sessions/src/server/repositoryUpdates.js";
import { registerProjectWatch } from "../../packages/vibe64-sessions/src/server/projectWatch.js";
import { PROJECT_WATCH, PROJECT_WATCH_RELEASE } from "../../packages/vibe64-sessions/src/shared/projectWatch.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { createClaudeCodeProcess } from "../../packages/vibe64-terminals/src/server/claudeCodeProcess.js";
import { createServiceShutdown } from "../../packages/vibe64-terminals/src/server/serviceShutdown.js";
import { createServiceTurnPublication } from "../../packages/vibe64-terminals/src/server/serviceTurnPublication.js";
import { sessionAgentManagerDefaults } from "../fixtures/sessionAgentManagerDefaults.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

// The session timeline as the running server writes it: the browser watch,
// the session's engine calls, turn publications, Claude Code processes,
// failed session requests and the server's stop, each through its real owner.

const SESSION = "2026-11-14_05-00-00";
const OWNER = Object.freeze({ uid: 42, username: "owner", role: "owner" });
const TAB = "tab:5f0c2d6e-8b1a-4c3d-9e2f-7a6b5c4d3e2f";
const INTERRUPT_ROUTE = "/api/app/:slug/vibe64/sessions/:sessionId/agent-turn/interrupt";

async function withStateRoot(t) {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-timeline-hooks-"));
  t.after(() => rm(stateRoot, { force: true, recursive: true }));
  const projectRuntimeRoot = path.join(stateRoot, "projects", "shop");
  await mkdir(projectRuntimeRoot, { recursive: true });
  return { projectRuntimeRoot, stateRoot };
}

/** What `vibe64 timeline SESSION --json` prints, as objects. */
async function timelineJson(stateRoot, sessionId = SESSION) {
  await flushSessionTimeline();
  let stdout = "";
  let stderr = "";
  const status = await runSessionTimelineCli([sessionId, "--state-root", stateRoot, "--json"], {
    env: {}, stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } }
  });
  assert.equal(status, 0, stderr);
  return stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** The browser watch of the running server: its action catalogue, and one connection per call. */
function browserWatches(projectRuntimeRoot) {
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
  registerVibe64ActionContext(actions, {
    projectContext: {
      currentPracticeProjectScope: () => null,
      projectsRoot: "/fixture",
      readWorkspaceProject: async () => ({ project: { path: "/fixture/shop", projectRuntimeRoot } })
    },
    resolveUser: async () => OWNER,
    authorizeProject() {}
  });
  const probe = { watch() { return () => {}; } };
  actions.register({ contributorId: "repository-updates", domain: "vibe64-sessions",
    actions: createProjectWatchActions({ repositoryUpdates: createRepositoryUpdates({ closeWatches() {}, probe }) })
      .map((action) => ({ ...action, surfaces: ["app"] })) });
  let listener;
  registerProjectWatch({ actions, realtime: { onConnection(next) { listener = next; return () => {}; } } });
  return function connect() {
    const socket = new EventEmitter();
    socket.connected = true;
    socket.join = () => {};
    socket.leave = () => {};
    const release = listener({ socket, readRequest: async () => ({ params: {} }) });
    return {
      watch: (input) => new Promise((resolve) => socket.emit(PROJECT_WATCH, input, resolve)),
      leave: (watchId) => socket.emit(PROJECT_WATCH_RELEASE, { watchId }),
      // As Socket.IO drops a connection: its disconnect listeners, then the realtime service's release.
      drop(reason) {
        socket.connected = false;
        socket.emit("disconnect", reason);
        release();
      }
    };
  };
}

function turnPublication() {
  const followUps = [];
  const { publishAgentSessionChanged } = createServiceTurnPublication({
    afterTemporaryTurn: async () => {},
    finishInterruptedCloses: async () => {},
    afterRoutedTurn: async () => {},
    cancelGoalIfMainAiChanged: async () => false,
    continueGoalWhenLimitResets: async () => {},
    resumeGoalAfterTurn: async () => false,
    logger: silentLogger,
    providerUsage: { observe() {} },
    publishSessionChanged: { agentTerminal: async () => {} },
    state: { lifecycle: { closing: false }, trackShutdownWork: (work) => followUps.push(work) },
    workspacePreparation: { ensureWorkspacePrepared: async () => {} },
    conversationTurns: { settled: async () => {} }
  });
  const run = (turn, state, active) => ({
    reason: active ? "claude-stream-turn-active" : "claude-stream-turn-idle",
    payload: { agentRun: { engineId: "claude", state, active, providerTurnId: turn, providerThreadId: "thread-1" } }
  });
  return {
    running: (turn) => publishAgentSessionChanged(SESSION, run(turn, "active", true)),
    ended: (turn, state) => publishAgentSessionChanged(SESSION, run(turn, state, false)),
    settled: () => Promise.all(followUps)
  };
}

const shown = (events) => events.map(({ kind, event, ...fields }) => {
  const { at: _at, project: _project, session: _session, ...rest } = fields;
  return [`${kind}.${event}`, rest];
});

test("a session's timeline shows a turn, the connection lost and regained during it, and a cancelled turn, with who and why", async (t) => {
  const { projectRuntimeRoot, stateRoot } = await withStateRoot(t);
  const connect = browserWatches(projectRuntimeRoot);
  const turnsAsked = [];
  const manager = createSessionAgentManager({
    ...sessionAgentManagerDefaults,
    defaultProviderId: "claude",
    providers: [{
      id: "claude",
      transportId: "claude_test",
      async sendMessage(_context, input) {
        turnsAsked.push(input.messageId);
        return { ok: true, delivered: true, turnId: `turn-${turnsAsked.length}` };
      },
      async interruptTurn() { return { ok: true, interrupted: true }; },
      async closeSession() { return { ok: true, closed: 1 }; }
    }]
  });
  const runtime = { stateRoot: projectRuntimeRoot };
  const published = turnPublication();
  const asOwner = (operation, requestMeta) => runWithProjectRequestContext(
    { projectRuntimeRoot, slug: "shop", vibe64User: OWNER },
    operation,
    requestMeta ? { requestMeta } : {}
  );
  const watch = { watchId: "watch-1", projectSlug: "shop", sessionId: SESSION, originId: TAB };

  const first = connect();
  assert.deepEqual(await first.watch(watch), { ok: true });
  await asOwner(async () => {
    await manager.sendMessage(SESSION, { messageId: "message-1", message: "Words the timeline never keeps" }, { runtime });
    await published.running("turn-1");
  });
  first.drop("transport close");
  const second = connect();
  assert.deepEqual(await second.watch(watch), { ok: true });
  await asOwner(async () => {
    await published.ended("turn-1", "completed");
    await manager.sendMessage(SESSION, { messageId: "message-2", message: "More words" }, { runtime });
    await published.running("turn-2");
    await published.running("turn-2");
  });
  await asOwner(() => manager.interruptTurn(SESSION, { reason: "cancel-message" }, { runtime, vibe64User: OWNER }), {
    request: { method: "POST", routeOptions: { url: INTERRUPT_ROUTE } }
  });
  await asOwner(() => published.ended("turn-2", "cancelled"));
  second.leave("watch-1");
  await manager.closeSession(SESSION, { runtime, changeover: true });
  createServiceShutdown({ state: {}, sessionAgent: { beginShutdown: () => ({ ok: true }) } }).beginShutdown();
  await published.settled();

  const events = await timelineJson(stateRoot);
  const [, reconnected] = events.filter(({ kind }) => kind === "connection").slice(1);
  assert.ok(reconnected.offlineMs >= 0 && reconnected.offlineMs < 60_000, "the reconnect says how long the tab was away");
  const connection = { tab: TAB, user: "owner" };
  const mainTurn = { engine: "claude", chat: "main", by: "owner", trigger: "background" };
  assert.deepEqual(shown(events), [
    ["connection.connected", connection],
    ["turn.started", { ...mainTurn, message: "message-1", turn: "turn-1" }],
    ["turn.running", { engine: "claude", chat: "main", turn: "turn-1", thread: "thread-1" }],
    ["connection.disconnected", { ...connection, reason: "transport close" }],
    ["connection.reconnected", { ...connection, offlineMs: reconnected.offlineMs }],
    ["turn.finished", { engine: "claude", chat: "main", turn: "turn-1", thread: "thread-1" }],
    ["turn.started", { ...mainTurn, message: "message-2", turn: "turn-2" }],
    ["turn.running", { engine: "claude", chat: "main", turn: "turn-2", thread: "thread-1" }],
    ["turn.cancel-requested", { ...mainTurn, reason: "cancel-message", trigger: `POST ${INTERRUPT_ROUTE}` }],
    ["turn.cancelled", { engine: "claude", chat: "main", turn: "turn-2", thread: "thread-1" }],
    ["connection.left", connection],
    ["conversation.engine-session-closed", { engine: "claude", chat: "main", reason: "engine changeover", ok: true, trigger: "background" }],
    ["server.stopping", { reason: "server-shutdown" }]
  ]);
  assert.doesNotMatch(JSON.stringify(events), /Words the timeline|More words/u, "a message's words never reach the timeline");
});

test("a session request that fails on Vibe64's side is in its timeline; a refusal and a request outside a session are not", async (t) => {
  const { projectRuntimeRoot, stateRoot } = await withStateRoot(t);
  const projectsRoot = path.join(stateRoot, "sources");
  await mkdir(path.join(projectsRoot, "shop"), { recursive: true });
  const app = testRouteApp();
  const routes = createActionRouteScope(vibe64RouteHttp(app.http, { tags: ["unit-test"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed: true,
      projectContext: {
        projectsRoot,
        currentPracticeProjectScope: () => null,
        readWorkspaceProject: async ({ slug }) => ({ project: { path: path.join(projectsRoot, slug), projectRuntimeRoot }, projectsRoot })
      }
    })
  });
  routes.serviceRoute("GET", "/sessions/:sessionId/thrown", {}, () => {
    throw Object.assign(new Error("Disk gone"), { statusCode: 500, code: "unit_disk_gone" });
  });
  routes.serviceRoute("GET", "/sessions/:sessionId/answered", {}, () => ({ ok: false, statusCode: 503, code: "unit_unavailable" }));
  routes.serviceRoute("GET", "/sessions/:sessionId/refused", {}, () => ({ ok: false, statusCode: 409, code: "unit_conflict" }));
  routes.serviceRoute("GET", "/projectwide", {}, () => ({ ok: false, statusCode: 500, code: "unit_projectwide" }));
  const server = Fastify();
  t.after(() => server.close());
  for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler });
  const base = `/api/app/shop/vibe64`;
  assert.equal((await server.inject({ method: "GET", url: `${base}/sessions/${SESSION}/thrown` })).statusCode, 500);
  assert.equal((await server.inject({ method: "GET", url: `${base}/sessions/${SESSION}/answered` })).statusCode, 503);
  assert.equal((await server.inject({ method: "GET", url: `${base}/sessions/${SESSION}/refused` })).statusCode, 409);
  assert.equal((await server.inject({ method: "GET", url: `${base}/projectwide` })).statusCode, 500);

  assert.deepEqual(shown((await timelineJson(stateRoot)).filter(({ kind }) => kind === "request")), [
    ["request.failed", { method: "GET", route: "/api/app/:slug/vibe64/sessions/:sessionId/thrown", status: 500, code: "unit_disk_gone" }],
    ["request.failed", { method: "GET", route: "/api/app/:slug/vibe64/sessions/:sessionId/answered", status: 503, code: "unit_unavailable" }]
  ]);
});

test("a session's Claude Code process start, Vibe64's stop and its exit are in its timeline; a tool-free helper's are not", async (t) => {
  const { projectRuntimeRoot, stateRoot } = await withStateRoot(t);
  const command = path.join(stateRoot, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { models: [{ value: 'fixture' }] } } }) + '\\n');
});
`, { mode: 0o700 });
  const start = (toolFree) => runWithProjectRequestContext({ projectRuntimeRoot, slug: "shop", vibe64User: OWNER }, () => createClaudeCodeProcess({
    env: process.env, logger: silentLogger, command, workdir: stateRoot, credentialHome: { home: stateRoot }, toolFree,
    execution: { ownerId: "conversation-1", sessionId: SESSION, projectSlug: "shop" }
  }));
  const helper = await start(true);
  assert.equal((await helper.stop()).scopeEmpty, true);
  const native = await start(false);
  t.after(() => native.stop());
  assert.equal((await native.stop()).scopeEmpty, true);

  const events = (await timelineJson(stateRoot)).filter(({ kind }) => kind === "process");
  assert.deepEqual(events.map(({ event }) => event), ["started", "stopped", "exited"]);
  const [started, stopped, exited] = events;
  assert.equal(started.engine, "claude");
  assert.ok(Number.isSafeInteger(started.pid) && started.pid > 0, "the start names the process");
  assert.ok(started.execution);
  assert.deepEqual([stopped.execution, exited.execution], [started.execution, started.execution]);
  assert.equal(exited.exitCode, undefined, "a process Vibe64 stopped has no exit code of its own");
  assert.deepEqual(await readSessionTimeline(projectRuntimeRoot, "conversation-1"), [], "nothing is filed under the helper's owner");
});
