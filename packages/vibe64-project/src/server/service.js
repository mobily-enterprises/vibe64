import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server/runtime";
import {
  createCoreProjectToolRegistry
} from "@local/vibe64-runtime/server/coreProjectTools";
import {
  createCoreWorkflowRegistry
} from "@local/vibe64-runtime/server/registerCoreWorkflowModules";
import {
  createVibe64AdapterRegistry,
  createVibe64ProjectConfigStore,
  createVibe64ProjectTypeStore,
  normalizeConfigDefinition
} from "@local/vibe64-adapters/server";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_project_request_failed",
    fallbackMessage: "Vibe64 project request failed."
  });
}

function projectTypeErrorCode(status = "") {
  return {
    missing: "vibe64_project_type_missing",
    unimplemented: "vibe64_project_type_unimplemented",
    unknown: "vibe64_unknown_project_type"
  }[status] || "vibe64_project_type_invalid";
}

function projectTypeMessage(status = "", projectType = "") {
  if (status === "missing") {
    return "Choose an Vibe64 project type before using project-specific tools.";
  }
  if (status === "unknown") {
    return `Unknown Vibe64 project type: ${projectType}.`;
  }
  if (status === "unimplemented") {
    return `Vibe64 project type is not implemented yet: ${projectType}.`;
  }
  return "Vibe64 project type is not ready.";
}

function createService({
  targetRoot = "",
  workflowRegistry = createCoreWorkflowRegistry()
} = {}) {
  const resolvedTargetRoot = resolveVibe64TargetRoot(targetRoot);
  const adapterRegistry = createVibe64AdapterRegistry();
  const projectConfigStore = createVibe64ProjectConfigStore({
    targetRoot: resolvedTargetRoot
  });
  const projectTypeStore = createVibe64ProjectTypeStore({
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
      availableApplicationTypes: adapterRegistry.availableApplicationTypes(),
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

  async function projectToolContext() {
    const projectType = await readProjectTypeState();
    if (!projectType.ready) {
      return {
        adapter: null,
        baseBranch: "main",
        config: null,
        projectConfig: null,
        projectMessage: projectType.message,
        projectReady: false,
        projectType,
        targetRoot: resolvedTargetRoot
      };
    }

    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    const config = await readProjectConfigForAdapter(adapter, projectType);
    const projectReady = config.ready === true;
    return {
      adapter,
      baseBranch: "main",
      config,
      projectConfig: config,
      projectMessage: projectReady
        ? ""
        : config.message || "Save Vibe64 project configuration before using project tools.",
      projectReady,
      projectType,
      targetRoot: resolvedTargetRoot
    };
  }

  async function createProjectToolRegistry(context = {}) {
    const adapterTools = typeof context.adapter?.listProjectTools === "function"
      ? await context.adapter.listProjectTools({
          adapter: context.adapter,
          config: context.config,
          projectConfig: context.projectConfig,
          projectType: context.projectType,
          targetRoot: resolvedTargetRoot
        })
      : [];
    const adapterToolModule = Array.isArray(adapterTools) && adapterTools.length
      ? [{
          id: `adapter.${context.adapter.id}`,
          tools: adapterTools
        }]
      : [];
    return createCoreProjectToolRegistry({
      toolModules: adapterToolModule
    });
  }

  function projectToolRunParameters(input = {}) {
    const inputObject = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const parameters = inputObject.parameters || inputObject.input || {};
    return parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? parameters
      : {};
  }

  async function listProjectToolState() {
    const context = await projectToolContext();
    const registry = await createProjectToolRegistry(context);
    return registry.listTools(context);
  }

  async function prepareProjectToolRunState(toolId = "", input = {}) {
    const context = await projectToolContext();
    const registry = await createProjectToolRegistry(context);
    const run = await registry.resolveToolRun(toolId, {
      context,
      parameters: projectToolRunParameters(input)
    });
    if (run.type === "command" && run.spec?.ok === false) {
      const error = new Error(run.spec.message || `${run.tool.label} cannot start.`);
      error.code = "vibe64_project_tool_not_ready";
      throw error;
    }
    if (run.type === "prompt" && !run.prompt) {
      const error = new Error(`${run.tool.label} did not produce a prompt.`);
      error.code = "vibe64_project_tool_not_ready";
      throw error;
    }
    return {
      ...run,
      adapter: context.adapter
        ? {
            id: context.adapter.id,
            label: context.adapter.label
          }
        : null,
      targetRoot: resolvedTargetRoot
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
      const error = new Error("Save Vibe64 project configuration before using project tools.");
      error.code = "vibe64_project_config_missing";
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
    return new Vibe64SessionRuntime({
      adapter,
      projectConfig,
      targetRoot: resolvedTargetRoot,
      workflowRegistry
    });
  }

  return Object.freeze({
    targetRoot: resolvedTargetRoot,

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

    async listProjectTools() {
      return projectResult(async () => {
        return {
          ok: true,
          tools: await listProjectToolState()
        };
      });
    },

    async prepareProjectToolRun(toolId, input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          ...await prepareProjectToolRunState(toolId, input)
        };
      });
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
    }
  });
}

export {
  createService,
  resolveVibe64TargetRoot
};
