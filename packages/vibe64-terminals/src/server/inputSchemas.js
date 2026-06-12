import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const sessionIdField = {
  type: "string",
  noTrim: false,
  required: true
};

const codexAttachmentFields = {
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
  }
};

const projectToolRunFields = {
  parameters: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  toolId: {
    type: "string",
    noTrim: false,
    required: true
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
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const shellTerminalFields = {
  reuseRunning: {
    type: "boolean",
    required: false
  },
  target: {
    type: "string",
    enum: ["worktree", "main"],
    noTrim: false,
    required: true
  }
};

const terminalControlTextFields = {
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
  }
};

const codexAttachmentInputValidator = deepFreeze({
  schema: createSchema(codexAttachmentFields),
  mode: "patch"
});

const codexAttachmentActionInputValidator = deepFreeze({
  schema: createSchema({
    ...codexAttachmentFields,
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
    parameters: projectToolRunFields.parameters
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

const shellTerminalInputValidator = deepFreeze({
  schema: createSchema(shellTerminalFields),
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

const shellTerminalActionInputValidator = deepFreeze({
  schema: createSchema({
    ...shellTerminalFields,
    sessionId: sessionIdField
  }),
  mode: "patch"
});

const openLaunchTargetActionInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: sessionIdField
  }),
  mode: "patch"
});

export {
  codexAttachmentActionInputValidator,
  codexAttachmentInputValidator,
  commandTerminalActionInputValidator,
  commandTerminalInputValidator,
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator,
  fixCodexReportInputValidator,
  projectToolFixActionInputValidator,
  projectToolFixInputValidator,
  projectToolRunActionInputValidator,
  projectToolRunInputValidator,
  sessionTerminalFixActionInputValidator,
  sessionTerminalFixInputValidator,
  shellTerminalActionInputValidator,
  shellTerminalInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
};
