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

const issueSessionStepInputValidator = deepFreeze({
  schema: createSchema({
    prompt: {
      type: "string",
      required: false
    },
    issue: {
      type: "string",
      noTrim: true,
      required: false
    },
    userCheck: {
      type: "string",
      required: false
    },
    codexThreadId: {
      type: "string",
      required: false
    }
  }),
  mode: "patch"
});

export {
  currentAppQueryInputValidator,
  issueSessionStepInputValidator
};
