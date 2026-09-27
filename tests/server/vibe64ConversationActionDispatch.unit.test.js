import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { registerRoutes as registerSessions } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { registerRoutes as registerTerminals } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("the existing assistant catalogue is actor-authorized without a project or session", async () => {
  const actions = createActionCatalogue();
  const user = { username: "member", role: "member" };
  const calls = [];
  let signedIn = true;
  registerVibe64ActionContext(actions, {
    resolveUser: async () => signedIn ? user : null,
    authorizeProject() { throw new Error("Model choices must not require a project."); }
  });
  actions.register({ contributorId: "sessions", domain: "sessions", actions: createSessionActions({ sessions: {
    listAssistantCapabilities(input) { calls.push(input); return { ok: true, engines: [] }; }
  } }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
  const execute = (input, channel = "api") => actions.execute({ actionId: "vibe64.assistants.capabilities.list", input,
    context: { channel, surface: "app" } });
  assert.deepEqual(await execute({ configuredOnly: "true" }), { ok: true, engines: [] });
  await execute({ configuredOnly: "true" }, "automation");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].vibe64User, user);
  await assert.rejects(execute({ vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
  signedIn = false;
  await assert.rejects(execute({}), { statusCode: 401 });
  assert.equal(calls.length, 2);
});

test("conversation HTTP handlers and automation execute the same authorized actions", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const app = testRouteApp();
    const actions = createActionCatalogue();
    const user = { username: "member", role: "member" };
    let allowed = true;
    const calls = [];
    const record = (method) => async (...args) => {
      const context = currentProjectRequestContext();
      calls.push({ method, args, projectSlug: context.slug, actor: context.vibe64User });
      return { ok: true, method };
    };
    const sessions = Object.fromEntries(["listSessions", "renameSession", "archiveSession", "retryWorkspaceSetup", "broadcastSessionPreviewState", "sendAgentMessage", "interruptAgentTurn", "readSessionConversationLog", "rewindConversation"].map((name) => [name, record(name)]));
    const terminals = Object.fromEntries(["readSessionWorkPlan", "listTemporaryConversations", "createTemporaryConversation", "readTemporaryConversation", "startTemporaryConversationTurn", "stopTemporaryConversation", "deleteTemporaryConversation"].map((name) => [name, record(name)]));
    actions.register({ contributorId: "sessions", domain: "sessions", actions: createSessionActions({ sessions }).map((action) => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...action })) });
    actions.register({ contributorId: "terminals", domain: "terminals", actions: createTerminalActions({ terminals }).map((action) => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, {
      projectContext,
      resolveUser: async () => user,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); }
    });
    const routeOptions = { projectContext, routeRelativePath: "vibe64", routeSurface: "app" };
    registerSessions(app.http, routeOptions);
    registerTerminals(app.http, { ...routeOptions, fastify: app.fastify, terminals, uploads: { readSingleMultipartFile() {} } });
    const cases = [
      ["GET", "/sessions", "vibe64.sessions.list", {}, "listSessions"],
      ["GET", "/sessions/:sessionId/conversation-log", "vibe64.sessions.conversation-log.read", {}, "readSessionConversationLog"],
      ["POST", "/sessions/:sessionId/conversation-rewind", "vibe64.sessions.conversation.rewind", { turnId: "000002" }, "rewindConversation"],
      ["GET", "/sessions/:sessionId/work-plan", "vibe64.terminals.work-plan.read", {}, "readSessionWorkPlan"],
      ["POST", "/sessions/:sessionId/agent-message", "vibe64.sessions.agent-message.send", { message: "Consider this correction.", messageId: "main-steer", submissionKind: "steer" }, "sendAgentMessage"],
      ["POST", "/sessions/:sessionId/agent-turn/interrupt", "vibe64.sessions.agent-turn.interrupt", { reason: "Requested by user" }, "interruptAgentTurn"],
      ["PATCH", "/sessions/:sessionId/name", "vibe64.sessions.rename", { name: "A name" }, "renameSession"],
      ["POST", "/sessions/:sessionId/archive", "vibe64.sessions.archive", {}, "archiveSession"],
      ["POST", "/sessions/:sessionId/workspace-setup/retry", "vibe64.sessions.workspace-setup.retry", {}, "retryWorkspaceSetup"],
      ["POST", "/sessions/:sessionId/preview-state", "vibe64.sessions.preview-state.broadcast", { projectSlug: slug, route: "/preview", originId: "browser" }, "broadcastSessionPreviewState"],
      ["GET", "/sessions/:sessionId/temporary-conversations", "vibe64.terminals.temporary-conversation.list", {}, "listTemporaryConversations"],
      ["POST", "/sessions/:sessionId/temporary-conversations", "vibe64.terminals.temporary-conversation.create", {}, "createTemporaryConversation"],
      ["GET", "/sessions/:sessionId/temporary-conversations/:conversationId", "vibe64.terminals.temporary-conversation.read", {}, "readTemporaryConversation"],
      ["POST", "/sessions/:sessionId/temporary-conversations/:conversationId/turns", "vibe64.terminals.temporary-conversation.turn.start", { message: "What is happening?", messageId: "msg-1" }, "startTemporaryConversationTurn"],
      ["POST", "/sessions/:sessionId/temporary-conversations/:conversationId/stop", "vibe64.terminals.temporary-conversation.stop", {}, "stopTemporaryConversation"],
      ["DELETE", "/sessions/:sessionId/temporary-conversations/:conversationId", "vibe64.terminals.temporary-conversation.delete", {}, "deleteTemporaryConversation"]
    ];
    for (const [method, suffix, actionId, body, serviceMethod] of cases) {
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${suffix}` });
      assert.ok(route, suffix);
      let actionInput;
      const request = {
        params: routeProjectParams({ sessionId: "session-1", conversationId: "temporary-1" }),
        ...(serviceMethod === "readSessionWorkPlan" ? { query: { offset: "17", limit: "12", expectedRevision: "a".repeat(64) } } : {}),
        input: { body }, vibe64User: user,
        executeAction({ actionId: receivedId, input }) {
          assert.equal(receivedId, actionId);
          assert.equal(Object.hasOwn(input, "vibe64User"), false);
          actionInput = input;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true);
      const fromHttp = calls.at(-1);
      assert.equal(fromHttp.method, serviceMethod);
      assert.equal(fromHttp.projectSlug, slug);
      assert.equal(fromHttp.actor, user);
      if (serviceMethod === "readSessionWorkPlan") {
        assert.equal(fromHttp.args[1].offset, 17);
        assert.equal(fromHttp.args[1].limit, 12);
        assert.equal(fromHttp.args[1].expectedRevision, "a".repeat(64));
      }
      await actions.execute({ actionId, input: { ...actionInput, projectSlug: slug }, context: { channel: "automation", surface: "app" } });
      assert.deepEqual(calls.at(-1), fromHttp);
      if (serviceMethod === "broadcastSessionPreviewState") assert.equal(fromHttp.args[1].projectSlug, slug);

      const count = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, testReply()), { statusCode: 403 });
      await assert.rejects(actions.execute({ actionId, input: { ...actionInput, projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { statusCode: 403 });
      assert.equal(calls.length, count);
      allowed = true;
    }
    const count = calls.length;
    await assert.rejects(actions.execute({ actionId: "vibe64.terminals.temporary-conversation.turn.start", input: {
      projectSlug: slug, sessionId: "session-1", conversationId: "temporary-1", message: [], messageId: "bad"
    }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" });
    assert.equal(calls.length, count);
    assert.equal(currentProjectRequestContext(), null);
  }));
});
