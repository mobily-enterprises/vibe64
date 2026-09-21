import {
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

function action({ execute, id, idempotency = "optional", input, kind = "command" }) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    input,
    output: null,
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
      input: temporaryConversationListInputValidator,
      execute: (input) => terminals.listTemporaryConversations(input.sessionId)
    }),
    action({
      id: ACTION_UPDATE_TEMPORARY_CONVERSATION,
      input: temporaryConversationUpdateInputValidator,
      execute: (input) => terminals.updateTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_CREATE_TEMPORARY_CONVERSATION,
      input: temporaryConversationCreateActionInputValidator,
      execute: (input) => terminals.createTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_READ_TEMPORARY_CONVERSATION,
      input: temporaryConversationInputValidator,
      idempotency: "none", kind: "query",
      execute: (input) => terminals.readTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_START_TEMPORARY_CONVERSATION_TURN,
      input: temporaryConversationTurnActionInputValidator,
      execute: (input) => terminals.startTemporaryConversationTurn(input.sessionId, input)
    }),
    action({
      id: ACTION_STOP_TEMPORARY_CONVERSATION,
      input: temporaryConversationStopActionInputValidator,
      execute: (input) => terminals.stopTemporaryConversation(input.sessionId, input)
    }),
    action({
      id: ACTION_DELETE_TEMPORARY_CONVERSATION,
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
