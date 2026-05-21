import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const sessionListInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const sessionCreateInputValidator = deepFreeze({
  schema: createSchema({
    workflowProfile: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const sessionIdInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const sessionActionInputValidator = deepFreeze({
  schema: createSchema({
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

const sessionRewindInputValidator = deepFreeze({
  schema: createSchema({
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
  sessionCreateInputValidator,
  sessionIdInputValidator,
  sessionListInputValidator,
  sessionRewindInputValidator
};
