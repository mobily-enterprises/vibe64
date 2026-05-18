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

const launchTargetFields = {
  launchTargetId: {
    type: "string",
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
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator
};
