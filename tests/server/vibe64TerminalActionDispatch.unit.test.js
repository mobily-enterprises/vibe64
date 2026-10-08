import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { ACTION_READ_CANONICAL_AGENT_GOAL, ACTION_UPDATE_CANONICAL_AGENT_GOAL, createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createMainBrowserConversations } from "../../packages/vibe64-sessions/src/server/mainBrowserConversations.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { registerRoutes } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

function catalogue(terminals, projectContext, { resolveUser, authorizeProject, resolveLearningContext } = {}) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "terminals", domain: "terminals", actions: createTerminalActions({ terminals }).map((action) => ({
    channels: ["api", "automation"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { projectContext, ...(resolveLearningContext ? { resolveLearningContext } : {}),
    resolveUser: resolveUser || (async () => ({ username: "owner", role: "owner" })),
    authorizeProject: authorizeProject || (async () => {})
  });
  return actions;
}

test("terminal and output HTTP operations share validated actions and fresh authority with automation", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const owner = { username: "owner", role: "owner" };
    let allowed = true;
    const calls = [];
    const cases = [
      ["GET", "/codex-terminal", "global-terminal.status", "globalCodexTerminalState", {}],
      ["POST", "/codex-terminal", "global-terminal.start", "startGlobalCodexTerminal", {}],
      ["POST", "/agent-sessions/reconcile", "agent-sessions.reconcile", "reconcileOpenAgentSessions", {}],
      ["POST", "/project-runtime/open", "project-runtime.open", "openProjectRuntime", { reason: "project-open" }],
      ["POST", "/project-runtime/close", "project-runtime.close", "closeProjectRuntime", { reason: "user-request" }],
      ["GET", "/sessions/:sessionId/outputs", "outputs.read", "outputTargetStatus", {}],
      ["POST", "/sessions/:sessionId/output-runs", "output-target.start", "startOutputTargetTerminal", { outputTargetId: "web", outputParameters: { audience: "Preview" }, forceRestart: true }],
      ["POST", "/sessions/:sessionId/output-runs/open", "output-target.open", "openOutputTarget", {}],
      ["POST", "/sessions/:sessionId/output-runs/:terminalSessionId/stop", "output-target.stop", "stopOutputTargetTerminal", {}],
      ["POST", "/sessions/:sessionId/preview-identity", "preview-identity.select", "selectPreviewIdentity", { mode: "identity", identityName: "editor" }],
      ["POST", "/sessions/:sessionId/agent-terminal", "agent-terminal.start", "startAgentTerminal", { originId: "tab:owner", size: { cols: 80, rows: 24 } }],
      ["GET", "/sessions/:sessionId/agent-goal", "agent-goal.read", "readAgentGoal", {}],
      ["POST", "/sessions/:sessionId/agent-goal", "agent-goal.update", "updateAgentGoal", { action: "resume", threadId: "thread-1", createdAt: 123.456, objective: " Preserve exact whitespace. " }],
      ["GET", "/sessions/:sessionId/agent-plan-usage", "agent-plan-usage.read", "readAgentPlanUsage", {}],
      ["GET", "/sessions/:sessionId/work-plan", "work-plan.read", "readSessionWorkPlan", { offset: 0, limit: 1000 }],
      ["POST", "/sessions/:sessionId/work-plan/archive", "work-plan.archive", "archiveSessionWorkPlan", { expectedRevision: "a".repeat(64) }],
      ["POST", "/sessions/:sessionId/work-plan/restore", "work-plan.restore", "restoreSessionWorkPlan", { archiveId: "b".repeat(64) }],
      ["POST", "/sessions/:sessionId/agent-session", "agent-session.prepare", "ensureAgentSession", {}]
    ];
    for (const [prefix, suffix, read, close, write] of [
      ["output-terminal", "/sessions/:sessionId/output-runs/:terminalSessionId/terminal", "readOutputTargetTerminal", "closeOutputTargetTerminal"],
      ["agent-terminal", "/sessions/:sessionId/agent-terminal/:terminalSessionId", "readAgentTerminal", "closeAgentTerminal", "writeAgentTerminal"],
      ["global-terminal", "/codex-terminal/:terminalSessionId", "readGlobalCodexTerminal", "closeGlobalCodexTerminal", "writeGlobalCodexTerminal"]
    ]) {
      cases.push(["GET", suffix, `${prefix}.read`, read, {}], ["DELETE", suffix, `${prefix}.close`, close, {}]);
      if (write) cases.push(
        ["GET", `${suffix}/control/snapshot`, `${prefix}.control.snapshot`, read, {}],
        ["GET", `${suffix}/control/quiet`, `${prefix}.control.snapshot`, read, {}],
        ["POST", `${suffix}/control/check-text`, `${prefix}.control.check-text`, read, { text: "ready" }],
        ["POST", `${suffix}/control/text`, `${prefix}.control.text`, write, { text: " echo hello\r\n", attachmentIds: ["attachment-1"], originId: "tab:owner" }],
        ["POST", `${suffix}/control/key`, `${prefix}.control.key`, write, { key: "ctrl-c" }]
      );
    }
    const terminals = Object.fromEntries(cases.map(([, , , method]) => [method, async (...args) => {
      const context = currentProjectRequestContext();
      calls.push({ method, args, project: context.slug, actor: context.vibe64User });
      return { ok: true, id: "terminal-1", output: "ready", status: "running", lastOutputAt: new Date(0).toISOString() };
    }]));
    const actions = catalogue(terminals, projectContext, { resolveUser: async () => owner,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
    });
    const app = testRouteApp();
    registerRoutes(app.http, { fastify: { get() {} }, projectContext, routeRelativePath: "vibe64", routeSurface: "app", terminals, uploads: { readSingleMultipartFile() {} } });
    assert.equal(actions.listDefinitions().length, 47);
    for (const [method, suffix, operation, serviceMethod, data] of cases) {
      const actionId = `vibe64.terminals.${operation}`;
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${suffix}` });
      assert.ok(route, suffix);
      let actionInput;
      const request = { headers: { host: "owner.example.test", "x-forwarded-proto": "https" },
        params: routeProjectParams({ sessionId: "session-1", terminalSessionId: "terminal-1" }),
        input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: actualId, input }) {
          assert.equal(actualId, actionId);
          assert.equal(Object.hasOwn(input, "vibe64User"), false);
          actionInput = input;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true, operation);
      const fromHttp = calls.at(-1);
      assert.equal(fromHttp.method, serviceMethod);
      assert.equal(fromHttp.actor, owner);
      assert.equal(fromHttp.project, slug);
      const execute = (input = { ...actionInput, projectSlug: slug }) => actions.execute({ actionId, input, context: { channel: "automation", surface: "app" } });
      await execute();
      assert.deepEqual(calls.at(-1), fromHttp, operation);
      if (operation.endsWith("control.text") || operation.endsWith("control.key")) {
        const [text, options] = fromHttp.args.slice(-2);
        assert.equal(text, operation.endsWith("control.text") ? data.text : "\u0003");
        assert.equal(options.trackGitActor, true);
        assert.equal(options.vibe64User, owner);
      }
      if (operation === "agent-goal.update") {
        assert.equal(fromHttp.args[1].objective, data.objective);
        assert.equal(fromHttp.args[1].createdAt, data.createdAt);
      }
      if (operation === "agent-terminal.start") {
        assert.deepEqual(fromHttp.args[1].size, { cols: 80, rows: 24 });
        assert.equal(fromHttp.args[2].vibe64User, owner);
      }
      assert.equal(actions.getDefinition(actionId).input.mode, "create");
      assert.equal(actions.getDefinition(actionId).extensions.assistant.exclude === true,
        !["work-plan.read", "outputs.read", "output-target.start", "output-target.stop", "output-terminal.read", "output-terminal.close"].includes(operation));
      const count = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      await assert.rejects(execute(), { statusCode: 403 });
      allowed = true;
      await assert.rejects(execute({ ...actionInput, projectSlug: slug, vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
      assert.equal(calls.length, count);
    }
    const count = calls.length;
    for (const [operation, input] of [
      ["work-plan.restore", { sessionId: "session-1" }],
      ["work-plan.restore", { sessionId: "session-1", archiveId: "../current" }],
      ["work-plan.restore", { sessionId: "session-1", archiveId: "a".repeat(64), archiveCurrent: true }],
      ["agent-goal.update", { sessionId: "session-1" }], ["agent-goal.update", { sessionId: "session-1", action: "complete" }],
      ["agent-goal.update", { sessionId: "session-1", action: "set", tokenBudget: 0 }],
      ["agent-terminal.start", { sessionId: "session-1", size: { command: "whoami" } }],
      ["agent-terminal.start", { sessionId: "session-1", size: { rows: -1 } }],
      ["agent-session.prepare", { sessionId: "session-1", runtime: {} }],
      ["agent-terminal.read", { terminalSessionId: "terminal-1" }],
      ["agent-terminal.read", { sessionId: "", terminalSessionId: "terminal-1" }],
      ["global-terminal.control.text", { terminalSessionId: "terminal-1" }],
      ["global-terminal.control.key", { terminalSessionId: "terminal-1", key: "rm -rf" }],
      ["global-terminal.control.text", { terminalSessionId: "terminal-1", text: "hi", trackGitActor: false }],
      ["output-target.start", { sessionId: "session-1" }]
    ]) await assert.rejects(actions.execute({ actionId: `vibe64.terminals.${operation}`, input: { ...input, projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" }, operation);
    assert.equal(calls.length, count);
    assert.equal(currentProjectRequestContext(), null);
  }));
});

test("output and attachment action downloads stream exact bytes and close their handles", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, apiBase, projectContext, slug }) => {
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-terminal-download-"));
    const server = Fastify();
    let allowed = true;
    const handles = [];
    const bytes = Buffer.alloc(2 * 1024 * 1024, 171);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const fileName = "résultat.bin";
    await writeFile(path.join(root, "content"), bytes);
    const read = async (sessionId, id) => {
      assert.equal(sessionId, "session-1");
      assert.equal(id, "result-1");
      assert.equal(currentProjectRequestContext().slug, slug);
      const fileHandle = await open(path.join(root, "content"), "r");
      handles.push({ fileHandle, closed: once(fileHandle, "close") });
      return { fileHandle, result: { sha256: hash, name: fileName, size: bytes.length, mediaType: "application/octet-stream" },
        attachment: { fileName, contentType: "application/octet-stream" } };
    };
    const terminals = { readOutputResult: read, readAgentAttachment: read };
    const actions = catalogue(terminals, projectContext, { async authorizeProject() {
      if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 });
    } });
    const app = testRouteApp();
    registerRoutes(app.http, { fastify: { get() {} }, projectContext, routeRelativePath: "vibe64", routeSurface: "app", terminals, uploads: { readSingleMultipartFile() {} } });
    server.addHook("onRequest", async (request) => {
      request.executeAction = ({ actionId, input }) => actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
    });
    for (const suffix of ["output-results/:resultId", "agent-attachments/:attachmentId"]) {
      const route = findRegisteredRoute(app, { method: "GET", path: `${apiRouteBase}/vibe64/sessions/:sessionId/${suffix}` });
      server.get(route.path, route.handler);
    }
    try {
      const origin = await server.listen({ host: "127.0.0.1", port: 0 });
      for (const suffix of ["output-results", "agent-attachments"]) {
        const url = `${origin}${apiBase}/vibe64/sessions/session-1/${suffix}/result-1`;
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(response.headers.get("content-disposition"), /r%C3%A9sultat.bin/u);
        if (suffix === "output-results") assert.equal(response.headers.get("digest"), `sha-256=${Buffer.from(hash, "hex").toString("base64")}`);
        else assert.match(response.headers.get("content-security-policy"), /sandbox/u);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        await handles.at(-1).closed;
        assert.equal(handles.at(-1).fileHandle.fd, -1);
        const count = handles.length;
        allowed = false;
        const denied = await fetch(url);
        assert.equal(denied.status, 403);
        await denied.text();
        await assert.rejects(actions.execute({ actionId: `vibe64.terminals.${suffix === "output-results" ? "output-result" : "agent-attachment"}.read`,
          input: { projectSlug: slug, sessionId: "session-1", [suffix === "output-results" ? "resultId" : "attachmentId"]: "result-1" },
          context: { channel: "automation", surface: "app" } }), { statusCode: 403 });
        assert.equal(handles.length, count);
        allowed = true;
      }
    } finally {
      await server.close();
      await Promise.all(handles.map(({ fileHandle }) => fileHandle.close()));
      await rm(root, { recursive: true, force: true });
    }
  }));
});

test("canonical Main goals reuse internal terminal actions with fresh authority and fixed service representation", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const actor = { username: "goal-owner", role: "owner" };
    let user = actor;
    let allowed = true;
    const calls = [];
    const goal = { status: "available", goal: { id: "opaque-goal", objective: "Keep the product objective", status: "paused" },
      target: { segmentId: "retained-goal", capabilities: { goals: true, goalBudgets: false,
        goalCommands: { pause: { delivery: "control", interruptsTurn: true } } } } };
    const rejected = { ok: false, code: "vibe64_goal_explicit_mode_required", error: "Choose Senior or Junior." };
    const terminals = {
      openBrowserConversation() { assert.fail("Goal actions must use the original product service policy."); },
      async readAgentGoal(...args) { calls.push({ method: "read", args, project: currentProjectRequestContext()?.slug }); return goal; },
      async updateAgentGoal(...args) { calls.push({ method: "update", args, project: currentProjectRequestContext()?.slug }); return rejected; }
    };
    const actions = catalogue(terminals, projectContext, {
      resolveUser: async () => user,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
    });
    actions.register({ contributorId: "goal-context", domain: "sessions",
      actions: createSessionActions({ sessions: {} }).filter(definition => definition.id === ACTION_READ_CONVERSATION_CONTEXT)
        .map(definition => ({ surfaces: ["app"], ...definition })) });
    const facade = await createMainBrowserConversations({ actions, terminals }).open({
      id: mainConversationId({ projectSlug: slug, sessionId: "session-1" }), context: { channel: "internal", surface: "app" }
    });
    assert.deepEqual(await facade.readGoal(), goal);
    assert.deepEqual(calls[0], { method: "read", args: ["session-1", { vibe64User: actor }, { canonical: true }], project: slug });
    const input = { action: "set", expectedSegmentId: null, expectedGoalId: null,
      messageId: "goal-one", objective: "Finish the requested work", tokenBudget: 1000 };
    assert.deepEqual(await facade.updateGoal(input), rejected, "original pre-admission failures are returned without manufacturing a goal or receipt");
    assert.deepEqual(calls[1], { method: "update", args: ["session-1", { ...input, sessionId: "session-1", vibe64User: actor }, { canonical: true }], project: slug });
    for (const actionId of [ACTION_READ_CANONICAL_AGENT_GOAL, ACTION_UPDATE_CANONICAL_AGENT_GOAL]) {
      const definition = actions.getDefinition(actionId);
      assert.deepEqual(definition.channels, ["internal"]);
      assert.equal(definition.idempotency, "none");
      assert.equal(definition.extensions.assistant.exclude, true);
      await assert.rejects(actions.execute({ actionId,
        input: { sessionId: "session-1", projectSlug: slug, ...(actionId === ACTION_UPDATE_CANONICAL_AGENT_GOAL ? input : {}) },
        context: { channel: "api", surface: "app" } }), { code: "ACTION_CHANNEL_FORBIDDEN" });
    }
    const count = calls.length;
    for (const extra of [
      { canonical: true }, { canonicalGoal: true }, { onGoalResult: "forged" },
      { threadId: "native-thread" }, { createdAt: 123.456 }, { host: {} }, { runtime: {} },
      { vibe64User: { role: "owner" } }, { attachments: [{ path: "/private/input" }] }
    ]) await assert.rejects(facade.updateGoal({ ...input, ...extra }), { code: "ACTION_VALIDATION_FAILED" });
    for (const malformed of [{ ...input, expectedSegmentId: "" }, { ...input, tokenBudget: 0 }]) {
      await assert.rejects(facade.updateGoal(malformed), { code: "ACTION_VALIDATION_FAILED" });
    }
    assert.equal(calls.length, count);
    allowed = false;
    await assert.rejects(facade.readGoal(), { statusCode: 403 });
    await assert.rejects(facade.updateGoal(input), { statusCode: 403 });
    allowed = true;
    user = { username: "another-owner", role: "owner" };
    await assert.rejects(facade.readGoal(), { code: "conversation_forbidden" });
    assert.equal(calls.length, count, "revoked or changed actors cannot reach the retained goal service");
  });
});

test("learning Main goals retain original internal controls and reauthorize the saved learner attempt", async () => {
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  const actor = { uid: 42, username: "learner", role: "member" };
  let user = actor;
  let active = true;
  const calls = [];
  const goal = { status: "available", goal: { id: "saved-native-goal", objective: "Keep the admitted lesson objective", status: "paused" } };
  const terminals = {
    openBrowserConversation() { assert.fail("Goal controls must retain the original internal service route."); },
    readAgentGoal(...args) { calls.push({ kind: "read", args, scope: currentProjectRequestContext().learningScope }); return goal; },
    updateAgentGoal(...args) { calls.push({ kind: "write", args, scope: currentProjectRequestContext().learningScope }); return { ok: true }; }
  };
  const actions = catalogue(terminals, null, {
    resolveUser: async () => user,
    authorizeProject() { assert.fail("Learning goals cannot borrow project authorization."); },
    async resolveLearningContext({ actor: current, attemptId: requested, sessionId, access }) {
      assert.equal(requested, attemptId);
      assert.equal(sessionId, "learning-session");
      if (access === "write" && !active) throw Object.assign(new Error("Ended attempt"), { code: "attempt_inactive" });
      return { projectRuntimeRoot: "/actual/private/learner/attempt", learningScope: {
        learnerId: String(current.uid), attemptId, noExercise: true
      } };
    }
  });
  actions.register({ contributorId: "learning-goal-context", domain: "sessions",
    actions: createSessionActions({ sessions: {} }).filter(definition => definition.id === ACTION_READ_CONVERSATION_CONTEXT)
      .map(definition => ({ surfaces: ["app"], ...definition })) });
  const facade = await createMainBrowserConversations({ actions, terminals }).open({
    id: mainConversationId({ learningAttemptId: attemptId, sessionId: "learning-session" }),
    context: { channel: "internal", surface: "app" }
  });
  assert.deepEqual(await facade.readGoal(), goal);
  assert.deepEqual(calls[0].args, ["learning-session", { vibe64User: actor }, { canonical: true }]);
  const input = { action: "set", expectedSegmentId: null, expectedGoalId: null,
    messageId: "lesson-goal-one", objective: "Keep the admitted lesson objective", tokenBudget: 1000 };
  assert.deepEqual(await facade.updateGoal(input), { ok: true });
  assert.deepEqual(calls[1].args, ["learning-session", { ...input, sessionId: "learning-session", vibe64User: actor }, { canonical: true }]);
  for (const call of calls) assert.equal(call.scope.attemptId, attemptId);
  for (const actionId of [ACTION_READ_CANONICAL_AGENT_GOAL, ACTION_UPDATE_CANONICAL_AGENT_GOAL]) {
    assert.deepEqual(actions.getDefinition(actionId).channels, ["internal"]);
    await assert.rejects(actions.execute({ actionId, input: { sessionId: "learning-session", learningAttemptId: attemptId,
      ...(actionId === ACTION_UPDATE_CANONICAL_AGENT_GOAL ? input : {}) }, context: { channel: "api", surface: "app" } }), {
      code: "ACTION_CHANNEL_FORBIDDEN"
    });
  }
  active = false;
  await assert.rejects(facade.updateGoal(input), { code: "attempt_inactive" });
  assert.deepEqual(await facade.readGoal(), goal);
  assert.equal(calls.length, 3);
  user = { uid: 43, username: "other", role: "member" };
  await assert.rejects(facade.readGoal(), { code: "conversation_forbidden" });
  assert.equal(calls.length, 3);
  assert.equal(currentProjectRequestContext(), null);
});
