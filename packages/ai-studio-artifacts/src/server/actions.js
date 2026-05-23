import {
  artifactPreviewReadInputValidator,
  currentStepInputSaveValidator,
  sessionIdInputValidator,
} from "./inputSchemas.js";

const ACTION_READ_ARTIFACT_PREVIEW = "feature.ai-studio-artifacts.preview.read";
const ACTION_READ_ARTIFACT_READINESS = "feature.ai-studio-artifacts.readiness.read";
const ACTION_SUBMIT_CURRENT_STEP_INPUT = "feature.ai-studio-artifacts.current-step-input.submit";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_ARTIFACT_PREVIEW,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: artifactPreviewReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ARTIFACT_PREVIEW
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readArtifactPreview(input.sessionId, {
        previewId: input.previewId
      });
    }
  },
  {
    id: ACTION_READ_ARTIFACT_READINESS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: sessionIdInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ARTIFACT_READINESS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readArtifactReadiness(input.sessionId);
    }
  },
  {
    id: ACTION_SUBMIT_CURRENT_STEP_INPUT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: currentStepInputSaveValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SUBMIT_CURRENT_STEP_INPUT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.submitCurrentStepInput(input.sessionId, {
        fields: input.fields || {},
        kind: input.kind,
        message: input.message,
        source: input.source,
        stepId: input.stepId,
        stepStatus: input.stepStatus,
        text: input.text
      });
    }
  }
]);

export {
  ACTION_READ_ARTIFACT_PREVIEW,
  ACTION_READ_ARTIFACT_READINESS,
  ACTION_SUBMIT_CURRENT_STEP_INPUT,
  featureActions
};
