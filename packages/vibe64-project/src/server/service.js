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
import {
  createStudioProjectContext,
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentWorkspaceRequestContext,
  currentWorkspaceTargetRoot
} from "@local/vibe64-core/server/workspaceRequestContext";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function workspaceProjectRecord({
  selected = false,
  slug = "",
  workspaceRoot = ""
} = {}) {
  return {
    external: false,
    name: slug,
    path: workspaceRoot,
    selected: Boolean(selected),
    slug,
    source: "managed"
  };
}

function projectResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_project_request_failed",
    fallbackMessage: "Vibe64 project request failed."
  });
}

function projectTypeErrorCode(status = "") {
  return {
    no_project_selected: "vibe64_project_not_selected",
    missing: "vibe64_project_type_missing",
    unimplemented: "vibe64_project_type_unimplemented",
    unknown: "vibe64_unknown_project_type"
  }[status] || "vibe64_project_type_invalid";
}

function projectTypeMessage(status = "", projectType = "") {
  if (status === "no_project_selected") {
    return "Choose a project before using project-specific tools.";
  }
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
  projectContext = null,
  targetRoot = "",
  workflowRegistry = createCoreWorkflowRegistry()
} = {}) {
  const studioProjectContext = projectContext || (String(targetRoot || "").trim()
    ? createStudioProjectContext({
      explicitTargetRoot: targetRoot
    })
    : getStudioProjectContext());
  const adapterRegistry = createVibe64AdapterRegistry();

  function currentTargetRoot() {
    return String(currentWorkspaceTargetRoot() || studioProjectContext.targetRoot || "").trim();
  }

  async function listProjectSelectionState() {
    const workspaceContext = currentWorkspaceRequestContext();
    if (!workspaceContext?.targetRoot) {
      return studioProjectContext.listProjects();
    }

    const listed = await studioProjectContext.listManagedWorkspaces();
    const currentProject = workspaceProjectRecord({
      selected: true,
      slug: workspaceContext.slug,
      workspaceRoot: workspaceContext.targetRoot
    });
    const projects = listed.workspaces
      .map((workspace) => workspaceProjectRecord({
        selected: workspace.slug === workspaceContext.slug,
        slug: workspace.slug,
        workspaceRoot: workspace.workspaceRoot
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug));

    if (!projects.some((project) => project.slug === currentProject.slug)) {
      projects.push(currentProject);
      projects.sort((left, right) => left.slug.localeCompare(right.slug));
    }

    return {
      ok: true,
      currentProject,
      hasSelection: true,
      projects,
      projectsRoot: workspaceContext.projectsRoot || listed.projectsRoot,
      targetRoot: workspaceContext.targetRoot
    };
  }

  function requireSelectedTargetRoot() {
    const workspaceTargetRoot = currentWorkspaceTargetRoot();
    if (workspaceTargetRoot) {
      return workspaceTargetRoot;
    }
    return studioProjectContext.requireSelectedTargetRoot();
  }

  function projectStores(targetRootValue = requireSelectedTargetRoot()) {
    const resolvedTargetRoot = resolveVibe64TargetRoot(targetRootValue);
    return {
      projectConfigStore: createVibe64ProjectConfigStore({
        targetRoot: resolvedTargetRoot
      }),
      projectTypeStore: createVibe64ProjectTypeStore({
        targetRoot: resolvedTargetRoot
      }),
      resolvedTargetRoot
    };
  }

  function noProjectSelectedTypeState() {
    const status = "no_project_selected";
    return {
      adapter: null,
      availableApplicationTypes: adapterRegistry.availableApplicationTypes(),
      availableProjectTypes: adapterRegistry.availableProjectTypes(),
      errorCode: projectTypeErrorCode(status),
      message: projectTypeMessage(status),
      path: "",
      projectType: "",
      ready: false,
      status,
      targetRoot: ""
    };
  }

  function noProjectSelectedConfigState() {
    return {
      invalid: [],
      message: projectTypeMessage("no_project_selected"),
      missing: [],
      projectType: "",
      ready: false,
      status: "no_project_selected",
      values: {}
    };
  }

  async function readProjectTypeState() {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return noProjectSelectedTypeState();
    }
    const {
      projectTypeStore,
      resolvedTargetRoot
    } = projectStores(targetRootValue);
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
    const {
      projectTypeStore
    } = projectStores();
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

  async function projectConfigDefinition(adapter, projectType, targetRootValue = requireSelectedTargetRoot()) {
    const configContext = {
      adapter,
      projectType,
      targetRoot: resolveVibe64TargetRoot(targetRootValue)
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
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      const projectType = noProjectSelectedTypeState();
      return {
        adapter: null,
        baseBranch: "main",
        config: null,
        projectConfig: null,
        projectMessage: projectType.message,
        projectReady: false,
        projectType,
        targetRoot: ""
      };
    }
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
        targetRoot: targetRootValue
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
      targetRoot: targetRootValue
    };
  }

  async function createProjectToolRegistry(context = {}) {
    const adapterTools = typeof context.adapter?.listProjectTools === "function"
      ? await context.adapter.listProjectTools({
          adapter: context.adapter,
          config: context.config,
          projectConfig: context.projectConfig,
          projectType: context.projectType,
          targetRoot: context.targetRoot
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
      targetRoot: context.targetRoot
    };
  }

  async function readProjectConfigForAdapter(adapter, projectType) {
    const targetRootValue = requireSelectedTargetRoot();
    const {
      projectConfigStore
    } = projectStores(targetRootValue);
    const config = await projectConfigStore.readConfig(
      await projectConfigDefinition(adapter, projectType, targetRootValue)
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
    if (!currentTargetRoot()) {
      return noProjectSelectedConfigState();
    }
    const { adapter, projectType } = await createProjectAdapter();
    return readProjectConfigForAdapter(adapter, projectType);
  }

  async function readProjectConfigDefaultsState() {
    const { adapter, projectType } = await createProjectAdapter();
    const targetRootValue = requireSelectedTargetRoot();
    const {
      projectConfigStore
    } = projectStores(targetRootValue);
    const config = normalizeConfigDefinition(await projectConfigDefinition(adapter, projectType, targetRootValue));
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
    const targetRootValue = requireSelectedTargetRoot();
    const {
      projectConfigStore
    } = projectStores(targetRootValue);
    const config = await projectConfigStore.saveConfig({
      definition: await projectConfigDefinition(adapter, projectType, targetRootValue),
      values: input?.values || {}
    });
    return configResponse({
      adapter,
      config,
      projectType
    });
  }

  async function createRuntime() {
    const resolvedTargetRoot = requireSelectedTargetRoot();
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
    currentTargetRoot() {
      return currentTargetRoot();
    },

    get targetRoot() {
      return currentTargetRoot();
    },

    get selectedProject() {
      return studioProjectContext.selectedProject;
    },

    async createProject(input = {}) {
      return projectResult(() => studioProjectContext.createManagedProject(input));
    },

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
      if (!currentTargetRoot()) {
        return {};
      }
      const {
        projectConfigStore
      } = projectStores(currentTargetRoot());
      return projectConfigStore.environment();
    },

    async listProjects() {
      return projectResult(() => listProjectSelectionState());
    },

    async requireSelectedTargetRoot() {
      return requireSelectedTargetRoot();
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
    },

    async selectProject(input = {}) {
      return projectResult(() => studioProjectContext.selectManagedProject(input));
    }
  });
}

export {
  createService,
  resolveVibe64TargetRoot
};
