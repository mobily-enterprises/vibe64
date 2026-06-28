import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  readCommittedProjectConfig
} from "@local/vibe64-core/server/committedProjectConfig";
import {
  isMissingPathError,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

import {
  createVibe64AdapterRegistry
} from "./adapters/registry.js";
import {
  VIBE64_RUNTIME_CONFIG_DIR,
  VIBE64_RUNTIME_DIR,
  VIBE64_CONFIG_HELPER_FILE,
  normalizeConfigDefinition,
  readConfigFromValues
} from "./configStore.js";

function projectTypeMissingError(committedConfig = {}) {
  const error = vibe64Error(
    committedConfig.message || "Committed Vibe64 project type is unavailable.",
    committedConfig.code || "vibe64_committed_project_type_missing"
  );
  error.committedProjectConfig = committedConfig;
  return error;
}

function projectConfigMissingError(projectConfig) {
  const error = vibe64Error(
    "Committed Vibe64 project configuration is incomplete.",
    "vibe64_committed_project_config_missing"
  );
  error.projectConfig = projectConfig;
  return error;
}

function projectConfigDefinitionContext(adapter, projectTypeState, targetRoot) {
  return {
    adapter,
    projectType: projectTypeState,
    targetRoot
  };
}

async function projectConfigDefinition(adapter, projectTypeState, targetRoot) {
  const configContext = projectConfigDefinitionContext(adapter, projectTypeState, targetRoot);
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

function committedProjectTypeState({
  committedConfig = {},
  definition = {},
  targetRoot = ""
} = {}) {
  return {
    adapter: {
      id: definition.id,
      label: definition.label
    },
    commit: committedConfig.commit || "",
    errorCode: "",
    message: "",
    path: committedConfig.configRoot ? `${committedConfig.ref}:${committedConfig.configRoot}` : "",
    projectType: committedConfig.projectType,
    ready: true,
    ref: committedConfig.ref || "",
    sourceType: committedConfig.sourceType || "",
    status: "ready",
    targetRoot
  };
}

function projectConfigResponse({
  adapter,
  committedConfig = {},
  config,
  projectType
} = {}) {
  return {
    ...config,
    adapter: {
      id: adapter.id,
      label: adapter.label
    },
    commit: committedConfig.commit || "",
    projectType: projectType.projectType,
    ref: committedConfig.ref || "",
    sourceType: committedConfig.sourceType || ""
  };
}

function committedConfigRuntimePaths(projectLocalRoot = "") {
  const root = normalizeText(projectLocalRoot);
  return {
    configRoot: "",
    helperPath: root ? path.join(root, VIBE64_RUNTIME_DIR, VIBE64_CONFIG_HELPER_FILE) : "",
    localConfigRoot: root ? path.join(root, VIBE64_RUNTIME_CONFIG_DIR) : "",
    runtimeRoot: root ? path.join(root, VIBE64_RUNTIME_DIR) : ""
  };
}

async function readRuntimeLocalConfigValue(localConfigRoot = "", fieldId = "") {
  if (!localConfigRoot || !fieldId) {
    return null;
  }
  try {
    return normalizeText(await readFile(path.join(localConfigRoot, fieldId), "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function readRuntimeLocalConfigValues(normalizedDefinition = {}, localConfigRoot = "") {
  const entries = await Promise.all((Array.isArray(normalizedDefinition.fields) ? normalizedDefinition.fields : [])
    .filter((field) => field.scope === "local")
    .map(async (field) => {
      const value = await readRuntimeLocalConfigValue(localConfigRoot, field.id);
      return value === null ? null : [field.id, value];
    }));
  return Object.fromEntries(entries.filter(Boolean));
}

async function committedConfigValuesForDefinition(definition = {}, {
  committedConfig = {},
  projectLocalRoot = ""
} = {}) {
  const normalizedDefinition = normalizeConfigDefinition(definition);
  const runtimePaths = committedConfigRuntimePaths(projectLocalRoot);
  const localValues = await readRuntimeLocalConfigValues(normalizedDefinition, runtimePaths.localConfigRoot);
  const sharedValues = committedConfig.configValues && typeof committedConfig.configValues === "object" && !Array.isArray(committedConfig.configValues)
    ? committedConfig.configValues
    : {};
  return Object.fromEntries(normalizedDefinition.fields
    .map((field) => {
      const sourceValues = field.scope === "local" ? localValues : sharedValues;
      return Object.hasOwn(sourceValues, field.id) ? [field.id, sourceValues[field.id]] : null;
    })
    .filter(Boolean)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function createVibe64CommittedProjectAdapterContext({
  adapterRegistry = createVibe64AdapterRegistry(),
  onlineProjectRecordPath = "",
  projectLocalRoot = "",
  projectRuntimeRoot = "",
  ref = "",
  sourceRoot = "",
  targetRoot = ""
} = {}) {
  const resolvedProjectLocalRoot = normalizeText(projectRuntimeRoot || projectLocalRoot);
  const resolvedTargetRoot = normalizeText(sourceRoot || targetRoot);

  async function readCommittedConfig() {
    return readCommittedProjectConfig({
      onlineProjectRecordPath,
      projectRuntimeRoot: resolvedProjectLocalRoot,
      ref,
      sourceRoot
    });
  }

  async function readProjectType() {
    const committedConfig = await readCommittedConfig();
    if (committedConfig.available !== true || !committedConfig.projectType) {
      throw projectTypeMissingError(committedConfig);
    }
    const definition = adapterRegistry.requireImplementedProjectType(committedConfig.projectType);
    return {
      committedConfig,
      projectType: committedProjectTypeState({
        committedConfig,
        definition,
        targetRoot: resolvedTargetRoot
      })
    };
  }

  async function createAdapter() {
    const {
      committedConfig,
      projectType
    } = await readProjectType();
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return {
      adapter,
      committedConfig,
      projectType
    };
  }

  async function readProjectConfigForAdapter(adapter, projectType, committedConfig) {
    const definition = await projectConfigDefinition(adapter, projectType, resolvedTargetRoot);
    const values = await committedConfigValuesForDefinition(definition, {
      committedConfig,
      projectLocalRoot: resolvedProjectLocalRoot
    });
    const config = readConfigFromValues(
      definition,
      values,
      {
        ...committedConfigRuntimePaths(resolvedProjectLocalRoot),
        configRoot: committedConfig.configRoot || ""
      }
    );
    return projectConfigResponse({
      adapter,
      committedConfig,
      config,
      projectType
    });
  }

  async function requireProjectConfigForAdapter(adapter, projectType, committedConfig) {
    const projectConfig = await readProjectConfigForAdapter(adapter, projectType, committedConfig);
    if (projectConfig.ready !== true) {
      throw projectConfigMissingError(projectConfig);
    }
    return projectConfig;
  }

  async function requireConfiguredAdapter() {
    const {
      adapter,
      committedConfig,
      projectType
    } = await createAdapter();
    const projectConfig = await requireProjectConfigForAdapter(adapter, projectType, committedConfig);
    return {
      adapter,
      committedConfig,
      projectConfig,
      projectType,
      targetRoot: resolvedTargetRoot
    };
  }

  return Object.freeze({
    createAdapter,
    readCommittedConfig,
    readProjectConfigForAdapter,
    readProjectType,
    requireConfiguredAdapter,
    requireProjectConfigForAdapter
  });
}

export {
  committedConfigRuntimePaths,
  committedConfigValuesForDefinition,
  createVibe64CommittedProjectAdapterContext
};
