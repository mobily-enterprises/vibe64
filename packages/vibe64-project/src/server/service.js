import path from "node:path";
import { createHash } from "node:crypto";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server/runtime";
import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server/sessionStore";
import {
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  normalizeRuntimeConfigKey,
  normalizeRuntimeConfigRecord,
  resolveRuntimeConfig,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigRecordsForScope
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  assertProjectDirectoryUsable,
  createStudioProjectContext,
  getStudioProjectContext,
  normalizeDevelopmentDatabaseName,
  normalizeDevelopmentDatabaseScope
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  runWithProjectRequestContext,
  runWithResolvedProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  resolveSourceConfigRoot
} from "@local/vibe64-core/server/projectState";
import {
  readProjectPromptHints,
  saveProjectPromptHints
} from "@local/vibe64-core/server/projectPromptHints";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  inspectGenesisCollaboration,
  inspectGenesisEngineering,
  inspectGenesisEnvironment,
  inspectGenesisProject,
  listGenesisTemplates,
  applyGenesisTemplate,
  setGenesisCollaboration,
  setGenesisEngineeringProfile
} from "@local/vibe64-genesis/server";
import {
  readPreviewApplicationIdentities as readStoredPreviewApplicationIdentities,
  savePreviewApplicationIdentities as saveStoredPreviewApplicationIdentities
} from "./previewApplicationIdentities.js";
import {
  materializeProjectEnvironmentFiles,
  projectEnvironmentFilesAreCurrent
} from "./projectEnvironmentFiles.js";
import {
  applicationDatabaseToolEnvironment,
  normalizeResourceEnvironment,
  preferredAlternative,
  satisfiedAlternative
} from "./resourceEnvironment.js";
import {
  developmentDatabasePolicy as resolveDevelopmentDatabasePolicy
} from "./developmentDatabasePolicy.js";
import {
  runProjectSessionPolicyExclusive as runProjectSessionPolicyMutationExclusive,
  runProjectSourceExclusive as runProjectSourceMutationExclusive
} from "./projectSourceMutationLock.js";

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

function catalogUnavailable() {
  return {
    errors: [{
      code: "vibe64_project_catalog_unavailable",
      message: "Project catalog operations are not available in local editor mode."
    }],
    ok: false
  };
}

function publicProject(project = {}, {
  context = null,
  selected = false
} = {}) {
  const projectRoot = context?.targetRoot || project.projectRoot || project.path || "";
  const slug = context?.slug || project.slug || project.name || path.basename(projectRoot);
  return {
    canonicalRepositoryPath: project.canonicalRepositoryPath || "",
    developmentDatabaseScope: normalizeDevelopmentDatabaseScope(
      project.developmentDatabaseScope
    ),
    developmentDatabaseName: normalizeDevelopmentDatabaseName(
      project.developmentDatabaseName
    ),
    githubMirrorPath: project.githubMirrorPath || "",
    ...(project.githubRepository ? { githubRepository: project.githubRepository } : {}),
    name: slug,
    path: projectRoot,
    projectRecordPath: context?.projectRecordPath || project.projectRecordPath || "",
    projectRoot,
    projectRuntimeRoot: context?.projectRuntimeRoot || project.projectRuntimeRoot || "",
    projectSessionSourceRoot: context?.projectSessionSourceRoot || project.projectSessionSourceRoot || "",
    ...(project.repository ? { repository: project.repository } : {}),
    repositoryMode: project.repositoryMode || project.repository?.mode || "",
    runtime: project.runtime || null,
    selected: Boolean(selected),
    slug,
    source: project.source || "workspace",
    sourceConfigRoot: context?.sourceConfigRoot || project.sourceConfigRoot || "",
    sourceRoot: context?.sourceRoot || project.sourceRoot || ""
  };
}

function valuePresent(environment = {}, name = "", allowEmpty = false) {
  if (!Object.hasOwn(environment, name) || typeof environment[name] !== "string") {
    return false;
  }
  const value = environment[name].trim();
  if (value === `$${name}` || value === `\${${name}}`) {
    return false;
  }
  return value.length > 0 || allowEmpty;
}

function requiredAlternative(resource = {}, environment = {}) {
  const alternatives = Array.isArray(resource.environmentAlternatives)
    ? resource.environmentAlternatives
    : [];
  if (satisfiedAlternative(resource, environment)) {
    return null;
  }
  return alternatives
    .map((alternative, index) => ({
      alternative,
      index,
      preferred: alternative.preferred === true,
      present: Object.entries(alternative.bindings || {}).filter(([semantic, name]) => (
        valuePresent(environment, name, (alternative.allowEmpty || []).includes(semantic))
      )).length
    }))
    .sort((left, right) => (
      right.present - left.present ||
      Number(right.preferred) - Number(left.preferred) ||
      left.index - right.index
    ))[0]?.alternative || preferredAlternative(resource);
}

function stackResourceRecords(resources = [], environment = {}) {
  const records = new Map();
  for (const declaration of resources) {
    const alternative = requiredAlternative(declaration.resource, environment);
    for (const [semantic, key] of Object.entries(alternative?.bindings || {})) {
      if (records.has(key)) {
        continue;
      }
      records.set(key, {
        editable: true,
        key,
        materialize: false,
        owner: "user",
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        secret: ["password", "url"].includes(semantic) ? true : undefined,
        source: `genesis-stack:${declaration.component}:${declaration.resource.id}`,
        value: ""
      });
    }
  }
  return [...records.values()];
}

function environmentRecord(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [String(key || "").trim(), String(entry ?? "")])
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)));
}

function systemEnvironmentRecords(environment = {}, {
  secretKeys = new Set(),
  source = "system",
  sources = {}
} = {}) {
  return Object.entries(environmentRecord(environment)).map(([key, value]) => ({
    editable: false,
    key,
    owner: "system",
    requiredFor: [],
    scope: RUNTIME_CONFIG_SCOPES.DEV,
    secret: secretKeys.has(key) ? true : undefined,
    source: sources[key] || source,
    value,
    valuePresent: true
  }));
}

function declaredEnvironmentDefaults(defaults = []) {
  if (!Array.isArray(defaults)) {
    return {};
  }
  return environmentRecord(Object.fromEntries(defaults
    .filter((entry) => entry && typeof entry.name === "string" && typeof entry.value === "string")
    .map((entry) => [entry.name, entry.value])));
}

function genesisEnvironmentIsUnconfigured(error) {
  return error?.code === "STACK_REQUIRED";
}

function projectEnvironmentResult(resolved, input, userRecords) {
  if (input.includeResourceConfiguration !== true) return resolved.projectEnvironment;
  const values = [];
  const userByKey = new Map(runtimeConfigRecordsForScope(userRecords,
    input.environment || input.scope || RUNTIME_CONFIG_SCOPES.DEV,
    { target: input.target }).map((record) => [record.key, record]));
  for (const [key, value] of Object.entries(resolved.projectEnvironment)) {
    // Managed resource addresses/credentials vary by session, not app size.
    if (Object.hasOwn(resolved.platformEnvironment || {}, key)) continue;
    const record = userByKey.get(key) || normalizeRuntimeConfigRecord({ key, value });
    if (!record.secret) values.push([key, value]);
  }
  const resources = resolved.resources.map(({ component, resource }) => [
    component, resource.id, resource.kind,
    Object.entries(satisfiedAlternative(resource, resolved.effectiveEnvironment)?.bindings || {}).sort(),
    Object.entries(resource.optionalBindings || {}).sort()
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    environment: resolved.projectEnvironment,
    resourceConfigurationFingerprint: resolved.environmentInspectionFailed ? null : createHash("sha256")
      .update(JSON.stringify({ values: values.sort(([left], [right]) => left.localeCompare(right)), resources }))
      .digest("hex")
  };
}

function createService({
  env = process.env,
  logger = null,
  inspectCollaboration = inspectGenesisCollaboration,
  inspectEngineering = inspectGenesisEngineering,
  inspectEnvironment = inspectGenesisEnvironment,
  inspectProject = inspectGenesisProject,
  listTemplates = listGenesisTemplates,
  applyTemplate = applyGenesisTemplate,
  projectContext = null,
  setCollaboration = setGenesisCollaboration,
  setEngineeringProfile = setGenesisEngineeringProfile,
  targetRoot = ""
} = {}) {
  let resourceEnvironmentProvider = null;
  const studioProjectContext = projectContext || (String(targetRoot || "").trim()
    ? createStudioProjectContext({
        explicitTargetRoot: targetRoot
      })
    : getStudioProjectContext());

  function selectedTargetRoot() {
    return String(currentProjectTargetRoot() || studioProjectContext.targetRoot || "").trim();
  }

  function requireSelectedTargetRoot() {
    const target = selectedTargetRoot();
    if (target) {
      return target;
    }
    return studioProjectContext.requireSelectedTargetRoot();
  }

  function selectedSourceRoot() {
    const requestSource = currentProjectSourceRoot();
    if (requestSource) {
      return requestSource;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    return typeof studioProjectContext.sourceRootForTarget === "function"
      ? studioProjectContext.sourceRootForTarget(target)
      : "";
  }

  function selectedSourceConfigRoot() {
    const requestRoot = currentProjectSourceConfigRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const sourceRoot = selectedSourceRoot();
    if (!sourceRoot) {
      return "";
    }
    return resolveSourceConfigRoot({
      sourceRoot
    });
  }

  function selectedProjectRuntimeRoot() {
    const requestRoot = currentProjectRuntimeRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    if (typeof studioProjectContext.projectRuntimeRootForTarget === "function") {
      return studioProjectContext.projectRuntimeRootForTarget(target);
    }
    return "";
  }

  function selectedSessionSourceRoot() {
    const requestRoot = currentProjectSessionSourceRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    return target && typeof studioProjectContext.projectSessionSourceRootForTarget === "function"
      ? studioProjectContext.projectSessionSourceRootForTarget(target)
      : "";
  }

  function sessionStore() {
    const target = requireSelectedTargetRoot();
    return createVibe64SessionStore({
      logger,
      projectContextRoot: target,
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selectedSessionSourceRoot()
    });
  }

  async function sourceForInput(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      const sourceRoot = selectedSourceRoot();
      return {
        label: sourceRoot ? "Standalone source" : "Project metadata",
        rootKind: sourceRoot ? "standalone-source" : "metadata-only",
        sessionId: "",
        sourceRoot
      };
    }
    // Internal orchestration may already hold a session record obtained
    // through a narrower capability than the public store reader (for
    // example, a renewal successor before it becomes visible). Reuse only an
    // exact-id record; ordinary callers still cross the public read boundary.
    const providedSessionId = String(input.session?.sessionId || input.session?.id || "").trim();
    const session = providedSessionId === sessionId
      ? input.session
      : await sessionStore().readSession(sessionId);
    return {
      label: "Session source",
      rootKind: "session-source",
      sessionId,
      sourceRoot: sessionSourcePath(session)
    };
  }

  async function runSessionSourceWorkExclusive(input = {}, operation, operationName = "project-source-write") {
    if (typeof operation !== "function") {
      throw new TypeError("Session source work requires an operation.");
    }
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return operation();
    }
    const runtime = await createRuntime({
      inspectSource: false
    });
    const exclusive = await runVibe64AgentWriteExclusive(
      runtime,
      sessionId,
      operation,
      { operation: operationName }
    );
    if (!exclusive.acquired) {
      const error = vibe64Error(
        exclusive.value?.error || "Another assistant operation is starting. Try again in a moment.",
        exclusive.value?.code || "vibe64_agent_write_mode_busy"
      );
      error.retryable = true;
      throw error;
    }
    return exclusive.value;
  }

  async function userEnvRecords() {
    return (await readEnvUserValues({
      projectRuntimeRoot: selectedProjectRuntimeRoot()
    })).records;
  }

  async function resolvedProjectEnvironment(input = {}, userRecords = [], {
    provisionResources = false
  } = {}) {
    const source = await sourceForInput(input);
    const sourceRoot = source.sourceRoot;
    const userEnvironment = runtimeConfigEnv(userRecords, {
      scope: input.environment || input.scope || RUNTIME_CONFIG_SCOPES.DEV,
      target: input.target
    });
    if (!sourceRoot) {
      return {
        databaseToolEnvironment: null,
        effectiveEnvironment: {
          ...env,
          ...userEnvironment
        },
        environmentFiles: [],
        projectEnvironment: userEnvironment,
        platformEnvironmentSecrets: new Set(),
        platformEnvironmentSources: {},
        resources: [],
        resourcesPrepared: true,
        source,
        warning: ""
      };
    }
    let declaration;
    try {
      declaration = await inspectEnvironment({
        environment: {
          ...env,
          ...userEnvironment
        },
        projectRoot: sourceRoot
      });
    } catch (error) {
      return {
        databaseToolEnvironment: null,
        environmentInspectionFailed: !genesisEnvironmentIsUnconfigured(error),
        effectiveEnvironment: {
          ...env,
          ...userEnvironment
        },
        environmentFiles: [],
        projectEnvironment: userEnvironment,
        platformEnvironmentSecrets: new Set(),
        platformEnvironmentSources: {},
        resources: [],
        resourcesPrepared: true,
        source,
        warning: genesisEnvironmentIsUnconfigured(error)
          ? ""
          : String(error?.message || "")
      };
    }
    const developmentDatabase = resourceEnvironmentProvider && source.sessionId && declaration.resources.length > 0
      ? await currentDevelopmentDatabaseConfiguration()
      : null;
    const environmentForResources = provisionResources
      ? resourceEnvironmentProvider?.environmentForResources
      : resourceEnvironmentProvider?.environmentForProvisionedResources;
    if (developmentDatabase && typeof environmentForResources !== "function") {
      throw new TypeError(
        provisionResources
          ? "Vibe64 resource environment provider must expose environmentForResources()."
          : "Vibe64 resource environment provider must expose environmentForProvisionedResources()."
      );
    }
    const provided = developmentDatabase
      ? await environmentForResources.call(resourceEnvironmentProvider, {
          components: declaration.components,
          ...developmentDatabase,
          projectRuntimeRoot: selectedProjectRuntimeRoot(),
          resources: declaration.resources,
          serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
          sessionId: source.sessionId,
          projectContextRoot: selectedTargetRoot(),
          sourceRoot
        })
      : {};
    const contribution = developmentDatabase
      ? normalizeResourceEnvironment(declaration.resources, provided)
      : {
          databaseToolEnvironment: null,
          environment: {},
          secretKeys: new Set(),
          sources: {}
        };
    const platformEnvironment = contribution.environment;
    const defaultEnvironment = declaredEnvironmentDefaults(declaration.environmentDefaults);
    const projectEnvironment = {
      ...defaultEnvironment,
      ...userEnvironment,
      ...platformEnvironment
    };
    return {
      defaultEnvironment,
      databaseToolEnvironment: contribution.databaseToolEnvironment,
      effectiveEnvironment: {
        ...env,
        ...projectEnvironment
      },
      environmentFiles: declaration.files,
      platformEnvironment,
      platformEnvironmentSecrets: contribution.secretKeys,
      platformEnvironmentSources: contribution.sources,
      projectEnvironment,
      resources: declaration.resources,
      resourcesPrepared: !developmentDatabase || provided.prepared === true,
      source,
      warning: ""
    };
  }

  async function stackEnvRecords(input = {}, userRecords = []) {
    const resolved = await resolvedProjectEnvironment(input, userRecords);
    return {
      records: [
        ...systemEnvironmentRecords(resolved.defaultEnvironment, {
          source: "genesis-stack:default"
        }),
        ...systemEnvironmentRecords(resolved.platformEnvironment, {
          secretKeys: resolved.platformEnvironmentSecrets,
          source: "vibe64-host:managed-resource",
          sources: resolved.platformEnvironmentSources
        }),
        ...stackResourceRecords(resolved.resources, resolved.effectiveEnvironment)
      ],
      source: resolved.source,
      warning: resolved.warning
    };
  }

  async function envConfig(input = {}) {
    const userRecords = await userEnvRecords();
    const stack = await stackEnvRecords(input, userRecords);
    const config = await resolveRuntimeConfig([
      ...stack.records,
      ...userRecords
    ], {
      scope: input.environment || input.scope,
      target: input.target
    });
    return {
      config,
      stack
    };
  }

  async function readEnvState(input = {}) {
    const { config, stack } = await envConfig(input);
    return {
      env: {
        ...runtimeConfigEnvViewModel(config),
        configSource: {
          label: stack.source.label,
          rootKind: stack.source.rootKind,
          sessionId: stack.source.sessionId,
          sourceRoot: stack.source.sourceRoot
        },
        ...(stack.warning ? { stackWarning: stack.warning } : {})
      },
      ok: true
    };
  }

  async function revealEnvSecretState(input = {}) {
    if (input.vibe64User && input.vibe64User.role !== "owner") {
      throw vibe64Error(
        "Only the Vibe64 owner can reveal development secrets.",
        "vibe64_owner_required"
      );
    }
    const key = normalizeRuntimeConfigKey(input.key);
    const { config } = await envConfig(input);
    const record = config.view?.records?.find((candidate) => candidate?.key === key);
    if (!record) {
      throw vibe64Error(
        "That development secret is not available.",
        "vibe64_env_variable_not_found"
      );
    }
    if (record.secret !== true) {
      throw vibe64Error(
        `${key} is not a secret value.`,
        "vibe64_env_variable_not_secret"
      );
    }
    const value = String(config.values?.[key] ?? "");
    if (record.valuePresent !== true || !value) {
      throw vibe64Error(
        `${key} has no value to reveal.`,
        "vibe64_env_secret_value_missing"
      );
    }
    return {
      key,
      ok: true,
      value
    };
  }

  async function saveEnvState(input = {}) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : {};
    const { records } = await stackEnvRecords(input, await userEnvRecords());
    const stackKeys = new Set(records.map((record) => record.key));
    for (const key of Object.keys(values)) {
      const normalizedKey = normalizeRuntimeConfigKey(key);
      if (runtimeConfigKeyIsVibe64Reserved(normalizedKey) && !stackKeys.has(normalizedKey)) {
        const error = new Error(`${normalizedKey} is reserved for Vibe64 and is not declared by the Genesis Stack.`);
        error.code = "vibe64_env_reserved_key";
        throw error;
      }
    }
    await saveEnvUserValues({
      environment: input.environment || input.scope,
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      values
    });
    const resolved = await resolvedProjectEnvironment(input, await userEnvRecords());
    await materializeProjectEnvironmentFiles({
      environment: resolved.projectEnvironment,
      files: resolved.environmentFiles,
      sourceRoot: resolved.source.sourceRoot
    });
    return readEnvState(input);
  }

  async function listProjectsState() {
    const requestContext = currentProjectRequestContext();
    if (!requestContext?.targetRoot || studioProjectContext.requestContextMatchesSelectedProject(requestContext)) {
      const listed = await studioProjectContext.listProjects();
      const currentProject = listed.currentProject
        ? publicProject(listed.currentProject, {
            selected: true
          })
        : null;
      const projects = listed.projects.map((project) => publicProject(project, {
        selected: project.selected
      }));
      if (currentProject && !projects.some((project) => project.slug === currentProject.slug)) {
        projects.push(currentProject);
        projects.sort((left, right) => left.slug.localeCompare(right.slug));
      }
      return {
        ...listed,
        currentProject,
        projects
      };
    }
    const listed = await studioProjectContext.listWorkspaceProjects();
    const current = listed.projects.find((project) => project.slug === requestContext.slug) || {};
    const projects = listed.projects.map((project) => publicProject(project, {
      context: project.slug === requestContext.slug ? requestContext : null,
      selected: project.slug === requestContext.slug
    }));
    return {
      currentProject: publicProject(current, {
        context: requestContext,
        selected: true
      }),
      hasSelection: true,
      ok: true,
      projects,
      projectsRoot: requestContext.projectsRoot || listed.projectsRoot,
      targetRoot: requestContext.targetRoot
    };
  }

  async function currentProjectState() {
    const listed = await listProjectsState();
    return listed.currentProject || null;
  }

  async function currentDevelopmentDatabaseScope() {
    return (await currentDevelopmentDatabaseConfiguration()).developmentDatabaseScope;
  }

  function canEditProjectSettings(input = {}) {
    return !input.vibe64User || input.vibe64User.role === "owner";
  }

  async function collaborationSettingsState(input = {}) {
    const source = await genesisSettingsSourceForInput(input);
    const publicSource = {
      rootKind: source.rootKind,
      sessionId: source.sessionId
    };
    if (!source.sourceRoot) {
      return {
        available: false,
        canEdit: false,
        choices: {},
        experience: "",
        explanationStyle: "",
        requirements: "",
        responseLength: "",
        source: publicSource,
        status: "unavailable",
        tone: "",
        unavailableReason: source.sessionId
          ? "This session does not have an available project source yet."
          : "Create or select an AI session to set collaboration guidance."
      };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    const collaboration = await inspectCollaboration({
      projectRoot: source.sourceRoot
    });
    return {
      available: true,
      canEdit: canEditProjectSettings(input),
      choices: collaboration.choices,
      experience: collaboration.experience,
      explanationStyle: collaboration.explanationStyle,
      requirements: collaboration.requirements,
      responseLength: collaboration.responseLength,
      source: publicSource,
      status: collaboration.status,
      tone: collaboration.tone,
      unavailableReason: ""
    };
  }

  async function saveCollaborationSettingsState(input = {}) {
    if (!canEditProjectSettings(input)) {
      throw vibe64Error(
        "Only the Vibe64 project owner can change collaboration through Project settings.",
        "vibe64_owner_required"
      );
    }
    let sourceInput = input;
    if (!String(input.sessionId || "").trim() && !selectedSourceRoot()) {
      const session = await sessionStore().readCurrentSession();
      if (session?.sessionId) {
        sourceInput = {
          ...input,
          sessionId: session.sessionId
        };
      }
    }
    return runSessionSourceWorkExclusive(sourceInput, async () => {
      const source = await genesisSettingsSourceForInput(sourceInput);
      if (!source.sourceRoot) {
        throw vibe64Error(
          "Collaboration guidance requires an available project source. Create or select an AI session first.",
          "vibe64_collaboration_source_required"
        );
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceMutationExclusive(
        selectedProjectRuntimeRoot(),
        async () => {
          await setCollaboration({
            experience: input.experience,
            explanationStyle: input.explanationStyle,
            projectRoot: source.sourceRoot,
            requirements: input.requirements,
            responseLength: input.responseLength,
            tone: input.tone
          });
          const collaboration = await collaborationSettingsState(sourceInput);
          return {
            collaboration,
            ok: true,
            projectSlug: String(currentProjectRequestContext()?.slug || path.basename(requireSelectedTargetRoot())).trim()
          };
        },
        { operation: "save-collaboration-guidance" }
      );
    }, "save-collaboration-guidance");
  }

  async function savePromptHintsState(input = {}) {
    if (!canEditProjectSettings(input)) {
      throw vibe64Error(
        "Only the Vibe64 project owner can change prompt suggestions.",
        "vibe64_owner_required"
      );
    }
    const { settings } = await saveProjectPromptHints({
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      settings: { promptHints: input.promptHints }
    });
    return {
      ok: true,
      projectSlug: String(currentProjectRequestContext()?.slug || path.basename(requireSelectedTargetRoot())).trim(),
      promptHints: {
        canEdit: true,
        enabled: settings.promptHints
      }
    };
  }

  async function currentDevelopmentDatabaseConfiguration() {
    const project = await currentProjectState();
    return {
      developmentDatabaseName: normalizeDevelopmentDatabaseName(project?.developmentDatabaseName),
      developmentDatabaseScope: normalizeDevelopmentDatabaseScope(project?.developmentDatabaseScope)
    };
  }

  function managedDevelopmentDatabaseAvailable() {
    return resourceEnvironmentProvider?.managedDevelopmentDatabase === true;
  }

  async function managedDevelopmentDatabaseDefaults(input = {}) {
    if (!managedDevelopmentDatabaseAvailable()) {
      return {};
    }
    if (typeof resourceEnvironmentProvider?.developmentDatabaseNameForProject !== "function") {
      throw vibe64Error(
        "This Vibe64 installation cannot name a managed project database.",
        "vibe64_managed_development_database_name_unavailable"
      );
    }
    const projectContextRoot = String(input.projectContextRoot || "").trim();
    if (!path.isAbsolute(projectContextRoot)) {
      throw vibe64Error(
        "Managed project database defaults require an absolute project context root.",
        "vibe64_managed_development_database_project_root_invalid"
      );
    }
    const developmentDatabaseName = normalizeDevelopmentDatabaseName(
      await resourceEnvironmentProvider.developmentDatabaseNameForProject({
        projectContextRoot,
        serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
        slug: String(input.slug || path.basename(projectContextRoot)).trim()
      })
    );
    if (!developmentDatabaseName) {
      throw vibe64Error(
        "The managed project database name is empty.",
        "vibe64_managed_development_database_name_unavailable"
      );
    }
    return {
      developmentDatabaseName,
      developmentDatabaseScope: "project"
    };
  }

  async function currentDevelopmentDatabasePolicy(input = {}) {
    const openSessions = Array.isArray(input.openSessions)
      ? input.openSessions
      : await (await createRuntime({
          inspectSource: false
        })).listSessionSummaries({
          statusGroup: "open"
        });
    return resolveDevelopmentDatabasePolicy({
      managed: managedDevelopmentDatabaseAvailable(),
      openSessions,
      scope: await currentDevelopmentDatabaseScope()
    });
  }

  async function developmentDatabaseState() {
    return (await currentDevelopmentDatabasePolicy()).developmentDatabase;
  }

  async function saveDevelopmentDatabaseScopeState(input = {}) {
    if (!managedDevelopmentDatabaseAvailable()) {
      throw vibe64Error(
        "This Vibe64 installation does not manage development databases.",
        "vibe64_managed_development_database_unavailable"
      );
    }
    return runProjectSessionPolicyMutationExclusive(
      selectedProjectRuntimeRoot(),
      async () => {
        const policy = await currentDevelopmentDatabasePolicy();
        if (!policy.developmentDatabase.canChange) {
          throw vibe64Error(
            policy.developmentDatabase.disabledReason,
            "vibe64_development_database_scope_busy"
          );
        }
        const slug = path.basename(requireSelectedTargetRoot());
        const scope = normalizeDevelopmentDatabaseScope(input.scope);
        const currentProject = await currentProjectState();
        let developmentDatabaseName = normalizeDevelopmentDatabaseName(
          currentProject?.developmentDatabaseName
        );
        if (scope === "project" && !developmentDatabaseName) {
          if (typeof resourceEnvironmentProvider?.developmentDatabaseNameForProject !== "function") {
            throw vibe64Error(
              "This Vibe64 installation cannot name a managed project database.",
              "vibe64_managed_development_database_name_unavailable"
            );
          }
          developmentDatabaseName = normalizeDevelopmentDatabaseName(
            await resourceEnvironmentProvider.developmentDatabaseNameForProject({
              projectContextRoot: requireSelectedTargetRoot(),
              serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
              slug
            })
          );
          if (!developmentDatabaseName) {
            throw vibe64Error(
              "The managed project database name is empty.",
              "vibe64_managed_development_database_name_unavailable"
            );
          }
        }
        await studioProjectContext.updateWorkspaceProjectMetadata({
          ...(developmentDatabaseName ? { developmentDatabaseName } : {}),
          developmentDatabaseScope: scope,
          slug
        });
        return {
          ...(await currentDevelopmentDatabasePolicy({ openSessions: [] })).developmentDatabase,
          ok: true
        };
      },
      {
        operation: "save-development-database-scope"
      }
    );
  }

  async function promptEnvironment() {
    return (await resolvedProjectEnvironment({}, await userEnvRecords())).effectiveEnvironment;
  }

  async function genesisSettingsSourceForInput(input = {}) {
    const source = await sourceForInput(input);
    if (source.sourceRoot || source.sessionId) {
      return source;
    }
    const session = await sessionStore().readCurrentSession();
    return session
      ? sourceForInput({
          ...input,
          session,
          sessionId: session.sessionId
        })
      : source;
  }

  async function engineeringProfileState(input = {}) {
    const source = await genesisSettingsSourceForInput(input);
    const publicSource = {
      rootKind: source.rootKind,
      sessionId: source.sessionId
    };
    if (!source.sourceRoot) {
      return {
        available: false,
        profile: null,
        profiles: [],
        source: publicSource,
        unavailableReason: source.sessionId
          ? "This session does not have an available project source yet."
          : "Create or select an AI session to choose an engineering profile."
      };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    const inspection = await inspectEngineering({
      projectRoot: source.sourceRoot
    });
    return {
      available: true,
      profile: {
        description: inspection.profile.description,
        id: inspection.profile.id,
        name: inspection.profile.name
      },
      profiles: inspection.profiles.map((profile) => ({
        description: profile.description,
        id: profile.id,
        name: profile.name
      })),
      source: publicSource,
      status: inspection.status,
      unavailableReason: ""
    };
  }

  async function projectOnboardingState(input = {}) {
    const source = await genesisSettingsSourceForInput(input);
    if (!source.sourceRoot) {
      return { ok: true, available: false, templates: [], source: { sessionId: source.sessionId } };
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    const inspection = await inspectProject({ projectRoot: source.sourceRoot });
    const catalogue = inspection.templateEligible
      ? await listTemplates({ projectRoot: source.sourceRoot })
      : { templates: [] };
    return {
      ok: true,
      available: true,
      inspection,
      templates: catalogue.templates,
      source: { rootKind: source.rootKind, sessionId: source.sessionId }
    };
  }

  async function applyProjectTemplateState(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    const templateId = String(input.templateId || "").trim();
    if (!sessionId || !templateId) {
      throw vibe64Error("Choose a template in an open session first.", "vibe64_template_selection_required");
    }
    return runSessionSourceWorkExclusive({ sessionId }, async () => {
      const session = await sessionStore().readSession(sessionId);
      if (session.status !== "active" || session.agentRuns.some((run) => run.active)) {
        throw vibe64Error("Wait for the active work to finish before adding a starter.", "vibe64_template_session_busy");
      }
      const source = await sourceForInput({ sessionId });
      if (!source.sourceRoot) {
        throw vibe64Error("This session has no available source.", "vibe64_template_source_required");
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceMutationExclusive(selectedProjectRuntimeRoot(), async () => {
        // The browser selects a configured identity; it cannot supply a repository or ref.
        const application = await applyTemplate({ projectRoot: source.sourceRoot, templateId });
        return {
          ...await projectOnboardingState({ sessionId }),
          application,
          projectSlug: String(currentProjectRequestContext()?.slug || path.basename(requireSelectedTargetRoot())).trim()
        };
      }, { operation: "apply-project-template" });
    }, "apply-project-template");
  }

  async function saveEngineeringProfileState(input = {}) {
    let sourceInput = input;
    if (!String(input.sessionId || "").trim() && !selectedSourceRoot()) {
      const session = await sessionStore().readCurrentSession();
      if (session?.sessionId) {
        sourceInput = {
          ...input,
          sessionId: session.sessionId
        };
      }
    }
    return runSessionSourceWorkExclusive(sourceInput, async () => {
      const source = await genesisSettingsSourceForInput(sourceInput);
      if (!source.sourceRoot) {
        throw vibe64Error(
          "Engineering profiles require an available project source. Create or select an AI session first.",
          "vibe64_engineering_source_required"
        );
      }
      await assertProjectDirectoryUsable(source.sourceRoot);
      return runProjectSourceMutationExclusive(
        selectedProjectRuntimeRoot(),
        async () => {
          await setEngineeringProfile({
            profile: input.profile,
            projectRoot: source.sourceRoot
          });
          return {
            engineering: await engineeringProfileState(sourceInput),
            ok: true,
            projectSlug: path.basename(requireSelectedTargetRoot())
          };
        },
        {
          operation: "save-engineering-profile"
        }
      );
    }, "save-engineering-profile");
  }

  async function previewApplicationIdentitySource(input = {}) {
    const source = await sourceForInput(input);
    if (!source.sourceRoot) {
      throw vibe64Error(
        "Preview identities require an available project source. Create or select a session first.",
        "vibe64_preview_application_identities_source_required"
      );
    }
    await assertProjectDirectoryUsable(source.sourceRoot);
    return source;
  }

  async function previewApplicationIdentitiesState(input = {}) {
    const source = await previewApplicationIdentitySource(input);
    const { identities } = await readStoredPreviewApplicationIdentities({
      sourceRoot: source.sourceRoot
    });
    return {
      identities,
      ok: true
    };
  }

  async function createRuntime(options = {}) {
    const target = requireSelectedTargetRoot();
    const requestContext = currentProjectRequestContext() || {};
    return new Vibe64SessionRuntime({
      createSessionSource: options.createSessionSource,
      inspectSourceByDefault: options.inspectSource !== false,
      projectContextRoot: target,
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selectedSessionSourceRoot(),
      promptEnvironment: () => runWithProjectRequestContext(requestContext, promptEnvironment),
      store: sessionStore()
    });
  }

  async function runInProjectContext(slug = "", operation, {
    allowDeleting = false
  } = {}) {
    return runWithResolvedProjectRequestContext({
      projectContext: studioProjectContext,
      request: {
        allowDeleting,
        params: {
          slug
        }
      }
    }, operation);
  }

  return Object.freeze({
    readOnboarding(input = {}) {
      return projectResult(() => projectOnboardingState(input));
    },

    applyTemplate(input = {}) {
      return projectResult(() => applyProjectTemplateState(input));
    },
    get selectedProject() {
      return studioProjectContext.selectedProject;
    },

    get targetRoot() {
      return selectedTargetRoot();
    },

    async createProject(input = {}) {
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return catalogUnavailable();
      }
      return projectResult(() => studioProjectContext.createWorkspaceProject(input));
    },

    async createRuntime(options = {}) {
      return createRuntime(options);
    },

    async createSessionStore() {
      requireSelectedTargetRoot();
      return sessionStore();
    },

    async readSelectedSessionSource(input = {}) {
      const explicitProjectContextRoot = String(input.projectContextRoot || "").trim();
      const store = explicitProjectContextRoot
        ? createVibe64SessionStore({
            projectContextRoot: explicitProjectContextRoot,
            projectRuntimeRoot: String(input.projectRuntimeRoot || "").trim(),
            projectSessionSourceRoot: String(input.projectSessionSourceRoot || "").trim()
          })
        : sessionStore();
      const session = await store.readCurrentSession();
      if (!session) {
        return null;
      }
      const sourceRoot = sessionSourcePath(session);
      if (!sourceRoot) {
        throw vibe64Error(
          `The selected session ${session.sessionId} has no usable source.`,
          "vibe64_selected_session_source_unavailable"
        );
      }
      return {
        sessionId: session.sessionId,
        sourceRoot
      };
    },

    currentProjectRuntimeRoot: selectedProjectRuntimeRoot,
    currentProjectSessionSourceRoot: selectedSessionSourceRoot,
    currentProjectSourceConfigRoot: selectedSourceConfigRoot,
    currentProjectSourceRoot: selectedSourceRoot,
    currentServiceDataRoot() {
      return String(studioProjectContext.serviceDataRoot || "").trim();
    },
    currentTargetRoot: selectedTargetRoot,

    async developmentDatabasePolicy(input = {}) {
      return currentDevelopmentDatabasePolicy(input);
    },

    async listProjects() {
      return projectResult(() => listProjectsState());
    },

    async managedDevelopmentDatabaseDefaults(input = {}) {
      return managedDevelopmentDatabaseDefaults(input);
    },

    async projectExecutionEnvironment(input = {}) {
      if (input.reusePrepared === true) {
        // A failed read is not evidence of readiness. The ordinary preparation
        // path below remains responsible for provisioning and its diagnostics.
        const records = await userEnvRecords();
        const resolved = await resolvedProjectEnvironment(input, records).catch(() => null);
        if (resolved?.resourcesPrepared && await projectEnvironmentFilesAreCurrent({
          environment: resolved.projectEnvironment,
          files: resolved.environmentFiles,
          sourceRoot: resolved.source.sourceRoot
        })) {
          return projectEnvironmentResult(resolved, input, records);
        }
      }
      return runSessionSourceWorkExclusive(input, async () => {
        const records = await userEnvRecords();
        const resolved = await resolvedProjectEnvironment(
          input,
          records,
          { provisionResources: true }
        );
        await materializeProjectEnvironmentFiles({
          environment: resolved.projectEnvironment,
          files: resolved.environmentFiles,
          sourceRoot: resolved.source.sourceRoot
        });
        return projectEnvironmentResult(resolved, input, records);
      }, "prepare-project-environment");
    },

    async projectInspectionEnvironment(input = {}) {
      const records = await userEnvRecords();
      const resolved = await resolvedProjectEnvironment(input, records);
      return projectEnvironmentResult(resolved, input, records);
    },

    async sessionDatabaseEnvironment(input = {}) {
      const resolved = await resolvedProjectEnvironment(
        input,
        await userEnvRecords(),
        { provisionResources: false }
      );
      const databaseToolEnvironment = resolved.databaseToolEnvironment ||
        applicationDatabaseToolEnvironment(resolved.resources, resolved.projectEnvironment);
      return {
        ...(await currentDevelopmentDatabaseConfiguration()),
        databaseToolEnvironment,
        source: resolved.source,
      };
    },

    async readCurrentProject() {
      return currentProjectState();
    },

    async readEnv(input = {}) {
      return projectResult(() => readEnvState(input));
    },

    async readEngineeringSettings(input = {}) {
      return projectResult(async () => ({
        engineering: await engineeringProfileState(input),
        ok: true
      }));
    },

    async revealEnvSecret(input = {}) {
      return projectResult(() => revealEnvSecretState(input));
    },

    async readPreviewApplicationIdentities(input = {}) {
      return projectResult(() => previewApplicationIdentitiesState(input));
    },

    async readPromptHints() {
      return projectResult(async () => {
        const { settings } = await readProjectPromptHints({
          projectRuntimeRoot: selectedProjectRuntimeRoot()
        });
        return {
          ok: true,
          promptHints: settings.promptHints
        };
      });
    },

    async readSettings(input = {}) {
      return projectResult(async () => {
        const [collaboration, { settings }] = await Promise.all([
          collaborationSettingsState(input),
          readProjectPromptHints({
            projectRuntimeRoot: selectedProjectRuntimeRoot()
          })
        ]);
        return {
          collaboration,
          developmentDatabase: await developmentDatabaseState(),
          ok: true,
          promptHints: {
            canEdit: canEditProjectSettings(input),
            enabled: settings.promptHints
          }
        };
      });
    },

    async releaseSessionResources(input = {}) {
      const sessionId = String(input.sessionId || "").trim();
      if (!sessionId || typeof resourceEnvironmentProvider?.removeSessionResources !== "function") {
        return { ok: true };
      }
      const source = await sourceForInput({
        session: input.session,
        sessionId
      });
      return resourceEnvironmentProvider.removeSessionResources({
        ...(await currentDevelopmentDatabaseConfiguration()),
        projectRuntimeRoot: selectedProjectRuntimeRoot(),
        projectContextRoot: selectedTargetRoot(),
        sessionId,
        serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
        sourceRoot: source.sourceRoot
      });
    },

    requireSelectedTargetRoot,
    runInProjectContext,

    runProjectSourceExclusive(operation, options = {}) {
      return runProjectSourceMutationExclusive(
        selectedProjectRuntimeRoot(),
        operation,
        options
      );
    },

    runProjectSessionPolicyExclusive(operation, options = {}) {
      return runProjectSessionPolicyMutationExclusive(
        selectedProjectRuntimeRoot(),
        operation,
        options
      );
    },

    setResourceEnvironmentProvider(provider = null) {
      if (
        provider !== null &&
        (!provider || typeof provider !== "object" || typeof provider.environmentForResources !== "function")
      ) {
        throw new TypeError("Vibe64 resource environment provider must expose environmentForResources() or be null.");
      }
      resourceEnvironmentProvider = provider;
    },

    async saveEnvUserValues(input = {}) {
      return projectResult(() => runSessionSourceWorkExclusive(
        input,
        () => saveEnvState(input),
        "save-project-environment"
      ));
    },

    async saveDevelopmentDatabaseScope(input = {}) {
      return projectResult(() => saveDevelopmentDatabaseScopeState(input));
    },

    async saveEngineeringProfile(input = {}) {
      return projectResult(() => saveEngineeringProfileState(input));
    },

    async saveCollaborationSettings(input = {}) {
      return projectResult(() => saveCollaborationSettingsState(input));
    },

    async savePromptHints(input = {}) {
      return projectResult(() => savePromptHintsState(input));
    },

    async savePreviewApplicationIdentities(input = {}) {
      return projectResult(() => runSessionSourceWorkExclusive(input, async () => {
        const source = await previewApplicationIdentitySource(input);
        return runProjectSourceMutationExclusive(
          selectedProjectRuntimeRoot(),
          async () => {
            const { identities } = await saveStoredPreviewApplicationIdentities({
              identities: input.identities,
              sourceRoot: source.sourceRoot
            });
            return {
              identities,
              ok: true
            };
          },
          {
            operation: "save-preview-application-identities"
          }
        );
      }, "save-preview-application-identities"));
    },

    async selectProject(input = {}) {
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return catalogUnavailable();
      }
      return projectResult(() => studioProjectContext.selectWorkspaceProject(input));
    }
  });
}

export {
  createService,
  resolveVibe64TargetRoot
};
