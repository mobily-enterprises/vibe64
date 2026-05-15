import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    includeGit: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const terminalInputValidator = deepFreeze({
  schema: createSchema({
    data: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

const codexThreadInputValidator = deepFreeze({
  schema: createSchema({
    threadId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const codexPromptHandoffInputValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "patch"
});

const codexAttachmentInputValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "patch"
});

const rewindIssueSessionInputValidator = deepFreeze({
  schema: createSchema({
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  codexAttachmentInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadInputValidator,
  currentAppQueryInputValidator,
  rewindIssueSessionInputValidator,
  terminalInputValidator
};
