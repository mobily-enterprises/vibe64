import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

import {
  SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS
} from "./sessionRenewalState.js";

const optionalUser = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const optionalOrigin = {
  originId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const renewalOperationFields = {
  ...optionalOrigin,
  operationKey: {
    type: "string",
    noTrim: false,
    minLength: 1,
    maxLength: 128,
    pattern: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u,
    required: true
  }
};

const renewalDraftGuardFields = {
  ...renewalOperationFields,
  expectedHash: {
    type: "string",
    noTrim: false,
    minLength: 64,
    maxLength: 64,
    pattern: /^[a-f0-9]{64}$/u,
    required: true
  },
  expectedRevision: {
    type: "integer",
    min: 1,
    required: true
  }
};

const renewalDraftFields = {
  ...renewalDraftGuardFields,
  draft: {
    // json-rest-schema counts UTF-16 code units while the domain contract
    // counts Unicode code points. Two code units per allowed code point keeps
    // transport input bounded without rejecting 20,000 astral characters;
    // sessionRenewalState performs the exact domain check.
    maxLength: SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS * 2,
    type: "string",
    noTrim: true,
    required: true
  }
};

const renewalConfirmationFields = {
  ...renewalDraftGuardFields,
  assistantSelection: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

function patchSchema(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "patch"
  });
}

function requiredInputSchema(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "create"
  });
}

const agentMessageFields = {
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  attachmentIds: {
    type: "array",
    items: {
      type: "string",
      noTrim: false
    },
    required: false
  },
  displayMessage: {
    type: "string",
    noTrim: false,
    required: false
  },
  displayAttachments: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: true
    },
    required: false
  },
  genesisTask: {
    type: "string",
    enum: ["deslop"],
    noTrim: false,
    required: false
  },
  message: {
    type: "string",
    noTrim: false,
    required: true
  },
  ...optionalOrigin,
  messageId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const agentMessageInputValidator = patchSchema(agentMessageFields);
const agentMessageActionInputValidator = patchSchema({
  ...agentMessageFields,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const assistantAccessActionInputValidator = patchSchema({
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const messageSuggestionActionInputValidator = patchSchema({
  ...agentMessageFields,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const messageSuggestionDecisionFields = {
  ...optionalOrigin
};

const messageSuggestionIdField = {
  suggestionId: {
    type: "string",
    noTrim: false,
    minLength: 36,
    maxLength: 36,
    pattern: /^[0-9a-f-]{36}$/iu,
    required: true
  }
};

const messageSuggestionDecisionInputValidator = patchSchema(
  messageSuggestionDecisionFields
);
const messageSuggestionDecisionActionInputValidator = patchSchema({
  ...messageSuggestionDecisionFields,
  ...messageSuggestionIdField,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const agentTurnInterruptFields = {
  ...optionalOrigin,
  reason: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const conversationRewindFields = {
  ...optionalOrigin,
  turnId: { type: "string", pattern: /^\d{6}$/u, required: true }
};
const conversationRewindInputValidator = requiredInputSchema(conversationRewindFields);
const conversationRewindActionInputValidator = requiredInputSchema({
  ...conversationRewindFields, ...optionalUser,
  sessionId: { type: "string", noTrim: false, required: true }
});

const agentTurnInterruptInputValidator = patchSchema(agentTurnInterruptFields);
const agentTurnInterruptActionInputValidator = patchSchema({
  ...agentTurnInterruptFields,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionPreviewStateInputValidator = patchSchema({
  ...optionalOrigin,
  projectSlug: {
    type: "string",
    noTrim: false,
    required: true
  },
  route: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  },
  title: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const sessionPresenceFields = {
  conversationId: {
    type: "string",
    noTrim: false,
    minLength: 1,
    maxLength: 128,
    pattern: /^[A-Za-z0-9_-]{1,128}$/u,
    required: false
  },
  originId: {
    type: "string",
    noTrim: false,
    minLength: 1,
    maxLength: 128,
    pattern: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u,
    required: true
  },
  sequence: {
    type: "integer",
    min: 1,
    required: true
  },
  typing: {
    type: "boolean",
    required: true
  }
};

const sessionPresenceInputValidator = requiredInputSchema(sessionPresenceFields);
const sessionPresenceActionInputValidator = requiredInputSchema({
  ...sessionPresenceFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionListInputValidator = patchSchema({
  ...optionalUser
});

const sessionPullRequestInputValidator = patchSchema({
  sessionId: { type: "string", required: true },
  title: { type: "string", required: true, maxLength: 256 },
  body: { type: "string", required: false, maxLength: 65536, noTrim: true },
  draft: { type: "boolean", required: false },
  ...optionalOrigin,
  ...optionalUser
});

const sessionCreateInputValidator = patchSchema({
  pullRequestNumber: { type: "integer", min: 1, required: false },
  assistantSelection: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  ...optionalOrigin,
  ...optionalUser
});

const assistantCapabilitiesInputValidator = patchSchema({
  ...optionalUser,
  configuredOnly: {
    type: "string",
    noTrim: false,
    required: false
  },
  connectedOnly: {
    type: "string",
    noTrim: false,
    required: false
  },
  cursor: {
    type: "string",
    noTrim: false,
    required: false
  },
  engineId: {
    type: "string",
    noTrim: false,
    required: false
  },
  limit: {
    type: "string",
    noTrim: false,
    required: false
  },
  modelProviderId: {
    type: "string",
    noTrim: false,
    required: false
  },
  search: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const assistantModelAccessFields = {
  engineId: {
    type: "string",
    enum: ["opencode"],
    noTrim: false,
    required: true
  },
  modelProviderId: {
    type: "string",
    noTrim: false,
    required: true
  },
  unlocked: {
    type: "boolean",
    required: true
  }
};

const assistantModelAccessUpdateInputValidator = patchSchema(assistantModelAccessFields);
const assistantModelAccessUpdateActionInputValidator = patchSchema({
  ...assistantModelAccessFields,
  ...optionalUser
});

const assistantSelectionUpdateInputValidator = patchSchema({
  assistantSelection: {
    type: "object",
    additionalProperties: true,
    required: true
  },
  ...optionalOrigin
});

const assistantSelectionUpdateActionInputValidator = patchSchema({
  assistantSelection: {
    type: "object",
    additionalProperties: true,
    required: true
  },
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const currentSessionInputValidator = patchSchema({
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const sessionIdInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionSaveInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionUpdateInputValidator = patchSchema({
  historyReview: { type: "object", additionalProperties: true },
  ...optionalOrigin,
  ...optionalUser,
  reviewedConflictId: {
    type: "string",
    required: false
  },
  force: {
    type: "boolean",
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionInspectInputValidator = patchSchema({
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalInspectActionInputValidator = requiredInputSchema({
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalDraftRequestInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalDraftRequestActionInputValidator = requiredInputSchema({
  ...renewalOperationFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalDraftUpdateInputValidator = requiredInputSchema(renewalDraftFields);
const sessionRenewalDraftUpdateActionInputValidator = requiredInputSchema({
  ...renewalDraftFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalDraftGuardInputValidator = requiredInputSchema(renewalDraftGuardFields);
const sessionRenewalDraftGuardActionInputValidator = requiredInputSchema({
  ...renewalDraftGuardFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalConfirmationInputValidator = requiredInputSchema(
  renewalConfirmationFields
);
const sessionRenewalConfirmationActionInputValidator = requiredInputSchema({
  ...renewalConfirmationFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionRenewalRetryInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalRetryActionInputValidator = requiredInputSchema({
  ...renewalOperationFields,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionChangesInputValidator = patchSchema({
  ...optionalUser,
  limit: {
    type: "string",
    noTrim: false,
    required: false
  },
  offset: {
    type: "string",
    noTrim: false,
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionChangeDiffInputValidator = patchSchema({
  ...optionalUser,
  lineLimit: {
    type: "string",
    noTrim: false,
    required: false
  },
  path: {
    type: "string",
    noTrim: true,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionConversationLogInputValidator = patchSchema({
  ...optionalUser,
  beforeTurnId: {
    type: "string",
    noTrim: false,
    required: false
  },
  limit: {
    type: "string",
    noTrim: false,
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const repositoryHistoryInputValidator = patchSchema({
  ...optionalUser,
  cursor: { type: "string", noTrim: false, required: false },
  limit: { type: "string", noTrim: false, required: false },
  sessionId: { type: "string", noTrim: false, required: true }
});

const repositoryVersionFilesInputValidator = patchSchema({
  ...optionalUser,
  commit: { type: "string", noTrim: false, required: true },
  historySnapshotCommit: { type: "string", noTrim: false, required: true },
  limit: { type: "string", noTrim: false, required: false },
  offset: { type: "string", noTrim: false, required: false },
  sessionId: { type: "string", noTrim: false, required: true }
});

const repositoryVersionFileDiffInputValidator = patchSchema({
  ...optionalUser,
  commit: { type: "string", noTrim: false, required: true },
  historySnapshotCommit: { type: "string", noTrim: false, required: true },
  lineLimit: { type: "string", noTrim: false, required: false },
  path: { type: "string", noTrim: true, required: true },
  sessionId: { type: "string", noTrim: false, required: true }
});

const integrationSetupRequestFields = {
  turnId: { type: "string", required: true, maxLength: 32, pattern: /^\d{6,}$/u },
  requestId: { type: "string", required: true, minLength: 64, maxLength: 64, pattern: /^[a-f0-9]{64}$/u }
};
const integrationSetupRequestInputValidator = requiredInputSchema(integrationSetupRequestFields);
const integrationSetupRequestActionInputValidator = requiredInputSchema({
  ...integrationSetupRequestFields,
  sessionId: { type: "string", required: true, maxLength: 200 }
});

export {
  conversationRewindInputValidator,
  conversationRewindActionInputValidator,
  integrationSetupRequestInputValidator,
  integrationSetupRequestActionInputValidator,
  assistantAccessActionInputValidator,
  SESSION_RENEWAL_HANDOVER_MAX_CHARACTERS,
  agentMessageActionInputValidator,
  agentMessageInputValidator,
  assistantCapabilitiesInputValidator,
  assistantModelAccessUpdateActionInputValidator,
  assistantModelAccessUpdateInputValidator,
  assistantSelectionUpdateActionInputValidator,
  assistantSelectionUpdateInputValidator,
  agentTurnInterruptActionInputValidator,
  agentTurnInterruptInputValidator,
  currentSessionInputValidator,
  messageSuggestionActionInputValidator,
  messageSuggestionDecisionActionInputValidator,
  messageSuggestionDecisionInputValidator,
  repositoryHistoryInputValidator,
  repositoryVersionFileDiffInputValidator,
  repositoryVersionFilesInputValidator,
  sessionConversationLogInputValidator,
  sessionChangeDiffInputValidator,
  sessionChangesInputValidator,
  sessionCreateInputValidator,
  sessionPullRequestInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionRenewalConfirmationActionInputValidator,
  sessionRenewalConfirmationInputValidator,
  sessionRenewalDraftGuardActionInputValidator,
  sessionRenewalDraftGuardInputValidator,
  sessionRenewalDraftRequestActionInputValidator,
  sessionRenewalDraftRequestInputValidator,
  sessionRenewalDraftUpdateActionInputValidator,
  sessionRenewalDraftUpdateInputValidator,
  sessionRenewalInspectActionInputValidator,
  sessionRenewalRetryActionInputValidator,
  sessionRenewalRetryInputValidator,
  sessionListInputValidator,
  sessionPresenceActionInputValidator,
  sessionPresenceInputValidator,
  sessionPreviewStateInputValidator,
  sessionSaveInputValidator,
  sessionUpdateInputValidator
};
