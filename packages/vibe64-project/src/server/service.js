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
  createVibe64AdapterRegistry,
  createVibe64ProjectConfigStore,
  createVibe64ProjectTypeStore,
  normalizeConfigDefinition
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
  resolveStudioTargetRoot,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  createStudioProjectContext,
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectStateRoot,
  currentProjectTargetRoot
} from "@local/vibe64-core/server/projectRequestContext";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectSelectionRecord({
  githubRepository = null,
  selected = false,
  slug = "",
  projectRoot = ""
} = {}) {
  const record = {
    external: false,
    name: slug,
    path: projectRoot,
    projectRoot,
    selected: Boolean(selected),
    slug,
    source: "workspace"
  };
  if (githubRepository) {
    record.githubRepository = githubRepository;
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

  function projectStateRoot(targetRootValue = currentTargetRoot()) {
    const projectStateRootValue = currentProjectStateRoot();
    if (projectStateRootValue) {
      return projectStateRootValue;
    }
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.projectStateRootForTarget === "function" && targetRootValue) {
      return studioProjectContext.projectStateRootForTarget(targetRootValue);
    }
    return "";
  }

  function projectLocalRoot(targetRootValue = currentTargetRoot()) {
    const projectLocalRootValue = currentProjectLocalRoot();
    if (projectLocalRootValue) {
      return projectLocalRootValue;
    }
    if (!targetRootValue) {
      return "";
    }
    if (typeof studioProjectContext.projectLocalRootForTarget === "function" && targetRootValue) {
      return studioProjectContext.projectLocalRootForTarget(targetRootValue);
    }
    return "";
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
      selected: true,
      slug: projectContextValue.slug,
      projectRoot: projectContextValue.targetRoot
    });
    const projects = listed.projects
      .map((project) => projectSelectionRecord({
        githubRepository: project.githubRepository,
        selected: project.slug === projectContextValue.slug,
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

  function projectStores(targetRootValue = requireSelectedTargetRoot()) {
    const resolvedTargetRoot = resolveVibe64TargetRoot(targetRootValue);
    const resolvedProjectStateRoot = projectStateRoot(resolvedTargetRoot);
    const resolvedProjectLocalRoot = projectLocalRoot(resolvedTargetRoot);
    return {
      projectConfigStore: createVibe64ProjectConfigStore({
        projectLocalRoot: resolvedProjectLocalRoot,
        projectSharedRoot: resolvedProjectStateRoot,
        targetRoot: resolvedTargetRoot
      }),
      projectTypeStore: createVibe64ProjectTypeStore({
        projectSharedRoot: resolvedProjectStateRoot,
        targetRoot: resolvedTargetRoot
      }),
      resolvedProjectLocalRoot,
      resolvedProjectStateRoot,
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

  function draftProjectType(input = {}) {
    return String(input?.projectType || "").trim();
  }

  async function readDraftProjectTypeState(projectTypeValue = "") {
    const targetRootValue = currentTargetRoot();
    const {
      projectTypeStore,
      resolvedTargetRoot
    } = projectStores(targetRootValue);
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
      status: "draft",
      targetRoot: resolvedTargetRoot
    };
  }

  async function resolveProjectTypeForConfig(input = {}) {
    const projectType = draftProjectType(input);
    if (projectType) {
      return readDraftProjectTypeState(projectType);
    }
    return requireProjectType();
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

  async function readProjectConfigState(input = {}) {
    if (!currentTargetRoot()) {
      return noProjectSelectedConfigState();
    }
    const { adapter, projectType } = await createProjectAdapter(input);
    return readProjectConfigForAdapter(adapter, projectType);
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
    } = projectStores(currentTargetRoot());
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

  async function activeRuntimeConfigWorktrees(targetRootValue = currentTargetRoot()) {
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
    const worktrees = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const worktreePath = path.join(sessionsRoot, entry.name, "worktree");
      if (await pathExists(worktreePath)) {
        worktrees.push({
          path: worktreePath,
          sessionId: entry.name
        });
      }
    }
    return worktrees.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async function runtimeConfigMaterializationRoots(input = {}, {
    includeActiveWorktrees = false
  } = {}) {
    const roots = [];
    const targetRootValue = String(input.targetRoot || currentTargetRoot() || "").trim();
    if (targetRootValue && await pathExists(targetRootValue)) {
      roots.push(targetRootValue);
    }
    const worktreePath = String(input.worktreePath || "").trim();
    if (worktreePath && await pathExists(worktreePath)) {
      roots.push(worktreePath);
    }
    if (includeActiveWorktrees && targetRootValue) {
      roots.push(...(await activeRuntimeConfigWorktrees(targetRootValue)).map((worktree) => worktree.path));
    }
    return roots;
  }

  async function materializeProjectRuntimeConfig(input = {}) {
    const config = input.config || await projectRuntimeConfigState(input);
    const roots = await runtimeConfigMaterializationRoots(input, {
      includeActiveWorktrees: input.syncActiveWorktrees === true
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
    const targetRootStatus = targetRootValue
      ? [await runtimeConfigRootStatus({
          expectedByPath,
          label: "Project root",
          root: targetRootValue,
          rootKind: "project-root",
          scope: config.scope
        })]
      : [];
    const activeWorktreeStatuses = await Promise.all((await activeRuntimeConfigWorktrees(targetRootValue))
      .map((worktree) => runtimeConfigRootStatus({
        expectedByPath,
        label: worktree.sessionId,
        root: worktree.path,
        rootKind: "worktree",
        scope: config.scope,
        sessionId: worktree.sessionId
      })));
    const roots = [
      ...targetRootStatus,
      ...activeWorktreeStatuses
    ];
    const generatedTimes = roots
      .flatMap((root) => root.targets)
      .map((target) => target.generatedAt)
      .filter(Boolean)
      .sort();
    return {
      activeWorktrees: activeWorktreeStatuses,
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
        activeWorktrees: [],
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
      syncActiveWorktrees: true
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
      syncActiveWorktrees: input.syncActiveWorktrees !== false
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
    const { adapter, projectType } = await createProjectAdapter(input);
    const targetRootValue = requireSelectedTargetRoot();
    const {
      projectTypeStore,
      projectConfigStore
    } = projectStores(targetRootValue);
    const config = await projectConfigStore.saveConfig({
      definition: await projectConfigDefinition(adapter, projectType, targetRootValue),
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
      targetRoot: targetRootValue
    });
    return hookResults.length
      ? {
          ...response,
          sync: hookResults
        }
      : response;
  }

  async function createRuntime(options = {}) {
    const resolvedTargetRoot = requireSelectedTargetRoot();
    const { adapter, projectType } = await createProjectAdapter();
    const projectConfig = await requireProjectConfigForAdapter(adapter, projectType);
    return new Vibe64SessionRuntime({
      actionReadiness: options.actionReadiness,
      adapter,
      projectConfig,
      projectLocalRoot: projectLocalRoot(resolvedTargetRoot),
      targetRoot: resolvedTargetRoot,
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

    async readProjectType() {
      return projectResult(async () => {
        return {
          ok: true,
          projectType: await readProjectTypeState()
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
