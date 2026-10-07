import { type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import type { Socket } from "socket.io";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createCapabilityHttpRuntime } from "@jskit-ai/kernel/server/http";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { RealtimeProvider } from "@jskit-ai/realtime/server/RealtimeProvider";
import { AssistantFeature } from "@jskit-ai/assistant-runtime/server";
import { createConversationRuntime, createConversationTranscript } from "@jskit-ai/assistant-core/server/conversation";
import { normalizeConversationTurn } from "@jskit-ai/assistant-core/shared/conversation";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { resolveVibe64AssistantSelection, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { createSessionActions } from "@local/vibe64-sessions/server/actions";
import { createTerminalActions } from "@local/vibe64-terminals/server/actions";
import { mainConversationId, temporaryConversationId } from "@local/vibe64-sessions/shared/conversation";
import { createMainBrowserConversations } from "../../../packages/vibe64-sessions/src/server/mainBrowserConversations.js";
import { Vibe64ConversationsProvider } from "../../../packages/vibe64-sessions/src/server/Vibe64ConversationsProvider.js";
import { createSessionConversations } from "../../../packages/vibe64-terminals/src/server/sessionConversations.js";
import { createSessionAttachments } from "../../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { createSessionAgentManager } from "../../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { registerRoutes as registerTerminalRoutes } from "../../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { createColleagueService } from "../../../packages/vibe64-colleague/src/server/service.js";
import { createColleagueActions, colleagueConversationDataSchema, colleagueConversationSelectionSchema } from "../../../packages/vibe64-colleague/src/server/actions.js";
import { sourceMetadata } from "../../server/vibe64TestHelpers.js";
import {
  bootstrapPayload, currentAppPayload, directChatSessionPayload,
  readyProjectSelectionPayload, WORKSPACE_SLUG
} from "./base-shell-data.ts";

type Handler = (response: ServerResponse, request: IncomingMessage) => void | Promise<void>;
type GoalView = { status: string; goal: Record<string, unknown> | null;
  target: { segmentId: string | null; capabilities: Record<string, unknown> } };

export function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

// Production client and real HTTP/Socket.IO transports. Provider responses are
// controlled here so failures never touch a real assistant or user project.
export async function assistantStatusServer({ temporaryEngineId = null, colleague = false }: {
  temporaryEngineId?: "codex" | "opencode" | null; colleague?: boolean
} = {}) {
  const session = structuredClone(directChatSessionPayload);
  session.sessionName = "Status recovery";
  session.agentSession.turn = { active: true, id: "turn-status", state: "active" } as typeof session.agentSession.turn;
  const conversation = {
    turnId: "turn-status",
    user: { role: "user", text: "Keep working while the connection recovers.", at: new Date().toISOString() },
    commentary: [{ role: "commentary", text: "I am working on the project.", at: new Date().toISOString() }]
  };
  const state = {
    assistantAccess: { ok: true, available: true, canUse: true, ownerOnly: false },
    conversationLog: [conversation] as Array<Record<string, unknown>>,
    checks: [] as Handler[],
    checkCount: 0,
    checkTimes: [] as number[],
    connectionAttempts: 0,
    subscriptions: [] as string[],
    conversationReads: [] as string[],
    rejectConnections: false,
    detailCount: 0,
    detailHandler: null as Handler | null,
    messages: [] as Record<string, unknown>[],
    steering: true,
    workAfterMessage: false,
    goal: null as GoalView | null,
    goalCommands: [] as Record<string, unknown>[],
    updateGoal: null as ((input: Record<string, unknown>) => unknown | Promise<unknown>) | null,
    interrupts: 0,
    requests: [] as string[],
    unexpectedRequests: [] as string[],
    session
  };
  const applicationEvents = new EventEmitter();
  const sockets = new Set<Socket>();
  const app = Fastify({ routerOptions: { maxParamLength: 1024 } });
  const actions = createActionCatalogue();
  const http = createCapabilityHttpRuntime({ fastify: app, actions });
  const owner = { uid: 42, username: "owner", email: "owner@example.com", role: "owner" };
  const id = mainConversationId({ projectSlug: WORKSPACE_SLUG, sessionId: session.sessionId });
  const turns = () => state.conversationLog.map((turn, index) => normalizeConversationTurn(turn, index)).filter(Boolean);
  const transcript = createConversationTranscript({ storage: {
    read(_scope, callback) {
      const rows = turns();
      return callback({ listTurnIds: () => rows.map(turn => turn.turnId), readTurn: turnId => rows.find(turn => turn.turnId === turnId) });
    },
    write() { throw new Error("Status fixture receipts are supplied explicitly by the scenario."); }
  } });
  function requireSession(sessionId: string) {
    if (sessionId !== session.sessionId) throw Object.assign(new Error("Unknown status-test session."), { statusCode: 404 });
  }
  const temporary = temporaryEngineId ? await temporaryConversationsFixture({
    engineId: temporaryEngineId, session, actions,
    publishSessionChanged: (sessionId, event) => publishSessionChanged(sessionId, event),
    onSubscribe: conversationId => state.subscriptions.push(temporaryConversationId({
      projectSlug: WORKSPACE_SLUG, sessionId: session.sessionId, conversationId
    }))
  }) : null;
  const terminals = {
    ...temporary?.terminals,
    async openBrowserConversation(sessionId: string) {
      requireSession(sessionId);
      return {
        async read(query = {}) {
          state.conversationReads.push(id);
          const agent = session.agentSession;
          return { id, engine: agent.providerId,
            segmentId: agent.thread?.id ? `${agent.providerId}:${agent.thread.id}` : null,
            status: agent.turn.active ? "working" : "ready", phase: agent.turn.active ? "working" : "",
            capabilities: { streaming: true, history: true, steering: state.steering, cancellation: true, attachments: true, goals: false },
            goal: state.goal?.goal || null, pendingRequest: null, error: "", streaming: { revision: 0, messages: [] },
            ...await transcript.readConversationLogPage(sessionId, query) };
        },
        subscribe(listener) {
          state.subscriptions.push(id);
          applicationEvents.on("conversation", listener);
          return () => applicationEvents.off("conversation", listener);
        },
        async inspectDelivery({ messageId }) { return { status: "unknown", messageId }; }
      };
    },
    async readAgentGoal(sessionId: string) {
      requireSession(sessionId);
      return state.goal || { status: "unsupported", goal: null, target: { segmentId: null, capabilities: { goals: false } } };
    },
    async updateAgentGoal(sessionId: string, input) {
      requireSession(sessionId);
      if (!state.updateGoal) throw new Error("This scenario has not supplied a goal command response.");
      const { sessionId: _sessionId, vibe64User: _user, ...command } = input;
      state.goalCommands.push(command);
      return state.updateGoal(command);
    }
  };
  const sessions = {
    async sendAgentMessage(sessionId: string, input) {
      requireSession(sessionId);
      const { vibe64User: _user, ...message } = input;
      state.messages.push(message);
      if (state.workAfterMessage) { session.agentSession.turn.active = true; publishTurn(); }
      return { ok: true, delivered: true, messageId: message.messageId };
    },
    async interruptAgentTurn(sessionId: string) {
      requireSession(sessionId);
      state.interrupts += 1;
      session.agentSession.turn.active = false;
      publishTurn();
      return { ok: true, interrupted: true };
    },
    async updateAssistantSelection() { throw new Error("This scenario has not supplied a selection response."); },
    browserConversations: createMainBrowserConversations({ actions, terminals })
  };
  const projectContext = { projectsRoot: "/workspace", async readWorkspaceProject() { return { project: { projectRoot: session.targetRoot } }; } };
  registerVibe64ActionContext(actions, {
    projectContext,
    resolveUser: async () => owner,
    async authorizeProject({ slug }) {
      if (slug !== WORKSPACE_SLUG) throw Object.assign(new Error("Unknown status-test project."), { statusCode: 403 });
    }
  });
  actions.register({ contributorId: "test.status.sessions", domain: "vibe64-sessions",
    actions: createSessionActions({ sessions }).filter(action => [
      "vibe64.sessions.conversation.context.read", "vibe64.sessions.agent-message.send",
      "vibe64.sessions.agent-turn.interrupt", "vibe64.sessions.assistant-selection.update"
    ].includes(action.id)).map(action => ({ surfaces: ["app"], channels: ["api", "internal"], ...action })) });
  actions.register({ contributorId: "test.status.terminals", domain: "vibe64-terminals",
    actions: createTerminalActions({ terminals }).filter(action => [
      "vibe64.terminals.agent-goal.canonical.read", "vibe64.terminals.agent-goal.canonical.update"
    ].includes(action.id) || temporary && action.id.startsWith("vibe64.terminals.temporary-conversation."))
      .map(action => ({ surfaces: ["app"], channels: ["api", "internal"], ...action })) });
  if (temporary) registerTerminalRoutes({ ...http, router: {
    register(method, route, ...options) {
      if (route.includes("/temporary-conversations")) return http.router.register(method, route, ...options);
    }
  } }, { terminals, projectContext, routeRelativePath: "vibe64", routeSurface: "app",
    fastify: { get() {} }, // This fixture does not expose the unrelated native terminal WebSocket routes.
    uploads: { readSingleMultipartFile() { throw new Error("This fixture has not supplied a file upload."); } }
  });
  let events;
  let publishSessionChanged;
  const colleagueRoot = colleague ? await mkdtemp(path.join(tmpdir(), "vibe64-browser-colleague-")) : null;
  const colleagueState = colleague ? {
    sent: [] as Record<string, unknown>[], interrupts: 0,
    beforeSend: null as (() => void | Promise<void>) | null
  } : null;
  // The existing Colleague service fixture controls only model access and the
  // model response. Its common runtime, transcript, actions and facade are real.
  const colleagueProvider = colleague ? defineFeature({
    id: "test.status.colleague", domain: "vibe64-colleague",
    requires: { events: "runtime.events" }, provides: { colleague: "vibe64.colleague" },
    actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
    setup({ events }) {
      const selection = { engineId: "codex", modelProviderId: "openai", modelId: "test-model" };
      const service = createColleagueService({ actions, events, systemRoot: colleagueRoot,
        accounts: { async readModelRoutingWorkflows() {
          return { ok: true, workflows: [{ available: true, engineId: "codex" }] };
        } },
        terminals: {
          async requireAssistantSelectionAccess(_selection, { vibe64User }) {
            if (vibe64User?.uid !== owner.uid) throw Object.assign(new Error("Model access denied."), { statusCode: 403 });
          },
          async resolveAssistantSelection(value, options) {
            await this.requireAssistantSelectionAccess(value, options);
            return { ...value, catalogRevision: "current" };
          },
          async resolveAssistantPurpose(_input, options) {
            await this.requireAssistantSelectionAccess(selection, options);
            return { available: true, effectiveSelection: selection };
          },
          createConversationHost(scope) { return { workdir: scope.workdir, stateDirectory: scope.runtimeRoot }; },
          async resolveConversationConfiguration(value, systemPrompt, options) {
            await this.requireAssistantSelectionAccess(value, options);
            return { engine: "api", configuration: { systemPrompt, integrationId: value.modelProviderId, model: value.modelId } };
          },
          async resolveConversationConnection({ assistantSelection: value }, options) {
            await this.requireAssistantSelectionAccess(value, options);
            return { providerId: value.modelProviderId, model: value.modelId,
              sdkPackage: "@ai-sdk/openai-compatible", apiKey: "test", baseURL: "http://colleague.invalid/v1" };
          }
        }
      });
      const routes = createVibe64FeatureRoutes(http, {
        projectScoped: false, routeRelativePath: "vibe64/colleague", routeSurface: "app", tags: ["vibe64-colleague"]
      });
      routes.actionRoute("GET", "", { actionId: "vibe64.colleague.state.read", buildInput: routes.requestQuery, summary: "Read your Colleague conversation." });
      routes.actionRoute("POST", "/focus", { actionId: "vibe64.colleague.focus.update", buildInput: routes.requestBody, summary: "Colleague focus.update." });
      routes.actionRoute("POST", "/conversations/fresh", { actionId: "vibe64.colleague.conversation.start-fresh", buildInput: routes.requestBody, summary: "Retain the old conversation and start fresh." });
      routes.actionRoute("GET", "/conversations/history", { actionId: "vibe64.colleague.conversation.history.read", buildInput: routes.requestQuery, summary: "List retained conversations." });
      routes.actionRoute("GET", "/conversations/history/page", { actionId: "vibe64.colleague.conversation.history-page.read", buildInput: routes.requestQuery, summary: "Read retained conversation history." });
      return { colleague: { ...service,
        close: () => service.close(),
        async send(input, context, options) {
          colleagueState.sent.push(structuredClone(input));
          await colleagueState.beforeSend?.();
          return service.send(input, context, options);
        },
        async stop(input, context) {
          colleagueState.interrupts += 1;
          return service.stop(input, context);
        },
        browserConversations: { ...service.browserConversations,
          conversationDataSchema: colleagueConversationDataSchema,
          conversationSelectionSchema: colleagueConversationSelectionSchema,
          async open(input) {
            const conversation = await service.browserConversations.open(input);
            return { ...conversation,
              read(options) { state.conversationReads.push(input.id); return conversation.read(options); },
              subscribe(listener) { state.subscriptions.push(input.id); return conversation.subscribe(listener); }
            };
          }
        }
      } };
    },
    actions: ({ colleague }) => createColleagueActions(colleague),
    async shutdown(_deps, { outputs }) {
      try { await outputs.colleague.close(); }
      finally { await rm(colleagueRoot, { recursive: true, force: true }); }
    }
  }) : null;
  const probe = defineProvider({ id: "test.status.realtime", requires: { realtime: "runtime.realtime", events: "runtime.events" },
    setup(capabilities) {
      events = capabilities.events;
      publishSessionChanged = createSessionChangedPublisher(events);
      capabilities.realtime.onConnection(({ socket }) => { sockets.add(socket); return () => sockets.delete(socket); });
      return {};
    }
  });
  const hosting = createCapabilityRuntime({ providers: [EventProvider, RealtimeProvider,
    ...(colleagueProvider ? [colleagueProvider] : []), Vibe64ConversationsProvider, AssistantFeature, probe],
    inputs: { "runtime.actions": actions, "runtime.http": http, "runtime.fastify": app,
      "runtime.config": { surfaceDefinitions: { app: { enabled: true, requiresWorkspace: false } },
        assistantSurfaces: { app: { settingsSurfaceId: "app", configScope: "global" } } },
      "runtime.env": {}, "runtime.logger": { debug() {}, info() {}, warn() {}, error() {} }, "vibe64.sessions": sessions,
      "auth.service": { realtime: { requireAuthentication: true }, async authenticateRequest() {
        return { authenticated: !state.rejectConnections, actor: { id: "42" } };
      } }
    }
  });
  function connectionAttempt(request: IncomingMessage) {
    const url = new URL(request.url!, "http://127.0.0.1");
    if (url.pathname === "/socket.io/" && url.searchParams.has("transport") && !url.searchParams.has("sid")) state.connectionAttempts += 1;
  }
  app.addHook("preClose", async () => {
    if (hosting.diagnostics().lifecycleState === "started") await hosting.shutdown();
  });
  app.addHook("onRequest", async request => {
    if (request.url.startsWith("/api/assistant/") || colleague && request.url.startsWith("/api/vibe64/colleague")) {
      state.requests.push(`${request.method} ${request.url}`);
    } else if (temporary && request.url.includes("/temporary-conversations")) {
      const route = new URL(request.url, "http://127.0.0.1").pathname.replace(/^\/api(?:\/app\/[^/]+)?/u, "");
      state.requests.push(`${request.method} ${route}`);
    }
  });
  app.setNotFoundHandler(async (parsed, reply) => {
    reply.hijack();
    const request = parsed.raw;
    const response = reply.raw;
    try {
      const url = new URL(request.url!, "http://127.0.0.1");
      const route = url.pathname.replace(/^\/api(?:\/app\/[^/]+)?/u, "");
      if (!url.pathname.startsWith("/api/")) {
        const asset = url.pathname.startsWith("/assets/") ? url.pathname.slice(1) : "index.html";
        const file = await readFile(path.join(process.env.VIBE64_STATUS_E2E_DIST || "dist", asset));
        const mime = asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "text/html";
        response.writeHead(200, { "content-type": mime });
        response.end(file);
        return;
      }
      const requestKey = `${request.method} ${route}`;
      const sessionRoute = `/vibe64/sessions/${session.sessionId}`;
      state.requests.push(requestKey);
      if (requestKey === `POST ${sessionRoute}/agent-session`) {
        state.checkCount += 1;
        state.checkTimes.push(Date.now());
        const handler = state.checks.shift();
        if (handler) await handler(response, request);
        else json(response, { ok: true, ...session.agentSession });
        return;
      }
      if (requestKey === `GET ${sessionRoute}`) {
        state.detailCount += 1;
        if (state.detailHandler) await state.detailHandler(response, request);
        else json(response, session);
        return;
      }
      if (requestKey === `POST ${sessionRoute}/agent-message`) {
        json(response, await sessions.sendAgentMessage(session.sessionId, parsed.body));
        return;
      }
      if (requestKey === `POST ${sessionRoute}/agent-turn/interrupt`) {
        json(response, await sessions.interruptAgentTurn(session.sessionId));
        return;
      }
      if (requestKey === "POST /vibe64/project-runtime/open") {
        json(response, { ok: true, runtime: { open: true, reason: "status-test" } });
        return;
      }
      if (requestKey === `POST ${sessionRoute}/updates/check`) {
        json(response, { ok: true, relationship: "current", ahead: 0, behind: 0, updateAvailable: false, incomingVersions: [] });
        return;
      }
      if (requestKey === `POST ${sessionRoute}/presence`) {
        json(response, { ok: true, status: "unavailable" });
        return;
      }
      if (requestKey === "PUT /vibe64/sessions/current") {
        const body = parsed.body as Record<string, unknown>;
        if (body.sessionId !== session.sessionId) {
          state.unexpectedRequests.push(`${requestKey}: ${JSON.stringify(body)}`);
          json(response, { ok: false, error: "Unknown status-test session." }, 404);
        } else {
          json(response, { ok: true, sessionId: session.sessionId });
        }
        return;
      }
      let result: unknown;
      if (route === "/auth/state") result = { ok: true, authenticated: true, setupRequired: false, user: { ...owner, id: String(owner.uid) } };
      else if (route === "/session") result = { ok: true, csrfToken: "status-e2e", authenticated: true };
      else if (route === "/bootstrap") result = { ...bootstrapPayload,
        session: { ...bootstrapPayload.session, authenticated: true, userId: String(owner.uid) },
        profile: { displayName: owner.username, email: owner.email, avatar: { effectiveUrl: "" } } };
      else if (route === "/vibe64/projects") result = readyProjectSelectionPayload;
      else if (route === "/studio/current-app") result = currentAppPayload;
      else if (route === "/vibe64/env") result = { ok: true, env: { environment: "dev", records: [], unavailable: null } };
      else if (route === "/vibe64/sessions") result = { ok: true, sessions: [session], limits: { openSessionCount: 1 }, creation: { canCreate: true, mode: "direct" } };
      else if (route === "/vibe64/sessions/current") result = { ok: true, sessionId: session.sessionId };
      else if (route === `${sessionRoute}/conversation-log`) result = { ok: true, sessionId: session.sessionId, conversationLog: state.conversationLog, pagination: { count: state.conversationLog.length, totalTurnCount: state.conversationLog.length, hasMoreBefore: false, limit: 20 } };
      else if (route === `${sessionRoute}/assistant-access`) result = state.assistantAccess;
      else if (route === `${sessionRoute}/temporary-conversations`) result = { ok: true, conversations: [] };
      else if (route === `${sessionRoute}/work`) result = { ok: true, unsaved: false, operation: null, updateOperation: null };
      else if (route === `${sessionRoute}/work-plan`) result = { ok: true, sessionId: session.sessionId, available: false, current: null, history: [] };
      else if (route === `${sessionRoute}/renewal`) result = { ok: true, renewal: null, viewerScope: "status-test-owner" };
      else if (route === `${sessionRoute}/agent-goal`) result = { ok: true, status: "unsupported" };
      else if (route === `${sessionRoute}/source-editor/stars`) result = { ok: true, files: [] };
      else if (route === "/vibe64/settings") result = { ok: true, promptHints: { enabled: false } };
      else if (route === "/vibe64/accounts") result = { ok: true, ready: true, accounts: [] };
      else if (route === "/vibe64/accounts/model-routing") result = { ok: true, routing: null };
      else if (route === "/vibe64/accounts/model-routing/workflows") result = { ok: true, canConfigure: true, workflows: [] };
      if (request.method !== "GET" || result === undefined) {
        state.unexpectedRequests.push(requestKey);
        json(response, { ok: false, error: `Unexpected status fixture request: ${requestKey}` }, 404);
        return;
      }
      json(response, result);
    } catch (error) {
      if (!response.headersSent) json(response, { ok: false, error: String(error) }, 500);
      else response.destroy();
    }
  });
  function broadcast(event: string, payload: Record<string, unknown>) {
    void events.publish({ type: event, realtime: { audience: "all_clients", event, payload } });
  }
  function publishTurn() {
    session.revision += 1;
    session.manifest.revision = session.revision;
    broadcast("vibe64.session.changed", {
      projectSlug: WORKSPACE_SLUG,
      sessionId: session.sessionId,
      revision: session.revision,
      reason: session.agentSession.turn.active ? "codex-app-server-turn-active" : "codex-app-server-turn-idle",
      agentSession: session.agentSession
    });
    applicationEvents.emit("conversation", { type: "phase", phase: session.agentSession.turn.active ? "working" : "" });
  }
  await hosting.start();
  http.start();
  // Observe initial Engine.IO handshakes after Socket.IO installs its request
  // handler. Polling upgrades carry sid and are not another connection attempt.
  app.server.on("request", connectionAttempt);
  app.server.on("upgrade", (request, socket) => {
    connectionAttempt(request);
    if (new URL(request.url!, "http://127.0.0.1").pathname === "/socket.io/") return;
    // The shared host leaves application upgrades to their owner. This fixture
    // exposes no browser-lifecycle/native terminal socket; reject it explicitly
    // so Chromium does not queue its Socket.IO handshake behind an open upgrade.
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  return {
    state,
    temporary,
    colleague: colleagueState,
    conversationId: id,
    connectionCount: () => sockets.size,
    url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}`,
    publishTurn,
    connectionsChanged() {
      broadcast("vibe64.connections.changed", { accountId: "codex" });
    },
    presence(payload: Record<string, unknown>) {
      broadcast("vibe64.session.presence.changed", payload);
    },
    sessionChanged(reason: string, payload: Record<string, unknown> = {}) {
      session.revision += 1;
      broadcast("vibe64.session.changed", {
        projectSlug: WORKSPACE_SLUG, sessionId: session.sessionId,
        revision: session.revision, reason, ...payload
      });
      const patch = payload.conversationLogPatch as { type: string; turn: Record<string, unknown> } | undefined;
      applicationEvents.emit("conversation", patch
        ? { type: "transcript", patch: { ...patch, turn: normalizeConversationTurn(patch.turn) } }
        : { type: "phase" });
    },
    progress(text: string) {
      conversation.commentary.push({ role: "commentary", text, at: new Date().toISOString() });
      broadcast("vibe64.session.changed", {
        projectSlug: WORKSPACE_SLUG, sessionId: session.sessionId,
        reason: "codex-app-server-commentary",
        conversationLogPatch: { type: "upsert-turn", turn: conversation }
      });
      applicationEvents.emit("conversation", { type: "transcript", patch: { type: "upsert-turn", turn: normalizeConversationTurn(conversation) } });
    },
    disconnect() {
      for (const socket of sockets) socket.conn.close();
    },
    forceDisconnect() {
      for (const socket of sockets) socket.disconnect(true);
    },
    async close() {
      app.server.closeAllConnections();
      try { await app.close(); }
      finally {
        await temporary?.close();
        applicationEvents.removeAllListeners();
      }
    }
  };
}

// The original durable-conversation unit fixture supplies this same store,
// write lock, attachments, routing selection and controlled native method seam.
// Canonical history, receipts, command coordination and publication stay real.
async function temporaryConversationsFixture({ engineId, session, actions, publishSessionChanged, onSubscribe }) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-browser-conversations-"));
  const targetRoot = path.join(root, "project");
  await mkdir(targetRoot);
  const selection = { engineId, modelProviderId: engineId === "opencode" ? "deepseek" : "openai",
    agentId: engineId === "opencode" ? "build" : "codex", modelId: "main-model", variantId: "high",
    catalogRevision: `sha256:${"a".repeat(64)}` };
  const capabilities = { engineId, transportId: engineId === "codex" ? "codex_app_server" : "opencode_server",
    revision: `sha256:${"b".repeat(64)}`, defaults: selection, agents: [{ id: selection.agentId, mode: "primary" }],
    modelProviders: [{ id: selection.modelProviderId, connected: true, models: [
      { id: "main-model", status: "available", variants: [{ id: "high" }] }
    ] }] };
  const stateRoot = path.join(root, "runtime");
  const store = createVibe64SessionStore({ projectContextRoot: targetRoot, projectRuntimeRoot: stateRoot });
  await store.createSession({ runtimeKind: "genesis", sessionId: session.sessionId, metadata: {
    ...sourceMetadata(targetRoot, session.sessionId), assistant_selection: serializeVibe64AssistantSelection(selection)
  } });
  const runtime = { store, stateRoot, getSession: id => store.readSession(id) };
  const attachments = createSessionAttachments({ projectService: { createRuntime: async () => runtime },
    env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") } });
  const native = new Map();
  let nextNativeId = 0;
  const captured = { temporaryCreates: [] as Record<string, unknown>[], temporaryTurns: [] as Record<string, unknown>[],
    temporaryDeletes: 0, outcome: (_turn: number) => "continue" };
  const sessionAgent = {
    async inspectAssistantPurposes() { return {}; },
    async assistantAccess() { return { canUse: true }; },
    async requireAssistantAccess() {},
    async requireAssistantAccessForSelection() {},
    async resolveSelection(input) { return resolveVibe64AssistantSelection(capabilities, input); },
    async createConversation() {
      const conversationId = `native-${++nextNativeId}`;
      native.set(conversationId, { status: "ready", runId: "", messages: [], accepted: new Set() });
      return { ok: true, conversationId };
    },
    async readConversation(_id, input) {
      const record = native.get(input.conversationId);
      if (!record) throw new Error("The controlled native conversation is unavailable.");
      const { accepted, ...response } = record;
      return { ok: true, ...response, admitted: accepted.has(input.messageId) };
    },
    async startConversationTurn(_id, input) {
      await input.onPromptSending?.({ threadId: input.conversationId });
      const record = native.get(input.conversationId);
      const runId = `temporary-run-${captured.temporaryTurns.length}`;
      const message = "Temporary recovery complete.";
      const text = input.outputSchema ? JSON.stringify({ kind: captured.outcome(captured.temporaryTurns.length),
        message, report: message }) : message;
      record.accepted.add(input.messageId);
      Object.assign(record, { status: "completed", runId, text });
      record.messages.push({ id: `${runId}-assistant`, role: "assistant", text, at: new Date().toISOString(), complete: true });
      return { ok: true, runId, status: "inProgress" };
    },
    async stopConversation(_id, input) {
      native.get(input.conversationId).status = "interrupted";
      return { ok: true };
    },
    async deleteConversation(_id, input) { native.delete(input.conversationId); return { ok: true }; }
  };
  const routingStore = createAssistantRoutingStore({ systemRoot: root });
  const role = { ...resolveVibe64AssistantSelection(capabilities, { ...selection, catalogRevision: capabilities.revision }), selectionSource: "explicit" };
  await routingStore.write({ [engineId]: { senior: role, junior: role, helper: role, router: role } }, 0);
  const manager = createSessionAgentManager({ providers: [{ id: engineId, transportId: capabilities.transportId, capabilities: async () => capabilities }],
    readRoutingConfiguration: () => routingStore.read(),
    readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "browser-fixture-connection" }) });
  Object.assign(sessionAgent, { resolveAssistantPurpose: (input, options) => manager.resolveAssistantPurpose(input, options) });
  let service;
  const common = createConversationRuntime({
    authorize: async ({ context, conversationId }) => conversationId === session.sessionId && context.sessionId === conversationId,
    host: { conversation: ({ id, context }) => service.conversationBinding(id, context) }
  });
  service = createSessionConversations({ systemRoot: root, sessionAgent, conversationRuntime: common, actions, attachments,
    prepareAgentSkills: async () => {},
    runAgentWrite: async (sessionId, options, operation, lockOptions) => {
      const result = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
        const currentSession = await runtime.getSession(sessionId);
        return operation({ ...options, runtime, session: currentSession });
      }, lockOptions);
      return result.value;
    },
    publishSessionChanged,
    publishConversation: event => common.publishNative(event)
  });
  const commandInput = input => {
    const { sessionId, conversationId, vibe64User, originId, ...body } = input;
    return body;
  };
  return {
    captured,
    async seed(records) {
      for (const record of records) await service.createTemporaryConversation(session.sessionId, {
        conversationId: record.conversationId, presentation: { title: record.title, draft: record.draft }, agentSettings: record.agentSettings
      });
    },
    terminals: {
      ...service,
      async createTemporaryConversation(sessionId, input) {
        captured.temporaryCreates.push({ ...commandInput(input), conversationId: input.conversationId });
        return service.createTemporaryConversation(sessionId, input);
      },
      async startTemporaryConversationTurn(sessionId, input) {
        captured.temporaryTurns.push(commandInput(input));
        return service.startTemporaryConversationTurn(sessionId, input);
      },
      async deleteTemporaryConversation(sessionId, input) {
        captured.temporaryDeletes += 1;
        return service.deleteTemporaryConversation(sessionId, input);
      },
      async openTemporaryBrowserConversation(sessionId, conversationId, options) {
        const handle = await common.open({ id: sessionId, context: { ...options, sessionId,
          temporaryConversationId: conversationId, runtime, session: await runtime.getSession(sessionId) } });
        return { ...handle, subscribe(listener) { onSubscribe(conversationId); return handle.subscribe(listener); } };
      }
    },
    async close() { await service.close(); await common.close(); await rm(root, { recursive: true, force: true }); }
  };
}
