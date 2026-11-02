import {
  projectRemoteInputValidator,
  projectIssueInputValidators,
  projectPullRequestInputValidators,
  projectOnboardingInputValidator,
  projectTemplateInputValidator,
  projectCreateInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectEngineeringProfileInputValidator,
  projectEngineeringSettingsReadInputValidator,
  projectCollaborationInputValidator,
  projectSettingsReadInputValidator,
  projectConnectedProjectsInputValidator,
  projectPromptHintsInputValidator,
  projectEnvReadInputValidator,
  projectEnvDownloadInputValidator,
  projectEnvSecretRevealInputValidator,
  projectEnvUserValuesInputValidator,
  projectSelectInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
} from "./inputSchemas.js";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
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
  ACTION_UPDATE_PULL_REQUEST_BRANCH
} from "./projectActions.js";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

const listIssuesInput = githubActionInput("GET", projectIssueInputValidators.list);
const createIssueInput = githubActionInput("POST", projectIssueInputValidators.create);
const listIssueLabelsInput = githubActionInput("GET", projectIssueInputValidators.labels);
const createIssueLabelInput = githubActionInput("POST", projectIssueInputValidators["create-label"]);
const listIssueMentionsInput = githubActionInput("GET", projectIssueInputValidators.mentions);
const setIssueLabelsInput = githubActionInput("PUT", projectIssueInputValidators["set-labels"]);
const readIssueInput = githubActionInput("GET", projectIssueInputValidators.read);
const commentOnIssueInput = githubActionInput("POST", projectIssueInputValidators.comment);
const setIssueStateInput = githubActionInput("PATCH", projectIssueInputValidators.state);
const editIssueInput = githubActionInput("PUT", projectIssueInputValidators.edit);
const editIssueCommentInput = githubActionInput("PATCH", projectIssueInputValidators["edit-comment"]);
const listPullRequestsInput = githubActionInput("GET", projectPullRequestInputValidators.list);
const readPullRequestInput = githubActionInput("GET", projectPullRequestInputValidators.read);
const markPullRequestReadyInput = githubActionInput("POST", projectPullRequestInputValidators.ready);
const updatePullRequestBranchInput = githubActionInput("POST", projectPullRequestInputValidators["update-branch"]);
const mergePullRequestInput = githubActionInput("POST", projectPullRequestInputValidators.merge);

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-project"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/repository/remote", {
    actionId: ACTION_READ_REPOSITORY_REMOTE,
    summary: "Read local Git remote configuration and last observed freshness."
  });
  routes.actionRoute("GET", "/repository/branches", {
    actionId: ACTION_READ_REPOSITORY_BRANCHES,
    buildInput: requestQuery,
    summary: "List repository branches for a new session."
  });
  routes.actionRoute("PUT", "/repository/workflow", {
    actionId: ACTION_SAVE_REPOSITORY_WORKFLOW,
    buildInput: repositoryWorkflowInput,
    summary: "Choose whether Save requires a pull request."
  });

  routes.actionRoute("GET", "/issues", {
    actionId: ACTION_LIST_ISSUES,
    summary: "List GitHub issues for this project.",
    buildInput: listIssuesInput
  });
  routes.actionRoute("POST", "/issues", {
    actionId: ACTION_CREATE_ISSUE,
    summary: "Create a GitHub issue in this project.",
    bodyLimit: 300_000,
    buildInput: createIssueInput
  });
  routes.actionRoute("GET", "/issue-labels", {
    actionId: ACTION_LIST_ISSUE_LABELS,
    summary: "Read this repository's GitHub labels and label permissions.",
    buildInput: listIssueLabelsInput
  });
  routes.actionRoute("POST", "/issue-labels", {
    actionId: ACTION_CREATE_ISSUE_LABEL,
    summary: "Create a GitHub repository label with a chosen colour.",
    buildInput: createIssueLabelInput
  });
  routes.actionRoute("GET", "/issue-mentions", {
    actionId: ACTION_LIST_ISSUE_MENTIONS,
    summary: "Read repository collaborators and issue participants for mentions.",
    buildInput: listIssueMentionsInput
  });
  routes.actionRoute("PUT", "/issues/:number/labels", {
    actionId: ACTION_SET_ISSUE_LABELS,
    summary: "Set the labels on a GitHub issue.",
    buildInput: setIssueLabelsInput
  });
  routes.actionRoute("GET", "/issues/:number", {
    actionId: ACTION_READ_ISSUE,
    summary: "Read a GitHub issue and its comments.",
    buildInput: readIssueInput
  });
  routes.actionRoute("POST", "/issues/:number/comments", {
    actionId: ACTION_COMMENT_ON_ISSUE,
    summary: "Comment on this project's GitHub issue.",
    bodyLimit: 300_000,
    buildInput: commentOnIssueInput
  });
  routes.actionRoute("PATCH", "/issues/:number", {
    actionId: ACTION_SET_ISSUE_STATE,
    summary: "Close or reopen this project's GitHub issue.",
    buildInput: setIssueStateInput
  });
  routes.actionRoute("PUT", "/issues/:number", {
    actionId: ACTION_EDIT_ISSUE,
    summary: "Edit this project's GitHub issue title and description.",
    bodyLimit: 300_000,
    buildInput: editIssueInput
  });
  routes.actionRoute("PATCH", "/issues/:number/comments/:commentId", {
    actionId: ACTION_EDIT_ISSUE_COMMENT,
    summary: "Edit a comment on this project's GitHub issue.",
    bodyLimit: 300_000,
    buildInput: editIssueCommentInput
  });
  routes.actionRoute("GET", "/pull-requests", {
    actionId: ACTION_LIST_PULL_REQUESTS,
    summary: "List GitHub pull requests for this project.",
    buildInput: listPullRequestsInput
  });
  routes.actionRoute("GET", "/pull-requests/:number", {
    actionId: ACTION_READ_PULL_REQUEST,
    summary: "Read a GitHub pull request.",
    buildInput: readPullRequestInput
  });
  routes.actionRoute("POST", "/pull-requests/:number/ready", {
    actionId: ACTION_MARK_PULL_REQUEST_READY,
    summary: "Apply the reviewed ready action to a GitHub pull request.",
    buildInput: markPullRequestReadyInput
  });
  routes.actionRoute("POST", "/pull-requests/:number/update-branch", {
    actionId: ACTION_UPDATE_PULL_REQUEST_BRANCH,
    summary: "Apply the reviewed update-branch action to a GitHub pull request.",
    buildInput: updatePullRequestBranchInput
  });
  routes.actionRoute("POST", "/pull-requests/:number/merge", {
    actionId: ACTION_MERGE_PULL_REQUEST,
    summary: "Apply the reviewed merge action to a GitHub pull request.",
    buildInput: mergePullRequestInput
  });

  routes.actionRoute("POST", "/repository/remote", {
    actionId: ACTION_REPOSITORY_REMOTE,
    body: projectRemoteInputValidator,
    buildInput: requestBody,
    summary: "Fetch, pull, push or configure the opened local repository."
  });

  routes.actionRoute("GET", "/projects", {
    actionId: ACTION_LIST_PROJECTS,
    summary: "List selectable Vibe64 projects."
  });
  routes.actionRoute("GET", "/onboarding", {
    actionId: ACTION_READ_ONBOARDING,
    buildInput: requestQuery,
    query: projectOnboardingInputValidator,
    summary: "Inspect project opening state and available templates."
  });
  routes.actionRoute("POST", "/templates/apply", {
    actionId: ACTION_APPLY_TEMPLATE,
    buildInput: requestBody,
    body: projectTemplateInputValidator,
    summary: "Apply a configured template to an empty session source."
  });
  routes.actionRoute("POST", "/projects", {
    actionId: ACTION_CREATE_PROJECT,
    body: projectCreateInputValidator,
    buildInput: requestBody,
    summary: "Create and select a Vibe64 project."
  });
  routes.actionRoute("POST", "/projects/select", {
    actionId: ACTION_SELECT_PROJECT,
    body: projectSelectInputValidator,
    buildInput: requestBody,
    summary: "Select an existing Vibe64 project."
  });
  routes.actionRoute("GET", "/env", {
    actionId: ACTION_READ_ENV,
    buildInput: requestQuery,
    query: projectEnvReadInputValidator,
    summary: "Read project Env values."
  });
  // Responses carrying stored secret values are the owner's and never cached.
  routes.serviceRoute("POST", "/env/reveal", {
    body: projectEnvSecretRevealInputValidator,
    statusCode: envSecretStatusCode,
    summary: "Reveal one project development secret to the Vibe64 owner."
  }, uncachedActionHandler(ACTION_REVEAL_ENV_SECRET));
  routes.serviceRoute("POST", "/env/download", {
    body: projectEnvDownloadInputValidator,
    statusCode: envSecretStatusCode,
    summary: "Download every project Env value as one .env file for the Vibe64 owner."
  }, uncachedActionHandler(ACTION_DOWNLOAD_ENV));
  routes.actionRoute("PUT", "/env/user-values", {
    actionId: ACTION_SAVE_ENV_USER_VALUES,
    body: projectEnvUserValuesInputValidator,
    buildInput: requestBody,
    summary: "Save user-owned project Env values."
  });
  routes.actionRoute("GET", "/settings", {
    actionId: ACTION_READ_PROJECT_SETTINGS,
    buildInput: settingsQueryInput,
    query: projectSettingsReadInputValidator,
    summary: "Read Vibe64 and source-owned project settings."
  });
  routes.actionRoute("PUT", "/settings/connections", {
    actionId: ACTION_SAVE_CONNECTED_PROJECTS,
    body: projectConnectedProjectsInputValidator,
    buildInput: settingsBodyInput,
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save the connected-project list in this source checkout."
  });
  routes.actionRoute("PUT", "/settings/collaboration", {
    actionId: ACTION_SAVE_COLLABORATION_SETTINGS,
    body: projectCollaborationInputValidator,
    buildInput: settingsBodyInput,
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save Genesis collaboration guidance in project source."
  });
  routes.actionRoute("PUT", "/settings/prompt-hints", {
    actionId: ACTION_SAVE_PROJECT_PROMPT_HINTS,
    body: projectPromptHintsInputValidator,
    buildInput: settingsBodyInput,
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save the Vibe64 prompt-suggestion choice."
  });
  routes.actionRoute("PUT", "/settings/development-database", {
    actionId: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
    body: projectDevelopmentDatabaseScopeInputValidator,
    buildInput: requestBody,
    summary: "Choose whether the host manages one development database per session or per project."
  });
  routes.actionRoute("GET", "/settings/engineering", {
    actionId: ACTION_READ_ENGINEERING_SETTINGS,
    buildInput: requestQuery,
    query: projectEngineeringSettingsReadInputValidator,
    summary: "Read the Genesis engineering profile from project source."
  });
  routes.actionRoute("PUT", "/settings/engineering", {
    actionId: ACTION_SAVE_ENGINEERING_PROFILE,
    body: projectEngineeringProfileInputValidator,
    buildInput: requestBody,
    summary: "Save the Genesis engineering profile in project source."
  });
  routes.actionRoute("GET", "/preview-identities", {
    actionId: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
    buildInput: requestQuery,
    query: previewApplicationIdentitiesReadInputValidator,
    summary: "Read repository-managed app identities from project source."
  });
  routes.actionRoute("PUT", "/preview-identities", {
    actionId: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
    body: previewApplicationIdentitiesInputValidator,
    buildInput: requestBody,
    summary: "Save repository-managed app identities to project source."
  });
}

/**
 * Derive HTTP fields from the action contract. URL identities take precedence;
 * actor, repository and operation are never caller inputs.
 * @param {string} method
 * @param {object} validator
 */
function githubActionInput(method, validator) {
  return function buildGithubActionInput(request) {
    const data = { ...(method === "GET" ? requestQuery(request) : requestBody(request)), ...request.params };
    return Object.fromEntries(Object.keys(validator.schema.getFieldDefinitions())
      .filter((name) => data[name] !== undefined).map((name) => [name, data[name]]));
  };
}

/**
 * A route handler that runs one owner-only Env action and keeps its response out of every cache.
 * @param {string} actionId
 */
function uncachedActionHandler(actionId) {
  return async function runUncachedAction(request, reply) {
    reply
      .header("cache-control", "no-store")
      .header("pragma", "no-cache");
    return request.executeAction({ actionId, input: withoutUser(requestBody(request)) });
  };
}

function envSecretStatusCode(response) {
  if (response?.ok === true) {
    return 200;
  }
  if (response?.code === "vibe64_owner_required") {
    return 403;
  }
  if (response?.code === "vibe64_env_variable_not_found") {
    return 404;
  }
  return 400;
}

function projectSettingsMutationStatusCode(response) {
  if (response?.ok === true) {
    return 200;
  }
  if (response?.code === "vibe64_owner_required") {
    return 403;
  }
  return 400;
}

/** @param {object} request */
function repositoryWorkflowInput(request) {
  return { requirePullRequest: requestBody(request).requirePullRequest };
}

/** @param {object} request */
function settingsQueryInput(request) {
  return withoutUser(requestQuery(request));
}

/** @param {object} request */
function settingsBodyInput(request) {
  return withoutUser(requestBody(request));
}

function withoutUser(input = {}) {
  const { vibe64User: _ignoredUser, ...data } = input;
  return data;
}

export { registerRoutes };
