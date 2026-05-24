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

const launchTargetFields = {
  launchTargetId: {
    type: "string",
    noTrim: false,
    required: true
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
  commandTerminalActionInputValidator,
  commandTerminalInputValidator,
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator,
  shellTerminalActionInputValidator,
  shellTerminalInputValidator
};
