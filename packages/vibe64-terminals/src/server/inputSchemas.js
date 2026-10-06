import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { assistantConversationGoalBodyValidator } from "@jskit-ai/assistant-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS, VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS } from "@local/vibe64-runtime/shared";
import { ASSISTANT_MODES } from "@local/vibe64-runtime/shared/assistantRouting";

const optionalText = {
  type: "string",
  noTrim: false,
  required: false
};

const requiredText = {
  ...optionalText,
  minLength: 1,
  required: true
};

const attachmentIdsField = {
  type: "array",
  items: {
    type: "string",
    noTrim: false
  },
  required: false
};

const sessionIdField = requiredText;
const vibe64UserField = {
  type: "object",
  additionalProperties: true,
  required: false
};

const agentAttachmentFields = {
  contentType: optionalText,
  fileName: requiredText,
  stream: {
    type: "none",
    required: true
  }
};

const outputTargetFields = {
  outputParameters: { type: "object", additionalProperties: true, required: false },
  forceRestart: {
    type: "boolean",
    required: false
  },
  outputTargetId: requiredText,
  originId: optionalText,
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

function validator(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "create"
  });
}

const agentAttachmentActionInputValidator = validator({
  ...agentAttachmentFields,
  sessionId: sessionIdField
});
const agentAttachmentDeleteActionInputValidator = validator({
  attachmentId: requiredText,
  sessionId: sessionIdField
});
const temporaryConversationListInputValidator = validator({ sessionId: sessionIdField });
const temporaryConversationPresentationField = { type: "object", additionalProperties: true, required: false };
const temporaryConversationRoutingField = { type: "object", required: false, schema: createSchema({
  mode: { type: "string", enum: ASSISTANT_MODES.filter(({ id }) => id !== "auto").map(({ id }) => id), required: true },
  review: { type: "boolean", required: false },
  workflowEngineId: { type: "string", enum: Object.values(VIBE64_ASSISTANT_ENGINE_IDS), required: false },
  override: { type: "object", required: false, schema: createSchema({
    engineId: { type: "string", enum: Object.values(VIBE64_ASSISTANT_ENGINE_IDS), required: false },
    ...Object.fromEntries(["schema", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision"]
      .map((key) => [key, optionalText]))
  }) }
}) };
const temporaryConversationUpdateInputValidator = validator({
  conversationId: requiredText, sessionId: sessionIdField,
  assistantRouting: temporaryConversationRoutingField,
  agentSettings: { type: "object", additionalProperties: true, required: false },
  presentation: temporaryConversationPresentationField,
  attachmentIds: attachmentIdsField
});
const temporaryConversationCreateActionInputValidator = validator({
  assistantRouting: temporaryConversationRoutingField,
  conversationId: optionalText,
  presentation: temporaryConversationPresentationField,
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  sessionId: sessionIdField,
  vibe64User: vibe64UserField
});
const temporaryConversationInputValidator = validator({
  conversationId: requiredText,
  sessionId: sessionIdField
});
const temporaryConversationReadInputValidator = validator({
  ...temporaryConversationInputValidator.schema.getFieldDefinitions(),
  beforeMessageId: optionalText,
  messageLimit: { type: "integer", min: 1, max: 12, required: false }
});
const temporaryConversationTurnActionInputValidator = validator({
  planRevision: optionalText,
  reviewAction: { type: "string", enum: ["retry"], required: false },
  submissionKind: { type: "string", enum: ["send", "steer"], required: false },
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  attachmentIds: attachmentIdsField,
  conversationId: requiredText,
  messageId: requiredText,
  displayMessage: optionalText,
  presentation: temporaryConversationPresentationField,
  message: requiredText,
  outputSchema: { type: "object", additionalProperties: true, required: false },
  promptLabel: optionalText,
  sessionId: sessionIdField,
  vibe64User: vibe64UserField
});
const temporaryConversationStopActionInputValidator = validator({
  conversationId: requiredText,
  runId: optionalText,
  sessionId: sessionIdField
});
const sessionPromptHintsActionInputValidator = validator({
  draft: {
    ...optionalText,
    // Schema lengths use UTF-16 units; normalization bounds Unicode characters.
    maxLength: VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS * 2
  },
  operationId: {
    type: "string",
    maxLength: 128,
    noTrim: false,
    pattern: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u,
    required: true
  },
  originId: {
    type: "string",
    maxLength: 128,
    noTrim: false,
    required: false
  },
  sessionId: sessionIdField,
  vibe64User: vibe64UserField
});
const outputTargetInputValidator = validator(outputTargetFields);
const outputTargetActionInputValidator = validator({
  ...outputTargetFields,
  sessionId: sessionIdField
});
const openOutputTargetActionInputValidator = validator({
  sessionId: sessionIdField
});
const previewIdentityInputValidator = validator({
  identityName: optionalText,
  mode: {
    type: "string",
    enum: ["identity", "guest"],
    noTrim: false,
    required: true
  }
});
const previewIdentityActionInputValidator = validator({
  identityName: optionalText,
  mode: {
    type: "string",
    enum: ["identity", "guest"],
    noTrim: false,
    required: true
  },
  publicHost: optionalText,
  publicProtocol: optionalText,
  sessionId: sessionIdField
});
const terminalControlTextInputValidator = validator({
  attachmentIds: attachmentIdsField,
  originId: optionalText,
  text: {
    type: "string",
    noTrim: true,
    required: true
  }
});
const terminalControlKeyInputValidator = validator({
  attachmentIds: attachmentIdsField,
  key: {
    type: "string",
    enum: ["ctrl-c", "enter", "escape", "tab"],
    noTrim: false,
    required: true
  },
  originId: optionalText
});

const emptyInputValidator = validator({});
const projectRuntimeInputValidator = validator({ reason: optionalText });
const sessionInputValidator = validator({ sessionId: sessionIdField });
const workPlanReadInputValidator = validator({
  sessionId: sessionIdField,
  archiveId: { ...optionalText, minLength: 64, maxLength: 64 },
  offset: { type: "integer", min: 0, required: false },
  limit: { type: "integer", min: 1, max: 16000, required: false },
  expectedRevision: { ...optionalText, minLength: 64, maxLength: 64 }
});
const workPlanArchiveInputValidator = validator({
  sessionId: sessionIdField,
  expectedRevision: { ...requiredText, minLength: 64, maxLength: 64 }
});
const workPlanRestoreInputValidator = validator({
  sessionId: sessionIdField,
  archiveId: { ...requiredText, minLength: 64, maxLength: 64 }
});
const outputStatusInputValidator = validator({
  sessionId: sessionIdField, publicHost: optionalText, publicProtocol: optionalText,
  outputTargetId: { ...optionalText, minLength: 1 },
  targetOffset: { type: "integer", min: 0, required: false },
  runOffset: { type: "integer", min: 0, required: false }
});
const outputResultInputValidator = validator({ sessionId: sessionIdField, resultId: requiredText });
const agentGoalInputValidator = validator({
  sessionId: sessionIdField,
  action: { type: "string", enum: ["set", "pause", "resume", "cancel"], required: true },
  threadId: optionalText,
  // Claude preserves fractional epoch seconds; the provider compares this
  // revision exactly when pausing, resuming or cancelling a goal.
  createdAt: { type: "number", min: 0, required: false },
  objective: { ...optionalText, noTrim: true },
  tokenBudget: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER, required: false }
});
const canonicalAgentGoalInputValidator = validator({
  ...assistantConversationGoalBodyValidator.schema.getFieldDefinitions(),
  sessionId: sessionIdField
});
const agentTerminalStartInputValidator = validator({
  sessionId: sessionIdField,
  originId: optionalText,
  size: { type: "object", required: false, schema: createSchema({
    cols: { type: "integer", min: 1, required: false },
    rows: { type: "integer", min: 1, required: false }
  }) }
});
const terminalInputValidator = validator({ sessionId: sessionIdField, terminalSessionId: requiredText });
const globalTerminalInputValidator = validator({ terminalSessionId: requiredText });
function terminalControlActionInputValidator(global, control) {
  return validator({
    ...(global ? globalTerminalInputValidator : terminalInputValidator).schema.getFieldDefinitions(),
    ...(control === "key" ? terminalControlKeyInputValidator : terminalControlTextInputValidator).schema.getFieldDefinitions()
  });
}

export {
  workPlanReadInputValidator,
  workPlanArchiveInputValidator,
  workPlanRestoreInputValidator,
  emptyInputValidator,
  projectRuntimeInputValidator,
  sessionInputValidator,
  outputStatusInputValidator,
  outputResultInputValidator,
  agentGoalInputValidator,
  canonicalAgentGoalInputValidator,
  agentTerminalStartInputValidator,
  terminalInputValidator,
  globalTerminalInputValidator,
  terminalControlActionInputValidator,
  agentAttachmentActionInputValidator,
  agentAttachmentDeleteActionInputValidator,
  openOutputTargetActionInputValidator,
  outputTargetActionInputValidator,
  outputTargetInputValidator,
  previewIdentityActionInputValidator,
  previewIdentityInputValidator,
  sessionPromptHintsActionInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator,
  temporaryConversationListInputValidator,
  temporaryConversationUpdateInputValidator,
  temporaryConversationCreateActionInputValidator,
  temporaryConversationInputValidator,
  temporaryConversationReadInputValidator,
  temporaryConversationStopActionInputValidator,
  temporaryConversationTurnActionInputValidator
};
