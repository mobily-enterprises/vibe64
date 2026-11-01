import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, NOT_A_TOOL, PROJECT_OPERATION, PROJECT_OWNER_OPERATION } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { assertLearningModeAllowsProject, learningModeProjectError, readLearningModeFor } from "@local/vibe64-core/server/learningMode";
import { issueTool, pullRequestTool } from "./assistantContracts.js";
import { onboardingReadTool, onboardingTemplateTool } from "./onboardingAssistantContracts.js";
import { settingsTool } from "./settingsAssistantContracts.js";

import {
  projectRemoteInputValidator,
  projectRepositoryBranchesInputValidator,
  projectEnvDownloadInputValidator,
  projectEnvSecretRevealInputValidator,
  emptyProjectInputValidator,
  projectRepositoryWorkflowInputValidator,
  projectIssueInputValidators,
  projectPullRequestInputValidators,
  projectOnboardingInputValidator,
  projectTemplateInputValidator,
  projectCollaborationInputValidator,
  projectCreateInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectEngineeringProfileInputValidator,
  projectEngineeringSettingsReadInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectSettingsReadInputValidator,
  projectConnectedProjectsInputValidator,
  projectPromptHintsInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
} from "./inputSchemas.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("./types.js").ProjectService} ProjectService */

const ACTION_REPOSITORY_REMOTE = "vibe64.project.repository.remote";
const ACTION_CREATE_PROJECT = "vibe64.project.projects.create";
const ACTION_READ_ONBOARDING = "vibe64.project.onboarding.read";
const ACTION_APPLY_TEMPLATE = "vibe64.project.templates.apply";
const ACTION_LIST_PROJECTS = "vibe64.project.projects.list";
const ACTION_SELECT_PROJECT = "vibe64.project.projects.select";
const ACTION_READ_ENV = "vibe64.project.env.read";
const ACTION_SAVE_ENV_USER_VALUES = "vibe64.project.env.user-values.save";
const ACTION_READ_PROJECT_SETTINGS = "vibe64.project.settings.read";
const ACTION_READ_ENGINEERING_SETTINGS = "vibe64.project.engineering.read";
const ACTION_SAVE_COLLABORATION_SETTINGS = "vibe64.project.collaboration.save";
const ACTION_SAVE_ENGINEERING_PROFILE = "vibe64.project.engineering.profile.save";
const ACTION_SAVE_PROJECT_PROMPT_HINTS = "vibe64.project.prompt-hints.save";
const ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE = "vibe64.project.development-database.scope.save";
const ACTION_READ_PREVIEW_APPLICATION_IDENTITIES = "vibe64.project.preview-identities.read";
const ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES = "vibe64.project.preview-identities.save";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

function projectChangedEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: "vibe64",
    entity: "project",
    operation,
    entityId: ({ input, result }) => result?.ok === false || result?.remoteChanged === false
      ? null
      : projectSlug(result) || projectSlug(input) || "projects",
    realtime: {
      audience: "all_clients",
      event: VIBE64_PROJECT_CHANGED_EVENT,
      payload: ({ input, result }) => projectRealtimePayload({
        ...input, ...result,
        projectSlug: projectSlug(result) || projectSlug(input)
      })
    }
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function projectRecord(value = {}) {
  const result = record(value);
  if (result.currentProject && typeof result.currentProject === "object" && !Array.isArray(result.currentProject)) {
    return result.currentProject;
  }
  if (result.project && typeof result.project === "object" && !Array.isArray(result.project)) {
    return result.project;
  }
  return {};
}

function projectSlug(value = {}) {
  const source = record(value);
  const project = projectRecord(source);
  return String(
    source.projectSlug || source.slug || source.name || project.slug || project.name || currentProjectRequestContext()?.slug || ""
  ).trim();
}

function projectRealtimePayload(value = {}) {
  const source = record(value);
  const slug = projectSlug(source);
  return {
    ...(slug ? { projectSlug: slug } : {}),
    ...(source.runtime ? { runtime: source.runtime } : {}),
    ...(source.runtime?.open === false ? { message: "Project is closed." } : {}),
    ...(source.action ? { action: String(source.action).trim() } : {}),
    ...(source.action === "runtime-closed" && source.runtime?.open === false && source.runtimeDormantClose === true
      ? { runtimeDormantClose: true } : {}),
    ...(source.action === "runtime-closed" && source.runtime?.open === false && source.runtimeCloseReason
      ? { runtimeCloseReason: String(source.runtimeCloseReason).trim().slice(0, 100) } : {}),
    ...(source.githubRefresh === true ? { githubRefresh: true } : {}),
    ...(typeof source.repositoryWorkflow?.requirePullRequest === "boolean"
      ? { repositoryWorkflow: { requirePullRequest: source.repositoryWorkflow.requirePullRequest } }
      : {}),
    ...(source.issueComment ? {
      issueComment: {
        number: source.issueComment.number,
        id: source.issueComment.id,
        author: source.issueComment.author
      },
      originId: String(source.originId || "").trim().slice(0, 200)
    } : {}),
    ...(typeof source.hasSelection === "boolean" ? { hasSelection: source.hasSelection } : {})
  };
}

/**
 * Without runtime events a project change goes unannounced; readers see it
 * on their next read.
 */
async function announceNoProjectChange() {
  return null;
}

/**
 * @param {object} dependencies
 * @param {RuntimeEvents | null} dependencies.events
 */
function createVibe64ProjectChangedPublisher({ events }) {
  if (!events) return announceNoProjectChange;

  return async function publishVibe64ProjectChanged(value = {}, {
    actorId = null,
    operation = "updated",
    reason = ""
  } = {}) {
    const catalogChange = operation === "deleted";
    const slug = catalogChange ? "" : projectSlug(value);
    return events.publish({
      type: "entity.changed",
      source: "vibe64",
      entity: "project",
      operation,
      entityId: slug || "projects",
      scope: {
        kind: "global",
        id: null
      },
      actorId,
      occurredAt: new Date().toISOString(),
      realtime: {
        audience: "all_clients",
        event: VIBE64_PROJECT_CHANGED_EVENT,
        payload: {
          ...(catalogChange ? {} : projectRealtimePayload(value)),
          ...(reason ? { reason: String(reason).trim() } : {})
        }
      }
    });
  };
}

// A project operation: a query reads, a command changes the project.
const PROJECT_QUERY = Object.freeze({ version: 1, kind: "query", output: null, idempotency: "none", events: [] });
const PROJECT_COMMAND = Object.freeze({ version: 1, kind: "command", output: null, idempotency: "optional", events: [] });

/**
 * Learn mode has only the learner's practice projects; new projects belong to Develop.
 * @param {ProjectService} project
 * @param {object} input
 * @param {object} context
 */
async function createDevelopProject(project, input, context) {
  const mode = await readLearningModeFor(authenticatedVibe64User(context));
  if (mode?.on) throw learningModeProjectError(mode);
  return project.createProject(input);
}

/**
 * A project selection the person's mode allows: practice projects in Learn
 * mode, their own projects in Develop mode.
 * @param {ProjectService} project
 * @param {object} input
 * @param {object} context
 */
async function selectProjectInMode(project, input, context) {
  await assertLearningModeAllowsProject({ actor: authenticatedVibe64User(context), slug: input.slug });
  return project.selectProject(input);
}

/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 */
function createProjectActions({ project }) {
  return Object.freeze([
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.repository.remote.read",
      input: emptyProjectInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: () => project.repositoryRemote()
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.repository.branches.read",
      input: projectRepositoryBranchesInputValidator,
      extensions: { assistant: {
        description: "Read current saved branch names and exact commits for a GitHub or Vibe64 Git project. Returns at most ten branches: use nextOffset to continue, or name for an exact branch lookup. These are saved repository branches, not another session's unsaved files or conversation. Pass a freshly read commit unchanged as repositoryBranch.expectedCommit when creating a session. Opening an existing branch uses name; creating a new branch also supplies fromBranch. Local-source projects use their existing local Git controls through a coding conversation.",
        output: { mode: "replace", schema: createSchema({
          ok: { type: "boolean", required: true }, error: { type: "string", maxLength: 512, required: false },
          branches: { type: "array", required: true, items: createSchema({
            name: { type: "string", maxLength: 4096, noTrim: true, required: true },
            commit: { type: "string", maxLength: 64, required: true }
          }) },
          defaultBranch: { type: "string", maxLength: 4096, noTrim: true, required: false },
          total: { type: "integer", required: true }, offset: { type: "integer", required: true },
          nextOffset: { type: "integer", nullable: true, required: true }
        }) },
        transformResult(result) {
          const branches = (result.branches || []).slice(0, 10).map(({ name, commit }) => ({ name, commit }));
          const offset = result.offset || 0;
          const total = result.total ?? (result.branches || []).length;
          return { ok: result.ok === true, branches, total, offset, nextOffset: offset + branches.length < total ? offset + branches.length : null,
            ...(result.defaultBranch ? { defaultBranch: result.defaultBranch } : {}),
            ...(result.error || result.errors?.[0]?.message ? { error: String(result.error || result.errors[0].message).slice(0, 512) } : {}) };
        }
      }, vibe64: PROJECT_OPERATION },
      execute: (input) => project.repositoryBranches(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.repository.workflow.save",
      input: projectRepositoryWorkflowInputValidator,
      extensions: { assistant: settingsTool("repository.workflow.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveRepositoryWorkflow(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.env.secret.reveal",
      input: projectEnvSecretRevealInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.revealEnvSecret(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.env.download",
      input: projectEnvDownloadInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.downloadEnv(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.issues.list",
      input: projectIssueInputValidators.list,
      extensions: { assistant: issueTool("list"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "list" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.issues.read",
      input: projectIssueInputValidators.read,
      extensions: { assistant: issueTool("read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "read" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.create",
      input: projectIssueInputValidators.create,
      extensions: { assistant: issueTool("create"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "create" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.edit",
      input: projectIssueInputValidators.edit,
      extensions: { assistant: issueTool("edit"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "edit" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.comment",
      input: projectIssueInputValidators.comment,
      extensions: { assistant: issueTool("comment"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "comment" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.edit-comment",
      input: projectIssueInputValidators["edit-comment"],
      extensions: { assistant: issueTool("edit-comment"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "edit-comment" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.state",
      input: projectIssueInputValidators.state,
      extensions: { assistant: issueTool("state"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "state" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.issues.labels",
      input: projectIssueInputValidators.labels,
      extensions: { assistant: issueTool("labels"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "labels" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.create-label",
      input: projectIssueInputValidators["create-label"],
      extensions: { assistant: issueTool("create-label"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "create-label" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.issues.set-labels",
      input: projectIssueInputValidators["set-labels"],
      extensions: { assistant: issueTool("set-labels"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "set-labels" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.issues.mentions",
      input: projectIssueInputValidators.mentions,
      extensions: { assistant: issueTool("mentions"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubIssues({ ...input, operation: "mentions" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.pull-requests.list",
      input: projectPullRequestInputValidators.list,
      extensions: { assistant: pullRequestTool("list"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubPullRequests({ ...input, operation: "list" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: "vibe64.project.pull-requests.read",
      input: projectPullRequestInputValidators.read,
      extensions: { assistant: pullRequestTool("read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubPullRequests({ ...input, operation: "read" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.pull-requests.ready",
      input: projectPullRequestInputValidators.ready,
      extensions: { assistant: pullRequestTool("ready"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubPullRequests({ ...input, operation: "ready" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.pull-requests.update-branch",
      input: projectPullRequestInputValidators["update-branch"],
      extensions: { assistant: pullRequestTool("update-branch"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubPullRequests({ ...input, operation: "update-branch" })
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.pull-requests.merge",
      input: projectPullRequestInputValidators.merge,
      extensions: { assistant: pullRequestTool("merge"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.githubPullRequests({ ...input, operation: "merge" })
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_READ_ONBOARDING,
      input: projectOnboardingInputValidator,
      extensions: { assistant: onboardingReadTool, vibe64: PROJECT_OPERATION },
      execute: (input) => project.readOnboarding(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_APPLY_TEMPLATE,
      input: projectTemplateInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: onboardingTemplateTool, vibe64: PROJECT_OPERATION },
      execute: (input) => project.applyTemplate(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_REPOSITORY_REMOTE,
      input: projectRemoteInputValidator,
      events: [projectChangedEvent()],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => project.repositoryRemote(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_LIST_PROJECTS,
      input: projectsReadInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (_input, context) => project.listProjects({ actor: authenticatedVibe64User(context) })
    }),
    Object.freeze({
      // Members create practice projects only through lessons.
      ...PROJECT_COMMAND,
      id: ACTION_CREATE_PROJECT,
      input: projectCreateInputValidator,
      events: [projectChangedEvent({ operation: "created" })],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input, context) => createDevelopProject(project, input, context)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SELECT_PROJECT,
      input: projectSelectInputValidator,
      events: [projectChangedEvent()],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input, context) => selectProjectInMode(project, input, context)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_READ_ENV,
      input: projectEnvReadInputValidator,
      extensions: { assistant: settingsTool("env.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readEnv(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_ENV_USER_VALUES,
      input: projectEnvUserValuesInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("env.user-values.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveEnvUserValues(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_READ_PROJECT_SETTINGS,
      input: projectSettingsReadInputValidator,
      extensions: { assistant: settingsTool("settings.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readSettings(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: "vibe64.project.connections.save",
      input: projectConnectedProjectsInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("connections.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveConnectedProjects(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_READ_ENGINEERING_SETTINGS,
      input: projectEngineeringSettingsReadInputValidator,
      extensions: { assistant: settingsTool("engineering.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readEngineeringSettings(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_COLLABORATION_SETTINGS,
      input: projectCollaborationInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("collaboration.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveCollaborationSettings(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_PROJECT_PROMPT_HINTS,
      input: projectPromptHintsInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("prompt-hints.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.savePromptHints(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_ENGINEERING_PROFILE,
      input: projectEngineeringProfileInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("engineering.profile.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveEngineeringProfile(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
      input: projectDevelopmentDatabaseScopeInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("development-database.scope.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveDevelopmentDatabaseScope(input)
    }),
    Object.freeze({
      ...PROJECT_QUERY,
      id: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
      input: previewApplicationIdentitiesReadInputValidator,
      extensions: { assistant: settingsTool("preview-identities.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readPreviewApplicationIdentities(input)
    }),
    Object.freeze({
      ...PROJECT_COMMAND,
      id: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
      input: previewApplicationIdentitiesInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("preview-identities.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.savePreviewApplicationIdentities(input)
    })
  ]);
}

export {
  announceNoProjectChange,
  ACTION_REPOSITORY_REMOTE,
  ACTION_READ_ONBOARDING,
  ACTION_APPLY_TEMPLATE,
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_READ_ENV,
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SELECT_PROJECT,
  createVibe64ProjectChangedPublisher,
  createProjectActions
};
