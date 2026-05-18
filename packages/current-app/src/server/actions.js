import {
  currentAppQueryInputValidator,
  emptyInputValidator,
  starredTargetScriptsInputValidator
} from "./inputSchemas.js";

const ACTION_READ_CURRENT_APP = "feature.current-app.read";
const ACTION_READ_SETUP_READINESS = "feature.current-app.setup-readiness.read";
const ACTION_LIST_TARGET_SCRIPTS = "feature.current-app.target-scripts.list";
const ACTION_RESET_STARRED_TARGET_SCRIPTS = "feature.current-app.target-scripts.starred.reset";
const ACTION_SAVE_STARRED_TARGET_SCRIPTS = "feature.current-app.target-scripts.starred.save";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_CURRENT_APP,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: currentAppQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_CURRENT_APP
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.featureService.inspectCurrentApp(input, {
        context
      });
    }
  },
  {
    id: ACTION_READ_SETUP_READINESS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: emptyInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_SETUP_READINESS
    },
    observability: {},
    async execute(_input, context, deps) {
      void context;
      return deps.featureService.inspectSetupReadiness();
    }
  },
  {
    id: ACTION_LIST_TARGET_SCRIPTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: emptyInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_TARGET_SCRIPTS
    },
    observability: {},
    async execute(_input, context, deps) {
      void context;
      return deps.featureService.listTargetScripts();
    }
  },
  {
    id: ACTION_SAVE_STARRED_TARGET_SCRIPTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: starredTargetScriptsInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_STARRED_TARGET_SCRIPTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveStarredTargetScripts(input);
    }
  },
  {
    id: ACTION_RESET_STARRED_TARGET_SCRIPTS,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: emptyInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_RESET_STARRED_TARGET_SCRIPTS
    },
    observability: {},
    async execute(_input, context, deps) {
      void context;
      return deps.featureService.resetStarredTargetScripts();
    }
  }
]);

export {
  ACTION_LIST_TARGET_SCRIPTS,
  ACTION_READ_CURRENT_APP,
  ACTION_READ_SETUP_READINESS,
  ACTION_RESET_STARRED_TARGET_SCRIPTS,
  ACTION_SAVE_STARRED_TARGET_SCRIPTS,
  featureActions
};
