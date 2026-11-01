import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, PROJECT_OPERATION, PROJECT_OWNER_OPERATION } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
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
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("./types.js").ProjectService} ProjectService */

const ACTION_REPOSITORY_REMOTE = "vibe64.project.repository.remote";
const ACTION_READ_REPOSITORY_REMOTE = "vibe64.project.repository.remote.read";
const ACTION_READ_REPOSITORY_BRANCHES = "vibe64.project.repository.branches.read";
const ACTION_SAVE_REPOSITORY_WORKFLOW = "vibe64.project.repository.workflow.save";
const ACTION_REVEAL_ENV_SECRET = "vibe64.project.env.secret.reveal";
const ACTION_DOWNLOAD_ENV = "vibe64.project.env.download";
const ACTION_LIST_ISSUES = "vibe64.project.issues.list";
const ACTION_READ_ISSUE = "vibe64.project.issues.read";
const ACTION_CREATE_ISSUE = "vibe64.project.issues.create";
const ACTION_EDIT_ISSUE = "vibe64.project.issues.edit";
const ACTION_COMMENT_ON_ISSUE = "vibe64.project.issues.comment";
const ACTION_EDIT_ISSUE_COMMENT = "vibe64.project.issues.edit-comment";
const ACTION_SET_ISSUE_STATE = "vibe64.project.issues.state";
const ACTION_LIST_ISSUE_LABELS = "vibe64.project.issues.labels";
const ACTION_CREATE_ISSUE_LABEL = "vibe64.project.issues.create-label";
const ACTION_SET_ISSUE_LABELS = "vibe64.project.issues.set-labels";
const ACTION_LIST_ISSUE_MENTIONS = "vibe64.project.issues.mentions";
const ACTION_LIST_PULL_REQUESTS = "vibe64.project.pull-requests.list";
const ACTION_READ_PULL_REQUEST = "vibe64.project.pull-requests.read";
const ACTION_MARK_PULL_REQUEST_READY = "vibe64.project.pull-requests.ready";
const ACTION_UPDATE_PULL_REQUEST_BRANCH = "vibe64.project.pull-requests.update-branch";
const ACTION_MERGE_PULL_REQUEST = "vibe64.project.pull-requests.merge";
const ACTION_SAVE_CONNECTED_PROJECTS = "vibe64.project.connections.save";
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
        ...input,
        ...result,
        projectSlug: projectSlug(result) || projectSlug(input)
      })
    }
  });
}

function projectRecord(value = {}) {
  const result = normalizeObject(value);
  if (result.currentProject && typeof result.currentProject === "object" && !Array.isArray(result.currentProject)) {
    return result.currentProject;
  }
  if (result.project && typeof result.project === "object" && !Array.isArray(result.project)) {
    return result.project;
  }
  return {};
}

function projectSlug(value = {}) {
  const source = normalizeObject(value);
  const project = projectRecord(source);
  return String(
    source.projectSlug || source.slug || source.name || project.slug || project.name || currentProjectRequestContext()?.slug || ""
  ).trim();
}

function projectRealtimePayload(value = {}) {
  const source = normalizeObject(value);
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
 * @param {RuntimeEvents} dependencies.events
 */
function createVibe64ProjectChangedPublisher({ events }) {
  return async function publishVibe64ProjectChanged(value = {}, options = {}) {
    const {
      actorId = null,
      operation = "updated",
      reason = ""
    } = options;
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


/**
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 */
function createProjectActions({ project }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_REPOSITORY_REMOTE,
      input: emptyProjectInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: () => project.repositoryRemote()
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_REPOSITORY_BRANCHES,
      input: projectRepositoryBranchesInputValidator,
      extensions: {
        assistant: {
          description: "Read current saved branch names and exact commits for a GitHub or Vibe64 Git project. Returns at most ten branches: use nextOffset to continue, or name for an exact branch lookup. These are saved repository branches, not another session's unsaved files or conversation. Pass a freshly read commit unchanged as repositoryBranch.expectedCommit when creating a session. Opening an existing branch uses name; creating a new branch also supplies fromBranch. Local-source projects use their existing local Git controls through a coding conversation.",
          output: {
            mode: "replace",
            schema: createSchema({
              ok: { type: "boolean", required: true },
              error: { type: "string", maxLength: 512, required: false },
              branches: {
                type: "array",
                required: true,
                items: createSchema({
                  name: { type: "string", maxLength: 4096, noTrim: true, required: true },
                  commit: { type: "string", maxLength: 64, required: true }
                })
              },
              defaultBranch: { type: "string", maxLength: 4096, noTrim: true, required: false },
              total: { type: "integer", required: true },
              offset: { type: "integer", required: true },
              nextOffset: { type: "integer", nullable: true, required: true }
            })
          },
          transformResult(result) {
            const branches = (result.branches || []).slice(0, 10).map(({ name, commit }) => ({ name, commit }));
            const offset = result.offset || 0;
            const total = result.total ?? (result.branches || []).length;
            return {
              ok: result.ok === true,
              branches,
              total,
              offset,
              nextOffset: offset + branches.length < total ? offset + branches.length : null,
              ...(result.defaultBranch ? { defaultBranch: result.defaultBranch } : {}),
              ...(result.error || result.errors?.[0]?.message
                ? { error: String(result.error || result.errors[0].message).slice(0, 512) }
                : {})
            };
          }
        },
        vibe64: PROJECT_OPERATION
      },
      execute: (input) => project.repositoryBranches(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_REPOSITORY_WORKFLOW,
      input: projectRepositoryWorkflowInputValidator,
      extensions: { assistant: settingsTool("repository.workflow.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveRepositoryWorkflow(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_REVEAL_ENV_SECRET,
      input: projectEnvSecretRevealInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.revealEnvSecret(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_DOWNLOAD_ENV,
      input: projectEnvDownloadInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.downloadEnv(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_ISSUES,
      input: projectIssueInputValidators.list,
      extensions: { assistant: issueTool("list"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.listGithubIssues(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_ISSUE,
      input: projectIssueInputValidators.read,
      extensions: { assistant: issueTool("read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readGithubIssue(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_ISSUE,
      input: projectIssueInputValidators.create,
      extensions: { assistant: issueTool("create"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.createGithubIssue(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_EDIT_ISSUE,
      input: projectIssueInputValidators.edit,
      extensions: { assistant: issueTool("edit"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.editGithubIssue(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_COMMENT_ON_ISSUE,
      input: projectIssueInputValidators.comment,
      extensions: { assistant: issueTool("comment"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.commentOnGithubIssue(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_EDIT_ISSUE_COMMENT,
      input: projectIssueInputValidators["edit-comment"],
      extensions: { assistant: issueTool("edit-comment"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.editGithubIssueComment(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SET_ISSUE_STATE,
      input: projectIssueInputValidators.state,
      extensions: { assistant: issueTool("state"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.updateGithubIssueState(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_ISSUE_LABELS,
      input: projectIssueInputValidators.labels,
      extensions: { assistant: issueTool("labels"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.listGithubIssueLabels(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_ISSUE_LABEL,
      input: projectIssueInputValidators["create-label"],
      extensions: { assistant: issueTool("create-label"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.createGithubIssueLabel(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SET_ISSUE_LABELS,
      input: projectIssueInputValidators["set-labels"],
      extensions: { assistant: issueTool("set-labels"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.updateGithubIssueLabels(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_ISSUE_MENTIONS,
      input: projectIssueInputValidators.mentions,
      extensions: { assistant: issueTool("mentions"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.listGithubIssueMentions(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_PULL_REQUESTS,
      input: projectPullRequestInputValidators.list,
      extensions: { assistant: pullRequestTool("list"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.listGithubPullRequests(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_PULL_REQUEST,
      input: projectPullRequestInputValidators.read,
      extensions: { assistant: pullRequestTool("read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readGithubPullRequest(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_MARK_PULL_REQUEST_READY,
      input: projectPullRequestInputValidators.ready,
      extensions: { assistant: pullRequestTool("ready"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.markGithubPullRequestReady(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_UPDATE_PULL_REQUEST_BRANCH,
      input: projectPullRequestInputValidators["update-branch"],
      extensions: { assistant: pullRequestTool("update-branch"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.updateGithubPullRequestBranch(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_MERGE_PULL_REQUEST,
      input: projectPullRequestInputValidators.merge,
      extensions: { assistant: pullRequestTool("merge"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.mergeGithubPullRequest(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_ONBOARDING,
      input: projectOnboardingInputValidator,
      extensions: { assistant: onboardingReadTool, vibe64: PROJECT_OPERATION },
      execute: (input) => project.readOnboarding(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_APPLY_TEMPLATE,
      input: projectTemplateInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: onboardingTemplateTool, vibe64: PROJECT_OPERATION },
      execute: (input) => project.applyTemplate(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_REPOSITORY_REMOTE,
      input: projectRemoteInputValidator,
      events: [projectChangedEvent()],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => project.repositoryRemote(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_PROJECTS,
      input: projectsReadInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => project.listProjectsFor(input)
    }),
    // Members create practice projects only through lessons.
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_CREATE_PROJECT,
      input: projectCreateInputValidator,
      events: [projectChangedEvent({ operation: "created" })],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.createDevelopProject(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SELECT_PROJECT,
      input: projectSelectInputValidator,
      events: [projectChangedEvent()],
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => project.selectProjectInMode(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_ENV,
      input: projectEnvReadInputValidator,
      extensions: { assistant: settingsTool("env.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readEnv(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_ENV_USER_VALUES,
      input: projectEnvUserValuesInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("env.user-values.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveEnvUserValues(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_PROJECT_SETTINGS,
      input: projectSettingsReadInputValidator,
      extensions: { assistant: settingsTool("settings.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readSettings(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_CONNECTED_PROJECTS,
      input: projectConnectedProjectsInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("connections.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveConnectedProjects(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_ENGINEERING_SETTINGS,
      input: projectEngineeringSettingsReadInputValidator,
      extensions: { assistant: settingsTool("engineering.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readEngineeringSettings(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_COLLABORATION_SETTINGS,
      input: projectCollaborationInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("collaboration.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.saveCollaborationSettings(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_PROJECT_PROMPT_HINTS,
      input: projectPromptHintsInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("prompt-hints.save"), vibe64: PROJECT_OWNER_OPERATION },
      execute: (input) => project.savePromptHints(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_ENGINEERING_PROFILE,
      input: projectEngineeringProfileInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("engineering.profile.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveEngineeringProfile(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
      input: projectDevelopmentDatabaseScopeInputValidator,
      events: [projectChangedEvent()],
      extensions: { assistant: settingsTool("development-database.scope.save"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.saveDevelopmentDatabaseScope(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
      input: previewApplicationIdentitiesReadInputValidator,
      extensions: { assistant: settingsTool("preview-identities.read"), vibe64: PROJECT_OPERATION },
      execute: (input) => project.readPreviewApplicationIdentities(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
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
  ACTION_APPLY_TEMPLATE,
  ACTION_COMMENT_ON_ISSUE,
  ACTION_CREATE_ISSUE,
  ACTION_CREATE_ISSUE_LABEL,
  ACTION_CREATE_PROJECT,
  ACTION_DOWNLOAD_ENV,
  ACTION_EDIT_ISSUE,
  ACTION_EDIT_ISSUE_COMMENT,
  ACTION_LIST_ISSUES,
  ACTION_LIST_ISSUE_LABELS,
  ACTION_LIST_ISSUE_MENTIONS,
  ACTION_LIST_PROJECTS,
  ACTION_LIST_PULL_REQUESTS,
  ACTION_MARK_PULL_REQUEST_READY,
  ACTION_MERGE_PULL_REQUEST,
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_ENV,
  ACTION_READ_ISSUE,
  ACTION_READ_ONBOARDING,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PULL_REQUEST,
  ACTION_READ_REPOSITORY_BRANCHES,
  ACTION_READ_REPOSITORY_REMOTE,
  ACTION_REPOSITORY_REMOTE,
  ACTION_REVEAL_ENV_SECRET,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_CONNECTED_PROJECTS,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SAVE_REPOSITORY_WORKFLOW,
  ACTION_SELECT_PROJECT,
  ACTION_SET_ISSUE_LABELS,
  ACTION_SET_ISSUE_STATE,
  ACTION_UPDATE_PULL_REQUEST_BRANCH,
  createVibe64ProjectChangedPublisher,
  createProjectActions
};
