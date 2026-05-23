import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const artifactPreviewReadInputValidator = deepFreeze({
  schema: createSchema({
    previewId: {
      type: "string",
      noTrim: false,
      required: true
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const currentStepInputValidator = deepFreeze({
  schema: createSchema({
    fields: {
      type: "object",
      additionalProperties: true
    },
    kind: {
      type: "string",
      noTrim: false
    },
    message: {
      type: "string",
      noTrim: false
    },
    source: {
      type: "string",
      noTrim: false
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepStatus: {
      type: "string",
      noTrim: false,
      required: true
    },
    text: {
      type: "string",
      noTrim: false
    }
  }),
  mode: "patch"
});

const currentStepInputSaveValidator = deepFreeze({
  schema: createSchema({
    fields: {
      type: "object",
      additionalProperties: true
    },
    kind: {
      type: "string",
      noTrim: false
    },
    message: {
      type: "string",
      noTrim: false
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    source: {
      type: "string",
      noTrim: false
    },
    stepId: {
      type: "string",
      noTrim: false,
      required: true
    },
    stepStatus: {
      type: "string",
      noTrim: false,
      required: true
    },
    text: {
      type: "string",
      noTrim: false
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

export {
  artifactPreviewReadInputValidator,
  currentStepInputSaveValidator,
  currentStepInputValidator,
  sessionIdInputValidator
};
