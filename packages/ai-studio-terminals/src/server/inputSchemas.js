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

const codexPromptHandoffFields = {
  completionActionId: {
    type: "string",
    noTrim: false,
    required: false
  },
  completionRequestId: {
    type: "string",
    noTrim: false,
    required: false
  },
  completionStartedAt: {
    type: "string",
    noTrim: false,
    required: false
  },
  completionStepId: {
    type: "string",
    noTrim: false,
    required: false
  },
  completionToken: {
    type: "string",
    noTrim: false,
    required: false
  },
  outputStart: {
    type: "string",
    noTrim: false,
    required: false
  },
  signature: {
    type: "string",
    noTrim: false,
    required: true
  }
};

const codexThreadFields = {
  threadId: {
    type: "string",
    noTrim: false,
    required: true
  }
};

const commandTerminalFields = {
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

const launchTargetFields = {
  launchTargetId: {
    type: "string",
    noTrim: false,
    required: true
  }
};

const shellTerminalFields = {
  target: {
    type: "string",
    enum: ["worktree", "main"],
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

const codexPromptHandoffInputValidator = deepFreeze({
  schema: createSchema(codexPromptHandoffFields),
  mode: "patch"
});

const codexPromptHandoffActionInputValidator = deepFreeze({
  schema: createSchema({
    ...codexPromptHandoffFields,
    sessionId: sessionIdField
  }),
  mode: "patch"
});

const codexThreadInputValidator = deepFreeze({
  schema: createSchema(codexThreadFields),
  mode: "patch"
});

const codexThreadActionInputValidator = deepFreeze({
  schema: createSchema({
    ...codexThreadFields,
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
  codexPromptHandoffActionInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadActionInputValidator,
  codexThreadInputValidator,
  commandTerminalActionInputValidator,
  commandTerminalInputValidator,
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator,
  shellTerminalActionInputValidator,
  shellTerminalInputValidator
};
