import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

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

const sessionIntentInputValidator = deepFreeze({
  schema: createSchema({
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
  sessionIntentInputValidator,
  sessionListInputValidator,
  sessionRewindInputValidator
};
