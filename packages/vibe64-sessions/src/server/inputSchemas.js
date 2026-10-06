import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { ASSISTANT_MODES } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";

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
  workflowEngineId: { type: "string", enum: ["codex", "claude", "opencode"], required: false },
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

const sessionRenameFields = {
  name: { type: "string", noTrim: false, minLength: 1, maxLength: 120, required: true },
  ...optionalOrigin
};
const sessionRenameInputValidator = requiredInputSchema(sessionRenameFields);
const sessionRenameActionInputValidator = requiredInputSchema({
  ...sessionRenameFields,
  sessionId: { type: "string", noTrim: false, minLength: 1, required: true }
});

const agentMessageFields = {
  planRevision: { type: "string", maxLength: 64, required: false },
  reviewAction: { type: "string", enum: ["retry"], required: false },
  submissionKind: { type: "string", enum: ["send", "steer"], required: false },
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
const agentMessageActionInputValidator = requiredInputSchema({
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
    minLength: 1,
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

const agentTurnInterruptInputValidator = patchSchema(agentTurnInterruptFields);
const agentTurnInterruptActionInputValidator = requiredInputSchema({
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
  ...optionalUser,
  sessionOffset: { type: "integer", min: 0, required: false }
});

const sessionRepositoryReviewSchema = createSchema({
  sessionId: { type: "string", minLength: 1, maxLength: 256, required: true },
  mode: { type: "string", enum: ["github", "managed_git", "local_source"], required: true },
  repository: { type: "string", minLength: 1, maxLength: 4096, required: true, noTrim: true },
  branch: { type: "string", minLength: 1, maxLength: 4096, required: true, noTrim: true }
});
const sessionHistoryReviewSchema = createSchema({
  ...Object.fromEntries(["baseCommit", "canonicalCommit", "sessionHead", "worktreeTree"].map((key) =>
    [key, { type: "string", minLength: 1, maxLength: 128, required: true }])),
  changedPaths: { type: "array", items: { type: "string", noTrim: true }, required: false }
});

const sessionPullRequestInputValidator = patchSchema({
  destinationReview: { type: "object", schema: sessionRepositoryReviewSchema, required: true },
  sessionId: { type: "string", required: true, minLength: 1 },
  title: { type: "string", required: true, minLength: 1, maxLength: 256 },
  body: { type: "string", required: false, maxLength: 65536, noTrim: true },
  draft: { type: "boolean", required: false },
  ...optionalOrigin,
  ...optionalUser
});

const sessionCreateInputValidator = patchSchema({
  workflowEngineId: { type: "string", enum: ["codex", "claude", "opencode"], required: false },
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
  ...optionalUser
});

const assistantCapabilitiesInputValidator = patchSchema({
  allConnectedModels: { type: "string", required: false },
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

const assistantSelectionField = { type: "object", required: false, schema: createSchema({
  engineId: { type: "string", enum: Object.values(VIBE64_ASSISTANT_ENGINE_IDS), required: false },
  ...Object.fromEntries(["schema", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision"]
    .map((key) => [key, { type: "string", required: false }]))
}) };
const assistantRoutingField = { type: "object", required: false, schema: createSchema({
  mode: { type: "string", enum: ASSISTANT_MODES.map(({ id }) => id), required: true },
  review: { type: "boolean", required: false },
  workflowEngineId: { type: "string", enum: Object.values(VIBE64_ASSISTANT_ENGINE_IDS), required: false },
  override: assistantSelectionField
}) };

const assistantSelectionUpdateInputValidator = patchSchema({
  assistantRouting: assistantRoutingField,
  assistantSelection: assistantSelectionField,
  ...optionalOrigin
});

const assistantSelectionUpdateActionInputValidator = patchSchema({
  assistantRouting: assistantRoutingField,
  assistantSelection: assistantSelectionField,
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
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
    minLength: 1,
    required: true
  }
});

const sessionSaveInputValidator = patchSchema({
  destinationReview: { type: "object", schema: sessionRepositoryReviewSchema, required: true },
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
    required: true
  }
});

const sessionUpdateInputValidator = patchSchema({
  historyReview: { type: "object", schema: sessionHistoryReviewSchema, required: false },
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
    minLength: 1,
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
    minLength: 1,
    required: true
  }
});

const sessionRenewalDraftRequestInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalDraftRequestActionInputValidator = requiredInputSchema({
  ...renewalOperationFields,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
    required: true
  }
});

const sessionRenewalDraftUpdateInputValidator = requiredInputSchema(renewalDraftFields);
const sessionRenewalDraftUpdateActionInputValidator = requiredInputSchema({
  ...renewalDraftFields,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
    required: true
  }
});

const sessionRenewalDraftGuardInputValidator = requiredInputSchema(renewalDraftGuardFields);
const sessionRenewalDraftGuardActionInputValidator = requiredInputSchema({
  ...renewalDraftGuardFields,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
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
    minLength: 1,
    required: true
  }
});

const sessionRenewalRetryInputValidator = requiredInputSchema(renewalOperationFields);
const sessionRenewalRetryActionInputValidator = requiredInputSchema({
  ...renewalOperationFields,
  sessionId: {
    type: "string",
    noTrim: false,
    minLength: 1,
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

const sessionConversationLogInputValidator = requiredInputSchema({
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
  sessionRepositoryReviewSchema,
  sessionHistoryReviewSchema,
  sessionRenameInputValidator,
  sessionRenameActionInputValidator,
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
