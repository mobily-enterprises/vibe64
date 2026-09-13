import {
  ACTION_SKIP_INTEGRATION_SETUP,
  ACTION_RESUME_INTEGRATION_SETUP,
  ACTION_APPROVE_MESSAGE_SUGGESTION,
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ARCHIVE_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_DISCARD_MESSAGE_SUGGESTION,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_INSPECT_ASSISTANT_ACCESS,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_SESSIONS,
  ACTION_LIST_ARCHIVED_SESSIONS,
  ACTION_LIST_ASSISTANT_CAPABILITIES,
  ACTION_LIST_MESSAGE_SUGGESTIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_SUGGEST_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
  ACTION_UPDATE_ASSISTANT_SELECTION,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_PRESENCE,
  ACTION_UPDATE_SESSION_WORK,
  ACTION_WITHDRAW_MESSAGE_SUGGESTION
} from "./actions.js";
import {
  integrationSetupRequestInputValidator,
  agentMessageInputValidator,
  agentTurnInterruptInputValidator,
  assistantModelAccessUpdateInputValidator,
  assistantSelectionUpdateInputValidator,
  messageSuggestionDecisionInputValidator,
  sessionRenewalDraftGuardInputValidator,
  sessionRenewalConfirmationInputValidator,
  sessionRenewalDraftRequestInputValidator,
  sessionRenewalDraftUpdateInputValidator,
  sessionRenewalRetryInputValidator,
  sessionPresenceInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-sessions"]
  });

  routes.actionRoute("GET", "/repository/history", {
    actionId: ACTION_INSPECT_REPOSITORY_HISTORY,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        cursor: firstValue(query.cursor),
        limit: firstValue(query.limit),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "Read a pinned page of project version history."
  });

  routes.actionRoute("GET", "/repository/history/:commit/files", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "List files changed by one project version."
  });

  routes.actionRoute("GET", "/repository/history/:commit/diff", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "Read one file diff from a project version."
  });

  routes.actionRoute("GET", "/sessions", {
    actionId: ACTION_LIST_SESSIONS,
    buildInput: (request) => withVibe64User(request),
    summary: "List open Vibe64 sessions."
  });

  routes.actionRoute("GET", "/sessions/archived", {
    actionId: ACTION_LIST_ARCHIVED_SESSIONS,
    buildInput: (request) => withVibe64User(request),
    summary: "List archived Vibe64 sessions, newest first."
  });

  routes.actionRoute("GET", "/assistants/capabilities", {
    actionId: ACTION_LIST_ASSISTANT_CAPABILITIES,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        configuredOnly: firstValue(query.configuredOnly),
        connectedOnly: firstValue(query.connectedOnly),
        cursor: firstValue(query.cursor),
        engineId: firstValue(query.engineId),
        limit: firstValue(query.limit),
        modelProviderId: firstValue(query.modelProviderId),
        search: firstValue(query.search)
      });
    },
    summary: "Read the live assistant engine, provider, model, agent, and variant catalog."
  });

  routes.actionRoute("PATCH", "/assistants/model-access", {
    actionId: ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
    body: assistantModelAccessUpdateInputValidator,
    bodyLimit: 8 * 1024,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Change the owner-controlled model access for an assistant provider."
  });

  routes.actionRoute("POST", "/sessions", {
    actionId: ACTION_CREATE_SESSION,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Create a Vibe64 chat session."
  });

  routes.actionRoute("PUT", "/sessions/current", {
    actionId: ACTION_UPDATE_CURRENT_SESSION,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Update the current Vibe64 session alias."
  });

  routes.actionRoute("GET", "/sessions/:sessionId", {
    actionId: ACTION_INSPECT_SESSION,
    buildInput: (request) => withVibe64User(request, {
      sessionId: request.params.sessionId
    }),
    summary: "Inspect a Vibe64 chat session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/assistant-selection", {
    actionId: ACTION_UPDATE_ASSISTANT_SELECTION,
    body: assistantSelectionUpdateInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Change provider, model, primary agent, or variant between turns."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/renewal", {
    actionId: ACTION_INSPECT_SESSION_RENEWAL,
    buildInput: (request) => ({
      sessionId: request.params.sessionId
    }),
    summary: "Inspect the resumable renewal state for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/draft", {
    actionId: ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
    body: sessionRenewalDraftRequestInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Request an editable handover draft for a Vibe64 session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/renewal/draft", {
    actionId: ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
    body: sessionRenewalDraftUpdateInputValidator,
    bodyLimit: 256 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Save an edited Vibe64 session handover draft."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/cancel", {
    actionId: ACTION_CANCEL_SESSION_RENEWAL,
    body: sessionRenewalDraftGuardInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Cancel an unconfirmed Vibe64 session renewal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/confirm", {
    actionId: ACTION_CONFIRM_SESSION_RENEWAL,
    body: sessionRenewalConfirmationInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Confirm the reviewed Vibe64 session handover."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/retry", {
    actionId: ACTION_RETRY_SESSION_RENEWAL,
    body: sessionRenewalRetryInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Resume a failed or interrupted Vibe64 session renewal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/work", {
    actionId: ACTION_INSPECT_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      sessionId: request.params.sessionId
    }),
    summary: "Inspect whether a Vibe64 session has work to save."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes", {
    actionId: ACTION_INSPECT_SESSION_CHANGES,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: request.params.sessionId
      });
    },
    summary: "List the files that differ from this session's canonical project version."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes/diff", {
    actionId: ACTION_INSPECT_SESSION_CHANGE_DIFF,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: request.params.sessionId
      });
    },
    summary: "Read the bounded diff for one current project file."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/save", {
    actionId: ACTION_SAVE_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Save session work to the project's canonical repository."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/check", {
    actionId: ACTION_CHECK_SESSION_UPDATES,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Check whether this session has a newer saved project version."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/apply", {
    actionId: ACTION_UPDATE_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Update this session (rebase) without publishing or discarding its work."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/resume", {
    actionId: ACTION_RESUME_INTEGRATION_SETUP,
    body: integrationSetupRequestInputValidator,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Resume or inspect delivery for an exact completed integration setup request."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/skip", {
    actionId: ACTION_SKIP_INTEGRATION_SETUP,
    body: integrationSetupRequestInputValidator,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Skip an exact saved integration setup request."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/conversation-log", {
    actionId: ACTION_READ_SESSION_CONVERSATION_LOG,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        beforeTurnId: firstValue(query.beforeTurnId || query.before),
        limit: firstValue(query.limit),
        sessionId: request.params.sessionId
      });
    },
    summary: "Read a Vibe64 session conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-message", {
    actionId: ACTION_SEND_AGENT_MESSAGE,
    body: agentMessageInputValidator,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Send a message to the Vibe64 assistant."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/assistant-access", {
    actionId: ACTION_INSPECT_ASSISTANT_ACCESS,
    buildInput: (request) => withVibe64User(request, {
      sessionId: request.params.sessionId
    }),
    summary: "Inspect whether the current identity may use this session's selected assistant."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/message-suggestions", {
    actionId: ACTION_LIST_MESSAGE_SUGGESTIONS,
    buildInput: (request) => withVibe64User(request, {
      sessionId: request.params.sessionId
    }),
    summary: "Read the visible owner-approval message-suggestion queue."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/message-suggestions", {
    actionId: ACTION_SUGGEST_AGENT_MESSAGE,
    body: agentMessageInputValidator,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Suggest a main-chat message for owner approval."
  });

  for (const [operation, actionId, summary] of [
    ["withdraw", ACTION_WITHDRAW_MESSAGE_SUGGESTION, "Withdraw a pending message suggestion."],
    ["approve", ACTION_APPROVE_MESSAGE_SUGGESTION, "Approve and deliver a pending message suggestion."],
    ["discard", ACTION_DISCARD_MESSAGE_SUGGESTION, "Discard a pending message suggestion."]
  ]) {
    routes.actionRoute(
      "POST",
      `/sessions/:sessionId/message-suggestions/:suggestionId/${operation}`,
      {
        actionId,
        body: messageSuggestionDecisionInputValidator,
        buildInput: (request) => withVibe64User(request, {
          ...routes.requestBody(request),
          sessionId: request.params.sessionId,
          suggestionId: request.params.suggestionId
        }),
        summary
      }
    );
  }

  routes.actionRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    actionId: ACTION_INTERRUPT_AGENT_TURN,
    body: agentTurnInterruptInputValidator,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Interrupt the active Vibe64 assistant turn."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/presence", {
    actionId: ACTION_UPDATE_SESSION_PRESENCE,
    body: sessionPresenceInputValidator,
    bodyLimit: 4 * 1024,
    buildInput: (request) => ({
      ...withoutVibe64User(routes.requestBody(request)),
      sessionId: request.params.sessionId
    }),
    summary: "Publish ephemeral typing presence for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-state", {
    actionId: ACTION_BROADCAST_SESSION_PREVIEW_STATE,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Publish the page displayed in a Vibe64 managed preview."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/archive", {
    actionId: ACTION_ARCHIVE_SESSION,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Archive a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/workspace-setup/retry", {
    actionId: ACTION_RETRY_WORKSPACE_SETUP,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
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

function withVibe64User(request, input = {}) {
  const safeInput = withoutVibe64User(input);
  return request.vibe64User
    ? {
        ...safeInput,
        vibe64User: request.vibe64User
      }
    : safeInput;
}

export { registerRoutes };
