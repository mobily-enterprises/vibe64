import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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
  configValuesFromInput,
  createVibe64AdapterRegistry,
  createVibe64ProjectConfigStore,
  createVibe64ProjectTypeStore,
  normalizeConfigDefinition,
  readConfigFromValues
} from "@local/vibe64-adapters/server";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  RUNTIME_CONFIG_OWNERS,
  dotenvText,
  generatedRuntimeConfigHeaderPresent,
  materializeRuntimeConfig,
  normalizeRuntimeConfigKey,
  resolveRuntimeConfig,
  runtimeConfigEnv
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readRuntimeConfigUserValues,
  saveRuntimeConfigUserValues
} from "@local/vibe64-core/server/runtimeConfigUserValues";
import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  pendingProjectBootstrapConfig,
  readOnlineProjectMetadata,
  saveProjectBootstrapConfig
} from "@local/vibe64-core/server/projectBootstrapConfig";
import {
  resolveStudioTargetRoot,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  createStudioProjectContext,
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentOnlineProjectRecordPath,
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectStateRoot,
  currentProjectTargetRoot
} from "@local/vibe64-core/server/projectRequestContext";
import {
  resolveProjectRuntimeRoot,
  resolveSourceConfigRoot
} from "@local/vibe64-core/server/projectState";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectSelectionRecord({
  githubRepository = null,
  onlineProjectRecordPath = "",
  projectLocalRoot = "",
  selected = false,
  sourceConfigRoot = "",
  sourceRoot = "",
  runtime = null,
  slug = "",
  projectRuntimeRoot = "",
  projectRoot = ""
} = {}) {
  const record = {
    external: false,
    name: slug,
    onlineProjectRecordPath,
    path: projectRoot,
    projectLocalRoot: projectRuntimeRoot || projectLocalRoot,
    projectRuntimeRoot: projectRuntimeRoot || projectLocalRoot,
    projectRoot,
    selected: Boolean(selected),
    slug,
    sourceConfigRoot,
    sourceRoot,
    source: "workspace"
  };
  if (githubRepository) {
    record.githubRepository = githubRepository;
  }
  if (runtime) {
    record.runtime = runtime;
  }
  return record;
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

const VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV = "VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT";

function selfTargetAutoSelectProjectRepro(env = process.env) {
  const selfTarget = /^(1|true|yes|on)$/iu.test(String(env?.[VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV] || "").trim());
  const projectSlug = selfTarget
    ? String(env?.[VIBE64_REPRO_SELF_TARGET_AUTO_SELECT_PROJECT_ENV] || "").trim()
    : "";
  return {
    enabled: Boolean(projectSlug),
    projectSlug,
    selfTarget
  };
}

function projectSelectionReproMetadata() {
  return {
    selfTargetAutoSelectProject: selfTargetAutoSelectProjectRepro()
  };
}

function createService({
  projectContext = null,
  projectConfigSavedHooks = [],
  projectConfigEnvironmentResolvers = [],
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
    return String(currentProjectTargetRoot() || studioProjectContext.targetRoot || "").trim();
  }

  function currentSourceRoot() {
    const requestSourceRoot = currentProjectSourceRoot();
    if (requestSourceRoot) {
      return requestSourceRoot;
    }
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.sourceRootForTarget === "function") {
      return studioProjectContext.sourceRootForTarget(targetRootValue);
    }
    return targetRootValue;
  }

  function sourceConfigRoot(sourceRootValue = currentSourceRoot()) {
    const requestSourceConfigRoot = currentProjectSourceConfigRoot();
    if (requestSourceConfigRoot) {
      return requestSourceConfigRoot;
    }
    if (!sourceRootValue) {
      return "";
    }
    if (typeof studioProjectContext.sourceConfigRootForTarget === "function" && sourceRootValue === currentTargetRoot()) {
      return studioProjectContext.sourceConfigRootForTarget(sourceRootValue);
    }
    return resolveSourceConfigRoot({
      sourceRoot: sourceRootValue
    });
  }

  function projectRuntimeRoot(targetRootValue = currentTargetRoot()) {
    const requestProjectRuntimeRoot = currentProjectRuntimeRoot() || currentProjectLocalRoot();
    if (requestProjectRuntimeRoot) {
      return requestProjectRuntimeRoot;
    }
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.projectRuntimeRootForTarget === "function" && targetRootValue) {
      return studioProjectContext.projectRuntimeRootForTarget(targetRootValue);
    }
    if (typeof studioProjectContext.projectLocalRootForTarget === "function" && targetRootValue) {
      return studioProjectContext.projectLocalRootForTarget(targetRootValue);
    }
    return resolveProjectRuntimeRoot({
      projectRoot: targetRootValue
    });
  }

  function onlineProjectRecordPath(targetRootValue = currentTargetRoot()) {
    const requestRecordPath = currentOnlineProjectRecordPath();
    if (requestRecordPath) {
      return requestRecordPath;
    }
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.onlineProjectRecordPathForTarget === "function") {
      return studioProjectContext.onlineProjectRecordPathForTarget(targetRootValue);
    }
    return "";
  }

  function projectStateRoot(targetRootValue = currentTargetRoot()) {
    const projectStateRootValue = currentProjectStateRoot();
    if (projectStateRootValue) {
      return projectStateRootValue;
    }
    void targetRootValue;
    const sourceRootValue = currentSourceRoot();
    return sourceRootValue ? sourceConfigRoot(sourceRootValue) : "";
  }

  function projectLocalRoot(targetRootValue = currentTargetRoot()) {
    return projectRuntimeRoot(targetRootValue);
  }

  function targetRootIsProjectHome(targetRootValue = currentTargetRoot()) {
    const normalizedTargetRoot = String(targetRootValue || "").trim();
    if (!normalizedTargetRoot) {
      return false;
    }
    if (typeof studioProjectContext.sourceRootForTarget === "function") {
      return !studioProjectContext.sourceRootForTarget(normalizedTargetRoot);
    }
    return false;
  }

  function projectSourceUnavailableError(error) {
    return String(error?.code || "").trim() === "vibe64_project_config_source_required";
  }

  async function readProjectBootstrapConfigForTarget(targetRootValue = currentTargetRoot()) {
    if (!targetRootValue || !targetRootIsProjectHome(targetRootValue)) {
      return null;
    }
    return pendingProjectBootstrapConfig(await readOnlineProjectMetadata(onlineProjectRecordPath(targetRootValue)));
  }

  function projectRuntimeConfigPathsForTarget(targetRootValue = currentTargetRoot()) {
    const runtimeRoot = projectRuntimeRoot(targetRootValue);
    return {
      helperPath: runtimeRoot ? path.join(runtimeRoot, "runtime", "vibe64-config.sh") : "",
      localConfigRoot: runtimeRoot ? path.join(runtimeRoot, "runtime-config") : "",
      runtimeRoot: runtimeRoot ? path.join(runtimeRoot, "runtime") : ""
    };
  }

  async function bootstrapProjectTypeState(input = {}) {
    const targetRootValue = currentTargetRoot();
    const bootstrapConfig = await readProjectBootstrapConfigForTarget(targetRootValue);
    const projectType = draftProjectType(input) || bootstrapConfig?.projectType || "";
    const definition = projectType ? adapterRegistry.projectTypeDefinition(projectType) : null;
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
      bootstrap: Boolean(bootstrapConfig),
      errorCode: ready ? "" : projectTypeErrorCode(status),
      message: ready ? "" : (definition?.disabledReason || projectTypeMessage(status, projectType)),
      path: onlineProjectRecordPath(targetRootValue),
      projectType,
      ready,
      sourceRoot: "",
      status,
      targetRoot: targetRootValue
    };
  }

  async function listProjectSelectionState() {
    const projectContextValue = currentProjectRequestContext();
    if (!projectContextValue?.targetRoot) {
      return {
        ...await studioProjectContext.listProjects(),
        repro: projectSelectionReproMetadata()
      };
    }

    if (typeof studioProjectContext.requestContextMatchesSelectedProject === "function" &&
      studioProjectContext.requestContextMatchesSelectedProject(projectContextValue)) {
      return {
        ...await studioProjectContext.listProjects(),
        repro: projectSelectionReproMetadata()
      };
    }

    const listed = await studioProjectContext.listWorkspaceProjects();
    const currentCatalogProject = listed.projects.find((project) => project.slug === projectContextValue.slug) || null;
    const currentProject = projectSelectionRecord({
      githubRepository: currentCatalogProject?.githubRepository || null,
      onlineProjectRecordPath: projectContextValue.onlineProjectRecordPath || currentCatalogProject?.onlineProjectRecordPath || "",
      projectLocalRoot: projectContextValue.projectLocalRoot || currentCatalogProject?.projectLocalRoot || "",
      projectRuntimeRoot: projectContextValue.projectRuntimeRoot || currentCatalogProject?.projectRuntimeRoot || "",
      runtime: currentCatalogProject?.runtime || null,
      selected: true,
      sourceConfigRoot: projectContextValue.sourceConfigRoot || currentCatalogProject?.sourceConfigRoot || "",
      sourceRoot: projectContextValue.sourceRoot || currentCatalogProject?.sourceRoot || "",
      slug: projectContextValue.slug,
      projectRoot: projectContextValue.targetRoot
    });
    const projects = listed.projects
      .map((project) => projectSelectionRecord({
        githubRepository: project.githubRepository,
        onlineProjectRecordPath: project.onlineProjectRecordPath,
        projectLocalRoot: project.projectLocalRoot,
        projectRuntimeRoot: project.projectRuntimeRoot,
        runtime: project.runtime,
        selected: project.slug === projectContextValue.slug,
        sourceConfigRoot: project.sourceConfigRoot,
        sourceRoot: project.sourceRoot,
        slug: project.slug,
        projectRoot: project.projectRoot
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
      projectsRoot: projectContextValue.projectsRoot || listed.projectsRoot,
      repro: projectSelectionReproMetadata(),
      targetRoot: projectContextValue.targetRoot
    };
  }

  function requireSelectedTargetRoot() {
    const projectTargetRoot = currentProjectTargetRoot();
    if (projectTargetRoot) {
      return projectTargetRoot;
    }
    return studioProjectContext.requireSelectedTargetRoot();
  }

  function normalizeSessionId(value = "") {
    return String(value || "").trim();
  }

  function activeSessionSourcePath(projectRuntimeRootValue = "", sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return projectRuntimeRootValue && normalizedSessionId
      ? path.join(projectRuntimeRootValue, "sessions", "active", normalizedSessionId, "source")
      : "";
  }

  function assertSourcePathTargetsSessionSource(sourcePath = "", {
    projectRuntimeRoot: projectRuntimeRootValue = "",
    sessionId = ""
  } = {}) {
    const normalizedSourcePath = path.resolve(sourcePath);
    const normalizedRuntimeRoot = String(projectRuntimeRootValue || "").trim()
      ? path.resolve(projectRuntimeRootValue)
      : "";
    if (!normalizedRuntimeRoot) {
      return normalizedSourcePath;
    }
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (normalizedSessionId) {
      const expectedSourcePath = activeSessionSourcePath(normalizedRuntimeRoot, normalizedSessionId);
      if (normalizedSourcePath !== path.resolve(expectedSourcePath)) {
        const error = new Error("Project config sourcePath must be the selected session source.");
        error.code = "vibe64_project_config_source_outside_session";
        throw error;
      }
      return normalizedSourcePath;
    }
    const activeSessionsRoot = path.join(normalizedRuntimeRoot, "sessions", "active");
    const relative = path.relative(activeSessionsRoot, normalizedSourcePath);
    const parts = relative.split(path.sep).filter(Boolean);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      parts.length !== 2 ||
      parts[1] !== "source"
    ) {
      const error = new Error("Project config sourcePath must point at an active session source.");
      error.code = "vibe64_project_config_source_outside_session";
      throw error;
    }
    return normalizedSourcePath;
  }

  async function singleActiveSessionSourceRoot(projectRuntimeRootValue = "") {
    const activeSessionsRoot = path.join(projectRuntimeRootValue, "sessions", "active");
    let entries = [];
    try {
      entries = await readdir(activeSessionsRoot, {
        withFileTypes: true
      });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return "";
      }
      throw error;
    }
    const sources = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sourcePath = activeSessionSourcePath(projectRuntimeRootValue, entry.name);
      if (await pathExists(sourcePath)) {
        sources.push(sourcePath);
      }
    }
    if (sources.length === 1) {
      return sources[0];
    }
    if (sources.length > 1) {
      const error = new Error("Project config edits require sessionId when multiple active session sources exist.");
      error.code = "vibe64_project_config_session_required";
      throw error;
    }
    return "";
  }

  async function projectConfigSourceRoot(input = {}, {
    requireWritable = false
  } = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return "";
    }
    const runtimeRoot = projectRuntimeRoot(targetRootValue);
    const requestedSourcePath = String(input?.sourcePath || "").trim();
    const requestedSessionId = normalizeSessionId(input?.sessionId);
    if (requestedSourcePath) {
      const resolvedSourcePath = path.resolve(requestedSourcePath);
      if (targetRootIsProjectHome(targetRootValue) || requestedSessionId) {
        const containedSourcePath = assertSourcePathTargetsSessionSource(resolvedSourcePath, {
          projectRuntimeRoot: runtimeRoot,
          sessionId: requestedSessionId
        });
        if (requireWritable && !await pathExists(containedSourcePath)) {
          const error = new Error("Project config sourcePath does not exist.");
          error.code = "vibe64_project_config_source_missing";
          throw error;
        }
        return containedSourcePath;
      }
      const selectedSourceRoot = currentSourceRoot();
      if (selectedSourceRoot && path.resolve(selectedSourceRoot) !== resolvedSourcePath) {
        const error = new Error("Project config sourcePath must match the selected source root.");
        error.code = "vibe64_project_config_source_outside_root";
        throw error;
      }
      if (requireWritable && !await pathExists(resolvedSourcePath)) {
        const error = new Error("Project config sourcePath does not exist.");
        error.code = "vibe64_project_config_source_missing";
        throw error;
      }
      return resolvedSourcePath;
    }
    if (requestedSessionId) {
      const sourcePath = activeSessionSourcePath(runtimeRoot, requestedSessionId);
      if (await pathExists(sourcePath)) {
        return sourcePath;
      }
      const error = new Error(`Active session source does not exist: ${requestedSessionId}.`);
      error.code = "vibe64_project_config_source_missing";
      throw error;
    }
    const selectedSourceRoot = currentSourceRoot();
    if (selectedSourceRoot) {
      return selectedSourceRoot;
    }
    const activeSourceRoot = await singleActiveSessionSourceRoot(runtimeRoot);
    if (activeSourceRoot) {
      return activeSourceRoot;
    }
    if (requireWritable) {
      const error = new Error("Project config edits require an active source session.");
      error.code = "vibe64_project_config_source_required";
      throw error;
    }
    return "";
  }

  async function projectStores(input = {}, {
    requireWritableSource = false
  } = {}) {
    const targetRootValue = currentTargetRoot() || requireSelectedTargetRoot();
    const resolvedTargetRoot = resolveVibe64TargetRoot(targetRootValue);
    const resolvedSourceRoot = await projectConfigSourceRoot(input, {
      requireWritable: requireWritableSource
    });
    const resolvedSourceConfigRoot = resolvedSourceRoot
      ? resolveSourceConfigRoot({
          sourceRoot: resolvedSourceRoot
        })
      : "";
    const resolvedProjectRuntimeRoot = projectRuntimeRoot(resolvedTargetRoot);
    if (!resolvedSourceRoot || !resolvedSourceConfigRoot) {
      const error = new Error("Project config requires an active source root.");
      error.code = "vibe64_project_config_source_required";
      throw error;
    }
    return {
      projectConfigStore: createVibe64ProjectConfigStore({
        projectLocalRoot: resolvedProjectRuntimeRoot,
        projectSharedRoot: resolvedSourceConfigRoot,
        targetRoot: resolvedSourceRoot
      }),
      projectTypeStore: createVibe64ProjectTypeStore({
        projectSharedRoot: resolvedSourceConfigRoot,
        targetRoot: resolvedSourceRoot
      }),
      resolvedProjectLocalRoot: resolvedProjectRuntimeRoot,
      resolvedProjectRuntimeRoot,
      resolvedProjectStateRoot: resolvedSourceConfigRoot,
      resolvedSourceConfigRoot,
      resolvedSourceRoot,
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

  async function readProjectTypeState(input = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return noProjectSelectedTypeState();
    }
    let stores = null;
    try {
      stores = await projectStores(input);
    } catch (error) {
      if (!projectSourceUnavailableError(error)) {
        throw error;
      }
      return bootstrapProjectTypeState(input);
    }
    const {
      projectTypeStore,
      resolvedSourceRoot,
      resolvedTargetRoot
    } = stores;
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
      sourceRoot: resolvedSourceRoot,
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
    let projectTypeStore = null;
    try {
      ({
        projectTypeStore
      } = await projectStores(input, {
        requireWritableSource: true
      }));
    } catch (error) {
      if (!projectSourceUnavailableError(error) || !targetRootIsProjectHome()) {
        throw error;
      }
      const targetRootValue = currentTargetRoot();
      const existingBootstrap = await readProjectBootstrapConfigForTarget(targetRootValue);
      await saveProjectBootstrapConfig({
        onlineProjectRecordPath: onlineProjectRecordPath(targetRootValue),
        projectType,
        values: existingBootstrap?.projectType === projectType ? existingBootstrap.values : {}
      });
      return readProjectTypeState(input);
    }
    await projectTypeStore.writeProjectType(projectType);
    return readProjectTypeState(input);
  }

  function draftProjectType(input = {}) {
    return String(input?.projectType || "").trim();
  }

  async function readDraftProjectTypeState(projectTypeValue = "", input = {}) {
    let projectTypeStore = {
      path: ""
    };
    let resolvedSourceRoot = "";
    let resolvedTargetRoot = currentTargetRoot();
    try {
      ({
        projectTypeStore,
        resolvedSourceRoot,
        resolvedTargetRoot
      } = await projectStores(input));
    } catch (error) {
      if (!projectSourceUnavailableError(error)) {
        throw error;
      }
    }
    const definition = adapterRegistry.requireImplementedProjectType(projectTypeValue);
    return {
      adapter: {
        id: definition.id,
        label: definition.label
      },
      availableApplicationTypes: adapterRegistry.availableApplicationTypes(),
      availableProjectTypes: adapterRegistry.availableProjectTypes(),
      draft: true,
      errorCode: "",
      message: "",
      path: projectTypeStore.path,
      projectType: definition.id,
      ready: true,
      sourceRoot: resolvedSourceRoot,
      status: "draft",
      targetRoot: resolvedTargetRoot
    };
  }

  async function resolveProjectTypeForConfig(input = {}) {
    const projectType = draftProjectType(input);
    if (projectType) {
      return readDraftProjectTypeState(projectType, input);
    }
    return readProjectTypeState(input).then((state) => {
      if (!state.ready) {
        const error = new Error(state.message);
        error.code = state.errorCode;
        error.projectType = state;
        throw error;
      }
      return state;
    });
  }

  async function createProjectAdapter(input = {}) {
    const projectType = await resolveProjectTypeForConfig(input);
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

  async function readProjectConfigForAdapter(adapter, projectType, input = {}) {
    let stores = null;
    try {
      stores = await projectStores(input);
    } catch (error) {
      if (!projectSourceUnavailableError(error)) {
        throw error;
      }
      return readBootstrapProjectConfigForAdapter(adapter, projectType);
    }
    const {
      projectConfigStore,
      resolvedSourceRoot
    } = stores;
    const config = await projectConfigStore.readConfig(await projectConfigDefinition(adapter, projectType, resolvedSourceRoot));
    return configResponse({
      adapter,
      config,
      projectType
    });
  }

  async function readBootstrapProjectConfigForAdapter(adapter, projectType) {
    const targetRootValue = currentTargetRoot();
    const bootstrapConfig = await readProjectBootstrapConfigForTarget(targetRootValue);
    const values = bootstrapConfig?.projectType === projectType.projectType
      ? bootstrapConfig.values
      : {};
    const config = readConfigFromValues(
      await projectConfigDefinition(adapter, projectType, targetRootValue),
      values,
      projectRuntimeConfigPathsForTarget(targetRootValue)
    );
    return configResponse({
      adapter,
      config: {
        ...config,
        bootstrap: Boolean(bootstrapConfig)
      },
      projectType
    });
  }

  async function requireProjectConfigForAdapter(adapter, projectType, input = {}) {
    const config = await readProjectConfigForAdapter(adapter, projectType, input);
    if (config.ready !== true) {
      const error = new Error("Save Vibe64 project configuration before using project tools.");
      error.code = "vibe64_project_config_missing";
      error.projectConfig = config;
      throw error;
    }
    return config;
  }

  async function readProjectConfigState(input = {}) {
    if (!currentTargetRoot()) {
      return noProjectSelectedConfigState();
    }
    const { adapter, projectType } = await createProjectAdapter(input);
    return readProjectConfigForAdapter(adapter, projectType, input);
  }

  async function currentProjectConfigStateForEnvironment() {
    const projectType = await readProjectTypeState();
    if (!projectType.ready) {
      return {
        projectConfig: null,
        projectType
      };
    }
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return {
      adapter,
      projectConfig: await readProjectConfigForAdapter(adapter, projectType),
      projectType
    };
  }

  async function projectConfigEnvironmentState() {
    if (!currentTargetRoot()) {
      return {};
    }
    const {
      projectConfigStore
    } = await projectStores();
    const baseEnvironment = await projectConfigStore.environment();
    const context = await currentProjectConfigStateForEnvironment();
    const extraEnvironments = await Promise.all(
      (Array.isArray(projectConfigEnvironmentResolvers) ? projectConfigEnvironmentResolvers : [])
        .filter((resolver) => typeof resolver === "function")
        .map((resolver) => resolver({
          ...context,
          targetRoot: currentTargetRoot()
        }))
    );
    return Object.assign(
      {},
      baseEnvironment,
      ...extraEnvironments.filter((environment) => environment && typeof environment === "object" && !Array.isArray(environment))
    );
  }

  async function projectRuntimeConfigState(input = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return resolveRuntimeConfig(null, input);
    }
    const context = await currentProjectConfigStateForEnvironment();
    const projectEnvironment = await projectConfigEnvironmentState();
    const userValues = await readRuntimeConfigUserValues({
      projectLocalRoot: projectLocalRoot(targetRootValue)
    });
    const profile = context.adapter && typeof context.adapter.getRuntimeConfigProfile === "function"
      ? await context.adapter.getRuntimeConfigProfile({
          ...context,
          projectEnvironment,
          targetRoot: targetRootValue
        })
      : null;
    return resolveRuntimeConfig(profile, {
      ...context,
      phase: input.phase,
      phases: input.phases,
      projectEnvironment,
      records: userValues.records,
      scope: input.scope,
      targetRoot: targetRootValue
    });
  }

  async function activeRuntimeConfigSessionSources(targetRootValue = currentTargetRoot()) {
    const sessionsRoot = path.join(projectLocalRoot(targetRootValue), "sessions", "active");
    let entries = [];
    try {
      entries = await readdir(sessionsRoot, {
        withFileTypes: true
      });
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return [];
      }
      throw error;
    }
    const sources = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const resolvedSourcePath = path.join(sessionsRoot, entry.name, "source");
      if (await pathExists(resolvedSourcePath)) {
        sources.push({
          path: resolvedSourcePath,
          sessionId: entry.name
        });
      }
    }
    return sources.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async function runtimeConfigMaterializationRoots(input = {}, {
    includeActiveSessionSources = false
  } = {}) {
    const roots = [];
    const targetRootValue = String(input.targetRoot || currentTargetRoot() || "").trim();
    if (
      targetRootValue &&
      !targetRootIsProjectHome(targetRootValue) &&
      await pathExists(targetRootValue)
    ) {
      roots.push(targetRootValue);
    }
    const sourcePath = String(input.sourcePath || "").trim();
    if (sourcePath && await pathExists(sourcePath)) {
      roots.push(sourcePath);
    }
    if (includeActiveSessionSources && targetRootValue) {
      roots.push(...(await activeRuntimeConfigSessionSources(targetRootValue)).map((source) => source.path));
    }
    return roots;
  }

  async function materializeProjectRuntimeConfig(input = {}) {
    const config = input.config || await projectRuntimeConfigState(input);
    const roots = await runtimeConfigMaterializationRoots(input, {
      includeActiveSessionSources: input.syncActiveSessionSources === true
    });
    if (!roots.length) {
      return [];
    }
    return materializeRuntimeConfig(config, {
      roots,
      scope: config.scope
    });
  }

  async function runtimeConfigMaterializationStatus(config = {}) {
    const targetRootValue = currentTargetRoot();
    const materializers = Array.isArray(config.materializers) ? config.materializers : [];
    const expectedByPath = new Map(materializers.map((materializer) => [
      materializer.path,
      runtimeConfigExpectedMaterializerText(config, materializer)
    ]));
    const targetRootStatus = targetRootValue && !targetRootIsProjectHome(targetRootValue)
      ? [await runtimeConfigRootStatus({
          expectedByPath,
          label: "Project root",
          root: targetRootValue,
          rootKind: "project-root",
          scope: config.scope
        })]
      : [];
    const activeSessionSourceStatuses = await Promise.all((await activeRuntimeConfigSessionSources(targetRootValue))
      .map((source) => runtimeConfigRootStatus({
        expectedByPath,
        label: source.sessionId,
        root: source.path,
        rootKind: "session-source",
        scope: config.scope,
        sessionId: source.sessionId
      })));
    const roots = [
      ...targetRootStatus,
      ...activeSessionSourceStatuses
    ];
    const generatedTimes = roots
      .flatMap((root) => root.targets)
      .map((target) => target.generatedAt)
      .filter(Boolean)
      .sort();
    return {
      activeSessionSources: activeSessionSourceStatuses,
      lastGeneratedAt: generatedTimes.at(-1) || "",
      roots,
      synced: roots.every((root) => root.synced)
    };
  }

  function runtimeConfigExpectedMaterializerText(config = {}, materializer = {}) {
    if ((materializer.format || "dotenv") === "dotenv") {
      return dotenvText(config.records, {
        scope: config.scope
      });
    }
    return "";
  }

  async function runtimeConfigRootStatus({
    expectedByPath = new Map(),
    label = "",
    root = "",
    rootKind = "",
    scope = "dev",
    sessionId = ""
  } = {}) {
    const targets = await Promise.all([...expectedByPath.entries()].map(async ([relativePath, expectedText]) => {
      return runtimeConfigTargetStatus({
        expectedText,
        path: path.join(root, relativePath),
        relativePath
      });
    }));
    return {
      label,
      path: root,
      rootKind,
      scope,
      sessionId,
      synced: targets.every((target) => target.status === "synced"),
      targets
    };
  }

  async function runtimeConfigTargetStatus({
    expectedText = "",
    path: targetPath = "",
    relativePath = ""
  } = {}) {
    let text = "";
    let fileStat = null;
    try {
      [text, fileStat] = await Promise.all([
        readFile(targetPath, "utf8"),
        stat(targetPath)
      ]);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return {
          exists: false,
          generated: false,
          generatedAt: "",
          path: targetPath,
          relativePath,
          status: "missing",
          synced: false
        };
      }
      throw error;
    }
    const generated = generatedRuntimeConfigHeaderPresent(text);
    const synced = generated && text === expectedText;
    return {
      exists: true,
      generated,
      generatedAt: generated ? fileStat.mtime.toISOString() : "",
      path: targetPath,
      relativePath,
      status: synced ? "synced" : generated ? "stale" : "unmanaged",
      synced
    };
  }

  function publicRuntimeConfigState(config = {}, {
    materialization = [],
    sync = null
  } = {}) {
    return {
      adapterId: config.adapterId || "",
      generatedTargets: config.view?.generatedTargets || [],
      lastGeneratedAt: sync?.lastGeneratedAt || "",
      materialization,
      missing: Array.isArray(config.missing) ? config.missing : [],
      ok: config.ok === true,
      phases: Array.isArray(config.phases) ? config.phases : [],
      scope: config.scope || "dev",
      sync: sync || {
        activeSessionSources: [],
        lastGeneratedAt: "",
        roots: [],
        synced: false
      },
      view: config.view || {
        generatedTargets: [],
        records: [],
        scope: config.scope || "dev"
      }
    };
  }

  async function readRuntimeConfigState(input = {}) {
    const config = await projectRuntimeConfigState(input);
    const sync = await runtimeConfigMaterializationStatus(config);
    return {
      runtimeConfig: publicRuntimeConfigState(config, {
        sync
      }),
      ok: true
    };
  }

  async function saveRuntimeConfigUserValuesState(input = {}) {
    const targetRootValue = requireSelectedTargetRoot();
    await assertRuntimeConfigUserValuesEditable(input);
    await saveRuntimeConfigUserValues({
      projectLocalRoot: projectLocalRoot(targetRootValue),
      scope: input.scope,
      values: input.values || {}
    });
    const config = await projectRuntimeConfigState({
      scope: input.scope
    });
    const materialization = await materializeProjectRuntimeConfig({
      config,
      syncActiveSessionSources: true
    });
    const sync = await runtimeConfigMaterializationStatus(config);
    return {
      runtimeConfig: publicRuntimeConfigState(config, {
        materialization,
        sync
      }),
      materialization,
      ok: true
    };
  }

  async function assertRuntimeConfigUserValuesEditable(input = {}) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : {};
    if (Object.keys(values).length === 0) {
      return;
    }
    const config = await projectRuntimeConfigState({
      scope: input.scope
    });
    const recordsByKey = new Map(config.records
      .filter((record) => record.scope === config.scope)
      .map((record) => [record.key, record]));
    for (const [key, value] of Object.entries(values)) {
      const normalizedKey = normalizeRuntimeConfigKey(key);
      if (value && typeof value === "object" && !Array.isArray(value) && value.remove === true) {
        continue;
      }
      const existingRecord = recordsByKey.get(normalizedKey);
      if (existingRecord && existingRecord.owner !== RUNTIME_CONFIG_OWNERS.USER) {
        const error = new Error(`${normalizedKey} is managed by Vibe64 and cannot be edited as a user runtime config value.`);
        error.code = "vibe64_runtime_config_value_not_editable";
        error.key = normalizedKey;
        error.owner = existingRecord.owner;
        throw error;
      }
    }
  }

  async function materializeRuntimeConfigState(input = {}) {
    const config = await projectRuntimeConfigState(input);
    const materialization = await materializeProjectRuntimeConfig({
      ...input,
      config,
      syncActiveSessionSources: input.syncActiveSessionSources !== false
    });
    const sync = await runtimeConfigMaterializationStatus(config);
    return {
      runtimeConfig: publicRuntimeConfigState(config, {
        materialization,
        sync
      }),
      materialization,
      ok: true
    };
  }

  async function projectRuntimeConfigEnvironmentState(input = {}) {
    const config = await projectRuntimeConfigState(input);
    assertRuntimeConfigReady(config);
    if (input.materialize !== false) {
      await materializeProjectRuntimeConfig({
        ...input,
        config
      });
    }
    return runtimeConfigEnv(config.records, {
      scope: config.scope
    });
  }

  function assertRuntimeConfigReady(config = {}) {
    const missing = Array.isArray(config.missing) ? config.missing : [];
    if (!missing.length) {
      return;
    }
    const scope = config.scope || "dev";
    const phases = Array.isArray(config.phases) && config.phases.length
      ? config.phases.join(", ")
      : "runtime";
    const keys = missing.map((entry) => entry.key).join(", ");
    const error = new Error(`Runtime config is missing required ${scope} value(s) for ${phases}: ${keys}.`);
    error.code = "vibe64_runtime_config_missing";
    error.missing = missing;
    error.scope = scope;
    error.phases = config.phases || [];
    throw error;
  }

  async function readProjectConfigDefaultsState(input = {}) {
    const { adapter, projectType } = await createProjectAdapter(input);
    let projectConfigStore = {
      configRoot: "",
      helperPath: "",
      runtimeRoot: ""
    };
    let resolvedSourceRoot = currentSourceRoot() || currentTargetRoot();
    try {
      ({
        projectConfigStore,
        resolvedSourceRoot
      } = await projectStores(input));
    } catch (error) {
      if (!projectSourceUnavailableError(error)) {
        throw error;
      }
      projectConfigStore = {
        configRoot: "",
        ...projectRuntimeConfigPathsForTarget(currentTargetRoot())
      };
      resolvedSourceRoot = currentTargetRoot();
    }
    const config = normalizeConfigDefinition(await projectConfigDefinition(adapter, projectType, resolvedSourceRoot));
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
    let writableStores = null;
    try {
      writableStores = await projectStores(input, {
        requireWritableSource: true
      });
    } catch (error) {
      if (!projectSourceUnavailableError(error) || !targetRootIsProjectHome()) {
        throw error;
      }
      return saveBootstrapProjectConfigState(input);
    }
    const { adapter, projectType } = await createProjectAdapter(input);
    const {
      projectTypeStore,
      projectConfigStore,
      resolvedSourceRoot,
      resolvedTargetRoot
    } = writableStores;
    const config = await projectConfigStore.saveConfig({
      definition: await projectConfigDefinition(adapter, projectType, resolvedSourceRoot),
      values: input?.values || {}
    });
    if (projectType.draft === true) {
      await projectTypeStore.writeProjectType(projectType.projectType);
    }
    const response = configResponse({
      adapter,
      config,
      projectType
    });
    const hookResults = await runProjectConfigSavedHooks({
      adapter,
      hooks: projectConfigSavedHooks,
      projectConfig: response,
      projectType,
      targetRoot: resolvedSourceRoot || resolvedTargetRoot
    });
    return hookResults.length
      ? {
          ...response,
          sync: hookResults
        }
      : response;
  }

  async function saveBootstrapProjectConfigState(input = {}) {
    const { adapter, projectType } = await createProjectAdapter(input);
    const targetRootValue = currentTargetRoot();
    const definition = await projectConfigDefinition(adapter, projectType, targetRootValue);
    const values = configValuesFromInput(definition, input?.values || {});
    await saveProjectBootstrapConfig({
      onlineProjectRecordPath: onlineProjectRecordPath(targetRootValue),
      projectType: projectType.projectType,
      values
    });
    const config = readConfigFromValues(definition, values, projectRuntimeConfigPathsForTarget(targetRootValue));
    return configResponse({
      adapter,
      config: {
        ...config,
        bootstrap: true
      },
      projectType: {
        ...projectType,
        bootstrap: true
      }
    });
  }

  function runtimeSetupOptionalError(error) {
    return new Set([
      "vibe64_project_config_missing",
      "vibe64_project_config_session_required",
      "vibe64_project_config_source_missing",
      "vibe64_project_config_source_required",
      "vibe64_project_type_invalid",
      "vibe64_project_type_missing",
      "vibe64_project_type_unimplemented",
      "vibe64_unknown_project_type"
    ]).has(String(error?.code || "").trim());
  }

  async function createRuntime(options = {}) {
    const targetRootValue = requireSelectedTargetRoot();
    const runtimeInput = options?.input && typeof options.input === "object" && !Array.isArray(options.input)
      ? options.input
      : options;
    const setupRequired = options?.sourceSetupRequired !== false;
    let adapter = undefined;
    let projectConfig = {};
    let resolvedSourceRoot = currentSourceRoot();
    try {
      const projectAdapter = await createProjectAdapter(runtimeInput);
      adapter = projectAdapter.adapter;
      projectConfig = await requireProjectConfigForAdapter(adapter, projectAdapter.projectType, runtimeInput);
      resolvedSourceRoot = projectAdapter.projectType.sourceRoot || currentSourceRoot() || targetRootValue;
    } catch (error) {
      if (setupRequired || !runtimeSetupOptionalError(error)) {
        throw error;
      }
      resolvedSourceRoot = currentSourceRoot() || targetRootValue;
    }
    const resolvedProjectRuntimeRoot = projectRuntimeRoot(targetRootValue);
    const resolvedProjectSharedRoot = resolvedSourceRoot && !(resolvedSourceRoot === targetRootValue && targetRootIsProjectHome(targetRootValue))
      ? sourceConfigRoot(resolvedSourceRoot)
      : "";
    return new Vibe64SessionRuntime({
      actionReadiness: options.actionReadiness,
      adapter,
      projectConfig,
      projectLocalRoot: resolvedProjectRuntimeRoot,
      onlineProjectRecordPath: onlineProjectRecordPath(targetRootValue),
      projectSharedRoot: resolvedProjectSharedRoot,
      targetRoot: resolvedSourceRoot,
      workflowRegistry
    });
  }

  return Object.freeze({
    currentTargetRoot() {
      return currentTargetRoot();
    },

    currentProjectStateRoot() {
      return projectStateRoot();
    },

    currentProjectLocalRoot() {
      return projectLocalRoot();
    },

    currentProjectRuntimeRoot() {
      return projectRuntimeRoot();
    },

    currentProjectSourceRoot() {
      return currentSourceRoot();
    },

    currentProjectSourceConfigRoot() {
      return sourceConfigRoot();
    },

    get targetRoot() {
      return currentTargetRoot();
    },

    get selectedProject() {
      return studioProjectContext.selectedProject;
    },

    async createProject(input = {}) {
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return projectCatalogUnavailable();
      }
      return projectResult(() => studioProjectContext.createWorkspaceProject(input));
    },

    async createRuntime(options = {}) {
      return createRuntime(options);
    },

    async readProjectType(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await readProjectTypeState(input)
        };
      });
    },

    async readProjectConfig(input = {}) {
      return projectResult(async () => {
        return {
          config: await readProjectConfigState(input),
          ok: true
        };
      });
    },

    async readProjectConfigDefaults(input = {}) {
      return projectResult(async () => {
        return {
          defaults: await readProjectConfigDefaultsState(input),
          ok: true
        };
      });
    },

    async requireProjectType() {
      return requireProjectType();
    },

    async projectConfigEnvironment() {
      return projectConfigEnvironmentState();
    },

    async projectRuntimeConfig(input = {}) {
      return projectRuntimeConfigState(input);
    },

    async readRuntimeConfig(input = {}) {
      return projectResult(() => readRuntimeConfigState(input));
    },

    async projectRuntimeConfigEnvironment(input = {}) {
      return projectRuntimeConfigEnvironmentState(input);
    },

    async materializeRuntimeConfig(input = {}) {
      return materializeProjectRuntimeConfig(input);
    },

    async materializeRuntimeConfigAction(input = {}) {
      return projectResult(() => materializeRuntimeConfigState(input));
    },

    async saveRuntimeConfigUserValues(input = {}) {
      return projectResult(() => saveRuntimeConfigUserValuesState(input));
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
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return projectCatalogUnavailable();
      }
      return projectResult(() => studioProjectContext.selectWorkspaceProject(input));
    }
  });
}

async function runProjectConfigSavedHooks(context = {}) {
  const hooks = Array.isArray(context.hooks)
    ? context.hooks
    : [];
  const results = await Promise.all(hooks
    .filter((hook) => typeof hook === "function")
    .map(async (hook) => {
      try {
        return await hook(context);
      } catch (error) {
        return {
          code: error?.code || "vibe64_project_config_sync_failed",
          error: String(error?.message || error || "Project config sync failed."),
          ok: false
        };
      }
    }));
  return results.filter(Boolean);
}

function projectCatalogUnavailable() {
  return {
    ok: false,
    errors: [
      {
        code: "vibe64_project_catalog_unavailable",
        message: "Project catalog operations are not available in local editor mode."
      }
    ]
  };
}

export {
  createService,
  resolveVibe64TargetRoot
};
