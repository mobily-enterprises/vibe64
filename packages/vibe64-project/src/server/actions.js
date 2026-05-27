import {
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
} from "./inputSchemas.js";

const ACTION_READ_PROJECT_TYPE = "feature.vibe64-project.project-type.read";
const ACTION_SAVE_PROJECT_TYPE = "feature.vibe64-project.project-type.save";
const ACTION_READ_PROJECT_CONFIG = "feature.vibe64-project.config.read";
const ACTION_READ_PROJECT_CONFIG_DEFAULTS = "feature.vibe64-project.config.defaults.read";
const ACTION_SAVE_PROJECT_CONFIG = "feature.vibe64-project.config.save";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_PROJECT_TYPE,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectTypeReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_TYPE
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.readProjectType();
    }
  },
  {
    id: ACTION_SAVE_PROJECT_TYPE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectTypeInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_PROJECT_TYPE
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveProjectType(input);
    }
  },
  {
    id: ACTION_READ_PROJECT_CONFIG,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectConfigReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_CONFIG
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.readProjectConfig();
    }
  },
  {
    id: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectConfigReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_CONFIG_DEFAULTS
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.readProjectConfigDefaults();
    }
  },
  {
    id: ACTION_SAVE_PROJECT_CONFIG,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectConfigInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_PROJECT_CONFIG
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveProjectConfig(input);
    }
  }
]);

export {
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_PROJECT_TYPE,
  featureActions
};
