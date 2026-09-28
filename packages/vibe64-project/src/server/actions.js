import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { issueTool, pullRequestTool } from "./assistantContracts.js";

import {
  projectRemoteInputValidator,
  projectRepositoryBranchesInputValidator,
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
  projectPromptHintsInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
} from "./inputSchemas.js";

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

function createVibe64ProjectChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

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

function action({ assistant, events = [], execute, id, input, kind, ownerRequired = false }) {
  return withVibe64ActionContext({
    id,
    version: 1,
    kind,
    input,
    output: null,
    ...(assistant ? { extensions: { assistant } } : {}),
    idempotency: kind === "query" ? "none" : "optional",
    audit: {
      actionName: id
    },
    observability: {},
    events,
    execute
  }, { ownerRequired });
}

function createProjectActions({ project } = {}) {
  if (!project) {
    throw new TypeError("createProjectActions requires project.");
  }

  return Object.freeze([
    action({ id: "vibe64.project.repository.remote.read", kind: "query", input: emptyProjectInputValidator,
      execute: () => project.repositoryRemote() }),
    action({ id: "vibe64.project.repository.branches.read", kind: "query", input: projectRepositoryBranchesInputValidator,
      assistant: {
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
      },
      execute: (input) => project.repositoryBranches(input) }),
    action({ id: "vibe64.project.repository.workflow.save", kind: "command", input: projectRepositoryWorkflowInputValidator,
      ownerRequired: true, execute: (input) => project.saveRepositoryWorkflow(input) }),
    action({ id: "vibe64.project.env.secret.reveal", kind: "query", input: projectEnvSecretRevealInputValidator,
      ownerRequired: true, execute: (input) => project.revealEnvSecret(input) }),
    ...Object.entries(projectIssueInputValidators).map(([operation, input]) => action({
      id: `vibe64.project.issues.${operation}`, input,
      assistant: issueTool(operation),
      kind: ["list", "read", "labels", "mentions"].includes(operation) ? "query" : "command",
      execute: (input) => project.githubIssues({ ...input, operation })
    })),
    ...Object.entries(projectPullRequestInputValidators).map(([operation, input]) => action({
      id: `vibe64.project.pull-requests.${operation}`, input,
      assistant: pullRequestTool(operation),
      kind: ["list", "read"].includes(operation) ? "query" : "command",
      execute: (input) => project.githubPullRequests({ ...input, operation })
    })),
    action({
      id: ACTION_READ_ONBOARDING,
      kind: "query",
      input: projectOnboardingInputValidator,
      execute: (input) => project.readOnboarding(input)
    }),
    action({
      id: ACTION_APPLY_TEMPLATE,
      kind: "command",
      input: projectTemplateInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.applyTemplate(input)
    }),
    action({
      id: ACTION_REPOSITORY_REMOTE,
      kind: "command",
      input: projectRemoteInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.repositoryRemote(input)
    }),
    action({
      id: ACTION_LIST_PROJECTS,
      kind: "query",
      input: projectsReadInputValidator,
      execute: () => project.listProjects()
    }),
    action({
      id: ACTION_CREATE_PROJECT,
      kind: "command",
      input: projectCreateInputValidator,
      events: [projectChangedEvent({ operation: "created" })],
      execute: (input) => project.createProject(input)
    }),
    action({
      id: ACTION_SELECT_PROJECT,
      kind: "command",
      input: projectSelectInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.selectProject(input)
    }),
    action({
      id: ACTION_READ_ENV,
      kind: "query",
      input: projectEnvReadInputValidator,
      execute: (input) => project.readEnv(input)
    }),
    action({
      id: ACTION_SAVE_ENV_USER_VALUES,
      kind: "command",
      input: projectEnvUserValuesInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveEnvUserValues(input)
    }),
    action({
      id: ACTION_READ_PROJECT_SETTINGS,
      kind: "query",
      input: projectSettingsReadInputValidator,
      execute: (input) => project.readSettings(input)
    }),
    action({
      id: ACTION_READ_ENGINEERING_SETTINGS,
      kind: "query",
      input: projectEngineeringSettingsReadInputValidator,
      execute: (input) => project.readEngineeringSettings(input)
    }),
    action({
      id: ACTION_SAVE_COLLABORATION_SETTINGS,
      ownerRequired: true,
      kind: "command",
      input: projectCollaborationInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveCollaborationSettings(input)
    }),
    action({
      id: ACTION_SAVE_PROJECT_PROMPT_HINTS,
      ownerRequired: true,
      kind: "command",
      input: projectPromptHintsInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.savePromptHints(input)
    }),
    action({
      id: ACTION_SAVE_ENGINEERING_PROFILE,
      kind: "command",
      input: projectEngineeringProfileInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveEngineeringProfile(input)
    }),
    action({
      id: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
      kind: "command",
      input: projectDevelopmentDatabaseScopeInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveDevelopmentDatabaseScope(input)
    }),
    action({
      id: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
      kind: "query",
      input: previewApplicationIdentitiesReadInputValidator,
      execute: (input) => project.readPreviewApplicationIdentities(input)
    }),
    action({
      id: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
      kind: "command",
      input: previewApplicationIdentitiesInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.savePreviewApplicationIdentities(input)
    })
  ]);
}

export {
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
