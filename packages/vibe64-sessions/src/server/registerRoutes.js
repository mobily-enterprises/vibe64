import {
  sessionRenameInputValidator,
  sessionPinInputValidator,
  integrationSetupRequestInputValidator,
  agentMessageInputValidator,
  mainChatApprovalInputValidator,
  agentTurnInterruptInputValidator,
  assistantModelAccessUpdateInputValidator,
  assistantSelectionUpdateInputValidator,
  sessionRenewalDraftGuardInputValidator,
  sessionRenewalConfirmationInputValidator,
  sessionRenewalDraftRequestInputValidator,
  sessionRenewalDraftUpdateInputValidator,
  sessionRenewalRetryInputValidator,
  sessionPresenceInputValidator
} from "./inputSchemas.js";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null
} = {}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-sessions"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/repository/history", {
    actionId: "vibe64.repository.history.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        cursor: firstValue(query.cursor),
        limit: firstValue(query.limit),
        sessionId: firstValue(query.sessionId)
      };
    },
    summary: "Read a pinned page of project version history."
  });

  routes.actionRoute("GET", "/repository/history/:commit/files", {
    actionId: "vibe64.repository.history.files.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: firstValue(query.sessionId)
      };
    },
    summary: "List files changed by one project version."
  });

  routes.actionRoute("GET", "/repository/history/:commit/diff", {
    actionId: "vibe64.repository.history.diff.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: firstValue(query.sessionId)
      };
    },
    summary: "Read one file diff from a project version."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/pin", {
    actionId: "vibe64.sessions.pin",
    body: sessionPinInputValidator,
    buildInput: (request) => ({ ...withoutVibe64User(requestBody(request)), sessionId: request.params.sessionId }),
    summary: "Pin this session as the project's server-selected source."
  });

  routes.actionRoute("GET", "/sessions", {
    actionId: "vibe64.sessions.list",
    buildInput: () => ({}),
    summary: "List open Vibe64 sessions."
  });

  routes.actionRoute("GET", "/sessions/archived", {
    actionId: "vibe64.sessions.archived.list",
    buildInput: () => ({}),
    summary: "List archived Vibe64 sessions, newest first."
  });

  routes.actionRoute("GET", "/assistants/capabilities", {
    actionId: "vibe64.assistants.capabilities.list",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        allConnectedModels: firstValue(query.allConnectedModels),
        configuredOnly: firstValue(query.configuredOnly),
        connectedOnly: firstValue(query.connectedOnly),
        cursor: firstValue(query.cursor),
        engineId: firstValue(query.engineId),
        limit: firstValue(query.limit),
        modelProviderId: firstValue(query.modelProviderId),
        search: firstValue(query.search)
      };
    },
    summary: "Read the live assistant engine, provider, model, agent, and variant catalog."
  });

  routes.actionRoute("PATCH", "/assistants/model-access", {
    actionId: "vibe64.assistants.model-access.update",
    body: assistantModelAccessUpdateInputValidator,
    bodyLimit: 8 * 1024,
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Change the owner-controlled model access for an assistant provider."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/pull-request", {
    actionId: "vibe64.sessions.pull-request.create",
    bodyLimit: 300_000,
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request), sessionId: request.params.sessionId
    }),
    summary: "Push session work to a new branch and create a GitHub pull request."
  });

  routes.actionRoute("POST", "/sessions", {
    actionId: "vibe64.sessions.create",
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Create a Vibe64 chat session."
  });

  routes.actionRoute("PUT", "/sessions/current", {
    actionId: "vibe64.sessions.current.update",
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Update the current Vibe64 session alias."
  });

  routes.actionRoute("GET", "/sessions/:sessionId", {
    actionId: "vibe64.sessions.inspect",
    buildInput: (request) => ({
      sessionId: request.params.sessionId
    }),
    summary: "Inspect a Vibe64 chat session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/assistant-selection", {
    actionId: "vibe64.sessions.assistant-selection.update",
    body: assistantSelectionUpdateInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Change provider, model, primary agent, or variant between turns."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/name", {
    actionId: "vibe64.sessions.rename",
    body: sessionRenameInputValidator,
    bodyLimit: 4096,
    buildInput: (request) => ({ ...requestBody(request), sessionId: request.params.sessionId }),
    summary: "Change this session's display name."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/renewal", {
    actionId: "vibe64.sessions.renewal.inspect",
    buildInput: (request) => ({
      sessionId: request.params.sessionId
    }),
    summary: "Inspect the resumable renewal state for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/draft", {
    actionId: "vibe64.sessions.renewal.draft.request",
    body: sessionRenewalDraftRequestInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Request an editable handover draft for a Vibe64 session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/renewal/draft", {
    actionId: "vibe64.sessions.renewal.draft.update",
    body: sessionRenewalDraftUpdateInputValidator,
    bodyLimit: 256 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Save an edited Vibe64 session handover draft."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/cancel", {
    actionId: "vibe64.sessions.renewal.cancel",
    body: sessionRenewalDraftGuardInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Cancel an unconfirmed Vibe64 session renewal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/confirm", {
    actionId: "vibe64.sessions.renewal.confirm",
    body: sessionRenewalConfirmationInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Confirm the reviewed Vibe64 session handover."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/retry", {
    actionId: "vibe64.sessions.renewal.retry",
    body: sessionRenewalRetryInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Resume a failed or interrupted Vibe64 session renewal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/work", {
    actionId: "vibe64.sessions.work.inspect",
    buildInput: (request) => ({
      sessionId: request.params.sessionId
    }),
    summary: "Inspect whether a Vibe64 session has work to save."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/connected/prepare", {
    actionId: "vibe64.sessions.connected.prepare",
    buildInput: request => ({ sessionId: request.params.sessionId }),
    summary: "Prepare isolated contribution sources for the session's configured connected projects."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/connected/replacement", {
    actionId: "vibe64.sessions.connected.replacement.inspect",
    buildInput: request => ({ sessionId: request.params.sessionId,
      repository: firstValue(requestQuery(request).repository) }),
    summary: "Review a discarded contribution before creating its replacement."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/connected/replacement", {
    actionId: "vibe64.sessions.connected.replace",
    buildInput: request => ({ ...withoutVibe64User(requestBody(request)), sessionId: request.params.sessionId }),
    summary: "Prepare a replacement contribution without saving either project."
  });

  routes.actionRoute("GET", "/incoming", {
    actionId: "vibe64.repository.incoming.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return Object.fromEntries(["sessionId", "id", "state", "offset", "limit"]
        .filter(key => query[key] !== undefined).map(key => [key, firstValue(query[key])]));
    },
    summary: "List Git-derived contributions to the receiving project."
  });
  routes.actionRoute("GET", "/incoming/:id", {
    actionId: "vibe64.repository.incoming.review",
    buildInput: request => ({ sessionId: firstValue(requestQuery(request).sessionId), id: request.params.id }),
    summary: "Review the exact contribution and integration heads with a bounded diff."
  });
  routes.actionRoute("POST", "/incoming/:id", {
    actionId: "vibe64.repository.incoming.change",
    buildInput: request => ({ ...withoutVibe64User(requestBody(request)), id: request.params.id }),
    summary: "Merge or discard an exact reviewed contribution."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes", {
    actionId: "vibe64.sessions.changes.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: request.params.sessionId
      };
    },
    summary: "List the files that differ from this session's canonical project version."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes/diff", {
    actionId: "vibe64.sessions.changes.diff.inspect",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: request.params.sessionId
      };
    },
    summary: "Read the bounded diff for one current project file."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/save", {
    actionId: "vibe64.sessions.work.save",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Save session work to the project's canonical repository."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/check", {
    actionId: "vibe64.sessions.updates.check",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Check whether this session has a newer saved project version."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/apply", {
    actionId: "vibe64.sessions.updates.apply",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Update this session (rebase) without saving or discarding its work."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/resume", {
    actionId: "vibe64.sessions.integration-setup.resume",
    body: integrationSetupRequestInputValidator,
    buildInput: (request) => ({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Resume or inspect delivery for an exact completed integration setup request."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/skip", {
    actionId: "vibe64.sessions.integration-setup.skip",
    body: integrationSetupRequestInputValidator,
    buildInput: (request) => ({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Skip an exact saved integration setup request."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/conversation-log", {
    actionId: "vibe64.sessions.conversation-log.read",
    buildInput(request) {
      const query = requestQuery(request);
      return {
        beforeTurnId: firstValue(query.beforeTurnId || query.before),
        limit: firstValue(query.limit),
        sessionId: request.params.sessionId
      };
    },
    summary: "Read a Vibe64 session conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-message", {
    actionId: "vibe64.sessions.agent-message.send",
    body: agentMessageInputValidator,
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Send a message to the Vibe64 assistant."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/main-chat-approvals", {
    actionId: "vibe64.sessions.main-chat-approvals.read",
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    summary: "Read the team members' main-chat messages waiting for the owner's approval."
  });

  for (const [method, suffix, operation, summary] of [
    ["PATCH", "", "edit", "Edit your own main-chat message while it waits for approval."],
    ["POST", "/withdraw", "withdraw", "Withdraw your own main-chat message while it waits for approval."],
    ["POST", "/approve", "approve", "Approve and send a team member's main-chat message."],
    ["POST", "/decline", "decline", "Decline a team member's main-chat message."]
  ]) {
    routes.actionRoute(method, `/sessions/:sessionId/main-chat-approvals/:approvalId${suffix}`, {
      actionId: `vibe64.sessions.main-chat-approvals.${operation}`,
      body: mainChatApprovalInputValidator,
      buildInput: (request) => ({
        ...withoutVibe64User(requestBody(request)),
        sessionId: request.params.sessionId,
        approvalId: request.params.approvalId
      }),
      summary
    });
  }

  routes.actionRoute("GET", "/sessions/:sessionId/assistant-access", {
    actionId: "vibe64.sessions.assistant-access.inspect",
    buildInput: (request) => ({
      sessionId: request.params.sessionId
    }),
    summary: "Inspect whether the current identity may use this session's selected assistant."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    actionId: "vibe64.sessions.agent-turn.interrupt",
    body: agentTurnInterruptInputValidator,
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Interrupt the active Vibe64 assistant turn."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/presence", {
    actionId: "vibe64.sessions.presence.update",
    body: sessionPresenceInputValidator,
    bodyLimit: 4 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Publish ephemeral typing presence for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-state", {
    actionId: "vibe64.sessions.preview-state.broadcast",
    buildInput: (request) => ({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Publish the page displayed in a Vibe64 managed preview."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/archive", {
    actionId: "vibe64.sessions.archive",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Archive a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/workspace-setup/retry", {
    actionId: "vibe64.sessions.workspace-setup.retry",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Retry the declared Vibe64 workspace preparation recipe."
  });
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function withoutVibe64User(input = {}) {
  const {
    vibe64User: _ignored,
    ...safeInput
  } = input || {};
  void _ignored;
  return safeInput;
}

export { registerRoutes };
