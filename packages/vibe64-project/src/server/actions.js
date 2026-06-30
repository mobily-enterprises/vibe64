import {
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectCreateInputValidator,
  projectEnvMaterializeInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
} from "./inputSchemas.js";

const ACTION_CREATE_PROJECT = "feature.vibe64-project.projects.create";
const ACTION_LIST_PROJECTS = "feature.vibe64-project.projects.list";
const ACTION_LIST_PROJECT_TOOLS = "feature.vibe64-project.tools.list";
const ACTION_READ_PROJECT_TYPE = "feature.vibe64-project.project-type.read";
const ACTION_SELECT_PROJECT = "feature.vibe64-project.projects.select";
const ACTION_SAVE_PROJECT_TYPE = "feature.vibe64-project.project-type.save";
const ACTION_READ_PROJECT_CONFIG = "feature.vibe64-project.config.read";
const ACTION_READ_PROJECT_CONFIG_DEFAULTS = "feature.vibe64-project.config.defaults.read";
const ACTION_SAVE_PROJECT_CONFIG = "feature.vibe64-project.config.save";
const ACTION_MATERIALIZE_ENV = "feature.vibe64-project.env.materialize";
const ACTION_READ_ENV = "feature.vibe64-project.env.read";
const ACTION_SAVE_ENV_USER_VALUES = "feature.vibe64-project.env.user-values.save";

const featureActions = Object.freeze([
  {
    id: ACTION_LIST_PROJECTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectsReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_PROJECTS
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.listProjects();
    }
  },
  {
    id: ACTION_CREATE_PROJECT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectCreateInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CREATE_PROJECT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.createProject(input);
    }
  },
  {
    id: ACTION_SELECT_PROJECT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectSelectInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SELECT_PROJECT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.selectProject(input);
    }
  },
  {
    id: ACTION_LIST_PROJECT_TOOLS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectConfigReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_LIST_PROJECT_TOOLS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.listProjectTools(input);
    }
  },
  {
    id: ACTION_READ_PROJECT_TYPE,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectTypeReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_TYPE
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readProjectType(input);
    }
  },
  {
    id: ACTION_SAVE_PROJECT_TYPE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
    surfaces: ["app"],
    input: projectConfigReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_CONFIG
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readProjectConfig(input);
    }
  },
  {
    id: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectConfigReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_CONFIG_DEFAULTS
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readProjectConfigDefaults(input);
    }
  },
  {
    id: ACTION_SAVE_PROJECT_CONFIG,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
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
  },
  {
    id: ACTION_READ_ENV,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectEnvReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_ENV
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.readEnv(input);
    }
  },
  {
    id: ACTION_SAVE_ENV_USER_VALUES,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectEnvUserValuesInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_ENV_USER_VALUES
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveEnvUserValues(input);
    }
  },
  {
    id: ACTION_MATERIALIZE_ENV,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: projectEnvMaterializeInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_MATERIALIZE_ENV
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.materializeEnvAction(input);
    }
  }
]);

export {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_LIST_PROJECT_TOOLS,
  ACTION_MATERIALIZE_ENV,
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_READ_ENV,
  ACTION_SELECT_PROJECT,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_PROJECT_TYPE,
  featureActions
};
