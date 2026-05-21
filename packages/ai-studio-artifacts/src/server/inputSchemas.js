import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const artifactReadInputValidator = deepFreeze({
  schema: createSchema({
    actionId: {
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

const artifactsInputValidator = deepFreeze({
  schema: createSchema({
    actionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    artifacts: {
      type: "object",
      additionalProperties: true,
      required: true
    }
  }),
  mode: "patch"
});

const issueArtifactsInputValidator = deepFreeze({
  schema: createSchema({
    body: {
      type: "string",
      noTrim: false,
      required: true
    },
    title: {
      type: "string",
      noTrim: false,
      required: true
    },
    word: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const artifactSaveInputValidator = deepFreeze({
  schema: createSchema({
    actionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    artifacts: {
      type: "object",
      additionalProperties: true,
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

const issueArtifactSaveInputValidator = deepFreeze({
  schema: createSchema({
    body: {
      type: "string",
      noTrim: false,
      required: true
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    },
    title: {
      type: "string",
      noTrim: false,
      required: true
    },
    word: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const issueArtifactClearInputValidator = deepFreeze({
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
  artifactReadInputValidator,
  artifactsInputValidator,
  artifactSaveInputValidator,
  issueArtifactClearInputValidator,
  issueArtifactsInputValidator,
  issueArtifactSaveInputValidator
};
