import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { createMainBrowserConversations } from "../../packages/vibe64-sessions/src/server/mainBrowserConversations.js";
import { Vibe64ConversationsProvider } from "../../packages/vibe64-sessions/src/server/Vibe64ConversationsProvider.js";
import { mainConversationId, temporaryConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { ACTION_READ_CANONICAL_AGENT_GOAL, createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
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
    const sessions = Object.fromEntries(["listSessions", "renameSession", "archiveSession", "retryWorkspaceSetup", "broadcastSessionPreviewState", "sendAgentMessage", "interruptAgentTurn", "readSessionConversationLog"].map((name) => [name, record(name)]));
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
    assert.equal(findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/sessions/:sessionId/conversation-rewind` }), null);
    assert.equal(createSessionActions({ sessions }).some(action => action.id === "vibe64.sessions.conversation.rewind"), false);
    const cases = [
      ["GET", "/sessions", "vibe64.sessions.list", {}, "listSessions"],
      ["GET", "/sessions/:sessionId/conversation-log", "vibe64.sessions.conversation-log.read", {}, "readSessionConversationLog"],
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

// Real Fastify requests expose headers through their prototype. Plain-object
// action fixtures do not exercise the retained request's cookie boundary.
test("conversation facades and subscription checks preserve real Fastify request headers", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    const app = Fastify();
    const actions = createActionCatalogue();
    const user = { username: "cookie-owner", uid: 42, role: "owner" };
    const cookie = "fixture-session=owner-session";
    let signedIn = true;
    let allowed = true;
    let goalReads = 0;
    let subscriptions = 0;
    const retained = [];
    const goal = { status: "available", goal: null, target: { segmentId: null, capabilities: { goals: true } } };
    registerVibe64ActionContext(actions, { projectContext,
      resolveUser: async ({ request }) => signedIn && request?.headers?.cookie === cookie ? user : null,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); }
    });
    const terminals = {
      openBrowserConversation() { assert.fail("Main goal reads use the existing goal action."); },
      openTemporaryBrowserConversation() { return { async readGoal() { goalReads += 1; return goal; } }; },
      async readAgentGoal() { goalReads += 1; return goal; }
    };
    for (const [contributorId, definitions] of [
      ["cookie-sessions", createSessionActions({ sessions: {} }).filter(({ id }) => id === ACTION_READ_CONVERSATION_CONTEXT)],
      ["cookie-terminals", createTerminalActions({ terminals }).filter(({ id }) => id === ACTION_READ_CANONICAL_AGENT_GOAL)]
    ]) actions.register({ contributorId, domain: "test", actions: definitions.map(definition => ({ surfaces: ["app"], ...definition })) });
    const conversations = createMainBrowserConversations({ actions, terminals });
    const { access } = await Vibe64ConversationsProvider.setup({
      actionCatalogue: actions, sessions: { browserConversations: conversations }, http: testRouteApp().http
    }, {});
    actions.register({ contributorId: "cookie-subscription", domain: "test", actions: [access.wrapAction({
      id: access.subscribeActionId, kind: "query", channels: ["internal"], surfaces: ["app"],
      input: { schema: createSchema({}), mode: "create" },
      execute() { subscriptions += 1; return { ok: true }; }
    })] });
    app.get("/:kind", async request => {
      assert.equal(Object.hasOwn(request, "headers"), false, "Exercise Fastify's inherited header getter");
      request.vibe64User = user;
      const context = { channel: "internal", surface: "app", requestMeta: { request } };
      if (request.params.kind === "subscribe") return actions.execute({ actionId: access.subscribeActionId, input: {}, context });
      const target = { projectSlug: slug, sessionId: "session-1", conversationId: "saved-temporary" };
      const id = request.params.kind === "temporary" ? temporaryConversationId(target) : mainConversationId(target);
      const conversation = await conversations.open({ id, context });
      retained.push(conversation);
      return conversation.readGoal();
    });
    const headers = { host: "localhost", origin: "http://localhost", cookie };
    try {
      for (const kind of ["main", "temporary"]) {
        const response = await app.inject({ method: "GET", url: `/${kind}`, headers });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(response.json(), goal);
      }
      assert.equal((await app.inject({ method: "GET", url: "/subscribe", headers })).statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: "/subscribe", headers: { ...headers, origin: "https://foreign.example" } })).statusCode, 403);
      assert.equal((await app.inject({ method: "GET", url: "/subscribe", headers: { host: "localhost", cookie } })).statusCode, 403);
      assert.equal(subscriptions, 1, "Foreign or missing origins cannot reach the subscription action");
      assert.equal((await app.inject({ method: "GET", url: "/main", headers: { ...headers, cookie: "fixture-session=another-session" } })).statusCode, 401);
      allowed = false;
      for (const conversation of retained) await assert.rejects(conversation.readGoal(), { statusCode: 403 });
      allowed = true;
      signedIn = false;
      for (const conversation of retained) await assert.rejects(conversation.readGoal(), { statusCode: 401 });
      assert.equal((await app.inject({ method: "GET", url: "/subscribe", headers })).statusCode, 401);
      assert.equal(goalReads, 2, "Retained requests must revalidate project access and login before reading goals");
      assert.equal(subscriptions, 1);
    } finally { await app.close(); }
  });
});


test("browser conversation methods retain fresh project context through delayed handle operations", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ projectContext, slug }) => {
    const actions = createActionCatalogue();
    let user = { username: "owner", uid: 42, role: "owner" };
    let allowed = true;
    const calls = [];
    const listeners = [];
    const releases = [];
    registerVibe64ActionContext(actions, {
      projectContext,
      resolveUser: async () => user,
      authorizeProject() {
        if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 });
      }
    });
    actions.register({ contributorId: "project-boundary", domain: "sessions", actions:
      createSessionActions({ sessions: {} }).filter(({ id }) => id === ACTION_READ_CONVERSATION_CONTEXT)
        .map(definition => ({ surfaces: ["app"], ...definition })) });

    async function openHandle(kind) {
      const opening = currentProjectRequestContext();
      assert.equal(opening?.slug, slug);
      await Promise.resolve();
      assert.equal(currentProjectRequestContext(), opening);
      const handle = {};
      for (const method of ["read", "send", "cancel", "select", "inspectDelivery", "readGoal", "updateGoal", "subscribe"]) {
        handle[method] = async input => {
          await Promise.resolve();
          const current = currentProjectRequestContext();
          assert.equal(current?.slug, slug, `${kind}.${method} lost its project context after open`);
          assert.equal(current?.targetRoot, opening.targetRoot);
          assert.equal(current?.vibe64User, user);
          calls.push(`${kind}.${method}`);
          if (method === "subscribe") {
            listeners.push(input);
            const release = () => {};
            releases.push(release);
            return release;
          }
          return method === "read" ? { configuration: { private: true }, conversationLog: [] } : { ok: true };
        };
      }
      return handle;
    }
    const facade = createMainBrowserConversations({ actions, terminals: {
      openBrowserConversation: () => openHandle("main"),
      openTemporaryBrowserConversation: () => openHandle("temporary")
    } });
    const target = { projectSlug: slug, sessionId: "session-1", conversationId: "saved-temporary" };
    const retained = [];
    for (const [kind, id] of [["main", mainConversationId(target)], ["temporary", temporaryConversationId(target)]]) {
      const browser = await facade.open({ id, context: { surface: "app", channel: "internal" } });
      retained.push(browser);
      assert.equal(currentProjectRequestContext(), null);
      assert.deepEqual(await browser.read(), { id, conversationLog: [] });
      assert.deepEqual(await browser.inspectDelivery({ messageId: "authored" }), { ok: true });
      const events = [];
      const release = await browser.subscribe(event => {
        assert.equal(currentProjectRequestContext(), null, "Publication must not restore the registration's cached context");
        events.push(event);
      });
      assert.equal(release, releases.at(-1));
      listeners.at(-1)({ type: "phase", phase: "working" });
      assert.deepEqual(events, [{ type: "phase", phase: "working", conversationId: id }]);
      if (kind === "temporary") {
        for (const method of ["send", "cancel", "select", "readGoal", "updateGoal"]) {
          assert.deepEqual(await browser[method]({ text: "hello", messageId: "authored" }), { ok: true });
        }
      }
      release();
      assert.equal(currentProjectRequestContext(), null);
    }
    assert.deepEqual(calls, ["main.read", "main.inspectDelivery", "main.subscribe", "temporary.read",
      "temporary.inspectDelivery", "temporary.subscribe", "temporary.send", "temporary.cancel",
      "temporary.select", "temporary.readGoal", "temporary.updateGoal"]);
    const count = calls.length;
    allowed = false;
    for (const browser of retained) await assert.rejects(browser.read(), { statusCode: 403 });
    allowed = true;
    user = { username: "other-owner", uid: 43, role: "owner" };
    for (const browser of retained) await assert.rejects(browser.read(), { code: "conversation_forbidden" });
    assert.equal(calls.length, count, "Revocation and actor changes must not invoke the retained handle");
  }));
});
