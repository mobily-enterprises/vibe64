import { NOT_A_TOOL, PROJECT_OPERATION, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { createConnectedContributionActions } from "./connectedContributionActions.js";
import { PROJECT_WATCH_ACTION } from "./projectWatch.js";
import {
  ASSISTANT_TOOL_DESCRIPTIONS,
  assistantAccessTool,
  conversationLogTool,
  repositoryHistoryTool,
  repositoryVersionFilesTool,
  conversationOperationTool,
  renewalInspectionTool,
  renewalTool,
  sessionTool,
  sessionWorkTool,
  sessionPullRequestTool,
  incomingContributionTool
} from "./assistantContracts.js";
import {
  incomingInspectionInputValidator,
  incomingChangeInputValidator,
  sessionRenameActionInputValidator,
  integrationSetupRequestActionInputValidator,
  agentMessageActionInputValidator,
  mainChatApprovalActionInputValidator,
  agentTurnInterruptActionInputValidator,
  assistantAccessActionInputValidator,
  assistantCapabilitiesInputValidator,
  assistantModelAccessUpdateActionInputValidator,
  assistantSelectionUpdateActionInputValidator,
  currentSessionInputValidator,
  sessionPinActionInputValidator,
  repositoryHistoryInputValidator,
  projectWatchInputValidator,
  repositoryVersionFileDiffInputValidator,
  repositoryVersionFilesInputValidator,
  sessionConversationLogInputValidator,
  sessionChangeDiffInputValidator,
  sessionChangesInputValidator,
  sessionCreateInputValidator,
  sessionPullRequestInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator,
  sessionPresenceActionInputValidator,
  sessionPreviewStateInputValidator,
  sessionRenewalConfirmationActionInputValidator,
  sessionRenewalDraftGuardActionInputValidator,
  sessionRenewalDraftRequestActionInputValidator,
  sessionRenewalDraftUpdateActionInputValidator,
  sessionRenewalInspectActionInputValidator,
  sessionRenewalRetryActionInputValidator,
  sessionSaveInputValidator,
  sessionUpdateInputValidator
} from "./inputSchemas.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("./types.js").SessionRepositoryUpdates} SessionRepositoryUpdates */

const ACTION_SKIP_INTEGRATION_SETUP = "vibe64.sessions.integration-setup.skip";
const ACTION_RESUME_INTEGRATION_SETUP = "vibe64.sessions.integration-setup.resume";
const ACTION_LIST_SESSIONS = "vibe64.sessions.list";
const ACTION_LIST_ARCHIVED_SESSIONS = "vibe64.sessions.archived.list";
const ACTION_LIST_ASSISTANT_CAPABILITIES = "vibe64.assistants.capabilities.list";
const ACTION_UPDATE_ASSISTANT_MODEL_ACCESS = "vibe64.assistants.model-access.update";
const ACTION_CREATE_PULL_REQUEST = "vibe64.sessions.pull-request.create";
const ACTION_CREATE_SESSION = "vibe64.sessions.create";
const ACTION_PIN_SESSION = "vibe64.sessions.pin";
const ACTION_RENAME_SESSION = "vibe64.sessions.rename";
const ACTION_UPDATE_ASSISTANT_SELECTION = "vibe64.sessions.assistant-selection.update";
const ACTION_UPDATE_CURRENT_SESSION = "vibe64.sessions.current.update";
const ACTION_INSPECT_SESSION_WORK = "vibe64.sessions.work.inspect";
const ACTION_SAVE_SESSION_WORK = "vibe64.sessions.work.save";
const ACTION_INSPECT_INCOMING = "vibe64.repository.incoming.inspect";
const ACTION_REVIEW_INCOMING = "vibe64.repository.incoming.review";
const ACTION_CHANGE_INCOMING = "vibe64.repository.incoming.change";
const ACTION_CHECK_SESSION_UPDATES = "vibe64.sessions.updates.check";
const ACTION_UPDATE_SESSION_WORK = "vibe64.sessions.updates.apply";
const ACTION_INSPECT_SESSION = "vibe64.sessions.inspect";
const ACTION_INSPECT_SESSION_RENEWAL = "vibe64.sessions.renewal.inspect";
const ACTION_REQUEST_SESSION_RENEWAL_DRAFT = "vibe64.sessions.renewal.draft.request";
const ACTION_UPDATE_SESSION_RENEWAL_DRAFT = "vibe64.sessions.renewal.draft.update";
const ACTION_CANCEL_SESSION_RENEWAL = "vibe64.sessions.renewal.cancel";
const ACTION_CONFIRM_SESSION_RENEWAL = "vibe64.sessions.renewal.confirm";
const ACTION_RETRY_SESSION_RENEWAL = "vibe64.sessions.renewal.retry";
const ACTION_INSPECT_SESSION_CHANGES = "vibe64.sessions.changes.inspect";
const ACTION_INSPECT_SESSION_CHANGE_DIFF = "vibe64.sessions.changes.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "vibe64.sessions.conversation-log.read";
const ACTION_READ_CONVERSATION_CONTEXT = "vibe64.sessions.conversation.context.read";
const ACTION_RETRY_WORKSPACE_SETUP = "vibe64.sessions.workspace-setup.retry";
const ACTION_ARCHIVE_SESSION = "vibe64.sessions.archive";
const ACTION_SEND_AGENT_MESSAGE = "vibe64.sessions.agent-message.send";
const ACTION_INSPECT_ASSISTANT_ACCESS = "vibe64.sessions.assistant-access.inspect";
const ACTION_READ_MAIN_CHAT_APPROVALS = "vibe64.sessions.main-chat-approvals.read";
const ACTION_EDIT_MAIN_CHAT_APPROVAL = "vibe64.sessions.main-chat-approvals.edit";
const ACTION_WITHDRAW_MAIN_CHAT_APPROVAL = "vibe64.sessions.main-chat-approvals.withdraw";
const ACTION_APPROVE_MAIN_CHAT_APPROVAL = "vibe64.sessions.main-chat-approvals.approve";
const ACTION_DECLINE_MAIN_CHAT_APPROVAL = "vibe64.sessions.main-chat-approvals.decline";
const ACTION_INTERRUPT_AGENT_TURN = "vibe64.sessions.agent-turn.interrupt";
const ACTION_BROADCAST_SESSION_PREVIEW_STATE = "vibe64.sessions.preview-state.broadcast";
const ACTION_UPDATE_SESSION_PRESENCE = "vibe64.sessions.presence.update";
const ACTION_INSPECT_REPOSITORY_HISTORY = "vibe64.repository.history.inspect";
const ACTION_INSPECT_REPOSITORY_VERSION_FILES = "vibe64.repository.history.files.inspect";
const ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF = "vibe64.repository.history.diff.inspect";

// Route adapters assemble body patches and path IDs before dispatch, so each
// action's input is in create mode: an action invocation must supply the
// complete required operation arguments.

/**
 * @param {object} dependencies
 * @param {SessionsService} dependencies.sessions
 */
function createSessionActions({ sessions }) {
  return Object.freeze([
    ...createConnectedContributionActions({ sessions }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_CONVERSATION_CONTEXT,
      input: { ...sessionIdInputValidator, mode: "create" },
      // This grant stays inside the application's conversation adapter. It has
      // no HTTP route or assistant tool projection.
      channels: ["internal"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.readConversationContext(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_PIN_SESSION,
      input: { ...sessionPinActionInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.pinSession),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.pinSession(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RENAME_SESSION,
      input: { ...sessionRenameActionInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.renameSession),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.renameSession(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RESUME_INTEGRATION_SETUP,
      input: { ...integrationSetupRequestActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.resumeIntegrationContinuation(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SKIP_INTEGRATION_SETUP,
      input: { ...integrationSetupRequestActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.skipIntegrationSetupRequest(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_REPOSITORY_HISTORY,
      input: { ...repositoryHistoryInputValidator, mode: "create" },
      extensions: { assistant: repositoryHistoryTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectRepositoryHistory(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_REPOSITORY_VERSION_FILES,
      input: { ...repositoryVersionFilesInputValidator, mode: "create" },
      extensions: { assistant: repositoryVersionFilesTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectRepositoryVersionFiles(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
      input: { ...repositoryVersionFileDiffInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectRepositoryVersionFileDiff(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_SESSIONS,
      input: { ...sessionListInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.listSessions),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.listSessions(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_ARCHIVED_SESSIONS,
      input: { ...sessionListInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.listArchivedSessions),
        vibe64: PROJECT_OPERATION
      },
      execute: () => sessions.listArchivedSessions()
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_ASSISTANT_CAPABILITIES,
      input: { ...assistantCapabilitiesInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => sessions.listAssistantCapabilities(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
      input: { ...assistantModelAccessUpdateActionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.updateAssistantModelAccess(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_SESSION,
      input: { ...sessionCreateInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.createSession),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.createSession(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_CURRENT_SESSION,
      input: { ...currentSessionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.updateCurrentSession(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_SESSION,
      input: { ...sessionInspectInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.inspectSession),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.inspectSession(input.sessionId)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_ASSISTANT_SELECTION,
      input: { ...assistantSelectionUpdateActionInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.updateAssistantSelection),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.updateAssistantSelection(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_SESSION_RENEWAL,
      input: { ...sessionRenewalInspectActionInputValidator, mode: "create" },
      extensions: {
        assistant: renewalInspectionTool(ASSISTANT_TOOL_DESCRIPTIONS.inspectSessionRenewal),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.inspectSessionRenewal(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
      input: { ...sessionRenewalDraftRequestActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: {
        assistant: renewalTool(ASSISTANT_TOOL_DESCRIPTIONS.requestSessionRenewalDraft),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.requestSessionRenewalDraft(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
      input: { ...sessionRenewalDraftUpdateActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: {
        assistant: renewalTool(ASSISTANT_TOOL_DESCRIPTIONS.updateSessionRenewalDraft),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.updateSessionRenewalDraft(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CANCEL_SESSION_RENEWAL,
      input: { ...sessionRenewalDraftGuardActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: {
        assistant: renewalTool(ASSISTANT_TOOL_DESCRIPTIONS.cancelSessionRenewal),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.cancelSessionRenewal(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CONFIRM_SESSION_RENEWAL,
      input: { ...sessionRenewalConfirmationActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: {
        assistant: renewalTool(ASSISTANT_TOOL_DESCRIPTIONS.confirmSessionRenewal),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.confirmSessionRenewal(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RETRY_SESSION_RENEWAL,
      input: { ...sessionRenewalRetryActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: {
        assistant: renewalTool(ASSISTANT_TOOL_DESCRIPTIONS.retrySessionRenewal),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.retrySessionRenewal(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_SESSION_CHANGES,
      input: { ...sessionChangesInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectSessionChanges(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_SESSION_CHANGE_DIFF,
      input: { ...sessionChangeDiffInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectSessionChangeDiff(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_SESSION_WORK,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: {
        assistant: sessionWorkTool(ASSISTANT_TOOL_DESCRIPTIONS.inspectSessionWork),
        vibe64: PROJECT_OPERATION
      },
      execute: (input, context) => sessions.inspectSessionWork(input.sessionId, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_PULL_REQUEST,
      input: { ...sessionPullRequestInputValidator, mode: "create" },
      extensions: { assistant: sessionPullRequestTool(), vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.createSessionPullRequest(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_SESSION_WORK,
      input: { ...sessionSaveInputValidator, mode: "create" },
      extensions: {
        assistant: sessionWorkTool(ASSISTANT_TOOL_DESCRIPTIONS.saveSessionWork),
        vibe64: PROJECT_OPERATION
      },
      execute: (input, context) => sessions.saveSessionWork(input.sessionId, input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_INCOMING,
      input: { ...incomingInspectionInputValidator, mode: "create" },
      extensions: {
        assistant: incomingContributionTool(ASSISTANT_TOOL_DESCRIPTIONS.inspectIncoming),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.inspectIncomingContributions(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_REVIEW_INCOMING,
      input: { ...incomingInspectionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.reviewIncomingContribution(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CHANGE_INCOMING,
      input: { ...incomingChangeInputValidator, mode: "create" },
      extensions: {
        assistant: incomingContributionTool(ASSISTANT_TOOL_DESCRIPTIONS.changeIncoming),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.changeIncomingContribution(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CHECK_SESSION_UPDATES,
      input: { ...sessionUpdateInputValidator, mode: "create" },
      extensions: {
        assistant: sessionWorkTool(ASSISTANT_TOOL_DESCRIPTIONS.checkSessionUpdates),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.checkSessionUpdates(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_SESSION_WORK,
      input: { ...sessionUpdateInputValidator, mode: "create" },
      extensions: {
        assistant: sessionWorkTool(ASSISTANT_TOOL_DESCRIPTIONS.updateSessionWork),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.updateSessionWork(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_SESSION_CONVERSATION_LOG,
      input: { ...sessionConversationLogInputValidator, mode: "create" },
      extensions: { assistant: conversationLogTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.readSessionConversationLog(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_RETRY_WORKSPACE_SETUP,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.retryWorkspaceSetup),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.retryWorkspaceSetup(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_ARCHIVE_SESSION,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: {
        assistant: sessionTool(ASSISTANT_TOOL_DESCRIPTIONS.archiveSession),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.archiveSession(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SEND_AGENT_MESSAGE,
      input: { ...agentMessageActionInputValidator, mode: "create" },
      extensions: {
        assistant: conversationOperationTool(ASSISTANT_TOOL_DESCRIPTIONS.sendAgentMessage),
        vibe64: PROJECT_OPERATION
      },
      execute: (input, context) => sessions.sendMainChatMessage(input, context)
    }),
    // Approvals are people's decisions: they have no assistant tool projection.
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_MAIN_CHAT_APPROVALS,
      input: { ...sessionIdInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.readMainChatApprovals(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_EDIT_MAIN_CHAT_APPROVAL,
      input: { ...mainChatApprovalActionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.editMainChatApproval(input.sessionId, input.approvalId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_WITHDRAW_MAIN_CHAT_APPROVAL,
      input: { ...mainChatApprovalActionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.withdrawMainChatApproval(input.sessionId, input.approvalId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_DECLINE_MAIN_CHAT_APPROVAL,
      input: { ...mainChatApprovalActionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.declineMainChatApproval(input.sessionId, input.approvalId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_APPROVE_MAIN_CHAT_APPROVAL,
      input: { ...mainChatApprovalActionInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => sessions.approveMainChatMessage(input, context)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_INSPECT_ASSISTANT_ACCESS,
      input: { ...assistantAccessActionInputValidator, mode: "create" },
      extensions: { assistant: assistantAccessTool(), vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.inspectAssistantAccess(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_INTERRUPT_AGENT_TURN,
      input: { ...agentTurnInterruptActionInputValidator, mode: "create" },
      extensions: {
        assistant: conversationOperationTool(ASSISTANT_TOOL_DESCRIPTIONS.interruptAgentTurn),
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => sessions.interruptAgentTurn(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_SESSION_PRESENCE,
      input: { ...sessionPresenceActionInputValidator, mode: "create" },
      idempotency: "domain_native",
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.updateSessionPresence(input.sessionId, input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_BROADCAST_SESSION_PREVIEW_STATE,
      input: { ...sessionPreviewStateInputValidator, mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => sessions.broadcastSessionPreviewState(input.sessionId, input)
    })
  ]);
}

/**
 * A browser page's watch of a project it has open, or of one session it shows.
 * Only its realtime connection (projectWatch.js) executes it, with the binding
 * in its context that releases what the watch holds when the page leaves or
 * disconnects.
 * @param {object} dependencies
 * @param {SessionRepositoryUpdates} dependencies.repositoryUpdates
 */
function createProjectWatchActions({ repositoryUpdates }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PROJECT_WATCH_ACTION,
      input: { ...projectWatchInputValidator, mode: "create" },
      // No HTTP route: a watch lives only as long as its connection.
      channels: ["api"],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => repositoryUpdates.watchProject(input, context)
    })
  ]);
}

export {
  ACTION_APPROVE_MAIN_CHAT_APPROVAL,
  ACTION_DECLINE_MAIN_CHAT_APPROVAL,
  ACTION_EDIT_MAIN_CHAT_APPROVAL,
  ACTION_READ_MAIN_CHAT_APPROVALS,
  ACTION_WITHDRAW_MAIN_CHAT_APPROVAL,
  ACTION_INSPECT_INCOMING,
  ACTION_REVIEW_INCOMING,
  ACTION_CHANGE_INCOMING,
  ACTION_RENAME_SESSION,
  ACTION_PIN_SESSION,
  ACTION_SKIP_INTEGRATION_SETUP,
  ACTION_RESUME_INTEGRATION_SETUP,
  ACTION_LIST_ASSISTANT_CAPABILITIES,
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ARCHIVE_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_CREATE_PULL_REQUEST,
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
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_READ_CONVERSATION_CONTEXT,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_ASSISTANT_MODEL_ACCESS,
  ACTION_UPDATE_ASSISTANT_SELECTION,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_PRESENCE,
  ACTION_UPDATE_SESSION_WORK,
  createProjectWatchActions,
  createSessionActions
};
