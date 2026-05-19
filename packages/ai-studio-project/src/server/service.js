import {
  AiStudioSessionRuntime,
  createAiStudioAdapterRegistry,
  createAiStudioProjectConfigStore,
  createAiStudioProjectTypeStore,
  normalizeConfigDefinition
} from "../../../../server/lib/aiStudio/index.js";
import {
  aiStudioResult
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  resolveStudioTargetRoot
} from "../../../../server/lib/studioRoots.js";

function resolveAiStudioTargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_project_request_failed",
    fallbackMessage: "AI Studio project request failed."
  });
}

function projectTypeErrorCode(status = "") {
  return {
    missing: "ai_studio_project_type_missing",
    unimplemented: "ai_studio_project_type_unimplemented",
    unknown: "ai_studio_unknown_project_type"
  }[status] || "ai_studio_project_type_invalid";
}

function projectTypeMessage(status = "", projectType = "") {
  if (status === "missing") {
    return "Choose an AI Studio project type before using project-specific tools.";
  }
  if (status === "unknown") {
    return `Unknown AI Studio project type: ${projectType}.`;
  }
  if (status === "unimplemented") {
    return `AI Studio project type is not implemented yet: ${projectType}.`;
  }
  return "AI Studio project type is not ready.";
}

function createService({ targetRoot = "" } = {}) {
  const resolvedTargetRoot = resolveAiStudioTargetRoot(targetRoot);
  const adapterRegistry = createAiStudioAdapterRegistry();
  const projectConfigStore = createAiStudioProjectConfigStore({
    targetRoot: resolvedTargetRoot
  });
  const projectTypeStore = createAiStudioProjectTypeStore({
    targetRoot: resolvedTargetRoot
  });

  async function readProjectTypeState() {
    const projectType = await projectTypeStore.readProjectType();
    const definition = adapterRegistry.projectTypeDefinition(projectType);
    const status = projectType
      ? definition
        ? definition.enabled
          ? "ready"
          : "unimplemented"
        : "unknown"
      : "missing";
    const ready = status === "ready";
    return {
      adapter: ready
        ? {
            id: definition.id,
            label: definition.label
          }
        : null,
      availableProjectTypes: adapterRegistry.availableProjectTypes(),
      errorCode: ready ? "" : projectTypeErrorCode(status),
      message: ready ? "" : (definition?.disabledReason || projectTypeMessage(status, projectType)),
      path: projectTypeStore.path,
      projectType,
      ready,
      status,
      targetRoot: resolvedTargetRoot
    };
  }

  async function requireProjectType() {
    const projectType = await readProjectTypeState();
    if (!projectType.ready) {
      const error = new Error(projectType.message);
      error.code = projectType.errorCode;
      error.projectType = projectType;
      throw error;
    }
    return projectType;
  }

  async function saveProjectTypeState(input = {}) {
    const projectType = String(input?.projectType || "").trim();
    adapterRegistry.requireImplementedProjectType(projectType);
    await projectTypeStore.writeProjectType(projectType);
    return readProjectTypeState();
  }

  async function createProjectAdapter() {
    const projectType = await requireProjectType();
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return {
      adapter,
      projectType
    };
  }

  async function projectConfigDefinition(adapter, projectType) {
    const configContext = {
      adapter,
      projectType,
      targetRoot: resolvedTargetRoot
    };
    const [adapterFields, adapterDefaults] = await Promise.all([
      adapter.getConfigFields(configContext),
      adapter.getDefaultConfig(configContext)
    ]);
    return {
      adapterFields,
      adapterLabel: adapter.label,
      defaultValues: adapterDefaults
    };
  }

  function configResponse({
    adapter,
    config,
    projectType
  } = {}) {
    return {
      ...config,
      adapter: {
        id: adapter.id,
        label: adapter.label
      },
      projectType: projectType.projectType
    };
  }

  async function readProjectConfigForAdapter(adapter, projectType) {
    const config = await projectConfigStore.readConfig(
      await projectConfigDefinition(adapter, projectType)
    );
    return configResponse({
      adapter,
      config,
      projectType
    });
  }

  async function requireProjectConfigForAdapter(adapter, projectType) {
    const config = await readProjectConfigForAdapter(adapter, projectType);
    if (config.ready !== true) {
      const error = new Error("Save AI Studio project configuration before using project tools.");
      error.code = "ai_studio_project_config_missing";
      error.projectConfig = config;
      throw error;
    }
    return config;
  }

  async function readProjectConfigState() {
    const { adapter, projectType } = await createProjectAdapter();
    return readProjectConfigForAdapter(adapter, projectType);
  }

  async function readProjectConfigDefaultsState() {
    const { adapter, projectType } = await createProjectAdapter();
    const config = normalizeConfigDefinition(await projectConfigDefinition(adapter, projectType));
    return {
      adapter: {
        id: adapter.id,
        label: adapter.label
      },
      configRoot: projectConfigStore.configRoot,
      defaults: config.defaults,
      fields: config.fields,
      helperPath: projectConfigStore.helperPath,
      projectType: projectType.projectType,
      runtimeRoot: projectConfigStore.runtimeRoot,
      sections: config.sections
    };
  }

  async function saveProjectConfigState(input = {}) {
    const { adapter, projectType } = await createProjectAdapter();
    const config = await projectConfigStore.saveConfig({
      definition: await projectConfigDefinition(adapter, projectType),
      values: input?.values || {}
    });
    return configResponse({
      adapter,
      config,
      projectType
    });
  }

  async function createRuntime() {
    const { adapter, projectType } = await createProjectAdapter();
    const projectConfig = await requireProjectConfigForAdapter(adapter, projectType);
    return new AiStudioSessionRuntime({
      adapter,
      projectConfig,
      targetRoot: resolvedTargetRoot
    });
  }

  return Object.freeze({
    async createRuntime() {
      return createRuntime();
    },

    async readProjectType() {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await readProjectTypeState()
        };
      });
    },

    async readProjectConfig() {
      return projectResult(async () => {
        return {
          config: await readProjectConfigState(),
          ok: true
        };
      });
    },

    async readProjectConfigDefaults() {
      return projectResult(async () => {
        return {
          defaults: await readProjectConfigDefaultsState(),
          ok: true
        };
      });
    },

    async requireProjectType() {
      return requireProjectType();
    },

    async projectConfigEnvironment() {
      return projectConfigStore.environment();
    },

    async saveProjectType(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await saveProjectTypeState(input)
        };
      });
    },

    async saveProjectConfig(input = {}) {
      return projectResult(async () => {
        return {
          config: await saveProjectConfigState(input),
          ok: true
        };
      });
    },

    targetRoot: resolvedTargetRoot
  });
}

export {
  createService,
  resolveAiStudioTargetRoot
};
