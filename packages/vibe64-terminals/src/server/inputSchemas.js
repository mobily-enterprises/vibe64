import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS } from "@local/vibe64-runtime/shared";

const optionalText = {
  type: "string",
  noTrim: false,
  required: false
};

const requiredText = {
  ...optionalText,
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
    mode: "patch"
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
const temporaryConversationCreateActionInputValidator = validator({
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  policy: optionalText,
  sessionId: sessionIdField,
  vibe64User: vibe64UserField
});
const temporaryConversationInputValidator = validator({
  conversationId: requiredText,
  sessionId: sessionIdField
});
const temporaryConversationTurnActionInputValidator = validator({
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  attachmentIds: attachmentIdsField,
  conversationId: requiredText,
  messageId: optionalText,
  message: requiredText,
  policy: optionalText,
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

export {
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
  temporaryConversationCreateActionInputValidator,
  temporaryConversationInputValidator,
  temporaryConversationStopActionInputValidator,
  temporaryConversationTurnActionInputValidator
};
