import {
  artifactReadInputValidator,
  artifactSaveInputValidator,
  issueArtifactClearInputValidator,
  issueArtifactSaveInputValidator
} from "./inputSchemas.js";

const ACTION_READ_ARTIFACTS = "feature.ai-studio-artifacts.read";
const ACTION_SAVE_ARTIFACTS = "feature.ai-studio-artifacts.save";
const ACTION_CLEAR_ISSUE_ARTIFACTS = "feature.ai-studio-artifacts.issue.clear";
const ACTION_CLEAR_AUTOPILOT_ARTIFACTS = "feature.ai-studio-artifacts.autopilot.clear";
const ACTION_READ_AUTOPILOT_ARTIFACTS = "feature.ai-studio-artifacts.autopilot.read";
const ACTION_SAVE_ISSUE_ARTIFACTS = "feature.ai-studio-artifacts.issue.save";

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
  },
  {
    id: ACTION_CLEAR_ISSUE_ARTIFACTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: issueArtifactClearInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CLEAR_ISSUE_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.clearIssueArtifacts(input.sessionId);
    }
  },
  {
    id: ACTION_READ_AUTOPILOT_ARTIFACTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: issueArtifactClearInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_AUTOPILOT_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readAutopilotArtifacts(input.sessionId);
    }
  },
  {
    id: ACTION_CLEAR_AUTOPILOT_ARTIFACTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: issueArtifactClearInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CLEAR_AUTOPILOT_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.clearAutopilotArtifacts(input.sessionId);
    }
  },
  {
    id: ACTION_SAVE_ISSUE_ARTIFACTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: issueArtifactSaveInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_ISSUE_ARTIFACTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveIssueArtifacts(input.sessionId, {
        body: input.body,
        title: input.title
      });
    }
  }
]);

export {
  ACTION_CLEAR_AUTOPILOT_ARTIFACTS,
  ACTION_CLEAR_ISSUE_ARTIFACTS,
  ACTION_READ_ARTIFACTS,
  ACTION_READ_AUTOPILOT_ARTIFACTS,
  ACTION_SAVE_ARTIFACTS,
  ACTION_SAVE_ISSUE_ARTIFACTS,
  featureActions
};
