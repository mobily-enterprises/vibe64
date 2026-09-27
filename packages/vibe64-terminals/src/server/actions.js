import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { temporaryConversationTool, workPlanTool } from "./assistantContracts.js";
import { terminalKeyInput, terminalSessionContainsText, terminalSessionControlSnapshot } from "@local/vibe64-execution/server/terminalSessions";
import {
  emptyInputValidator,
  projectRuntimeInputValidator,
  sessionInputValidator,
  workPlanReadInputValidator,
  outputStatusInputValidator,
  outputResultInputValidator,
  agentGoalInputValidator,
  agentTerminalStartInputValidator,
  terminalInputValidator,
  globalTerminalInputValidator,
  terminalControlActionInputValidator,
  agentAttachmentActionInputValidator,
  agentAttachmentDeleteActionInputValidator,
  openOutputTargetActionInputValidator,
  outputTargetActionInputValidator,
  previewIdentityActionInputValidator,
  sessionPromptHintsActionInputValidator,
  temporaryConversationListInputValidator,
  temporaryConversationUpdateInputValidator,
  temporaryConversationCreateActionInputValidator,
  temporaryConversationInputValidator,
  temporaryConversationReadInputValidator,
  temporaryConversationStopActionInputValidator,
  temporaryConversationTurnActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_OUTPUT_TARGET = "vibe64.terminals.output-target.start";
const ACTION_OPEN_OUTPUT_TARGET = "vibe64.terminals.output-target.open";
const ACTION_SELECT_PREVIEW_IDENTITY = "vibe64.terminals.preview-identity.select";
const ACTION_UPLOAD_AGENT_ATTACHMENT = "vibe64.terminals.agent-attachment.upload";
const ACTION_DELETE_AGENT_ATTACHMENT = "vibe64.terminals.agent-attachment.delete";
const ACTION_LIST_TEMPORARY_CONVERSATIONS = "vibe64.terminals.temporary-conversation.list";
const ACTION_UPDATE_TEMPORARY_CONVERSATION = "vibe64.terminals.temporary-conversation.update";
const ACTION_CREATE_TEMPORARY_CONVERSATION = "vibe64.terminals.temporary-conversation.create";
const ACTION_READ_TEMPORARY_CONVERSATION = "vibe64.terminals.temporary-conversation.read";
const ACTION_START_TEMPORARY_CONVERSATION_TURN = "vibe64.terminals.temporary-conversation.turn.start";
const ACTION_STOP_TEMPORARY_CONVERSATION = "vibe64.terminals.temporary-conversation.stop";
const ACTION_DELETE_TEMPORARY_CONVERSATION = "vibe64.terminals.temporary-conversation.delete";
const ACTION_GENERATE_SESSION_PROMPT_HINTS = "vibe64.terminals.prompt-hints.generate";
const ACTION_CANCEL_SESSION_PROMPT_HINTS = "vibe64.terminals.prompt-hints.cancel";

function action({ assistant, execute, id, idempotency = "optional", input, kind = "command" }) {
  return withVibe64ActionContext({
    id,
    version: 1,
    kind,
    input,
    output: null,
    extensions: { assistant: assistant || { exclude: true } },
    idempotency,
    audit: { actionName: id },
    observability: {},
    execute
  });
}

function createTerminalActions({ terminals } = {}) {
  if (!terminals) {
    throw new TypeError("createTerminalActions requires terminals.");
  }
  return Object.freeze([
    action({ id: "vibe64.terminals.global-terminal.status", input: emptyInputValidator, kind: "query", idempotency: "none",
      execute: () => terminals.globalCodexTerminalState() }),
    action({ id: "vibe64.terminals.global-terminal.start", input: emptyInputValidator,
      execute: (input) => terminals.startGlobalCodexTerminal(input) }),
    action({ id: "vibe64.terminals.agent-sessions.reconcile", input: emptyInputValidator,
      execute: (input) => terminals.reconcileOpenAgentSessions(input) }),
    action({ id: "vibe64.terminals.project-runtime.open", input: projectRuntimeInputValidator,
      execute: (input) => terminals.openProjectRuntime(input) }),
    action({ id: "vibe64.terminals.project-runtime.close", input: projectRuntimeInputValidator,
      execute: (input) => terminals.closeProjectRuntime(input) }),
    action({ id: "vibe64.terminals.outputs.read", input: outputStatusInputValidator, kind: "query", idempotency: "none",
      execute: (input) => terminals.outputTargetStatus(input.sessionId, { publicHost: input.publicHost || "", publicProtocol: input.publicProtocol || "" }) }),
    action({ id: "vibe64.terminals.output-result.read", input: outputResultInputValidator, kind: "query", idempotency: "none",
      execute: (input) => terminals.readOutputResult(input.sessionId, input.resultId) }),
    action({ id: "vibe64.terminals.output-target.stop", input: terminalInputValidator,
      execute: (input) => terminals.stopOutputTargetTerminal(input.sessionId, input.terminalSessionId) }),
    action({ id: "vibe64.terminals.agent-terminal.start", input: agentTerminalStartInputValidator,
      execute: (input) => terminals.startAgentTerminal(input.sessionId, input, { vibe64User: input.vibe64User || null }) }),
    action({ id: "vibe64.terminals.agent-goal.read", input: sessionInputValidator, kind: "query", idempotency: "none",
      execute: (input) => terminals.readAgentGoal(input.sessionId, { vibe64User: input.vibe64User || null }) }),
    action({ id: "vibe64.terminals.agent-goal.update", input: agentGoalInputValidator, idempotency: "none",
      execute: (input) => terminals.updateAgentGoal(input.sessionId, input) }),
    action({ id: "vibe64.terminals.agent-plan-usage.read", input: sessionInputValidator, kind: "query", idempotency: "none",
      execute: (input) => terminals.readAgentPlanUsage(input.sessionId, { vibe64User: input.vibe64User || null }) }),
    action({ id: "vibe64.terminals.work-plan.read", input: workPlanReadInputValidator, kind: "query", idempotency: "none",
      assistant: workPlanTool(), execute: (input) => terminals.readSessionWorkPlan(input.sessionId, input) }),
    action({ id: "vibe64.terminals.agent-session.prepare", input: sessionInputValidator,
      execute: (input) => terminals.ensureAgentSession(input.sessionId, { vibe64User: input.vibe64User || null }) }),
    action({ id: "vibe64.terminals.agent-attachment.read", input: agentAttachmentDeleteActionInputValidator, kind: "query", idempotency: "none",
      execute: (input) => terminals.readAgentAttachment(input.sessionId, input.attachmentId) }),
    ...terminalSnapshotActions({
      prefix: "output-terminal",
      read: (input) => terminals.readOutputTargetTerminal(input.sessionId, input.terminalSessionId),
      close: (input) => terminals.closeOutputTargetTerminal(input.sessionId, input.terminalSessionId)
    }),
    ...terminalSnapshotActions({
      prefix: "agent-terminal",
      read: (input) => terminals.readAgentTerminal(input.sessionId, input.terminalSessionId, { vibe64User: input.vibe64User || null }),
      close: (input) => terminals.closeAgentTerminal(input.sessionId, input.terminalSessionId),
      write: (input, data) => terminals.writeAgentTerminal(input.sessionId, input.terminalSessionId, data, input)
    }),
    ...terminalSnapshotActions({
      prefix: "global-terminal", global: true,
      read: (input) => terminals.readGlobalCodexTerminal(input.terminalSessionId),
      close: (input) => terminals.closeGlobalCodexTerminal(input.terminalSessionId),
      write: (input, data) => terminals.writeGlobalCodexTerminal(input.terminalSessionId, data, input)
    }),
    action({
      id: ACTION_START_OUTPUT_TARGET,
      input: outputTargetActionInputValidator,
      execute: (input) => terminals.startOutputTargetTerminal(input.sessionId, {
        forceRestart: input.forceRestart === true,
        outputTargetId: input.outputTargetId,
        ...(input.outputParameters === undefined ? {} : { outputParameters: input.outputParameters }),
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_OPEN_OUTPUT_TARGET,
      input: openOutputTargetActionInputValidator,
      execute: (input) => terminals.openOutputTarget(input.sessionId)
    }),
    action({
      id: ACTION_SELECT_PREVIEW_IDENTITY,
      input: previewIdentityActionInputValidator,
      idempotency: "none",
      execute: (input) => terminals.selectPreviewIdentity(input.sessionId, {
        identityName: input.identityName || "",
        mode: input.mode
      }, {
        publicHost: input.publicHost || "",
        publicProtocol: input.publicProtocol || ""
      })
    }),
    action({
      id: ACTION_UPLOAD_AGENT_ATTACHMENT,
      idempotency: "none",
      input: agentAttachmentActionInputValidator,
      execute: (input) => terminals.uploadAgentAttachment(input.sessionId, input)
    }),
    action({
      id: ACTION_DELETE_AGENT_ATTACHMENT,
      input: agentAttachmentDeleteActionInputValidator,
      execute: (input) => terminals.deleteAgentAttachment(input.sessionId, input)
    }),
    action({
      id: ACTION_LIST_TEMPORARY_CONVERSATIONS, idempotency: "none", kind: "query",
      assistant: temporaryConversationTool("List saved temporary conversations in the specified project and session. These are separate from Main chat."),
      input: temporaryConversationListInputValidator,
      execute: (input) => terminals.listTemporaryConversations(input.sessionId)
    }),
    action({
      id: ACTION_UPDATE_TEMPORARY_CONVERSATION,
      assistant: temporaryConversationTool("Update an existing temporary conversation's title/draft presentation or its Senior/Junior assistantRouting. This does not send a message."),
      input: temporaryConversationUpdateInputValidator,
      execute: (input) => terminals.updateTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_CREATE_TEMPORARY_CONVERSATION,
      assistant: temporaryConversationTool("Create a separate temporary conversation in a session. Use assistantRouting.mode senior or junior when requested. Provide a stable conversationId for retry; creating a chat does not send a prompt or open it in the browser."),
      input: temporaryConversationCreateActionInputValidator,
      execute: (input) => terminals.createTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_READ_TEMPORARY_CONVERSATION,
      assistant: temporaryConversationTool("Read a temporary conversation's actual current status and up to twelve recent messages. Use beforeMessageId to read earlier messages. Text may be truncated; never invent the omitted text or assume a failed read means work stopped."),
      input: temporaryConversationReadInputValidator,
      idempotency: "none", kind: "query",
      execute: (input) => terminals.readTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_START_TEMPORARY_CONVERSATION_TURN,
      assistant: temporaryConversationTool("Send a prompt to the selected temporary conversation. Supply a unique messageId and reuse it on retry. Use submissionKind steer for guidance during an active turn. This requests coding-agent work; the returned state does not mean the work is complete."),
      input: temporaryConversationTurnActionInputValidator,
      execute: (input) => terminals.startTemporaryConversationTurn(input.sessionId, input)
    }),
    action({
      id: ACTION_STOP_TEMPORARY_CONVERSATION,
      assistant: temporaryConversationTool("Stop the coding agent in this temporary conversation. This preserves its transcript and does not stop Colleague or speech."),
      input: temporaryConversationStopActionInputValidator,
      execute: (input) => terminals.stopTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_DELETE_TEMPORARY_CONVERSATION,
      assistant: temporaryConversationTool("Explicitly close this temporary conversation and remove its saved chat and native provider histories. Use only when the user requests closing or removing it."),
      input: temporaryConversationInputValidator,
      execute: (input) => terminals.deleteTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_GENERATE_SESSION_PROMPT_HINTS,
      idempotency: "none",
      input: sessionPromptHintsActionInputValidator,
      execute: (input) => terminals.generateSessionPromptHints(input.sessionId, {
        draft: input.draft || "",
        operationId: input.operationId,
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_CANCEL_SESSION_PROMPT_HINTS,
      idempotency: "none",
      input: sessionPromptHintsActionInputValidator,
      execute: (input) => terminals.cancelSessionPromptHints(input.sessionId, {
        operationId: input.operationId,
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    })
  ]);
}

// The control projection and exact-byte writes are shared by HTTP and direct
// callers. Shell content is deliberately excluded from Colleague discovery.
function terminalSnapshotActions({ prefix, global = false, read, close, write }) {
  const input = global ? globalTerminalInputValidator : terminalInputValidator;
  const id = (operation) => `vibe64.terminals.${prefix}.${operation}`;
  const query = { kind: "query", idempotency: "none" };
  return [
    action({ id: id("read"), input, execute: read, ...query }),
    action({ id: id("close"), input, execute: close }),
    ...(write ? [
      action({ id: id("control.snapshot"), input, ...query,
        execute: async (input) => terminalSessionControlSnapshot(await read(input)) }),
      action({ id: id("control.check-text"), input: terminalControlActionInputValidator(global, "text"), ...query,
        execute: async (input) => terminalSessionContainsText(await read(input), input.text) }),
      ...["text", "key"].map((control) => action({
        id: id(`control.${control}`), input: terminalControlActionInputValidator(global, control), idempotency: "none",
        execute: async ({ text, key, ...input }) => terminalSessionControlSnapshot(await write({ ...input, trackGitActor: true },
          control === "text" ? text : terminalKeyInput(key)))
      }))
    ] : [])
  ];
}

export {
  ACTION_LIST_TEMPORARY_CONVERSATIONS,
  ACTION_UPDATE_TEMPORARY_CONVERSATION,
  ACTION_CANCEL_SESSION_PROMPT_HINTS,
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_DELETE_TEMPORARY_CONVERSATION,
  ACTION_GENERATE_SESSION_PROMPT_HINTS,
  ACTION_OPEN_OUTPUT_TARGET,
  ACTION_READ_TEMPORARY_CONVERSATION,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_OUTPUT_TARGET,
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPLOAD_AGENT_ATTACHMENT,
  createTerminalActions
};
