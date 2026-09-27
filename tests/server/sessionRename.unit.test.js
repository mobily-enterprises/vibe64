import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import { ACTION_RENAME_SESSION, createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { sessionRenameInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { createAgentSessionCommandService, prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

const execFileAsync = promisify(execFile);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-rename-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ sessionId: "one", runtimeKind: "genesis", metadata: {
    source_kind: "session_clone", source_path: path.join(root, "sessions", "active", "one", "source"), source_path_authority: "managed_session_source"
  } });
  const events = [];
  return { root, store, events, publishSessionChanged: async (...args) => events.push(args) };
}

test("rename API persists the display name and publishes a list refresh without needing an AI", async (t) => {
  const f = await fixture(t);
  const service = createService({ project: { createRuntime: async () => ({ store: f.store }) }, terminals: {}, publishSessionChanged: f.publishSessionChanged });
  const action = createSessionActions({ sessions: service }).find(({ id }) => id === ACTION_RENAME_SESSION);
  assert.deepEqual(await action.execute({ sessionId: "one", name: "  My work  ", originId: "tab1" }), { ok: true, sessionId: "one", sessionName: "My work" });
  assert.equal(await f.store.readMetadataValue("one", "label"), "My work");
  assert.equal(f.events[0][1].payload.clientRefresh.includeList, true);
  assert.equal(f.events[0][1].originId, "tab1");
  assert.equal((await service.renameSession("one", { name: "bad\nname" })).ok, false);
  assert.equal((await service.renameSession("missing", { name: "Name" })).code, "vibe64_session_not_found");
});

test("rename HTTP uses the project/session route and validates input", async () => {
  for (const name of ["", " ", "x".repeat(121)]) {
    assert.ok(Object.keys(sessionRenameInputValidator.schema.create({ name }).errors).length);
  }
  assert.ok(sessionRenameInputValidator.schema.create({ name: "Valid", sessionId: "foreign" }).errors.sessionId);
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    const route = findRegisteredRoute(app, { method: "PATCH", path: `${apiRouteBase}/vibe64/sessions/:sessionId/name` });
    assert.equal(route.options.body, sessionRenameInputValidator);
    const calls = [];
    await route.handler({ executeAction: async (value) => { calls.push(value); return { ok: true }; },
      input: { body: { name: "New name", sessionId: "foreign" } }, params: routeProjectParams({ sessionId: "one" }) }, testReply());
    assert.equal(calls[0].actionId, ACTION_RENAME_SESSION);
    assert.equal(calls[0].input.sessionId, "one");
  }));
});

function socketRequest(control, route, extra = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...control, ...extra });
    const request = http.request({ socketPath: control.socketPath, method: "POST", path: route, headers: { "Content-Type": "application/json" } }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("the real chat helper renames only its bound session and cannot use the shell control route", async (t) => {
  const f = await fixture(t);
  const wrapperHostDir = path.join(f.root, "wrappers");
  const project = { slug: "test", projectRoot: f.root };
  const service = createAgentSessionCommandService({
    projectService: {
      readCurrentProject: async () => project,
      createSessionStore: async () => f.store,
      runInProjectContext: async (slug, operation) => { assert.equal(slug, "test"); return operation(); }
    },
    publishSessionChanged: f.publishSessionChanged,
    stopOwnedExecutions: async () => ({ supported: true, ok: true })
  });
  t.after(() => service.closeAllForSession("one"));
  const prepared = await prepareAgentSessionCommand({ commandService: service, sessionId: "one", wrapperHostDir });
  await prepareAgentHelperCommand({ wrapperHostDir });
  // A managed child has the rename capability, never the shell transport token.
  const env = { PATH: process.env.PATH, VIBE64_SESSION_RENAME_CONTROL: prepared.env.VIBE64_SESSION_RENAME_CONTROL };
  const result = await execFileAsync(path.join(wrapperHostDir, "vibe64-helper"), ["session", "rename", "My renamed session"], { env });
  assert.deepEqual(JSON.parse(result.stdout), { sessionName: "My renamed session" });
  assert.equal(await f.store.readMetadataValue("one", "label"), "My renamed session");
  assert.equal(f.events[0][1].reason, "session-renamed");
  const control = JSON.parse(env.VIBE64_SESSION_RENAME_CONTROL);
  for (const [route, extra] of [
    ["/agent-session-command/rename", { sessionId: "other", name: "Stolen" }],
    ["/agent-session-command/rename", { generationId: "old", name: "Stale" }],
    ["/agent-session-command/rename", { token: prepared.env.VIBE64_AGENT_SESSION_COMMAND_TOKEN, name: "Wrong token" }],
    ["/agent-session-command/run", { commandBase64: Buffer.from("echo bad").toString("base64url") }]
  ]) {
    assert.equal((await socketRequest(control, route, extra)).status, 403);
  }
  assert.equal((await socketRequest(control, "/agent-session-command/rename", { name: "bad\nname" })).status, 400);
  assert.equal(await f.store.readMetadataValue("one", "label"), "My renamed session");
  project.projectRoot = path.join(f.root, "changed");
  const rebound = await socketRequest(control, "/agent-session-command/rename", { name: "Wrong project" });
  assert.equal(rebound.body.code, "vibe64_agent_session_command_project_binding_changed");
});
