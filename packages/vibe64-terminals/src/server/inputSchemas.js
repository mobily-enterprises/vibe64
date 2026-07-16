import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const sessionIdField = {
  type: "string",
  noTrim: false,
  required: true
};

const agentAttachmentFields = {
  contentType: {
    type: "string",
    noTrim: false,
    required: false
  },
  dataBase64: {
    type: "string",
    noTrim: true,
    required: true
  },
  fileName: {
    type: "string",
    noTrim: false,
    required: true
  }
};

const commandTerminalFields = {
  advanceOnSuccess: {
    type: "boolean",
    required: false
  },
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
  originId: {
    type: "string",
    noTrim: false,
    required: false
  },
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const projectToolRunFields = {
  parameters: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  sessionId: {
    ...sessionIdField,
    required: false
  },
  originId: {
    type: "string",
    noTrim: false,
    required: false
  },
  sourcePath: {
    type: "string",
    noTrim: false,
    required: false
  },
  toolId: {
    type: "string",
    noTrim: false,
    required: true
  },
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const projectToolFixFields = {
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
  exitCode: {
    type: "string",
    noTrim: false,
    required: false
  },
  output: {
    type: "string",
    noTrim: true,
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
  toolId: {
    type: "string",
    noTrim: false,
    required: true
  },
  toolLabel: {
    type: "string",
    noTrim: false,
    required: false
  },
  userMessage: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const sessionTerminalFixFields = {
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
  sessionId: sessionIdField,
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
};

const fixCodexReportFields = {
  message: {
    type: "string",
    noTrim: false,
    required: false
  },
  status: {
    type: "string",
    enum: ["fixed", "blocked"],
    noTrim: false,
    required: true
  },
  token: {
    type: "string",
    noTrim: false,
    required: true
  },
  verificationSummary: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const launchTargetFields = {
  forceRestart: {
    type: "boolean",
    required: false
  },
  launchInput: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  launchTargetId: {
    type: "string",
    noTrim: false,
    required: true
  },
  originId: {
    type: "string",
    noTrim: false,
    required: false
  },
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const previewIdentityFields = {
  email: {
    type: "string",
    noTrim: false,
    required: false
  },
  mode: {
    type: "string",
    enum: ["viewer", "email", "guest"],
    noTrim: false,
    required: true
  }
};

const terminalControlTextFields = {
  originId: {
    type: "string",
    noTrim: false,
    required: false
  },
  text: {
    type: "string",
    noTrim: true,
    required: true
  }
};

const terminalControlKeyFields = {
  key: {
    type: "string",
    enum: ["ctrl-c", "enter", "escape", "tab"],
    noTrim: false,
    required: true
  },
  originId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const agentAttachmentInputValidator = deepFreeze({
  schema: createSchema(agentAttachmentFields),
  mode: "patch"
});

const agentAttachmentActionInputValidator = deepFreeze({
  schema: createSchema({
    ...agentAttachmentFields,
    sessionId: sessionIdField
  }),
  mode: "patch"
});

const commandTerminalInputValidator = deepFreeze({
  schema: createSchema(commandTerminalFields),
  mode: "patch"
});

const commandTerminalActionInputValidator = deepFreeze({
  schema: createSchema({
    ...commandTerminalFields,
    sessionId: sessionIdField
  }),
  mode: "patch"
});

const projectToolRunInputValidator = deepFreeze({
  schema: createSchema({
    originId: projectToolRunFields.originId,
    parameters: projectToolRunFields.parameters,
    sessionId: projectToolRunFields.sessionId,
    sourcePath: projectToolRunFields.sourcePath
  }),
  mode: "patch"
});

const projectToolRunActionInputValidator = deepFreeze({
  schema: createSchema(projectToolRunFields),
  mode: "patch"
});

const projectToolFixInputValidator = deepFreeze({
  schema: createSchema({
    ...projectToolFixFields,
    toolId: {
      ...projectToolFixFields.toolId,
      required: false
    }
  }),
  mode: "patch"
});

const projectToolFixActionInputValidator = deepFreeze({
  schema: createSchema(projectToolFixFields),
  mode: "patch"
});

const sessionTerminalFixInputValidator = deepFreeze({
  schema: createSchema({
    ...sessionTerminalFixFields,
    sessionId: {
      ...sessionTerminalFixFields.sessionId,
      required: false
    }
  }),
  mode: "patch"
});

const sessionTerminalFixActionInputValidator = deepFreeze({
  schema: createSchema(sessionTerminalFixFields),
  mode: "patch"
});

const fixCodexReportInputValidator = deepFreeze({
  schema: createSchema(fixCodexReportFields),
  mode: "patch"
});

const launchTargetInputValidator = deepFreeze({
  schema: createSchema(launchTargetFields),
  mode: "patch"
});

const launchTargetActionInputValidator = deepFreeze({
  schema: createSchema({
    ...launchTargetFields,
    sessionId: sessionIdField
  }),
  mode: "patch"
});

const previewIdentityInputValidator = deepFreeze({
  schema: createSchema(previewIdentityFields),
  mode: "patch"
});

const previewIdentityActionInputValidator = deepFreeze({
  schema: createSchema({
    ...previewIdentityFields,
    publicHost: {
      type: "string",
      noTrim: false,
      required: false
    },
    publicProtocol: {
      type: "string",
      noTrim: false,
      required: false
    },
    sessionId: sessionIdField,
    vibe64User: {
      type: "object",
      additionalProperties: true,
      required: false
    }
  }),
  mode: "patch"
});

const terminalControlTextInputValidator = deepFreeze({
  schema: createSchema(terminalControlTextFields),
  mode: "patch"
});

const terminalControlKeyInputValidator = deepFreeze({
  schema: createSchema(terminalControlKeyFields),
  mode: "patch"
});

const openLaunchTargetActionInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: sessionIdField
  }),
  mode: "patch"
});

export {
  agentAttachmentActionInputValidator,
  agentAttachmentInputValidator,
  commandTerminalActionInputValidator,
  commandTerminalInputValidator,
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator,
  previewIdentityActionInputValidator,
  previewIdentityInputValidator,
  fixCodexReportInputValidator,
  projectToolFixActionInputValidator,
  projectToolFixInputValidator,
  projectToolRunActionInputValidator,
  projectToolRunInputValidator,
  sessionTerminalFixActionInputValidator,
  sessionTerminalFixInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
};
