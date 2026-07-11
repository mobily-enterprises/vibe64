import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server/runtime";
import {
  setupOptionsForRuntimeProfile
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  createCoreProjectToolRegistry
} from "@local/vibe64-runtime/server/coreProjectTools";
import {
  createCoreWorkflowRegistry
} from "@local/vibe64-runtime/server/registerCoreWorkflowModules";
import {
  configValuesFromInput,
  createVibe64CommittedProjectAdapterContext,
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
  RUNTIME_CONFIG_TARGETS,
  RUNTIME_CONFIG_SCOPES,
  dotenvText,
  generatedRuntimeConfigHeaderPresent,
  materializeRuntimeConfig,
  normalizeRuntimeConfigKey,
  readGeneratedRuntimeConfigDotenvUserValues,
  resolveRuntimeConfig,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyIsPublic
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import {
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import {
  buildRuntimeLock,
  runtimePackage,
  writeRuntimeLock
} from "@local/vibe64-core/server/runtimeToolchain";
import {
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  normalizeRepositoryMode,
  normalizeWorkflowRepositoryProfile
} from "@local/vibe64-core/server/projectRepository";
import {
  pendingProjectBootstrapConfig,
  readProjectRecordMetadata,
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
  currentProjectRecordPath,
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  runWithResolvedProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  resolveProjectRuntimeRoot,
  resolveSourceConfigRoot
} from "@local/vibe64-core/server/projectState";
import {
  targetSessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  PROJECT_TEMPLATES,
  applyProjectTemplate as materializeProjectTemplate,
  readProjectTemplates as readAvailableProjectTemplates
} from "./projectTemplates.js";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectSelectionRecord({
  gitCacheRoot = "",
  githubRepository = null,
  projectRecordPath = "",
  projectLocalRoot = "",
  repository = null,
  repositoryMode = "",
  selected = false,
  sourceConfigRoot = "",
  sourceRoot = "",
  runtime = null,
  slug = "",
  workflowRepositoryProfile = "",
  projectRuntimeRoot = "",
  projectRoot = ""
} = {}) {
  const record = {
    external: false,
    gitCacheRoot,
    name: slug,
    projectRecordPath,
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
  if (repository) {
    record.repository = repository;
  }
  if (repositoryMode) {
    record.repositoryMode = repositoryMode;
  }
  if (workflowRepositoryProfile) {
    record.workflowRepositoryProfile = workflowRepositoryProfile;
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
const ENV_CONFIG_VIEW_BASELINE = "baseline";
const ENV_CONFIG_VIEW_SESSION = "session";

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

function projectSelectionSetupMetadata(runtimeProfile = null) {
  const setupOptions = setupOptionsForRuntimeProfile(runtimeProfile);
  return {
    studioSetupEnabled: setupOptions.includeStudioSetup
  };
}

function createService({
  adapterServices = () => ({}),
  adapterSettingsComponentHandlers = {},
  env = process.env,
  projectContext = null,
  projectConfigSavedHooks = [],
  projectTemplates = PROJECT_TEMPLATES,
  projectRuntimeConfigEnvironmentResolvers = [],
  targetRoot = "",
  workflowRegistry = createCoreWorkflowRegistry()
} = {}) {
  const studioProjectContext = projectContext || (String(targetRoot || "").trim()
    ? createStudioProjectContext({
      explicitTargetRoot: targetRoot
    })
    : getStudioProjectContext());
  const adapterRegistry = createVibe64AdapterRegistry();

  function adapterServiceContext(context = {}) {
    const services = typeof adapterServices === "function"
      ? adapterServices(context)
      : adapterServices;
    return services && typeof services === "object" && !Array.isArray(services)
      ? services
      : {};
  }

  function adapterSettingsComponentHandlerRegistry(context = {}) {
    const handlers = typeof adapterSettingsComponentHandlers === "function"
      ? adapterSettingsComponentHandlers(context)
      : adapterSettingsComponentHandlers;
    return handlers && typeof handlers === "object" && !Array.isArray(handlers)
      ? handlers
      : {};
  }

  function currentTargetRoot() {
    return String(currentProjectTargetRoot() || studioProjectContext.targetRoot || "").trim();
  }

  function sourceRootForTargetRoot(targetRootValue = currentTargetRoot()) {
    const resolvedTargetRoot = String(targetRootValue || "").trim();
    if (!resolvedTargetRoot) {
      return "";
    }
    if (typeof studioProjectContext.sourceRootForTarget === "function") {
      return studioProjectContext.sourceRootForTarget(resolvedTargetRoot);
    }
    return resolvedTargetRoot;
  }

  function currentSourceRoot() {
    const requestSourceRoot = currentProjectSourceRoot();
    if (requestSourceRoot) {
      return requestSourceRoot;
    }
    return sourceRootForTargetRoot();
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

  function projectRecordPath(targetRootValue = currentTargetRoot()) {
    const requestRecordPath = currentProjectRecordPath();
    if (requestRecordPath) {
      return requestRecordPath;
    }
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.projectRecordPathForTarget === "function") {
      return studioProjectContext.projectRecordPathForTarget(targetRootValue);
    }
    return "";
  }

  function projectLocalRoot(targetRootValue = currentTargetRoot()) {
    return projectRuntimeRoot(targetRootValue);
  }

  function serviceDataRoot() {
    return String(studioProjectContext.serviceDataRoot || "").trim();
  }

  function projectSessionSourceRoot(targetRootValue = currentTargetRoot()) {
    const requestProjectSessionSourceRoot = currentProjectSessionSourceRoot();
    if (requestProjectSessionSourceRoot) {
      return requestProjectSessionSourceRoot;
    }
    if (targetRootValue && typeof studioProjectContext.projectSessionSourceRootForTarget === "function") {
      return studioProjectContext.projectSessionSourceRootForTarget(targetRootValue);
    }
    return targetRootValue || "";
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

  function projectSourceReadUnavailableError(error) {
    return [
      "vibe64_project_config_source_missing",
      "vibe64_project_config_source_required"
    ].includes(String(error?.code || "").trim());
  }

  function projectSourceConfigReadUnavailableError(error) {
    return projectSourceReadUnavailableError(error) ||
      String(error?.code || "").trim() === "vibe64_project_config_session_required";
  }

  async function bootstrapProjectConfigWritableAfterSourceError(error) {
    if (!targetRootIsProjectHome()) {
      return false;
    }
    if (projectSourceUnavailableError(error)) {
      return true;
    }
    if (String(error?.code || "").trim() !== "vibe64_project_config_source_missing") {
      return false;
    }
    if (error?.explicitSourcePath) {
      return false;
    }
    return Boolean(error?.sessionId || await readProjectBootstrapConfigForTarget(currentTargetRoot()));
  }

  function committedProjectConfigUnavailableError(error) {
    return String(error?.code || "").trim().startsWith("vibe64_committed_project_");
  }

  async function activePreSourceSessionCanUseCommittedConfig(input = {}) {
    const sessionId = normalizeSessionId(input?.sessionId);
    if (!sessionId) {
      return false;
    }
    const runtimeRoot = projectRuntimeRoot(currentTargetRoot());
    if (!runtimeRoot) {
      return false;
    }
    const sessionRoot = path.join(runtimeRoot, "sessions", "active", sessionId);
    if (!await pathExists(sessionRoot)) {
      return false;
    }
    return !await activeSessionSourceRoot(runtimeRoot, sessionId, {
      projectSessionSourceRoot: projectSessionSourceRoot(currentTargetRoot())
    });
  }

  async function projectReadCanUseCommittedConfig(input = {}) {
    if (draftSourcePath(input) || draftProjectType(input)) {
      return false;
    }
    if (!normalizeSessionId(input?.sessionId)) {
      return true;
    }
    return activePreSourceSessionCanUseCommittedConfig(input);
  }

  function committedProjectAdapterContext(targetRootValue = currentTargetRoot(), {
    sourceReadMode = "git",
    sourceRoot = ""
  } = {}) {
    const sourceRootValue = String(sourceRoot || currentSourceRoot() || "").trim();
    return createVibe64CommittedProjectAdapterContext({
      adapterRegistry,
      projectRecordPath: projectRecordPath(targetRootValue),
      projectRuntimeRoot: projectRuntimeRoot(targetRootValue),
      sourceReadMode,
      sourceRoot: sourceRootValue,
      targetRoot: sourceRootValue || targetRootValue
    });
  }

  async function readProjectBootstrapConfigForTarget(targetRootValue = currentTargetRoot()) {
    if (!targetRootValue || !targetRootIsProjectHome(targetRootValue)) {
      return null;
    }
    return pendingProjectBootstrapConfig(await readProjectRecordMetadata(projectRecordPath(targetRootValue)));
  }

  function projectRuntimeConfigPathsForTarget(targetRootValue = currentTargetRoot()) {
    const runtimeRoot = projectRuntimeRoot(targetRootValue);
    return {
      helperPath: runtimeRoot ? path.join(runtimeRoot, "runtime", "vibe64-config.sh") : "",
      localConfigRoot: runtimeRoot ? path.join(runtimeRoot, "runtime-config") : "",
      runtimeRoot: runtimeRoot ? path.join(runtimeRoot, "runtime") : ""
    };
  }

  async function projectRepositoryMode(targetRootValue = currentTargetRoot()) {
    const recordPath = projectRecordPath(targetRootValue);
    if (!recordPath) {
      return "";
    }
    return normalizeRepositoryMode((await readProjectRecordMetadata(recordPath))?.repository?.mode);
  }

  function normalizeEnvConfigView(input = {}) {
    const explicitView = normalizeText(input?.envConfigView || input?.configView || input?.view);
    if (explicitView === ENV_CONFIG_VIEW_BASELINE || explicitView === ENV_CONFIG_VIEW_SESSION) {
      return explicitView;
    }
    return normalizeSessionId(input?.sessionId) || draftSourcePath(input)
      ? ENV_CONFIG_VIEW_SESSION
      : ENV_CONFIG_VIEW_BASELINE;
  }

  async function resolveEnvConfigSource(input = {}) {
    const targetRootValue = currentTargetRoot();
    const view = normalizeEnvConfigView(input);
    if (!targetRootValue) {
      return {
        configSource: "committed",
        label: "Project baseline",
        rootKind: "",
        sourceRoot: "",
        targetRoot: "",
        view: ENV_CONFIG_VIEW_BASELINE
      };
    }

    if (view === ENV_CONFIG_VIEW_SESSION) {
      const sourceRoot = await projectConfigSourceRoot(input);
      return {
        configSource: "session",
        label: "Session draft",
        rootKind: "session-source",
        sessionId: normalizeSessionId(input?.sessionId),
        sourceRoot,
        targetRoot: targetRootValue,
        view
      };
    }

    const selectedSourceRoot = sourceRootForTargetRoot(targetRootValue);
    const repositoryMode = await projectRepositoryMode(targetRootValue);
    const sourceRoot = selectedSourceRoot ||
      (repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE ? targetRootValue : "");
    return {
      configSource: "committed",
      label: "Project baseline",
      repositoryMode,
      rootKind: sourceRoot ? "project-root" : "git-cache",
      sourceReadMode: repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE ? "filesystem" : "git",
      sourceRoot,
      targetRoot: targetRootValue,
      view: ENV_CONFIG_VIEW_BASELINE
    };
  }

  function publicEnvConfigSource(source = {}) {
    return {
      configSource: source.configSource || "committed",
      label: source.label || "Project baseline",
      repositoryMode: source.repositoryMode || "",
      rootKind: source.rootKind || "",
      sessionId: source.sessionId || "",
      sourceReadMode: source.sourceReadMode || "",
      sourceRoot: source.sourceRoot || "",
      targetRoot: source.targetRoot || "",
      view: source.view || ENV_CONFIG_VIEW_BASELINE
    };
  }

  function bootstrapProjectConfigEnvironmentStore(input = {}, targetRootValue = currentTargetRoot()) {
    const sessionId = normalizeSessionId(input?.sessionId);
    const runtimeRoot = projectRuntimeRoot(targetRootValue);
    if (!sessionId || !runtimeRoot) {
      return null;
    }
    const sourceRoot = targetSessionSourcePath(projectSessionSourceRoot(targetRootValue), sessionId);
    return createVibe64ProjectConfigStore({
      projectLocalRoot: runtimeRoot,
      sourceContractRoot: resolveSourceConfigRoot({
        sourceRoot
      }),
      targetRoot: sourceRoot
    });
  }

  async function bootstrapProjectConfigEnvironment(input = {}) {
    const store = bootstrapProjectConfigEnvironmentStore(input);
    return store ? store.environment() : {};
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
      path: projectRecordPath(targetRootValue),
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
        repro: projectSelectionReproMetadata(),
        setup: projectSelectionSetupMetadata(studioProjectContext.runtimeProfile)
      };
    }

    if (typeof studioProjectContext.requestContextMatchesSelectedProject === "function" &&
      studioProjectContext.requestContextMatchesSelectedProject(projectContextValue)) {
      return {
        ...await studioProjectContext.listProjects(),
        repro: projectSelectionReproMetadata(),
        setup: projectSelectionSetupMetadata(studioProjectContext.runtimeProfile)
      };
    }

    const listed = await studioProjectContext.listWorkspaceProjects();
    const currentCatalogProject = listed.projects.find((project) => project.slug === projectContextValue.slug) || null;
    const currentProject = projectSelectionRecord({
      gitCacheRoot: currentCatalogProject?.gitCacheRoot || "",
      githubRepository: currentCatalogProject?.githubRepository || null,
      projectRecordPath: projectContextValue.projectRecordPath || currentCatalogProject?.projectRecordPath || "",
      projectLocalRoot: projectContextValue.projectLocalRoot || currentCatalogProject?.projectLocalRoot || "",
      projectRuntimeRoot: projectContextValue.projectRuntimeRoot || currentCatalogProject?.projectRuntimeRoot || "",
      repository: currentCatalogProject?.repository || null,
      repositoryMode: currentCatalogProject?.repositoryMode || "",
      runtime: currentCatalogProject?.runtime || null,
      selected: true,
      sourceConfigRoot: projectContextValue.sourceConfigRoot || currentCatalogProject?.sourceConfigRoot || "",
      sourceRoot: projectContextValue.sourceRoot || currentCatalogProject?.sourceRoot || "",
      slug: projectContextValue.slug,
      workflowRepositoryProfile: currentCatalogProject?.workflowRepositoryProfile || "",
      projectRoot: projectContextValue.targetRoot
    });
    const projects = listed.projects
      .map((project) => projectSelectionRecord({
        gitCacheRoot: project.gitCacheRoot,
        githubRepository: project.githubRepository,
        projectRecordPath: project.projectRecordPath,
        projectLocalRoot: project.projectLocalRoot,
        projectRuntimeRoot: project.projectRuntimeRoot,
        repository: project.repository,
        repositoryMode: project.repositoryMode,
        runtime: project.runtime,
        selected: project.slug === projectContextValue.slug,
        sourceConfigRoot: project.sourceConfigRoot,
        sourceRoot: project.sourceRoot,
        slug: project.slug,
        workflowRepositoryProfile: project.workflowRepositoryProfile,
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
      setup: projectSelectionSetupMetadata(studioProjectContext.runtimeProfile),
      targetRoot: projectContextValue.targetRoot
    };
  }

  async function currentProjectTemplateContext(input = {}) {
    const selection = await listProjectSelectionState();
    return {
      env,
      input,
      project: selection.currentProject || null,
      projectRuntimeRoot: projectRuntimeRoot(),
      sourceRoot: currentSourceRoot(),
      targetRoot: currentTargetRoot(),
      templates: projectTemplates
    };
  }

  async function readProjectTemplatesState(input = {}) {
    return readAvailableProjectTemplates(await currentProjectTemplateContext(input));
  }

  async function applyProjectTemplateState(templateId = "", input = {}) {
    return materializeProjectTemplate({
      ...await currentProjectTemplateContext(input),
      templateId
    });
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

  async function assertSourcePathTargetsSessionSource(sourcePath = "", {
    projectRuntimeRoot: projectRuntimeRootValue = "",
    projectSessionSourceRoot: projectSessionSourceRootValue = "",
    sessionId = ""
  } = {}) {
    const normalizedSourcePath = path.resolve(sourcePath);
    const normalizedRuntimeRoot = String(projectRuntimeRootValue || "").trim()
      ? path.resolve(projectRuntimeRootValue)
      : "";
    if (!normalizedRuntimeRoot) {
      return normalizedSourcePath;
    }
    const normalizedProjectSessionSourceRoot = String(projectSessionSourceRootValue || "").trim()
      ? path.resolve(projectSessionSourceRootValue)
      : "";
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (normalizedSessionId) {
      const expectedSourcePath = normalizedProjectSessionSourceRoot
        ? targetSessionSourcePath(normalizedProjectSessionSourceRoot, normalizedSessionId)
        : "";
      if (!expectedSourcePath || normalizedSourcePath !== path.resolve(expectedSourcePath)) {
        const error = new Error("Project config sourcePath must be the selected session source.");
        error.code = "vibe64_project_config_source_outside_session";
        throw error;
      }
      return normalizedSourcePath;
    }
    if (normalizedProjectSessionSourceRoot) {
      const activeSessionsRoot = path.join(normalizedProjectSessionSourceRoot, "sessions", "active");
      const managedRelative = path.relative(activeSessionsRoot, normalizedSourcePath);
      const managedParts = managedRelative.split(path.sep).filter(Boolean);
      if (
        managedRelative &&
        !managedRelative.startsWith("..") &&
        !path.isAbsolute(managedRelative) &&
        managedParts.length === 2 &&
        managedParts[1] === "source"
      ) {
        return normalizedSourcePath;
      }
    }
    {
      const error = new Error("Project config sourcePath must point at an active session source.");
      error.code = "vibe64_project_config_source_outside_session";
      throw error;
    }
  }

  async function activeSessionMetadataValue(sessionRoot = "", name = "") {
    try {
      return String(await readFile(path.join(sessionRoot, "metadata", name), "utf8") || "").trim();
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return "";
      }
      throw error;
    }
  }

  async function activeSessionSourceRoot(projectRuntimeRootValue = "", sessionId = "", {
    projectSessionSourceRoot: projectSessionSourceRootValue = ""
  } = {}) {
    const sessionRoot = path.join(projectRuntimeRootValue, "sessions", "active", sessionId);
    const explicitSourcePath = await activeSessionMetadataValue(sessionRoot, "source_path");
    if (explicitSourcePath && await pathExists(explicitSourcePath)) {
      return path.resolve(explicitSourcePath);
    }
    const sourcePath = targetSessionSourcePath(projectSessionSourceRootValue, sessionId);
    return sourcePath && await pathExists(sourcePath) ? sourcePath : "";
  }

  async function singleActiveSessionSourceRoot(projectRuntimeRootValue = "", {
    projectSessionSourceRoot: projectSessionSourceRootValue = ""
  } = {}) {
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
      const sourcePath = await activeSessionSourceRoot(projectRuntimeRootValue, entry.name, {
        projectSessionSourceRoot: projectSessionSourceRootValue
      });
      if (sourcePath) {
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
    allowMissingSessionSource = false,
    requireWritable = false
  } = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return "";
    }
    const runtimeRoot = projectRuntimeRoot(targetRootValue);
    const sessionSourceRoot = projectSessionSourceRoot(targetRootValue);
    const requestedSourcePath = draftSourcePath(input);
    const requestedSessionId = normalizeSessionId(input?.sessionId);
    if (requestedSourcePath) {
      const resolvedSourcePath = path.resolve(requestedSourcePath);
      if (targetRootIsProjectHome(targetRootValue) || requestedSessionId) {
        const containedSourcePath = await assertSourcePathTargetsSessionSource(resolvedSourcePath, {
          projectRuntimeRoot: runtimeRoot,
          projectSessionSourceRoot: sessionSourceRoot,
          sessionId: requestedSessionId
        });
        if (requireWritable && !await pathExists(containedSourcePath)) {
          const error = new Error("Project config sourcePath does not exist.");
          error.code = "vibe64_project_config_source_missing";
          error.explicitSourcePath = true;
          error.sessionId = requestedSessionId;
          error.sourcePath = containedSourcePath;
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
        error.explicitSourcePath = true;
        error.sourcePath = resolvedSourcePath;
        throw error;
      }
      return resolvedSourcePath;
    }
    if (requestedSessionId) {
      const existingSourcePath = await activeSessionSourceRoot(runtimeRoot, requestedSessionId, {
        projectSessionSourceRoot: sessionSourceRoot
      });
      if (existingSourcePath) {
        return existingSourcePath;
      }
      const selectedProjectSourceRoot = sourceRootForTargetRoot(targetRootValue);
      if (!requireWritable && selectedProjectSourceRoot && await pathExists(selectedProjectSourceRoot)) {
        return selectedProjectSourceRoot;
      }
      const sourcePath = targetSessionSourcePath(sessionSourceRoot, requestedSessionId);
      if (!requireWritable && allowMissingSessionSource && sourcePath) {
        return sourcePath;
      }
      const error = new Error(`Active session source does not exist: ${requestedSessionId}.`);
      error.code = "vibe64_project_config_source_missing";
      error.sessionId = requestedSessionId;
      error.sourcePath = sourcePath;
      throw error;
    }
    const selectedSourceRoot = currentSourceRoot();
    if (selectedSourceRoot) {
      return selectedSourceRoot;
    }
    const activeSourceRoot = await singleActiveSessionSourceRoot(runtimeRoot, {
      projectSessionSourceRoot: sessionSourceRoot
    });
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
    allowMissingSessionSource = false,
    requireWritableSource = false
  } = {}) {
    const targetRootValue = currentTargetRoot() || requireSelectedTargetRoot();
    const resolvedTargetRoot = resolveVibe64TargetRoot(targetRootValue);
    const resolvedSourceRoot = await projectConfigSourceRoot(input, {
      allowMissingSessionSource,
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
        sourceContractRoot: resolvedSourceConfigRoot,
        targetRoot: resolvedSourceRoot
      }),
      projectTypeStore: createVibe64ProjectTypeStore({
        sourceContractRoot: resolvedSourceConfigRoot,
        targetRoot: resolvedSourceRoot
      }),
      resolvedProjectLocalRoot: resolvedProjectRuntimeRoot,
      resolvedProjectRuntimeRoot,
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

  function unavailableCommittedProjectTypeState(error = {}, {
    envConfigSource = null
  } = {}) {
    const status = String(error?.code || "") === "vibe64_committed_project_type_missing"
      ? "missing"
      : "unavailable";
    return {
      adapter: null,
      availableApplicationTypes: adapterRegistry.availableApplicationTypes(),
      availableProjectTypes: adapterRegistry.availableProjectTypes(),
      committed: true,
      errorCode: error?.code || "vibe64_committed_project_config_unavailable",
      message: String(error?.message || "Committed Vibe64 project config is unavailable."),
      path: "",
      projectType: "",
      ready: false,
      sourceRoot: envConfigSource?.sourceRoot || currentSourceRoot(),
      status,
      targetRoot: currentTargetRoot()
    };
  }

  async function readCommittedProjectTypeState(input = {}, {
    envConfigSource = null
  } = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return noProjectSelectedTypeState();
    }
    const resolvedSource = envConfigSource || await resolveEnvConfigSource({
      ...input,
      envConfigView: ENV_CONFIG_VIEW_BASELINE
    });
    try {
      return (await committedProjectAdapterContext(targetRootValue, {
        sourceReadMode: resolvedSource.sourceReadMode,
        sourceRoot: resolvedSource.sourceRoot
      }).readProjectType()).projectType;
    } catch (error) {
      if (!committedProjectConfigUnavailableError(error)) {
        throw error;
      }
      return unavailableCommittedProjectTypeState(error, {
        envConfigSource: resolvedSource
      });
    }
  }

  async function readCommittedProjectTypeStateForSetup(input = {}, {
    allowDraftProjectType = false
  } = {}) {
    if (draftSourcePath(input)) {
      return null;
    }
    if (draftProjectType(input) && !allowDraftProjectType) {
      return null;
    }
    const sessionId = normalizeSessionId(input?.sessionId);
    if (sessionId && !await activePreSourceSessionCanUseCommittedConfig(input)) {
      return null;
    }
    const projectType = await readCommittedProjectTypeState(input);
    return projectType.ready === true ? projectType : null;
  }

  async function resolveProjectSetupState(input = {}, {
    allowDraftProjectTypeForCommitted = false,
    preferBootstrapForSession = false,
    sourceError = null
  } = {}) {
    if (sourceError && !projectSourceConfigReadUnavailableError(sourceError)) {
      throw sourceError;
    }
    if (!sourceError) {
      return {
        mode: "source"
      };
    }
    const bootstrapConfig = await readProjectBootstrapConfigForTarget(currentTargetRoot());
    const requestedProjectType = draftProjectType(input);
    const sessionId = normalizeSessionId(input?.sessionId);
    if (
      (preferBootstrapForSession && sessionId) ||
      (requestedProjectType && !allowDraftProjectTypeForCommitted) ||
      (sessionId && bootstrapConfig)
    ) {
      return {
        bootstrapConfig,
        mode: "bootstrap"
      };
    }
    const committedProjectType = await readCommittedProjectTypeStateForSetup(input, {
      allowDraftProjectType: allowDraftProjectTypeForCommitted
    });
    if (committedProjectType) {
      return {
        mode: "committed",
        projectType: committedProjectType
      };
    }
    return {
      bootstrapConfig,
      mode: (bootstrapConfig || requestedProjectType || sessionId) ? "bootstrap" : "missing"
    };
  }

  function committedProjectSetupReadOnlyError(kind = "config", projectType = null) {
    const error = new Error(
      kind === "projectType"
        ? "Project type is committed in the repository. Start a source session before changing it."
        : "Project configuration is committed in the repository. Start a source session before editing it."
    );
    error.code = kind === "projectType"
      ? "vibe64_project_type_committed_read_only"
      : "vibe64_project_config_committed_read_only";
    if (projectType) {
      error.projectType = projectType;
    }
    return error;
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
      const setupState = await resolveProjectSetupState(input, {
        sourceError: error
      });
      if (setupState.mode === "committed") {
        return setupState.projectType;
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
    const projectType = draftProjectType(input);
    adapterRegistry.requireImplementedProjectType(projectType);
    let projectTypeStore = null;
    try {
      ({
        projectTypeStore
      } = await projectStores(input, {
        requireWritableSource: true
      }));
    } catch (error) {
      const setupState = await resolveProjectSetupState(input, {
        allowDraftProjectTypeForCommitted: true,
        preferBootstrapForSession: true,
        sourceError: error
      });
      if (setupState.mode === "committed") {
        if (setupState.projectType?.projectType === projectType) {
          return setupState.projectType;
        }
        throw committedProjectSetupReadOnlyError("projectType", setupState.projectType);
      }
      if (!await bootstrapProjectConfigWritableAfterSourceError(error)) {
        throw error;
      }
      const targetRootValue = currentTargetRoot();
      const existingBootstrap = await readProjectBootstrapConfigForTarget(targetRootValue);
      await saveProjectBootstrapConfig({
        projectRecordPath: projectRecordPath(targetRootValue),
        projectType,
        values: existingBootstrap?.projectType === projectType ? existingBootstrap.values : {}
      });
      return readProjectTypeState(input);
    }
    await projectTypeStore.writeProjectType(projectType);
    return readProjectTypeState(input);
  }

  function draftProjectType(input = {}) {
    return normalizeText(input?.projectType);
  }

  function draftSourcePath(input = {}) {
    return normalizeText(input?.sourcePath);
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
      if (!projectSourceConfigReadUnavailableError(error)) {
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

  function runtimePackageView(entry = {}) {
    if (!entry?.id) {
      return null;
    }
    return {
      family: entry.family || entry.id,
      id: entry.id,
      label: entry.label || entry.id,
      provider: entry.provider || "",
      role: entry.role || "",
      version: entry.version || ""
    };
  }

  function runtimeChoicePackageOption(entry = {}) {
    const view = runtimePackageView(entry);
    if (!view) {
      return null;
    }
    return {
      ...view,
      packageId: view.id,
      value: view.id
    };
  }

  function runtimeChoiceOption(option = {}) {
    const packageEntry = runtimePackage(option.runtimePackageId);
    const packageOption = packageEntry ? runtimeChoicePackageOption(packageEntry) : null;
    return {
      description: option.description || "",
      label: option.label || option.value,
      package: packageOption,
      packageId: packageOption?.packageId || "",
      runtimeUnavailable: option.runtimeUnavailable === true,
      runtimeUnavailableReason: option.runtimeUnavailableReason || "",
      value: option.value
    };
  }

  function fieldHasRuntimeOptions(field = {}) {
    return field.type === "select" &&
      (Array.isArray(field.options) ? field.options : [])
        .some((option) => option.runtimePackageId || option.runtimeUnavailable === true);
  }

  function runtimeFieldChoice(field = {}, config = {}) {
    const options = (Array.isArray(field.options) ? field.options : []).map(runtimeChoiceOption);
    const selectedValue = String(config?.values?.[field.id] ?? config?.defaults?.[field.id] ?? field.defaultValue ?? "");
    const selectedOption = options.find((option) => String(option.value || "") === selectedValue) || null;
    return {
      configFieldId: field.id,
      description: field.description || "",
      id: `config:${field.id}`,
      kind: "config",
      label: field.label || field.id,
      options,
      selectedPackage: selectedOption?.package || null,
      selectedPackageId: selectedOption?.packageId || "",
      selectedValue
    };
  }

  function runtimeToolChoice(entry = {}) {
    const option = runtimeChoicePackageOption(entry);
    if (!option) {
      return null;
    }
    return {
      id: `tool:${entry.id}`,
      kind: "tool",
      label: entry.label || entry.id,
      locked: true,
      options: [option],
      selectedPackage: option,
      selectedPackageId: entry.id,
      selectedValue: entry.id
    };
  }

  function runtimeChoicesForProjectConfig(config = {}, {
    runtimeLock = null
  } = {}) {
    const selected = runtimeLock?.selected || {};
    const toolChoices = (Array.isArray(selected.tools) ? selected.tools : [])
      .map(runtimeToolChoice)
      .filter(Boolean);
    const fieldChoices = (Array.isArray(config.fields) ? config.fields : [])
      .filter(fieldHasRuntimeOptions)
      .map((field) => runtimeFieldChoice(field, config));
    return [
      ...toolChoices,
      ...fieldChoices
    ];
  }

  function runtimeConfigMetadataFromLock(config = {}, runtimeLock = null) {
    const runtimeChoices = runtimeChoicesForProjectConfig(config, {
      runtimeLock
    });
    return {
      runtimeChoices,
      runtimeLock
    };
  }

  async function projectToolContext(input = {}) {
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
    const projectType = await readProjectTypeState(input);
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
    const config = await readProjectConfigForAdapter(adapter, projectType, input);
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

  async function listProjectToolState(input = {}) {
    const context = await projectToolContext(input);
    const registry = await createProjectToolRegistry(context);
    return registry.listTools(context);
  }

  async function prepareProjectToolRunState(toolId = "", input = {}) {
    const context = await projectToolContext(input);
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
      const setupState = await resolveProjectSetupState(input, {
        sourceError: error
      });
      if (setupState.mode === "committed") {
        const committedConfig = await readCommittedProjectConfigForAdapterIfAvailable(adapter, projectType, input);
        if (committedConfig) {
          return committedConfig;
        }
      }
      return readBootstrapProjectConfigForAdapter(adapter, projectType);
    }
    const {
      projectConfigStore,
      resolvedSourceRoot
    } = stores;
    const config = await projectConfigStore.readConfig(await projectConfigDefinition(adapter, projectType, resolvedSourceRoot));
    return configResponseWithRuntime({
      adapter,
      config,
      projectType,
      targetRoot: resolvedSourceRoot
    });
  }

  async function readCommittedProjectConfigForAdapterIfAvailable(adapter, projectType, input = {}) {
    if (!await projectReadCanUseCommittedConfig(input)) {
      return null;
    }
    const resolvedSource = await resolveEnvConfigSource({
      ...input,
      envConfigView: ENV_CONFIG_VIEW_BASELINE
    });
    const context = committedProjectAdapterContext(currentTargetRoot(), {
      sourceReadMode: resolvedSource.sourceReadMode,
      sourceRoot: resolvedSource.sourceRoot
    });
    const committedConfig = await context.readCommittedConfig();
    if (
      committedConfig.available !== true ||
      committedConfig.projectType !== projectType.projectType
    ) {
      return null;
    }
    const projectConfig = await context.readProjectConfigForAdapter(adapter, projectType, committedConfig);
    return {
      ...projectConfig,
      ...await projectConfigRuntimeMetadata({
        adapter,
        projectConfig,
        projectType,
        targetRoot: currentTargetRoot()
      })
    };
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
    return configResponseWithRuntime({
      adapter,
      config: {
        ...config,
        bootstrap: Boolean(bootstrapConfig)
      },
      projectType,
      targetRoot: targetRootValue
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

  async function adapterSettingsContext(input = {}) {
    if (!currentTargetRoot()) {
      return {
        adapter: null,
        projectConfig: noProjectSelectedConfigState(),
        projectType: noProjectSelectedTypeState(),
        ready: false,
        sections: [],
        services: {}
      };
    }
    const { adapter, projectType } = await createProjectAdapter(input);
    const projectConfig = await readProjectConfigForAdapter(adapter, projectType, input);
    const services = adapterServiceContext({
      adapter,
      input,
      projectConfig,
      projectType,
      targetRoot: currentTargetRoot()
    });

    async function saveProjectConfigValues(values = {}) {
      return saveProjectConfigState({
        ...input,
        projectType: projectType.projectType,
        values: {
          ...(projectConfig.values || {}),
          ...(values && typeof values === "object" && !Array.isArray(values) ? values : {})
        }
      });
    }

    return {
      adapter,
      config: projectConfig,
      input,
      projectConfig,
      projectLocalRoot: projectLocalRoot(),
      projectRuntimeRoot: projectRuntimeRoot(),
      projectType,
      ready: projectType.ready === true && projectConfig.ready === true,
      saveProjectConfigValues,
      services,
      sourceConfigRoot: sourceConfigRoot(),
      sourceRoot: currentSourceRoot(),
      targetRoot: currentTargetRoot()
    };
  }

  async function readAdapterSettingsState(input = {}) {
    const context = await adapterSettingsContext(input);
    if (!context.adapter) {
      return {
        adapter: null,
        config: context.projectConfig,
        projectConfig: context.projectConfig,
        projectType: context.projectType,
        sections: []
      };
    }
    const sections = typeof context.adapter.listSettingsSections === "function"
      ? await context.adapter.listSettingsSections(context)
      : [];
    return {
      adapter: {
        id: context.adapter.id,
        label: context.adapter.label
      },
      config: context.projectConfig,
      projectConfig: context.projectConfig,
      projectType: context.projectType,
      sections
    };
  }

  async function adapterSettingsActionContext(input = {}) {
    const context = await adapterSettingsContext(input);
    if (!context.adapter) {
      const error = new Error(context.projectType.message || "Choose a project before using adapter settings.");
      error.code = context.projectType.errorCode || "vibe64_project_not_selected";
      throw error;
    }
    return context;
  }

  async function adapterSettingsComponentContext(componentId = "", input = {}) {
    const context = await adapterSettingsActionContext(input);
    const sections = typeof context.adapter.listSettingsSections === "function"
      ? await context.adapter.listSettingsSections(context)
      : [];
    const normalizedComponentId = normalizeText(componentId);
    const component = sections
      .flatMap((section) => Array.isArray(section.components) ? section.components : [])
      .find((candidate) => candidate.id === normalizedComponentId || candidate.component === normalizedComponentId);
    if (!component) {
      const error = new Error(`Adapter settings component is not available: ${normalizedComponentId || "(empty)"}`);
      error.code = "vibe64_adapter_settings_component_missing";
      throw error;
    }
    const handlers = adapterSettingsComponentHandlerRegistry({
      ...context,
      component
    });
    const handler = handlers[component.id] || handlers[component.component] || null;
    if (!handler) {
      const error = new Error(`Adapter settings component is not wired: ${component.id}.`);
      error.code = "vibe64_adapter_settings_component_unwired";
      throw error;
    }
    return {
      ...context,
      component,
      handler,
      sections
    };
  }

  function adapterSettingsComponentOperationMethod(operation = "") {
    return {
      connect: "connect",
      disconnect: "disconnect",
      "smtp-login": "saveSmtpLogin",
      "smtp-login/disconnect": "disconnectSmtpLogin",
      setup: "setup",
      sync: "sync"
    }[normalizeText(operation)] || normalizeText(operation);
  }

  async function readAdapterSettingsComponentState(componentId = "", input = {}) {
    const context = await adapterSettingsComponentContext(componentId, input);
    if (typeof context.handler.read === "function") {
      return context.handler.read(input, context);
    }
    if (typeof context.handler.getStatus === "function") {
      return context.handler.getStatus(input, context);
    }
    const error = new Error(`Adapter settings component cannot be read: ${context.component.id}.`);
    error.code = "vibe64_adapter_settings_component_read_unavailable";
    throw error;
  }

  async function runAdapterSettingsComponentOperationState(componentId = "", operation = "", input = {}) {
    const context = await adapterSettingsComponentContext(componentId, input);
    const method = adapterSettingsComponentOperationMethod(operation);
    let result = null;
    if (typeof context.handler.run === "function") {
      result = await context.handler.run(operation, input, context);
    } else if (method && typeof context.handler[method] === "function") {
      result = await context.handler[method](input, context);
    } else {
      const error = new Error(`Adapter settings component operation is not available: ${operation || "(empty)"}.`);
      error.code = "vibe64_adapter_settings_component_operation_missing";
      throw error;
    }
    const saveValues = context.component.saveValuesOnSuccess?.[normalizeText(operation)] || null;
    if (
      saveValues &&
      typeof saveValues === "object" &&
      !Array.isArray(saveValues) &&
      result?.ok !== false
    ) {
      return {
        ...result,
        config: await context.saveProjectConfigValues(saveValues)
      };
    }
    return result;
  }

  async function startAdapterSettingsActionState(actionId = "", input = {}) {
    const context = await adapterSettingsActionContext(input);
    return context.adapter.startSettingsAction(actionId, context);
  }

  async function submitAdapterSettingsActionState(actionId = "", stepId = "", input = {}) {
    const context = await adapterSettingsActionContext(input);
    return context.adapter.submitSettingsAction(actionId, stepId, input?.payload || {}, context);
  }

  async function adapterSettingsActionStatusState(actionId = "", input = {}) {
    const context = await adapterSettingsActionContext(input);
    return context.adapter.settingsActionStatus(actionId, context);
  }

  async function cancelAdapterSettingsActionState(actionId = "", input = {}) {
    const context = await adapterSettingsActionContext(input);
    return context.adapter.cancelSettingsAction(actionId, context);
  }

  async function currentProjectConfigStateForEnvironment(input = {}) {
    const projectType = await readProjectTypeState(input);
    if (!projectType.ready) {
      return {
        projectConfig: null,
        projectType
      };
    }
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return {
      adapter,
      projectConfig: await readProjectConfigForAdapter(adapter, projectType, input),
      projectType
    };
  }

  async function currentCommittedProjectConfigStateForEnvironment(input = {}, {
    envConfigSource = null
  } = {}) {
    const resolvedSource = envConfigSource || await resolveEnvConfigSource({
      ...input,
      envConfigView: ENV_CONFIG_VIEW_BASELINE
    });
    const projectType = await readCommittedProjectTypeState(input, {
      envConfigSource: resolvedSource
    });
    if (!projectType.ready) {
      return {
        adapter: null,
        envConfigSource: resolvedSource,
        projectConfig: null,
        projectType
      };
    }
    const context = committedProjectAdapterContext(currentTargetRoot(), {
      sourceReadMode: resolvedSource.sourceReadMode,
      sourceRoot: resolvedSource.sourceRoot
    });
    const {
      adapter,
      committedConfig,
      projectType: committedProjectType
    } = await context.createAdapter();
    return {
      adapter,
      envConfigSource: resolvedSource,
      projectConfig: await context.readProjectConfigForAdapter(adapter, committedProjectType, committedConfig),
      projectType: committedProjectType
    };
  }

  async function projectConfigEnvironmentState(input = {}) {
    if (!currentTargetRoot()) {
      return {};
    }
    let baseEnvironment = {};
    const bootstrapConfig = await readProjectBootstrapConfigForTarget(currentTargetRoot());
    try {
      const {
        projectConfigStore
      } = await projectStores(input, {
        allowMissingSessionSource: Boolean(bootstrapConfig)
      });
      baseEnvironment = await projectConfigStore.environment();
    } catch (error) {
      if (projectSourceReadUnavailableError(error) && bootstrapConfig) {
        baseEnvironment = await bootstrapProjectConfigEnvironment(input);
      } else if (projectSourceReadUnavailableError(error) && await projectReadCanUseCommittedConfig(input)) {
        baseEnvironment = await committedProjectConfigEnvironmentState(
          await currentCommittedProjectConfigStateForEnvironment(input)
        );
      } else {
        throw error;
      }
    }
    return baseEnvironment;
  }

  function projectConfigSelectionInputForRuntimeConfig(input = {}) {
    const selection = {};
    const projectType = draftProjectType(input);
    const sessionId = normalizeSessionId(input?.sessionId);
    const sourcePath = draftSourcePath(input);
    if (projectType) {
      selection.projectType = projectType;
    }
    if (sessionId) {
      selection.sessionId = sessionId;
    }
    if (sourcePath) {
      const selectedSourceRoot = currentSourceRoot();
      if (
        targetRootIsProjectHome() ||
        !selectedSourceRoot ||
        path.resolve(selectedSourceRoot) === path.resolve(sourcePath)
      ) {
        selection.sourcePath = sourcePath;
      }
    }
    return selection;
  }

  async function projectRuntimeConfigState(input = {}, {
    configSource = "session",
    envConfigSource = null
  } = {}) {
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return resolveRuntimeConfig(null, input);
    }
    const projectConfigInput = projectConfigSelectionInputForRuntimeConfig(input);
    const committed = configSource === "committed";
    const context = committed
      ? await currentCommittedProjectConfigStateForEnvironment(projectConfigInput, {
          envConfigSource
        })
      : await currentProjectConfigStateForEnvironment(projectConfigInput);
    if (committed && context.projectType?.ready !== true) {
      return unavailableRuntimeConfig(input, context.projectType, {
        envConfigSource: context.envConfigSource || envConfigSource
      });
    }
    const baseProjectEnvironment = committed
      ? await committedProjectConfigEnvironmentState(context)
      : await projectConfigEnvironmentState(projectConfigInput);
    const projectEnvironment = {
      ...baseProjectEnvironment,
      ...await projectRuntimeConfigEnvironmentResolverState(context)
    };
    const userValues = await readEnvUserValues({
      projectLocalRoot: projectLocalRoot(targetRootValue)
    });
    const resolvedServiceDataRoot = serviceDataRoot();
    const profile = context.adapter && typeof context.adapter.getRuntimeConfigProfile === "function"
      ? await context.adapter.getRuntimeConfigProfile({
          ...context,
          projectEnvironment,
          serviceDataRoot: resolvedServiceDataRoot,
          targetRoot: targetRootValue
        })
      : null;
    const config = await resolveRuntimeConfig(profile, {
      ...context,
      phase: input.phase,
      phases: input.phases,
      projectEnvironment,
      records: userValues.records,
      scope: envInputScope(input),
      serviceDataRoot: resolvedServiceDataRoot,
      target: input.target,
      targetRoot: targetRootValue
    });
    return {
      ...config,
      envConfigSource: context.envConfigSource || envConfigSource || null,
      systemEnvironment: projectEnvironment
    };
  }

  function envInputScope(input = {}) {
    return input.environment || input.scope;
  }

  function runtimeInputFromEnvInput(input = {}) {
    return {
      ...input,
      scope: envInputScope(input),
      target: RUNTIME_CONFIG_TARGETS.ENV_FILE
    };
  }

  async function committedProjectConfigEnvironmentState(context = {}) {
    void context;
    return {};
  }

  async function projectRuntimeConfigEnvironmentResolverState(context = {}) {
    const adapterEnvironment = typeof context.adapter?.getProjectEnvironment === "function"
      ? await context.adapter.getProjectEnvironment({
          ...context,
          services: adapterServiceContext(context),
          targetRoot: currentTargetRoot()
        })
      : {};
    const extraEnvironments = await Promise.all(
      (Array.isArray(projectRuntimeConfigEnvironmentResolvers) ? projectRuntimeConfigEnvironmentResolvers : [])
        .filter((resolver) => typeof resolver === "function")
        .map((resolver) => resolver({
          ...context,
          services: adapterServiceContext(context),
          targetRoot: currentTargetRoot()
        }))
    );
    return Object.assign(
      {},
      adapterEnvironment && typeof adapterEnvironment === "object" && !Array.isArray(adapterEnvironment)
        ? adapterEnvironment
        : {},
      ...extraEnvironments.filter((environment) => environment && typeof environment === "object" && !Array.isArray(environment))
    );
  }

  async function unavailableRuntimeConfig(input = {}, projectType = {}, {
    envConfigSource = null
  } = {}) {
    const targetRootValue = currentTargetRoot();
    const userValues = targetRootValue
      ? await readEnvUserValues({
          projectLocalRoot: projectLocalRoot(targetRootValue)
        })
      : {
          records: []
        };
    const config = await resolveRuntimeConfig(null, {
      phase: input.phase,
      phases: input.phases,
      records: userValues.records,
      scope: input.scope,
      target: input.target
    });
    return {
      ...config,
      envConfigSource,
      ok: false,
      systemEnvironment: {},
      unavailable: {
        code: projectType?.errorCode || "vibe64_committed_project_config_unavailable",
        message: projectType?.message || "Committed Vibe64 project config is unavailable.",
        status: projectType?.status || "unavailable"
      }
    };
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
      const resolvedSourcePath = await activeSessionSourceRoot(projectLocalRoot(targetRootValue), entry.name, {
        projectSessionSourceRoot: projectSessionSourceRoot(targetRootValue)
      });
      if (resolvedSourcePath) {
        sources.push({
          label: await runtimeConfigSessionSourceLabel(path.join(sessionsRoot, entry.name), entry.name),
          path: resolvedSourcePath,
          sessionId: entry.name
        });
      }
    }
    return sources.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async function runtimeConfigSessionSourceLabel(sessionRoot = "", sessionId = "") {
    const metadataRoot = path.join(sessionRoot, "metadata");
    for (const name of ["work_title", "work_anchor_title", "issue_title", "branch"]) {
      const value = await readOptionalTextFile(path.join(metadataRoot, name));
      if (value) {
        return `${value} (${sessionId})`;
      }
    }
    return sessionId;
  }

  async function readOptionalTextFile(filePath = "") {
    try {
      return String(await readFile(filePath, "utf8")).trim();
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return "";
      }
      throw error;
    }
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
    const sourcePath = draftSourcePath(input);
    if (sourcePath && await pathExists(sourcePath)) {
      roots.push(sourcePath);
    }
    if (includeActiveSessionSources && targetRootValue) {
      roots.push(...(await activeRuntimeConfigSessionSources(targetRootValue)).map((source) => source.path));
    }
    return roots;
  }

  async function envConfigMaterializationRoots(source = {}) {
    const sourceRoot = String(source?.sourceRoot || "").trim();
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      return [];
    }
    return [sourceRoot];
  }

  async function envRuntimeConfigMaterializationPlan(input = {}, {
    importGeneratedDotenvUserValues = false
  } = {}) {
    const source = await resolveEnvConfigSource(input);
    let config = await projectRuntimeConfigState(input, {
      configSource: source.configSource,
      envConfigSource: source
    });
    const roots = await envConfigMaterializationRoots(source);
    if (!roots.length) {
      return {
        config,
        imported: {
          changed: false,
          keys: []
        },
        roots,
        source
      };
    }
    const imported = importGeneratedDotenvUserValues
      ? await importRuntimeConfigDotenvUserValues(config, {
          roots
        })
      : {
          changed: false,
          keys: []
        };
    if (imported.changed) {
      config = await projectRuntimeConfigState({
        ...input,
        scope: config.scope
      }, {
        configSource: source.configSource,
        envConfigSource: source
      });
    }
    return {
      config,
      imported,
      roots,
      source
    };
  }

  async function materializeProjectRuntimeConfig(input = {}) {
    const {
      config,
      roots
    } = await runtimeConfigMaterializationPlan(input, {
      configSource: input.configSource || "session",
      importGeneratedDotenvUserValues: true,
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

  async function runtimeConfigMaterializationPlan(input = {}, {
    configSource = "session",
    importGeneratedDotenvUserValues = false,
    includeActiveSessionSources = false
  } = {}) {
    let config = input.config || await projectRuntimeConfigState(input, {
      configSource
    });
    const roots = await runtimeConfigMaterializationRoots(input, {
      includeActiveSessionSources
    });
    if (!roots.length) {
      return {
        config,
        imported: {
          changed: false,
          keys: []
        },
        roots
      };
    }
    const imported = importGeneratedDotenvUserValues
      ? await importRuntimeConfigDotenvUserValues(config, {
          roots
        })
      : {
          changed: false,
          keys: []
        };
    if (imported.changed) {
      config = await projectRuntimeConfigState({
        ...input,
        scope: config.scope
      }, {
        configSource
      });
    }
    return {
      config,
      imported,
      roots
    };
  }

  async function importRuntimeConfigDotenvUserValues(config = {}, {
    roots = []
  } = {}) {
    if ((config.scope || RUNTIME_CONFIG_SCOPES.DEV) !== RUNTIME_CONFIG_SCOPES.DEV) {
      return {
        changed: false,
        keys: []
      };
    }
    const targetRootValue = currentTargetRoot();
    if (!targetRootValue) {
      return {
        changed: false,
        keys: []
      };
    }
    const importValues = await readGeneratedRuntimeConfigDotenvUserValues({
      materializers: config.materializers,
      publicEnvPrefixes: config.publicEnvPrefixes,
      records: config.records,
      roots,
      scope: config.scope,
      userValueReservedKeys: config.userValueReservedKeys
    });
    const keys = Object.keys(importValues).sort((left, right) => left.localeCompare(right));
    if (!keys.length) {
      return {
        changed: false,
        keys
      };
    }
    await saveEnvUserValues({
      environment: config.scope,
      projectLocalRoot: projectLocalRoot(targetRootValue),
      values: importValues
    });
    return {
      changed: true,
      keys
    };
  }

  async function runtimeConfigMaterializationStatus(config = {}, {
    roots: explicitRoots = null,
    source = null
  } = {}) {
    const targetRootValue = currentTargetRoot();
    const materializers = Array.isArray(config.materializers) ? config.materializers : [];
    const expectedByPath = new Map(materializers.map((materializer) => [
      materializer.path,
      runtimeConfigExpectedMaterializerText(config, materializer)
    ]));
    if (Array.isArray(explicitRoots)) {
      const rootStatuses = await Promise.all(explicitRoots.map((root) => runtimeConfigRootStatus({
        expectedByPath,
        label: source?.label || "Project baseline",
        root,
        rootKind: source?.rootKind || "project-root",
        scope: config.scope,
        sessionId: source?.sessionId || ""
      })));
      const generatedTimes = rootStatuses
        .flatMap((root) => root.targets)
        .map((target) => target.generatedAt)
        .filter(Boolean)
        .sort();
      return {
        activeSessionSources: rootStatuses.filter((root) => root.rootKind === "session-source"),
        lastGeneratedAt: generatedTimes.at(-1) || "",
        roots: rootStatuses,
        synced: rootStatuses.every((root) => root.synced)
      };
    }
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
        label: source.label,
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

  function publicEnvState(config = {}, {
    materialization = [],
    sync = null
  } = {}) {
    const view = runtimeConfigEnvViewModel(config);
    return {
      ...view,
      configSource: publicEnvConfigSource(config.envConfigSource || {}),
      generatedFiles: {
        activeSessionSources: sync?.activeSessionSources || [],
        lastGeneratedAt: sync?.lastGeneratedAt || "",
        materialization,
        roots: sync?.roots || [],
        synced: sync ? sync.synced === true : false,
        targets: view.generatedTargets || []
      },
      ok: config.ok === true,
      unavailable: config.unavailable || null
    };
  }

  async function readEnvState(input = {}) {
    const runtimeInput = runtimeInputFromEnvInput(input);
    const {
      config,
      roots,
      source
    } = await envRuntimeConfigMaterializationPlan(runtimeInput);
    const sync = await runtimeConfigMaterializationStatus(config, {
      roots,
      source
    });
    return {
      env: publicEnvState(config, {
        sync
      }),
      ok: true
    };
  }

  async function saveEnvUserValuesState(input = {}) {
    const targetRootValue = requireSelectedTargetRoot();
    const runtimeInput = runtimeInputFromEnvInput(input);
    await assertEnvUserValuesEditable(runtimeInput);
    await saveEnvUserValues({
      environment: envInputScope(input),
      projectLocalRoot: projectLocalRoot(targetRootValue),
      values: input.values || {}
    });
    const {
      config,
      roots,
      source
    } = await envRuntimeConfigMaterializationPlan({
      ...runtimeInput,
      scope: envInputScope(input)
    }, {
      importGeneratedDotenvUserValues: true
    });
    const materialization = roots.length && !config.unavailable
      ? await materializeRuntimeConfig(config, {
          roots,
          scope: config.scope
        })
      : [];
    const sync = await runtimeConfigMaterializationStatus(config, {
      roots,
      source
    });
    return {
      env: publicEnvState(config, {
        materialization,
        sync
      }),
      materialization,
      ok: true
    };
  }

  async function assertEnvUserValuesEditable(input = {}) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : {};
    if (Object.keys(values).length === 0) {
      return;
    }
    const source = await resolveEnvConfigSource(input);
    const config = await projectRuntimeConfigState(input, {
      configSource: source.configSource,
      envConfigSource: source
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
      if (existingRecord && existingRecord.editable !== true) {
        const error = new Error(`${normalizedKey} is not editable as a user Env value.`);
        error.code = "vibe64_env_value_not_editable";
        error.key = normalizedKey;
        error.owner = existingRecord.owner;
        error.source = existingRecord.source;
        throw error;
      }
      if (runtimeConfigKeyIsVibe64Reserved(normalizedKey)) {
        const error = new Error(`${normalizedKey} is reserved for Vibe64 and cannot be saved as a user Env value.`);
        error.code = "vibe64_env_reserved_key";
        error.key = normalizedKey;
        throw error;
      }
      if (!config.unavailable && (config.userValueReservedKeys || []).includes(normalizedKey)) {
        const error = new Error(`${normalizedKey} is reserved by the selected adapter and cannot be saved as a user Env value.`);
        error.code = "vibe64_env_reserved_key";
        error.key = normalizedKey;
        throw error;
      }
      const secret = value && typeof value === "object" && !Array.isArray(value)
        ? value.secret === true
        : false;
      if (secret && runtimeConfigKeyIsPublic(normalizedKey, config.publicEnvPrefixes)) {
        const error = new Error(`${normalizedKey} is public by adapter naming convention and cannot be saved as a secret.`);
        error.code = "vibe64_env_public_secret_not_allowed";
        error.key = normalizedKey;
        throw error;
      }
    }
  }

  async function materializeEnvState(input = {}) {
    const runtimeInput = runtimeInputFromEnvInput(input);
    const {
      config,
      roots,
      source
    } = await envRuntimeConfigMaterializationPlan(runtimeInput, {
      importGeneratedDotenvUserValues: true
    });
    if (config.unavailable) {
      const error = new Error(config.unavailable.message);
      error.code = config.unavailable.code;
      throw error;
    }
    const materialization = await materializeRuntimeConfig(config, {
      roots,
      scope: config.scope
    });
    const sync = await runtimeConfigMaterializationStatus(config, {
      roots,
      source
    });
    return {
      env: publicEnvState(config, {
        materialization,
        sync
      }),
      materialization,
      ok: true
    };
  }

  async function projectRuntimeConfigEnvironmentState(input = {}) {
    let config = await projectRuntimeConfigState(input);
    const plan = await runtimeConfigMaterializationPlan({
      ...input,
      config
    }, {
      configSource: "session",
      importGeneratedDotenvUserValues: true
    });
    config = plan.config;
    assertRuntimeConfigReady(config);
    if (input.materialize !== false) {
      await materializeRuntimeConfig(config, {
        roots: plan.roots,
        scope: config.scope
      });
    }
    return runtimeConfigEnv(config.records, {
      scope: config.scope,
      target: input.target
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
      if (!projectSourceConfigReadUnavailableError(error)) {
        throw error;
      }
      projectConfigStore = {
        configRoot: "",
        ...projectRuntimeConfigPathsForTarget(currentTargetRoot())
      };
      resolvedSourceRoot = currentTargetRoot();
    }
    const definition = await projectConfigDefinition(adapter, projectType, resolvedSourceRoot);
    const config = normalizeConfigDefinition(definition);
    const configState = readConfigFromValues(definition, config.defaults, projectConfigStore);
    const response = {
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
    return {
      ...response,
      ...await projectConfigRuntimeMetadata({
        adapter,
        projectConfig: configResponse({
          adapter,
          config: configState,
          projectType
        }),
        projectType,
        targetRoot: resolvedSourceRoot
      })
    };
  }

  function runtimeMetadataOptionalError(error) {
    return new Set([
      "vibe64_runtime_package_unsupported",
      "vibe64_runtime_requirement_unsupported"
    ]).has(String(error?.code || "").trim());
  }

  async function buildProjectRuntimeLock({
    adapter,
    projectConfig,
    projectType,
    targetRoot = ""
  } = {}) {
    if (typeof adapter?.getRuntimeRequirements !== "function") {
      return null;
    }
    const runtimeRequirements = await adapter.getRuntimeRequirements({
      config: projectConfig,
      projectType,
      targetRoot
    });
    return buildRuntimeLock({
      adapterId: adapter.id,
      projectType: projectType?.projectType || projectConfig?.projectType || "",
      runtimeRequirements
    });
  }

  async function projectConfigRuntimeMetadata({
    adapter,
    projectConfig,
    projectType,
    targetRoot = ""
  } = {}) {
    try {
      const runtimeLock = await buildProjectRuntimeLock({
        adapter,
        projectConfig,
        projectType,
        targetRoot
      });
      return runtimeConfigMetadataFromLock(projectConfig, runtimeLock);
    } catch (error) {
      if (!runtimeMetadataOptionalError(error)) {
        throw error;
      }
      return {
        runtimeChoices: runtimeChoicesForProjectConfig(projectConfig),
        runtimeIssue: {
          code: error.code || "vibe64_runtime_metadata_unavailable",
          message: String(error.message || error || "Runtime metadata is unavailable.")
        },
        runtimeLock: null
      };
    }
  }

  async function configResponseWithRuntime({
    adapter,
    config,
    projectType,
    targetRoot = ""
  } = {}) {
    const response = configResponse({
      adapter,
      config,
      projectType
    });
    return {
      ...response,
      ...await projectConfigRuntimeMetadata({
        adapter,
        projectConfig: response,
        projectType,
        targetRoot
      })
    };
  }

  async function writeProjectRuntimeLock({
    adapter,
    projectConfig,
    sourceContractRoot = "",
    projectType,
    targetRoot = ""
  } = {}) {
    const lock = await buildProjectRuntimeLock({
      adapter,
      projectConfig,
      projectType,
      targetRoot
    });
    if (!lock) {
      return null;
    }
    return writeRuntimeLock({
      lock,
      sourceContractRoot
    });
  }

  async function saveProjectConfigState(input = {}) {
    let writableStores = null;
    try {
      writableStores = await projectStores(input, {
        requireWritableSource: true
      });
    } catch (error) {
      const setupState = await resolveProjectSetupState(input, {
        allowDraftProjectTypeForCommitted: true,
        preferBootstrapForSession: true,
        sourceError: error
      });
      if (setupState.mode === "committed") {
        throw committedProjectSetupReadOnlyError("config", setupState.projectType);
      }
      if (!await bootstrapProjectConfigWritableAfterSourceError(error)) {
        throw error;
      }
      return saveBootstrapProjectConfigState(input);
    }
    const { adapter, projectType } = await createProjectAdapter(input);
    const {
      projectTypeStore,
      projectConfigStore,
      resolvedSourceConfigRoot,
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
    const runtimeLock = await writeProjectRuntimeLock({
      adapter,
      projectConfig: response,
      sourceContractRoot: resolvedSourceConfigRoot,
      projectType,
      targetRoot: resolvedSourceRoot || resolvedTargetRoot
    });
    const runtimeMetadata = runtimeConfigMetadataFromLock(response, runtimeLock);
    const hookResults = await runProjectConfigSavedHooks({
      adapter,
      hooks: [
        typeof adapter?.onProjectConfigSaved === "function"
          ? async (context = {}) => adapter.onProjectConfigSaved({
              ...context,
              services: adapterServiceContext(context)
            })
          : null,
        ...(Array.isArray(projectConfigSavedHooks) ? projectConfigSavedHooks : [])
      ],
      projectConfig: response,
      projectType,
      sourceConfigRoot: resolvedSourceConfigRoot,
      sourceRoot: resolvedSourceRoot,
      targetRoot: resolvedSourceRoot || resolvedTargetRoot
    });
    return hookResults.length
      ? {
          ...response,
          ...runtimeMetadata,
          sync: hookResults
        }
      : {
          ...response,
          ...runtimeMetadata
        };
  }

  async function saveBootstrapProjectConfigState(input = {}) {
    const { adapter, projectType } = await createProjectAdapter(input);
    const targetRootValue = currentTargetRoot();
    const definition = await projectConfigDefinition(adapter, projectType, targetRootValue);
    const values = configValuesFromInput(definition, input?.values || {});
    await saveProjectBootstrapConfig({
      projectRecordPath: projectRecordPath(targetRootValue),
      projectType: projectType.projectType,
      values
    });
    const config = readConfigFromValues(definition, values, projectRuntimeConfigPathsForTarget(targetRootValue));
    return configResponseWithRuntime({
      adapter,
      config: {
        ...config,
        bootstrap: true
      },
      projectType: {
        ...projectType,
        bootstrap: true
      },
      targetRoot: targetRootValue
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

  function workflowCreationBaselineForProjectType(projectType = {}, {
    workflowRepositoryProfile = ""
  } = {}) {
    const baseline = {};
    if (projectType.sourceType === "git-cache") {
      baseline.seedRequired = false;
    }
    const normalizedProfile = normalizeWorkflowRepositoryProfile(workflowRepositoryProfile);
    if (normalizedProfile) {
      baseline.workflowRepositoryProfile = normalizedProfile;
    }
    return Object.keys(baseline).length ? baseline : null;
  }

  async function currentWorkflowRepositoryProfile() {
    const requestProfile = normalizeWorkflowRepositoryProfile(
      currentProjectRequestContext()?.workflowRepositoryProfile
    );
    if (requestProfile) {
      return requestProfile;
    }
    const selectionState = await listProjectSelectionState();
    return normalizeWorkflowRepositoryProfile(selectionState?.currentProject?.workflowRepositoryProfile);
  }

  async function committedRuntimeSetup(targetRootValue = currentTargetRoot()) {
    const context = committedProjectAdapterContext(targetRootValue);
    try {
      const {
        adapter,
        committedConfig,
        projectType
      } = await context.createAdapter();
      return {
        adapter,
        projectConfig: await context.requireProjectConfigForAdapter(adapter, projectType, committedConfig),
        projectType
      };
    } catch (error) {
      if (committedProjectConfigUnavailableError(error)) {
        return null;
      }
      throw error;
    }
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
    const workflowRepositoryProfile = await currentWorkflowRepositoryProfile();
    let workflowCreationBaseline = workflowCreationBaselineForProjectType({}, {
      workflowRepositoryProfile
    });
    if (options?.skipProjectConfig === true) {
      resolvedSourceRoot = currentSourceRoot() || targetRootValue;
    } else {
      try {
        const projectAdapter = await createProjectAdapter(runtimeInput);
        adapter = projectAdapter.adapter;
        projectConfig = await requireProjectConfigForAdapter(adapter, projectAdapter.projectType, runtimeInput);
        resolvedSourceRoot = projectAdapter.projectType.sourceRoot || currentSourceRoot() || targetRootValue;
        workflowCreationBaseline = workflowCreationBaselineForProjectType(projectAdapter.projectType, {
          workflowRepositoryProfile
        });
      } catch (error) {
        const committedSetup = runtimeSetupOptionalError(error) && !draftProjectType(runtimeInput)
          ? await committedRuntimeSetup(targetRootValue)
          : null;
        if (committedSetup) {
          adapter = committedSetup.adapter;
          projectConfig = committedSetup.projectConfig;
          resolvedSourceRoot = currentSourceRoot() || targetRootValue;
          workflowCreationBaseline = workflowCreationBaselineForProjectType(committedSetup.projectType, {
            workflowRepositoryProfile
          });
        } else if (setupRequired || !runtimeSetupOptionalError(error)) {
          throw error;
        } else {
          resolvedSourceRoot = currentSourceRoot() || targetRootValue;
        }
      }
    }
    const resolvedProjectRuntimeRoot = projectRuntimeRoot(targetRootValue);
    const resolvedSourceContractRoot = resolvedSourceRoot && !(resolvedSourceRoot === targetRootValue && targetRootIsProjectHome(targetRootValue))
      ? sourceConfigRoot(resolvedSourceRoot)
      : "";
    return new Vibe64SessionRuntime({
      actionReadiness: options.actionReadiness,
      adapter,
      projectConfig,
      projectLocalRoot: resolvedProjectRuntimeRoot,
      projectRecordPath: projectRecordPath(targetRootValue),
      projectSessionSourceRoot: projectSessionSourceRoot(targetRootValue),
      sourceContractRoot: resolvedSourceContractRoot,
      targetRoot: resolvedSourceRoot,
      workflowCreationBaseline,
      workflowRegistry
    });
  }

  async function runInProjectContext(slug = "", operation) {
    return runWithResolvedProjectRequestContext({
      projectContext: studioProjectContext,
      request: {
        params: {
          slug
        }
      }
    }, operation);
  }

  return Object.freeze({
    currentTargetRoot() {
      return currentTargetRoot();
    },

    currentProjectLocalRoot() {
      return projectLocalRoot();
    },

    currentServiceDataRoot() {
      return serviceDataRoot();
    },

    currentProjectRuntimeRoot() {
      return projectRuntimeRoot();
    },

    currentProjectSessionSourceRoot() {
      return projectSessionSourceRoot();
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

    async applyProjectTemplate(templateId = "", input = {}) {
      return projectResult(() => applyProjectTemplateState(templateId, input));
    },

    runInProjectContext,

    async readProjectType(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await readProjectTypeState(input)
        };
      });
    },

    async readProjectTemplates(input = {}) {
      return projectResult(() => readProjectTemplatesState(input));
    },

    async readCommittedProjectType(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await readCommittedProjectTypeState(input)
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

    async readCommittedProjectConfig(input = {}) {
      return projectResult(async () => {
        const {
          projectConfig,
          projectType
        } = await currentCommittedProjectConfigStateForEnvironment(input);
        return {
          config: projectConfig || noProjectSelectedConfigState(),
          ok: true,
          projectType
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

    async readAdapterSettings(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          settings: await readAdapterSettingsState(input)
        };
      });
    },

    async readAdapterSettingsComponent(componentId = "", input = {}) {
      return projectResult(() => readAdapterSettingsComponentState(componentId, input));
    },

    async runAdapterSettingsComponentOperation(componentId = "", operation = "", input = {}) {
      return projectResult(() => runAdapterSettingsComponentOperationState(componentId, operation, input));
    },

    async startAdapterSettingsAction(actionId = "", input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          step: await startAdapterSettingsActionState(actionId, input)
        };
      });
    },

    async submitAdapterSettingsAction(actionId = "", stepId = "", input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          step: await submitAdapterSettingsActionState(actionId, stepId, input)
        };
      });
    },

    async adapterSettingsActionStatus(actionId = "", input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          step: await adapterSettingsActionStatusState(actionId, input)
        };
      });
    },

    async cancelAdapterSettingsAction(actionId = "", input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          step: await cancelAdapterSettingsActionState(actionId, input)
        };
      });
    },

    async requireProjectType() {
      return requireProjectType();
    },

    async projectConfigEnvironment(input = {}) {
      return projectConfigEnvironmentState(input);
    },

    async projectRuntimeConfig(input = {}) {
      return projectRuntimeConfigState(input);
    },

    async readEnv(input = {}) {
      return projectResult(() => readEnvState(input));
    },

    async projectRuntimeConfigEnvironment(input = {}) {
      return projectRuntimeConfigEnvironmentState(input);
    },

    async materializeRuntimeConfig(input = {}) {
      return materializeProjectRuntimeConfig(input);
    },

    async materializeEnvAction(input = {}) {
      return projectResult(() => materializeEnvState(input));
    },

    async saveEnvUserValues(input = {}) {
      return projectResult(() => saveEnvUserValuesState(input));
    },

    async listProjects() {
      return projectResult(() => listProjectSelectionState());
    },

    async requireSelectedTargetRoot() {
      return requireSelectedTargetRoot();
    },

    async listProjectTools(input = {}) {
      return projectResult(async () => {
        return {
          ok: true,
          tools: await listProjectToolState(input)
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
