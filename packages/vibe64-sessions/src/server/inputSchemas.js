import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { ASSISTANT_MODES } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";

import { SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS } from "@local/vibe64-terminals/server/sessionRenewalHandover";
import { BROWSER_KEY_PATTERN, UUID_V4_PATTERN } from "./inputPatterns.js";

// Every action names its session the same way; an optional one may be empty.
const sessionIdField = { type: "string", noTrim: false, minLength: 1, maxLength: 256, required: true };
const optionalSessionIdField = { type: "string", noTrim: false, maxLength: 256, required: false };
const withSessionId = (fields) => ({ ...fields, sessionId: sessionIdField });

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
    pattern: BROWSER_KEY_PATTERN,
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
    maxLength: SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS * 2,
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

// Route bodies choose their mode: a patch accepts any subset of its fields.
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

// An action always validates its complete input; action() supplies the mode.
function actionInput(fields) {
  return deepFreeze({ schema: createSchema(fields) });
}

const sessionRenameFields = {
  name: { type: "string", noTrim: false, minLength: 1, maxLength: 120, required: true },
  ...optionalOrigin
};
const sessionRenameInputValidator = requiredInputSchema(sessionRenameFields);
const sessionRenameActionInputValidator = actionInput(withSessionId(sessionRenameFields));

const agentMessageFields = {
  clientId: { type: "string", noTrim: false, minLength: 1, maxLength: 128, required: false },
  planRevision: { type: "string", maxLength: 64, required: false },
  reviewAction: { type: "string", enum: ["retry"], required: false },
  submissionKind: { type: "string", enum: ["send", "steer"], required: false },
  // lesson: a lesson beat's Do it for me sent it (stored on the message turn).
  messageSource: { type: "string", enum: ["lesson"], required: false },
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
const agentMessageActionInputValidator = actionInput(withSessionId(agentMessageFields));

const mainChatApprovalFields = {
  expectedRevision: { type: "integer", min: 1, required: true },
  text: { ...agentMessageFields.message, required: false },
  note: { type: "string", noTrim: false, maxLength: 500, required: false }
};
const mainChatApprovalInputValidator = patchSchema(mainChatApprovalFields);
const mainChatApprovalActionInputValidator = actionInput({
  ...mainChatApprovalFields,
  sessionId: sessionIdField,
  approvalId: { type: "string", noTrim: false, minLength: 8, maxLength: 128, pattern: /^[A-Za-z0-9_-]+$/u, required: true }
});

const assistantAccessActionInputValidator = actionInput(withSessionId({}));

const agentTurnInterruptFields = {
  ...optionalOrigin,
  reason: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const agentTurnInterruptInputValidator = patchSchema(agentTurnInterruptFields);
const agentTurnInterruptActionInputValidator = actionInput(withSessionId(agentTurnInterruptFields));

const sessionPreviewStateInputValidator = actionInput({
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
  sessionId: sessionIdField,
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
    pattern: BROWSER_KEY_PATTERN,
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
const sessionPresenceActionInputValidator = actionInput(withSessionId(sessionPresenceFields));

const sessionListInputValidator = actionInput({
  sessionOffset: { type: "integer", min: 0, required: false }
});

const sessionRepositoryReviewSchema = createSchema({
  sessionId: sessionIdField,
  mode: { type: "string", enum: ["github", "managed_git", "local_source"], required: true },
  repository: { type: "string", minLength: 1, maxLength: 4096, required: true, noTrim: true },
  branch: { type: "string", minLength: 1, maxLength: 4096, required: true, noTrim: true }
});
const connectedWorkReviewSchema = createSchema({
  projectSlug: { type: "string", pattern: /^[a-z0-9][a-z0-9_-]{0,47}$/u, required: true },
  destination: { type: "object", schema: sessionRepositoryReviewSchema, required: true }
});
const sessionHistoryReviewSchema = createSchema({
  ...Object.fromEntries(["baseCommit", "canonicalCommit", "sessionHead", "worktreeTree"].map((key) =>
    [key, { type: "string", minLength: 1, maxLength: 128, required: true }])),
  changedPaths: { type: "array", items: { type: "string", noTrim: true }, required: false }
});

const sessionPullRequestInputValidator = actionInput({
  destinationReview: { type: "object", schema: sessionRepositoryReviewSchema, required: true },
  sessionId: sessionIdField,
  title: { type: "string", required: true, minLength: 1, maxLength: 256 },
  body: { type: "string", required: false, maxLength: 65536, noTrim: true },
  draft: { type: "boolean", required: false },
  ...optionalOrigin,
});

const incomingReviewSchema = createSchema({
  repository: { type: "string", required: true, minLength: 1, maxLength: 256 },
  targetBranch: { type: "string", required: true, minLength: 1, maxLength: 255, noTrim: true },
  id: { type: "string", required: true, pattern: UUID_V4_PATTERN },
  ...Object.fromEntries(["targetHead", "activeHead", "discardedHead"].map(key => [key, {
    type: "string", required: true, pattern: key === "targetHead" ? /^[a-f0-9]{40,64}$/u : /^(?:[a-f0-9]{40,64})?$/u
  }]))
});
const incomingInspectionInputValidator = actionInput({
  sessionId: sessionIdField,
  id: { type: "string", required: false, pattern: UUID_V4_PATTERN },
  state: { type: "string", required: false, enum: ["pending", "merged", "discarded", "unresolved", "all"] },
  offset: { type: "integer", required: false, min: 0 },
  limit: { type: "integer", required: false, min: 1, max: 50 }
});
const incomingChangeInputValidator = actionInput({
  sessionId: sessionIdField,
  id: { type: "string", required: true, pattern: UUID_V4_PATTERN },
  action: { type: "string", required: true, enum: ["merge", "discard", "review-repair"] },
  review: { type: "object", required: true, schema: incomingReviewSchema },
  repairReview: { type: "object", required: false, schema: createSchema(Object.fromEntries(
    ["tree", "worktreeTree", "head", "indexTree"].map(key => [key, {
      type: "string", required: true, pattern: /^[a-f0-9]{40,64}$/u
    }])) ) }
});

const connectedSourceAllocationInputValidator = actionInput({
  contribution: { type: "object", additionalProperties: true, required: true },
  sessionName: { type: "string", required: false, minLength: 1, maxLength: 120 }
});

const connectedReplacementInspectionInputValidator = actionInput({
  sessionId: sessionIdField,
  repository: { type: "string", required: true, pattern: /^[a-z0-9_-]+\/[a-z0-9_.-]+$/u }
});
const connectedReplacementInputValidator = actionInput({
  sessionId: sessionIdField,
  repository: { type: "string", required: true, pattern: /^[a-z0-9_-]+\/[a-z0-9_.-]+$/u },
  review: { type: "object", required: true, schema: incomingReviewSchema }
});

const connectedWorkInputValidator = actionInput({
  contribution: { type: "object", additionalProperties: true, required: true },
  submittedCommit: { type: "string", pattern: /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u, required: false },
  destinationReview: { type: "object", schema: sessionRepositoryReviewSchema, required: false }
});

const sessionCreateInputValidator = actionInput({
  repositoryBranch: { type: "object", required: false, schema: createSchema({
    name: { type: "string", minLength: 1, maxLength: 255, noTrim: true, required: true },
    fromBranch: { type: "string", minLength: 1, maxLength: 255, noTrim: true, required: false },
    expectedCommit: { type: "string", pattern: /^[a-f0-9]{40,64}$/u, required: true }
  }) },
  pullRequestNumber: { type: "integer", min: 1, required: false },
  assistantSelection: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  ...optionalOrigin,
});

const assistantCapabilitiesInputValidator = actionInput({
  allConnectedModels: { type: "string", required: false },
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
const assistantModelAccessUpdateActionInputValidator = actionInput({
  ...assistantModelAccessFields,
});

const assistantSelectionField = { type: "object", required: false, schema: createSchema({
  engineId: { type: "string", enum: Object.values(VIBE64_ASSISTANT_ENGINE_IDS), required: false },
  ...Object.fromEntries(["schema", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision"]
    .map((key) => [key, { type: "string", required: false }]))
}) };
const assistantRoutingField = { type: "object", required: false, schema: createSchema({
  mode: { type: "string", enum: ASSISTANT_MODES.map(({ id }) => id), required: true },
  review: { type: "boolean", required: false },
  autoSave: { type: "boolean", required: false },
  override: assistantSelectionField
}) };

const assistantSelectionUpdateInputValidator = patchSchema({
  assistantRouting: assistantRoutingField,
  assistantSelection: assistantSelectionField,
  ...optionalOrigin
});

const assistantSelectionUpdateActionInputValidator = actionInput({
  assistantRouting: assistantRoutingField,
  assistantSelection: assistantSelectionField,
  ...optionalOrigin,
  sessionId: sessionIdField
});

const sessionPinFields = { ...optionalOrigin, pinned: { type: "boolean", required: true } };
const sessionPinInputValidator = requiredInputSchema(sessionPinFields);
const sessionPinActionInputValidator = actionInput(withSessionId(sessionPinFields));

const currentSessionInputValidator = actionInput({
  sessionId: optionalSessionIdField
});

const sessionIdInputValidator = actionInput(withSessionId(optionalOrigin));

const sessionSaveInputValidator = actionInput({
  destinationReview: { type: "object", schema: sessionRepositoryReviewSchema, required: true },
  connectedReview: { type: "array", maxItems: 64, items: connectedWorkReviewSchema, required: false },
  ...optionalOrigin,
  sessionId: sessionIdField
});

const sessionUpdateInputValidator = actionInput({
  historyReview: { type: "object", schema: sessionHistoryReviewSchema, required: false },
  requestId: { type: "string", pattern: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u, required: false },
  ...optionalOrigin,
  reviewedConflictId: {
    type: "string",
    required: false
  },
  force: {
    type: "boolean",
    required: false
  },
  sessionId: sessionIdField
});

const sessionInspectInputValidator = actionInput(withSessionId({}));

const sessionRenewalInspectActionInputValidator = actionInput(withSessionId({}));

const sessionRenewalDraftRequestInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalDraftRequestActionInputValidator = actionInput(withSessionId(renewalOperationFields));

const sessionRenewalDraftUpdateInputValidator = requiredInputSchema(renewalDraftFields);
const sessionRenewalDraftUpdateActionInputValidator = actionInput(withSessionId(renewalDraftFields));

const sessionRenewalDraftGuardInputValidator = requiredInputSchema(renewalDraftGuardFields);
const sessionRenewalDraftGuardActionInputValidator = actionInput(withSessionId(renewalDraftGuardFields));

const sessionRenewalConfirmationInputValidator = requiredInputSchema(
  renewalConfirmationFields
);
const sessionRenewalConfirmationActionInputValidator = actionInput(withSessionId(renewalConfirmationFields));

const sessionRenewalRetryInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalRetryActionInputValidator = actionInput(withSessionId(renewalOperationFields));

const sessionChangesInputValidator = actionInput({
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
  sessionId: sessionIdField
});

const sessionChangeDiffInputValidator = actionInput({
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
  sessionId: sessionIdField
});

const sessionConversationLogInputValidator = actionInput({
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
  sessionId: sessionIdField
});

const repositoryHistoryInputValidator = actionInput({
  cursor: { type: "string", noTrim: false, required: false },
  limit: { type: "string", noTrim: false, required: false },
  sessionId: optionalSessionIdField
});

const repositoryVersionFilesInputValidator = actionInput({
  commit: { type: "string", noTrim: false, required: true },
  historySnapshotCommit: { type: "string", noTrim: false, required: true },
  limit: { type: "string", noTrim: false, required: false },
  offset: { type: "string", noTrim: false, required: false },
  sessionId: optionalSessionIdField
});

const repositoryVersionFileDiffInputValidator = actionInput({
  commit: { type: "string", noTrim: false, required: true },
  historySnapshotCommit: { type: "string", noTrim: false, required: true },
  lineLimit: { type: "string", noTrim: false, required: false },
  path: { type: "string", noTrim: true, required: true },
  sessionId: optionalSessionIdField
});

const integrationSetupRequestFields = {
  turnId: { type: "string", required: true, maxLength: 32, pattern: /^\d{6,}$/u },
  requestId: { type: "string", required: true, minLength: 64, maxLength: 64, pattern: /^[a-f0-9]{64}$/u }
};
const integrationSetupRequestInputValidator = requiredInputSchema(integrationSetupRequestFields);
const integrationSetupRequestActionInputValidator = actionInput(withSessionId(integrationSetupRequestFields));

export {
  incomingReviewSchema,
  incomingInspectionInputValidator,
  incomingChangeInputValidator,
  connectedSourceAllocationInputValidator,
  connectedReplacementInspectionInputValidator,
  connectedReplacementInputValidator,
  connectedWorkInputValidator,
  connectedWorkReviewSchema,
  sessionRepositoryReviewSchema,
  sessionHistoryReviewSchema,
  sessionRenameInputValidator,
  sessionRenameActionInputValidator,
  integrationSetupRequestInputValidator,
  integrationSetupRequestActionInputValidator,
  assistantAccessActionInputValidator,
  agentMessageActionInputValidator,
  agentMessageInputValidator,
  mainChatApprovalActionInputValidator,
  mainChatApprovalInputValidator,
  assistantCapabilitiesInputValidator,
  assistantModelAccessUpdateActionInputValidator,
  assistantModelAccessUpdateInputValidator,
  assistantSelectionUpdateActionInputValidator,
  assistantSelectionUpdateInputValidator,
  agentTurnInterruptActionInputValidator,
  agentTurnInterruptInputValidator,
  currentSessionInputValidator,
  sessionPinInputValidator,
  sessionPinActionInputValidator,
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
