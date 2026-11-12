import {
  sessionRenameInputValidator,
  sessionPinInputValidator,
  integrationSetupRequestInputValidator,
  agentMessageInputValidator,
  mainChatApprovalInputValidator,
  agentTurnInterruptInputValidator,
  assistantModelAccessUpdateInputValidator,
  assistantSelectionUpdateInputValidator,
  sessionRenewalCancelInputValidator,
  sessionRenewalConfirmationInputValidator,
  sessionRenewalDraftRequestInputValidator,
  sessionRenewalDraftUpdateInputValidator,
  sessionRenewalRetryInputValidator,
  sessionPresenceInputValidator
} from "./inputSchemas.js";
import {
  ACTION_APPROVE_MAIN_CHAT_APPROVAL,
  ACTION_ARCHIVE_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_CREATE_PULL_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_DECLINE_MAIN_CHAT_APPROVAL,
  ACTION_EDIT_MAIN_CHAT_APPROVAL,
  ACTION_INSPECT_ASSISTANT_ACCESS,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_ARCHIVED_SESSIONS,
  ACTION_LIST_ASSISTANT_CAPABILITIES,
  ACTION_LIST_SESSIONS,
  ACTION_PIN_SESSION,
  ACTION_READ_MAIN_CHAT_APPROVALS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RENAME_SESSION,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RESUME_INTEGRATION_SETUP,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_SKIP_INTEGRATION_SETUP,
  ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
  ACTION_UPDATE_ASSISTANT_SELECTION,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_SESSION_PRESENCE,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_WORK,
  ACTION_WITHDRAW_MAIN_CHAT_APPROVAL
} from "./sessionActions.js";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/studioProjectContext").createStudioProjectContext>} StudioProjectContext */

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-sessions"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/repository/history", {
    actionId: ACTION_INSPECT_REPOSITORY_HISTORY,
    buildInput: historyPageInput,
    summary: "Read a pinned page of project version history."
  });

  routes.actionRoute("GET", "/repository/history/:commit/files", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    buildInput: versionFilesInput,
    summary: "List files changed by one project version."
  });

  routes.actionRoute("GET", "/repository/history/:commit/diff", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    buildInput: versionFileDiffInput,
    summary: "Read one file diff from a project version."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/pin", {
    actionId: ACTION_PIN_SESSION,
    body: sessionPinInputValidator,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Pin this session as the project's server-selected source."
  });

  routes.actionRoute("GET", "/sessions", {
    actionId: ACTION_LIST_SESSIONS,
    buildInput: noInput,
    summary: "List open Vibe64 sessions."
  });

  routes.actionRoute("GET", "/sessions/archived", {
    actionId: ACTION_LIST_ARCHIVED_SESSIONS,
    buildInput: archivedSessionsInput,
    summary: "List archived Vibe64 sessions, newest first; sessionLimit and sessionOffset read one page."
  });

  routes.actionRoute("GET", "/assistants/capabilities", {
    actionId: ACTION_LIST_ASSISTANT_CAPABILITIES,
    buildInput: assistantCapabilitiesInput,
    summary: "Read the live assistant engine, provider, model, agent, and variant catalog."
  });

  routes.actionRoute("PATCH", "/assistants/model-access", {
    actionId: ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
    body: assistantModelAccessUpdateInputValidator,
    bodyLimit: 8 * 1024,
    buildInput: bodyWithoutUserInput,
    summary: "Change the owner-controlled model access for an assistant provider."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/pull-request", {
    actionId: ACTION_CREATE_PULL_REQUEST,
    bodyLimit: 300_000,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Push session work to a new branch and create a GitHub pull request."
  });

  routes.actionRoute("POST", "/sessions", {
    actionId: ACTION_CREATE_SESSION,
    buildInput: bodyWithoutUserInput,
    summary: "Create a Vibe64 chat session."
  });

  routes.actionRoute("PUT", "/sessions/current", {
    actionId: ACTION_UPDATE_CURRENT_SESSION,
    buildInput: bodyWithoutUserInput,
    summary: "Update the current Vibe64 session alias."
  });

  routes.actionRoute("GET", "/sessions/:sessionId", {
    actionId: ACTION_INSPECT_SESSION,
    buildInput: sessionIdInput,
    summary: "Inspect a Vibe64 chat session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/assistant-selection", {
    actionId: ACTION_UPDATE_ASSISTANT_SELECTION,
    body: assistantSelectionUpdateInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Change provider, model, primary agent, or variant between turns."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/name", {
    actionId: ACTION_RENAME_SESSION,
    body: sessionRenameInputValidator,
    bodyLimit: 4096,
    buildInput: sessionBodyInput,
    summary: "Change this session's display name."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/renewal", {
    actionId: ACTION_INSPECT_SESSION_RENEWAL,
    buildInput: sessionIdInput,
    summary: "Inspect the resumable renewal state for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/draft", {
    actionId: ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
    body: sessionRenewalDraftRequestInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Request an editable handover draft for a Vibe64 session."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/renewal/draft", {
    actionId: ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
    body: sessionRenewalDraftUpdateInputValidator,
    bodyLimit: 256 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Save an edited Vibe64 session handover draft."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/cancel", {
    actionId: ACTION_CANCEL_SESSION_RENEWAL,
    body: sessionRenewalCancelInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Cancel a Vibe64 session renewal under review, or one that failed before its fresh session took over."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/confirm", {
    actionId: ACTION_CONFIRM_SESSION_RENEWAL,
    body: sessionRenewalConfirmationInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Confirm the reviewed Vibe64 session handover."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/renewal/retry", {
    actionId: ACTION_RETRY_SESSION_RENEWAL,
    body: sessionRenewalRetryInputValidator,
    bodyLimit: 32 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Resume a failed or interrupted Vibe64 session renewal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/work", {
    actionId: ACTION_INSPECT_SESSION_WORK,
    buildInput: sessionIdInput,
    summary: "Inspect whether a Vibe64 session has work to save."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes", {
    actionId: ACTION_INSPECT_SESSION_CHANGES,
    buildInput: sessionChangesInput,
    summary: "List the files that differ from this session's canonical project version."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes/diff", {
    actionId: ACTION_INSPECT_SESSION_CHANGE_DIFF,
    buildInput: sessionChangeDiffInput,
    summary: "Read the bounded diff for one current project file."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/save", {
    actionId: ACTION_SAVE_SESSION_WORK,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Save session work to the project's canonical repository."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/check", {
    actionId: ACTION_CHECK_SESSION_UPDATES,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Check whether this session has a newer saved project version."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/apply", {
    actionId: ACTION_UPDATE_SESSION_WORK,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Update this session (rebase) without saving or discarding its work."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/resume", {
    actionId: ACTION_RESUME_INTEGRATION_SETUP,
    body: integrationSetupRequestInputValidator,
    buildInput: sessionBodyInput,
    summary: "Resume or inspect delivery for an exact completed integration setup request."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/integration-setup/skip", {
    actionId: ACTION_SKIP_INTEGRATION_SETUP,
    body: integrationSetupRequestInputValidator,
    buildInput: sessionBodyInput,
    summary: "Skip an exact saved integration setup request."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/conversation-log", {
    actionId: ACTION_READ_SESSION_CONVERSATION_LOG,
    buildInput: conversationLogInput,
    summary: "Read a Vibe64 session conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-message", {
    actionId: ACTION_SEND_AGENT_MESSAGE,
    body: agentMessageInputValidator,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Send a message to the Vibe64 assistant."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/main-chat-approvals", {
    actionId: ACTION_READ_MAIN_CHAT_APPROVALS,
    buildInput: sessionIdInput,
    summary: "Read the team members' main-chat messages waiting for the owner's approval."
  });

  routes.actionRoute("PATCH", "/sessions/:sessionId/main-chat-approvals/:approvalId", {
    actionId: ACTION_EDIT_MAIN_CHAT_APPROVAL,
    body: mainChatApprovalInputValidator,
    buildInput: mainChatApprovalInput,
    summary: "Edit your own main-chat message while it waits for approval."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/main-chat-approvals/:approvalId/withdraw", {
    actionId: ACTION_WITHDRAW_MAIN_CHAT_APPROVAL,
    body: mainChatApprovalInputValidator,
    buildInput: mainChatApprovalInput,
    summary: "Withdraw your own main-chat message while it waits for approval."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/main-chat-approvals/:approvalId/approve", {
    actionId: ACTION_APPROVE_MAIN_CHAT_APPROVAL,
    body: mainChatApprovalInputValidator,
    buildInput: mainChatApprovalInput,
    summary: "Approve and send a team member's main-chat message."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/main-chat-approvals/:approvalId/decline", {
    actionId: ACTION_DECLINE_MAIN_CHAT_APPROVAL,
    body: mainChatApprovalInputValidator,
    buildInput: mainChatApprovalInput,
    summary: "Decline a team member's main-chat message."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/assistant-access", {
    actionId: ACTION_INSPECT_ASSISTANT_ACCESS,
    buildInput: sessionIdInput,
    summary: "Inspect whether the current identity may use this session's selected assistant."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    actionId: ACTION_INTERRUPT_AGENT_TURN,
    body: agentTurnInterruptInputValidator,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Interrupt the active Vibe64 assistant turn."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/presence", {
    actionId: ACTION_UPDATE_SESSION_PRESENCE,
    body: sessionPresenceInputValidator,
    bodyLimit: 4 * 1024,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Publish ephemeral typing presence for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-state", {
    actionId: ACTION_BROADCAST_SESSION_PREVIEW_STATE,
    buildInput: sessionBodyInput,
    summary: "Publish the page displayed in a Vibe64 managed preview."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/archive", {
    actionId: ACTION_ARCHIVE_SESSION,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Archive a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/workspace-setup/retry", {
    actionId: ACTION_RETRY_WORKSPACE_SETUP,
    buildInput: sessionBodyWithoutUserInput,
    summary: "Retry the declared Vibe64 workspace preparation recipe."
  });
}

function noInput() {
  return {};
}

function sessionIdInput(request) {
  return { sessionId: request.params.sessionId };
}

function sessionBodyInput(request) {
  return {
    ...requestBody(request),
    sessionId: request.params.sessionId
  };
}

/**
 * The body without any acting user it names: the action policy supplies the
 * trusted user.
 */
function bodyWithoutUserInput(request) {
  return withoutVibe64User(requestBody(request));
}

function sessionBodyWithoutUserInput(request) {
  return {
    ...withoutVibe64User(requestBody(request)),
    sessionId: request.params.sessionId
  };
}

// Only the page fields the query names: an absent one read as "" is refused
// as a whole number, and without sessionLimit the list is complete.
function archivedSessionsInput(request) {
  const query = requestQuery(request);
  return Object.fromEntries(["sessionLimit", "sessionOffset"]
    .filter((name) => Object.hasOwn(query, name))
    .map((name) => [name, firstValue(query[name])]));
}

function historyPageInput(request) {
  const query = requestQuery(request);
  return {
    cursor: firstValue(query.cursor),
    limit: firstValue(query.limit),
    sessionId: firstValue(query.sessionId)
  };
}

function versionFilesInput(request) {
  const query = requestQuery(request);
  return {
    commit: request.params.commit,
    historySnapshotCommit: firstValue(query.historySnapshotCommit),
    limit: firstValue(query.limit),
    offset: firstValue(query.offset),
    sessionId: firstValue(query.sessionId)
  };
}

function versionFileDiffInput(request) {
  const query = requestQuery(request);
  return {
    commit: request.params.commit,
    historySnapshotCommit: firstValue(query.historySnapshotCommit),
    lineLimit: firstValue(query.lineLimit),
    path: firstValue(query.path),
    sessionId: firstValue(query.sessionId)
  };
}

function assistantCapabilitiesInput(request) {
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
}

function sessionChangesInput(request) {
  const query = requestQuery(request);
  return {
    limit: firstValue(query.limit),
    offset: firstValue(query.offset),
    sessionId: request.params.sessionId
  };
}

function sessionChangeDiffInput(request) {
  const query = requestQuery(request);
  return {
    lineLimit: firstValue(query.lineLimit),
    path: firstValue(query.path),
    sessionId: request.params.sessionId
  };
}

function conversationLogInput(request) {
  const query = requestQuery(request);
  return {
    beforeTurnId: firstValue(query.beforeTurnId || query.before),
    limit: firstValue(query.limit),
    sessionId: request.params.sessionId
  };
}

function mainChatApprovalInput(request) {
  return {
    ...withoutVibe64User(requestBody(request)),
    sessionId: request.params.sessionId,
    approvalId: request.params.approvalId
  };
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function withoutVibe64User(input) {
  const {
    vibe64User: _ignored,
    ...safeInput
  } = input || {};
  void _ignored;
  return safeInput;
}

export { registerRoutes };
