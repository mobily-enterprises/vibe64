import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const vibe64UserInputSchema = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const originInputSchema = {
  originId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const composerMenuProjectionInputSchema = {
  includeComposerMenu: {
    type: "string",
    noTrim: false,
    required: false
  },
  includeRuntimeEnrichment: {
    type: "string",
    noTrim: false,
    required: false
  },
  projectSlug: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const agentSettingsInputSchema = {
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const composerSubmissionInputSchema = {
  composerSubmissionId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const displayInputSchema = {
  displayInput: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const displayFieldsInputSchema = {
  displayFields: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const agentMessageInputValidator = deepFreeze({
  schema: createSchema({
    afterSubmissionId: {
      type: "string",
      noTrim: false,
      required: false
    },
    ...agentSettingsInputSchema,
    ...composerSubmissionInputSchema,
    ...displayFieldsInputSchema,
    ...originInputSchema,
    fields: {
      type: "object",
      additionalProperties: true,
      required: false
    },
    message: {
      type: "string",
      noTrim: false,
      required: false
    },
    promptTemplateId: {
      type: "string",
      noTrim: false,
      required: false
    },
    text: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const originOnlyInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema
  }),
  mode: "patch"
});

const agentMessageCancelInputValidator = originOnlyInputValidator;

const agentTurnInterruptInputValidator = deepFreeze({
  schema: createSchema({
    afterSubmissionId: {
      type: "string",
      noTrim: false,
      required: false
    },
    controlRequestId: {
      type: "string",
      noTrim: false,
      required: false
    },
    ...originInputSchema,
    reason: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const agentTaskStartInputValidator = deepFreeze({
  schema: createSchema({
    ...agentSettingsInputSchema,
    ...originInputSchema,
    taskId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const agentTaskMessageInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    message: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const agentTaskControlInputValidator = originOnlyInputValidator;

const sessionListInputValidator = deepFreeze({
  schema: createSchema({
    archive: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionCreateInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    workflowDefinition: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const currentSessionInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionIdInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionDiffInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    full: {
      type: "string",
      noTrim: false,
      required: false
    },
    lineLimit: {
      type: "string",
      noTrim: false,
      required: false
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionInspectInputValidator = deepFreeze({
  schema: createSchema({
    ...composerMenuProjectionInputSchema,
    ...originInputSchema,
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionConversationLogInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
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
  }),
  mode: "patch"
});

const sessionAdvanceInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: false
    },
    stepStatus: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionActionInputValidator = deepFreeze({
  schema: createSchema({
    ...agentSettingsInputSchema,
    ...composerSubmissionInputSchema,
    ...displayInputSchema,
    ...originInputSchema,
    ...vibe64UserInputSchema,
    actionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    input: {
      type: "object",
      additionalProperties: true,
      required: false
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionIntentInputValidator = deepFreeze({
  schema: createSchema({
    ...agentSettingsInputSchema,
    ...composerSubmissionInputSchema,
    ...displayFieldsInputSchema,
    ...originInputSchema,
    ...vibe64UserInputSchema,
    fields: {
      type: "object",
      additionalProperties: true,
      required: false
    },
    input: {
      type: "object",
      additionalProperties: true,
      required: false
    },
    intentId: {
      type: "string",
      noTrim: false,
      required: true
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: false
    },
    stepStatus: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionTerminalFailureFixInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    actionId: {
      type: "string",
      noTrim: false,
      required: false
    },
    actionLabel: {
      type: "string",
      noTrim: false,
      required: false
    },
    attemptedCommand: {
      type: "string",
      noTrim: false,
      required: false
    },
    closeError: {
      type: "string",
      noTrim: false,
      required: false
    },
    commandPreview: {
      type: "string",
      noTrim: false,
      required: false
    },
    currentStep: {
      type: "string",
      noTrim: false,
      required: false
    },
    exitCode: {
      type: "string",
      noTrim: false,
      required: false
    },
    launchTargetId: {
      type: "string",
      noTrim: false,
      required: false
    },
    launchTargetLabel: {
      type: "string",
      noTrim: false,
      required: false
    },
    output: {
      type: "string",
      noTrim: true,
      required: false
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepStatus: {
      type: "string",
      noTrim: false,
      required: false
    },
    terminalKind: {
      type: "string",
      noTrim: false,
      required: false
    },
    terminalSessionId: {
      type: "string",
      noTrim: false,
      required: false
    },
    terminalStatus: {
      type: "string",
      noTrim: false,
      required: false
    },
    userMessage: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionRewindInputValidator = deepFreeze({
  schema: createSchema({
    ...originInputSchema,
    ...vibe64UserInputSchema,
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionRecoveryInputValidator = deepFreeze({
  schema: createSchema({
    issueId: {
      type: "string",
      noTrim: false,
      required: true
    },
    ...originInputSchema,
    optionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    signature: {
      type: "string",
      noTrim: false,
      required: true
    },
    ...vibe64UserInputSchema
  }),
  mode: "patch"
});

export {
  agentMessageCancelInputValidator,
  agentTaskControlInputValidator,
  agentTaskMessageInputValidator,
  agentTaskStartInputValidator,
  agentTurnInterruptInputValidator,
  agentMessageInputValidator,
  currentSessionInputValidator,
  sessionActionInputValidator,
  sessionAdvanceInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionIntentInputValidator,
  sessionListInputValidator,
  sessionRecoveryInputValidator,
  sessionRewindInputValidator,
  sessionTerminalFailureFixInputValidator
};
