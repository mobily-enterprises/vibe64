import { githubApi, projectGithubFullName } from "./githubApi.js";
import { readProjectRepositoryWorkflow } from "@local/vibe64-core/server/projectRepository";
import { readTeamAiStatus } from "@local/vibe64-core/server/teamAiGate";
import { assertLearningModeAllowsProject, learningModeProjectError, readLearningModeFor } from "@local/vibe64-core/server/learningMode";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { readProjectPromptHints } from "@local/vibe64-core/server/projectPromptHints";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
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
  savePreviewApplicationIdentities
} from "./previewApplicationIdentities.js";
import {
  runProjectSessionPolicyExclusive,
  runProjectSourceExclusive
} from "./projectSourceMutationLock.js";
import { createProjectDevelopmentDatabase } from "./projectDevelopmentDatabase.js";
import { createProjectEnvironment } from "./projectEnvironment.js";
import { createProjectOnboarding } from "./projectOnboarding.js";
import { createProjectRepositories } from "./projectRepositories.js";
import { projectResult } from "./projectResult.js";
import { createProjectSelection } from "./projectSelection.js";
import { createProjectSessionEnvironment } from "./projectSessionEnvironment.js";
import { createProjectSessionWork } from "./projectSessionWork.js";
import { createProjectSettings } from "./projectSettings.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */
/** @typedef {import("./types.js").PublishProjectChanged} PublishProjectChanged */
/** @typedef {import("./types.js").SavedEnvValues} SavedEnvValues */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */

function catalogUnavailable() {
  return {
    errors: [{
      code: "vibe64_project_catalog_unavailable",
      message: "Project catalog operations are not available in local editor mode."
    }],
    ok: false
  };
}

/**
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {(fullName: string, input: object) => Promise<object>} [dependencies.inspectConnectedRepository]
 * @param {typeof inspectGenesisCollaboration} [dependencies.inspectCollaboration]
 * @param {typeof inspectGenesisEngineering} [dependencies.inspectEngineering]
 * @param {typeof inspectGenesisEnvironment} [dependencies.inspectEnvironment]
 * @param {typeof inspectGenesisProject} [dependencies.inspectProject]
 * @param {typeof listGenesisTemplates} [dependencies.listTemplates]
 * @param {typeof applyGenesisTemplate} [dependencies.applyTemplate]
 * @param {StudioProjectContext} dependencies.projectContext
 * @param {PublishProjectChanged} dependencies.publishProjectChanged
 * @param {ProjectResourceEnvironment} dependencies.resourceEnvironmentProvider a host's managed resources, or local ones
 * @param {SavedEnvValues} dependencies.savedEnvValues a host's saved values, or none
 * @param {typeof setGenesisCollaboration} [dependencies.setCollaboration]
 * @param {typeof setGenesisEngineeringProfile} [dependencies.setEngineeringProfile]
 */
function createService({
  env,
  logger,
  inspectConnectedRepository = (fullName, input) => githubApi(input, {
    env,
    feature: "Connected repositories",
    failureCode: "vibe64_connections_access_failed"
  })(`repos/${fullName}`, undefined, "GET"),
  inspectCollaboration = inspectGenesisCollaboration,
  inspectEngineering = inspectGenesisEngineering,
  inspectEnvironment = inspectGenesisEnvironment,
  inspectProject = inspectGenesisProject,
  listTemplates = listGenesisTemplates,
  applyTemplate = applyGenesisTemplate,
  projectContext,
  publishProjectChanged,
  resourceEnvironmentProvider,
  savedEnvValues,
  setCollaboration = setGenesisCollaboration,
  setEngineeringProfile = setGenesisEngineeringProfile
}) {
  // Sessions sets the observer of an applied starter through setTemplateApplicationObserver after construction
  // and clears it at its shutdown.
  // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.project
  let templateApplicationObserver = null;
  const selection = createProjectSelection({ logger, projectContext });
  const environment = createProjectEnvironment({
    env,
    inspectEnvironment,
    resourceEnvironmentProvider,
    savedEnvValues,
    selection
  });
  const sessionWork = createProjectSessionWork({ environment, logger, selection });
  const developmentDatabase = createProjectDevelopmentDatabase({
    projectContext,
    resourceEnvironmentProvider,
    selection,
    sessionWork
  });
  const projectSettings = createProjectSettings({
    inspectCollaboration,
    inspectConnectedRepository,
    inspectEngineering,
    logger,
    selection,
    sessionWork,
    setCollaboration,
    setEngineeringProfile
  });
  const onboarding = createProjectOnboarding({
    applyTemplate,
    environment,
    inspectProject,
    listTemplates,
    selection,
    sessionWork
  });
  const sessionEnvironment = createProjectSessionEnvironment({
    environment,
    logger,
    resourceEnvironmentProvider,
    selection,
    sessionWork
  });
  const repositories = createProjectRepositories({
    env,
    logger,
    publishProjectChanged,
    selection
  });

  function readOnboarding(input) {
    return projectResult(() => onboarding.projectOnboardingState(input));
  }

  async function applyProjectTemplate(input) {
    const result = await projectResult(() => onboarding.applyProjectTemplateState(input));
    // The starter changed the Stack after the source locks were released; the
    // session owner prepares its workspace (dependencies, managed resources).
    const observer = templateApplicationObserver;
    if (result?.ok === true && observer) {
      void Promise.resolve()
        .then(() => observer({ sessionId: String(input.sessionId || "").trim() }))
        .catch((error) => logger.warn({ error: error?.message }, "Workspace preparation after a starter could not start."));
    }
    return result;
  }

  async function createProject(input) {
    if (projectContext.runtimeProfile?.projectCatalogEnabled === false) {
      return catalogUnavailable();
    }
    return projectResult(() => projectContext.createWorkspaceProject(input));
  }

  /**
   * Creates a project in Develop mode; Learn mode has only the learner's practice projects.
   * @param {object} input
   */
  async function createDevelopProject(input) {
    const mode = await readLearningModeFor(input.vibe64User);
    if (mode?.on) throw learningModeProjectError(mode);
    return createProject(input);
  }

  async function createRuntime(options = {}) {
    return sessionWork.createRuntime(options);
  }

  async function createRuntimeWithoutSource(options = {}) {
    return sessionWork.createRuntimeWithoutSource(options);
  }

  async function createSessionStore() {
    return selection.sessionStore();
  }

  async function readSelectedSessionSource(input = {}) {
    const explicitProjectContextRoot = String(input.projectContextRoot || "").trim();
    const store = explicitProjectContextRoot
      ? createVibe64SessionStore({
        projectContextRoot: explicitProjectContextRoot,
        projectRuntimeRoot: String(input.projectRuntimeRoot || "").trim(),
        projectSessionSourceRoot: String(input.projectSessionSourceRoot || "").trim()
      })
      : selection.sessionStore();
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
  }

  async function developmentDatabasePolicy(input = {}) {
    return developmentDatabase.currentDevelopmentDatabasePolicy(input);
  }

  /**
   * Every learner's practice project slug. Practice projects live in the
   * learning space, outside the catalogue that listProjects reads.
   */
  async function listPracticeProjectSlugs() {
    return (await projectContext.listLearningSpaceProjects()).map(project => project.slug);
  }

  async function listProjects({ actor = null } = {}) {
    return projectResult(async () => {
      const listed = await selection.listProjectsState();
      // The owner's list says when team members are waiting for team AI.
      const teamAi = await readTeamAiStatus({ actor });
      return teamAi ? { ...listed, teamAi } : listed;
    });
  }

  /**
   * The project list as the person in the input sees it.
   * @param {object} input
   */
  async function listProjectsFor(input) {
    return listProjects({ actor: input.vibe64User });
  }

  async function managedDevelopmentDatabaseDefaults(input = {}) {
    return developmentDatabase.managedDevelopmentDatabaseDefaults(input);
  }

  async function readCurrentProject() {
    return selection.currentProjectState();
  }

  /**
   * The current project's slug without listing projects, for hot paths.
   */
  function currentProjectSlug() {
    return selection.currentProjectSlug();
  }

  async function readEnv(input = {}) {
    return projectResult(() => environment.readEnvState(input));
  }

  async function readEngineeringSettings(input) {
    return projectResult(async () => ({
      engineering: await projectSettings.engineeringProfileState(input),
      ok: true
    }));
  }

  async function revealEnvSecret(input) {
    return projectResult(() => environment.revealEnvSecretState(input));
  }

  async function downloadEnv(input) {
    return projectResult(() => environment.downloadEnvState(input));
  }

  async function readPreviewApplicationIdentities(input = {}) {
    return projectResult(() => projectSettings.previewApplicationIdentitiesState(input));
  }

  async function readPromptHints() {
    return projectResult(async () => {
      const { settings } = await readProjectPromptHints({
        projectRuntimeRoot: selection.selectedProjectRuntimeRoot()
      });
      return {
        ok: true,
        promptHints: settings.promptHints
      };
    });
  }

  async function saveConnectedProjects(input) {
    return projectResult(() => projectSettings.saveConnectedProjectsState(input));
  }

  async function readSettings(input) {
    return projectResult(async () => {
      const [collaboration, connectedProjects, { settings }, currentProject] = await Promise.all([
        projectSettings.collaborationSettingsState(input),
        projectSettings.connectedProjectsState(input),
        readProjectPromptHints({
          projectRuntimeRoot: selection.selectedProjectRuntimeRoot()
        }),
        selection.currentProjectState()
      ]);
      return {
        collaboration,
        connectedProjects,
        repositoryWorkflow: {
          ...(await readProjectRepositoryWorkflow(selection.selectedProjectRuntimeRoot())),
          canEdit: projectSettings.canEditProjectSettings(input),
          available: Boolean(projectGithubFullName(currentProject))
        },
        developmentDatabase: await developmentDatabase.developmentDatabaseState(),
        ok: true,
        promptHints: {
          canEdit: projectSettings.canEditProjectSettings(input),
          enabled: settings.promptHints
        }
      };
    });
  }

  function runSelectedProjectSourceExclusive(operation, options = {}) {
    return runProjectSourceExclusive(
      selection.selectedProjectRuntimeRoot(),
      operation,
      options
    );
  }

  function runSelectedProjectSessionPolicyExclusive(operation, options = {}) {
    return runProjectSessionPolicyExclusive(
      selection.selectedProjectRuntimeRoot(),
      operation,
      options
    );
  }

  /**
   * Fills or, at its owner's shutdown, clears the observer of an applied starter.
   * @param {Function | null} observer
   */
  function setTemplateApplicationObserver(observer) {
    if (observer !== null && typeof observer !== "function") {
      throw new TypeError("Vibe64 template application observer must be a function or null.");
    }
    templateApplicationObserver = observer;
  }

  async function saveEnvUserValues(input = {}) {
    return projectResult(() => sessionWork.runSessionSourceWorkExclusive(
      input,
      () => environment.saveEnvState(input),
      "save-project-environment"
    ));
  }

  async function saveDevelopmentDatabaseScope(input) {
    return projectResult(() => developmentDatabase.saveDevelopmentDatabaseScopeState(input));
  }

  async function saveEngineeringProfile(input) {
    return projectResult(() => projectSettings.saveEngineeringProfileState(input));
  }

  async function saveCollaborationSettings(input) {
    return projectResult(() => projectSettings.saveCollaborationSettingsState(input));
  }

  async function savePromptHints(input) {
    return projectResult(() => projectSettings.savePromptHintsState(input));
  }

  async function saveProjectPreviewApplicationIdentities(input = {}) {
    return projectResult(() => sessionWork.runSessionSourceWorkExclusive(input, async () => {
      const source = await projectSettings.previewApplicationIdentitySource(input);
      return runProjectSourceExclusive(
        selection.selectedProjectRuntimeRoot(),
        async () => {
          const { identities } = await savePreviewApplicationIdentities({
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
  }

  async function selectProject(input) {
    if (projectContext.runtimeProfile?.projectCatalogEnabled === false) {
      return catalogUnavailable();
    }
    return projectResult(() => projectContext.selectWorkspaceProject(input));
  }

  /**
   * Selects a project the person's mode allows: practice projects in Learn mode, their own projects in Develop mode.
   * @param {object} input
   */
  async function selectProjectInMode(input) {
    await assertLearningModeAllowsProject({ actor: input.vibe64User, slug: input.slug });
    return selectProject(input);
  }

  return Object.freeze({
    readOnboarding,
    applyTemplate: applyProjectTemplate,
    get selectedProject() {
      return projectContext.selectedProject;
    },
    get targetRoot() {
      return selection.selectedTargetRoot();
    },
    createProject,
    createDevelopProject,
    createRuntime,
    createRuntimeWithoutSource,
    createSessionStore,
    readSelectedSessionSource,
    currentProjectRuntimeRoot: selection.selectedProjectRuntimeRoot,
    currentProjectSessionSourceRoot: selection.selectedSessionSourceRoot,
    currentProjectSourceConfigRoot: selection.selectedSourceConfigRoot,
    currentProjectSourceRoot: selection.selectedSourceRoot,
    currentServiceDataRoot: selection.serviceDataRoot,
    currentTargetRoot: selection.selectedTargetRoot,
    developmentDatabasePolicy,
    listPracticeProjectSlugs,
    listProjects,
    listProjectsFor,
    managedDevelopmentDatabaseDefaults,
    projectExecutionEnvironment: sessionEnvironment.projectExecutionEnvironment,
    projectInspectionEnvironment: sessionEnvironment.projectInspectionEnvironment,
    projectEnvironmentStatus: sessionEnvironment.projectEnvironmentStatus,
    localDatabaseServers: sessionEnvironment.localDatabaseServers,
    sessionDatabaseEnvironment: sessionEnvironment.sessionDatabaseEnvironment,
    repositoryRemote: repositories.repositoryRemote,
    repositoryBranches: repositories.repositoryBranches,
    resolveSessionBranch: repositories.resolveSessionBranch,
    inspectWorkspaceSetup: repositories.inspectWorkspaceSetup,
    inspectConnectedDevelopmentInputs: repositories.inspectConnectedDevelopmentInputs,
    prepareConnectedDevelopmentInputs: repositories.prepareConnectedDevelopmentInputs,
    readSessionConnectedRepositories: repositories.readSessionConnectedRepositories,
    readRepositoryWorkflow: repositories.readRepositoryWorkflow,
    saveRepositoryWorkflow: repositories.saveRepositoryWorkflow,
    refreshGithub: repositories.refreshGithub,
    listGithubIssues: repositories.listGithubIssues,
    readGithubIssue: repositories.readGithubIssue,
    createGithubIssue: repositories.createGithubIssue,
    editGithubIssue: repositories.editGithubIssue,
    commentOnGithubIssue: repositories.commentOnGithubIssue,
    editGithubIssueComment: repositories.editGithubIssueComment,
    updateGithubIssueState: repositories.updateGithubIssueState,
    listGithubIssueLabels: repositories.listGithubIssueLabels,
    createGithubIssueLabel: repositories.createGithubIssueLabel,
    updateGithubIssueLabels: repositories.updateGithubIssueLabels,
    listGithubIssueMentions: repositories.listGithubIssueMentions,
    listGithubPullRequests: repositories.listGithubPullRequests,
    readGithubPullRequest: repositories.readGithubPullRequest,
    markGithubPullRequestReady: repositories.markGithubPullRequestReady,
    updateGithubPullRequestBranch: repositories.updateGithubPullRequestBranch,
    mergeGithubPullRequest: repositories.mergeGithubPullRequest,
    resolvePullRequestSource: repositories.resolvePullRequestSource,
    preparePullRequestSource: repositories.preparePullRequestSource,
    publishSessionPullRequest: repositories.publishSessionPullRequest,
    readCurrentProject,
    currentProjectSlug,
    readEnv,
    readEngineeringSettings,
    revealEnvSecret,
    downloadEnv,
    readPreviewApplicationIdentities,
    readPromptHints,
    saveConnectedProjects,
    readSettings,
    releaseSessionResources: sessionEnvironment.releaseSessionResources,
    requireSelectedTargetRoot: selection.requireSelectedTargetRoot,
    runInProjectContext: selection.runInProjectContext,
    runProjectSourceExclusive: runSelectedProjectSourceExclusive,
    runProjectSessionPolicyExclusive: runSelectedProjectSessionPolicyExclusive,
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.project
    setTemplateApplicationObserver,
    saveEnvUserValues,
    saveDevelopmentDatabaseScope,
    saveEngineeringProfile,
    saveCollaborationSettings,
    savePromptHints,
    savePreviewApplicationIdentities: saveProjectPreviewApplicationIdentities,
    selectProject,
    selectProjectInMode
  });
}

export {
  createService
};
