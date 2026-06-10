import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const vibe64UserInputSchema = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
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
    ...vibe64UserInputSchema,
    workflowDefinition: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionIdInputValidator = deepFreeze({
  schema: createSchema({
    ...vibe64UserInputSchema,
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
    ...displayInputSchema,
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
    ...displayFieldsInputSchema,
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
    shellTarget: {
      type: "string",
      noTrim: false,
      required: false
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

export {
  sessionActionInputValidator,
  sessionAdvanceInputValidator,
  sessionCreateInputValidator,
  sessionIdInputValidator,
  sessionIntentInputValidator,
  sessionListInputValidator,
  sessionRewindInputValidator,
  sessionTerminalFailureFixInputValidator
};
