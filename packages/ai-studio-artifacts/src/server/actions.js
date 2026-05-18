import {
  artifactReadInputValidator,
  artifactSaveInputValidator
} from "./inputSchemas.js";

const ACTION_READ_ARTIFACTS = "feature.ai-studio-artifacts.read";
const ACTION_SAVE_ARTIFACTS = "feature.ai-studio-artifacts.save";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_ARTIFACTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: artifactReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readArtifacts(input.sessionId, {
        actionId: input.actionId
      });
    }
  },
  {
    id: ACTION_SAVE_ARTIFACTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: artifactSaveInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveArtifacts(input.sessionId, {
        actionId: input.actionId,
        artifacts: input.artifacts || {}
      });
    }
  }
]);

export {
  ACTION_READ_ARTIFACTS,
  ACTION_SAVE_ARTIFACTS,
  featureActions
};
