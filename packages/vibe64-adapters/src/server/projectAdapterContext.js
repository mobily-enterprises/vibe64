import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";

import {
  createVibe64AdapterRegistry
} from "./adapters/registry.js";
import {
  createVibe64ProjectConfigStore
} from "./configStore.js";
import {
  createVibe64ProjectTypeStore
} from "./projectType.js";

function projectTypeMissingError() {
  return vibe64Error(
    "Choose a Vibe64 project type before continuing.",
    "vibe64_project_type_missing"
  );
}

function projectConfigMissingError(projectConfig) {
  const error = vibe64Error(
    "Save Vibe64 project configuration before continuing.",
    "vibe64_project_config_missing"
  );
  error.projectConfig = projectConfig;
  return error;
}

async function projectConfigDefinition(adapter, projectTypeState, targetRoot) {
  const configContext = {
    adapter,
    projectType: projectTypeState,
    targetRoot
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

function projectTypeState({
  definition = {},
  projectType = "",
  projectTypePath = "",
  targetRoot = ""
} = {}) {
  return {
    adapter: {
      id: definition.id,
      label: definition.label
    },
    errorCode: "",
    message: "",
    path: projectTypePath,
    projectType,
    ready: true,
    status: "ready",
    targetRoot
  };
}

function projectConfigResponse({
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

function createVibe64ProjectAdapterContext({
  adapterRegistry = createVibe64AdapterRegistry(),
  projectLocalRoot = "",
  sourceContractRoot = "",
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = normalizeText(targetRoot);
  const projectConfigStore = createVibe64ProjectConfigStore({
    projectLocalRoot,
    sourceContractRoot,
    targetRoot: resolvedTargetRoot
  });
  const projectTypeStore = createVibe64ProjectTypeStore({
    sourceContractRoot,
    targetRoot: resolvedTargetRoot
  });

  async function readProjectType() {
    const projectType = await projectTypeStore.readProjectType();
    if (!projectType) {
      throw projectTypeMissingError();
    }
    const definition = adapterRegistry.requireImplementedProjectType(projectType);
    return projectTypeState({
      definition,
      projectType,
      projectTypePath: projectTypeStore.path,
      targetRoot: resolvedTargetRoot
    });
  }

  async function createAdapter() {
    const projectType = await readProjectType();
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return {
      adapter,
      projectType
    };
  }

  async function readProjectConfigForAdapter(adapter, projectType) {
    const config = await projectConfigStore.readConfig(
      await projectConfigDefinition(adapter, projectType, resolvedTargetRoot)
    );
    return projectConfigResponse({
      adapter,
      config,
      projectType
    });
  }

  async function requireProjectConfigForAdapter(adapter, projectType) {
    const projectConfig = await readProjectConfigForAdapter(adapter, projectType);
    if (projectConfig.ready !== true) {
      throw projectConfigMissingError(projectConfig);
    }
    return projectConfig;
  }

  async function requireConfiguredAdapter() {
    const {
      adapter,
      projectType
    } = await createAdapter();
    const projectConfig = await requireProjectConfigForAdapter(adapter, projectType);
    return {
      adapter,
      projectConfig,
      projectType,
      targetRoot: resolvedTargetRoot
    };
  }

  return Object.freeze({
    createAdapter,
    readProjectConfigForAdapter,
    readProjectType,
    requireConfiguredAdapter,
    requireProjectConfigForAdapter
  });
}

export {
  createVibe64ProjectAdapterContext
};
