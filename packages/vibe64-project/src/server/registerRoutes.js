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
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null
} = {}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-project"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/repository/remote", {
    actionId: "vibe64.project.repository.remote.read",
    summary: "Read local Git remote configuration and last observed freshness."
  });
  routes.actionRoute("GET", "/repository/branches", {
    actionId: "vibe64.project.repository.branches.read",
    buildInput: (request) => requestQuery(request),
    summary: "List repository branches for a new session."
  });
  routes.actionRoute("PUT", "/repository/workflow", {
    actionId: "vibe64.project.repository.workflow.save",
    buildInput: (request) => ({ requirePullRequest: requestBody(request).requirePullRequest }),
    summary: "Choose whether Save requires a pull request."
  });

  for (const [method, path, operation, summary, bodyLimit] of [
    ["GET", "/issues", "list", "List GitHub issues for this project."],
    ["POST", "/issues", "create", "Create a GitHub issue in this project.", 300_000],
    ["GET", "/issue-labels", "labels", "Read this repository's GitHub labels and label permissions."],
    ["POST", "/issue-labels", "create-label", "Create a GitHub repository label with a chosen colour."],
    ["GET", "/issue-mentions", "mentions", "Read repository collaborators and issue participants for mentions."],
    ["PUT", "/issues/:number/labels", "set-labels", "Set the labels on a GitHub issue."],
    ["GET", "/issues/:number", "read", "Read a GitHub issue and its comments."],
    ["POST", "/issues/:number/comments", "comment", "Comment on this project's GitHub issue.", 300_000],
    ["PATCH", "/issues/:number", "state", "Close or reopen this project's GitHub issue."],
    ["PUT", "/issues/:number", "edit", "Edit this project's GitHub issue title and description.", 300_000],
    ["PATCH", "/issues/:number/comments/:commentId", "edit-comment", "Edit a comment on this project's GitHub issue.", 300_000]
  ]) routes.actionRoute(method, path, {
    actionId: `vibe64.project.issues.${operation}`, summary, bodyLimit,
    buildInput: githubActionInput(method, projectIssueInputValidators[operation])
  });
  for (const [method, path, operation, summary] of [
    ["GET", "/pull-requests", "list", "List GitHub pull requests for this project."],
    ["GET", "/pull-requests/:number", "read", "Read a GitHub pull request."],
    ["POST", "/pull-requests/:number/ready", "ready", "Apply the reviewed ready action to a GitHub pull request."],
    ["POST", "/pull-requests/:number/update-branch", "update-branch", "Apply the reviewed update-branch action to a GitHub pull request."],
    ["POST", "/pull-requests/:number/merge", "merge", "Apply the reviewed merge action to a GitHub pull request."]
  ]) routes.actionRoute(method, path, {
    actionId: `vibe64.project.pull-requests.${operation}`, summary,
    buildInput: githubActionInput(method, projectPullRequestInputValidators[operation])
  });

  routes.actionRoute("POST", "/repository/remote", {
    actionId: "vibe64.project.repository.remote",
    body: projectRemoteInputValidator,
    buildInput: requestBody,
    summary: "Fetch, pull, push or configure the opened local repository."
  });

  routes.actionRoute("GET", "/projects", {
    actionId: "vibe64.project.projects.list",
    summary: "List selectable Vibe64 projects."
  });
  routes.actionRoute("GET", "/onboarding", {
    actionId: "vibe64.project.onboarding.read",
    buildInput: requestQuery,
    query: projectOnboardingInputValidator,
    summary: "Inspect project opening state and available templates."
  });
  routes.actionRoute("POST", "/templates/apply", {
    actionId: "vibe64.project.templates.apply",
    buildInput: requestBody,
    body: projectTemplateInputValidator,
    summary: "Apply a configured template to an empty session source."
  });
  routes.actionRoute("POST", "/projects", {
    actionId: "vibe64.project.projects.create",
    body: projectCreateInputValidator,
    buildInput: requestBody,
    summary: "Create and select a Vibe64 project."
  });
  routes.actionRoute("POST", "/projects/select", {
    actionId: "vibe64.project.projects.select",
    body: projectSelectInputValidator,
    buildInput: requestBody,
    summary: "Select an existing Vibe64 project."
  });
  routes.actionRoute("GET", "/env", {
    actionId: "vibe64.project.env.read",
    buildInput: requestQuery,
    query: projectEnvReadInputValidator,
    summary: "Read project Env values."
  });
  // Responses carrying stored secret values are the owner's and never cached.
  for (const [path, actionId, body, summary] of [
    ["/env/reveal", "vibe64.project.env.secret.reveal", projectEnvSecretRevealInputValidator,
      "Reveal one project development secret to the Vibe64 owner."],
    ["/env/download", "vibe64.project.env.download", projectEnvDownloadInputValidator,
      "Download every project Env value as one .env file for the Vibe64 owner."]
  ]) {
    routes.serviceRoute("POST", path, {
      body,
      statusCode: envSecretStatusCode,
      summary
    }, async (request, reply) => {
      reply
        .header("cache-control", "no-store")
        .header("pragma", "no-cache");
      return request.executeAction({ actionId, input: withoutUser(requestBody(request)) });
    });
  }
  routes.actionRoute("PUT", "/env/user-values", {
    actionId: "vibe64.project.env.user-values.save",
    body: projectEnvUserValuesInputValidator,
    buildInput: requestBody,
    summary: "Save user-owned project Env values."
  });
  routes.actionRoute("GET", "/settings", {
    actionId: "vibe64.project.settings.read",
    buildInput: (request) => withoutUser(requestQuery(request)),
    query: projectSettingsReadInputValidator,
    summary: "Read Vibe64 and source-owned project settings."
  });
  routes.actionRoute("PUT", "/settings/connections", {
    actionId: "vibe64.project.connections.save",
    body: projectConnectedProjectsInputValidator,
    buildInput: (request) => withoutUser(requestBody(request)),
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save the connected-project list in this source checkout."
  });
  routes.actionRoute("PUT", "/settings/collaboration", {
    actionId: "vibe64.project.collaboration.save",
    body: projectCollaborationInputValidator,
    buildInput: (request) => withoutUser(requestBody(request)),
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save Genesis collaboration guidance in project source."
  });
  routes.actionRoute("PUT", "/settings/prompt-hints", {
    actionId: "vibe64.project.prompt-hints.save",
    body: projectPromptHintsInputValidator,
    buildInput: (request) => withoutUser(requestBody(request)),
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save the Vibe64 prompt-suggestion choice."
  });
  routes.actionRoute("PUT", "/settings/development-database", {
    actionId: "vibe64.project.development-database.scope.save",
    body: projectDevelopmentDatabaseScopeInputValidator,
    buildInput: requestBody,
    summary: "Choose whether the host manages one development database per session or per project."
  });
  routes.actionRoute("GET", "/settings/engineering", {
    actionId: "vibe64.project.engineering.read",
    buildInput: requestQuery,
    query: projectEngineeringSettingsReadInputValidator,
    summary: "Read the Genesis engineering profile from project source."
  });
  routes.actionRoute("PUT", "/settings/engineering", {
    actionId: "vibe64.project.engineering.profile.save",
    body: projectEngineeringProfileInputValidator,
    buildInput: requestBody,
    summary: "Save the Genesis engineering profile in project source."
  });
  routes.actionRoute("GET", "/preview-identities", {
    actionId: "vibe64.project.preview-identities.read",
    buildInput: requestQuery,
    query: previewApplicationIdentitiesReadInputValidator,
    summary: "Read repository-managed app identities from project source."
  });
  routes.actionRoute("PUT", "/preview-identities", {
    actionId: "vibe64.project.preview-identities.save",
    body: previewApplicationIdentitiesInputValidator,
    buildInput: requestBody,
    summary: "Save repository-managed app identities to project source."
  });
}

// Derive HTTP fields from the action contract. URL identities take precedence;
// actor, repository and operation are never caller inputs.
function githubActionInput(method, validator) {
  return function buildGithubActionInput(request) {
    const data = { ...(method === "GET" ? requestQuery(request) : requestBody(request)), ...request.params };
    return Object.fromEntries(Object.keys(validator.schema.getFieldDefinitions())
      .filter((name) => data[name] !== undefined).map((name) => [name, data[name]]));
  };
}

function envSecretStatusCode(response = {}) {
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

function projectSettingsMutationStatusCode(response = {}) {
  if (response?.ok === true) {
    return 200;
  }
  if (response?.code === "vibe64_owner_required") {
    return 403;
  }
  return 400;
}

function withoutUser(input = {}) {
  const { vibe64User: _ignoredUser, ...data } = input;
  return data;
}

export { registerRoutes };
