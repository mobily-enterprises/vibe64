import {
  ACTION_REPOSITORY_REMOTE,
  ACTION_READ_ONBOARDING,
  ACTION_APPLY_TEMPLATE,
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_ENV,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SELECT_PROJECT
} from "./actions.js";
import {
  projectRemoteInputValidator,
  projectOnboardingInputValidator,
  projectTemplateInputValidator,
  projectCreateInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectEngineeringProfileInputValidator,
  projectEngineeringSettingsReadInputValidator,
  projectCollaborationInputValidator,
  projectSettingsReadInputValidator,
  projectPromptHintsInputValidator,
  projectEnvReadInputValidator,
  projectEnvSecretRevealInputValidator,
  projectEnvUserValuesInputValidator,
  projectSelectInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  project = null,
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-project"]
  });

  routes.serviceRoute("GET", "/repository/remote", {
    summary: "Read local Git remote configuration and last observed freshness."
  }, () => project.repositoryRemote());

  routes.serviceRoute("GET", "/issues", {
    summary: "List GitHub issues for this project."
  }, (request) => project.githubIssues({
    ...routes.requestQuery(request), operation: "list", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("POST", "/issues", {
    bodyLimit: 300_000,
    summary: "Create a GitHub issue in this project."
  }, (request) => project.githubIssues({
    title: routes.requestBody(request).title,
    body: routes.requestBody(request).body,
    labels: routes.requestBody(request).labels,
    operation: "create", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("GET", "/issue-labels", {
    summary: "Read this repository's GitHub labels and label permissions."
  }, (request) => project.githubIssues({
    operation: "labels", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("PUT", "/issues/:number/labels", {
    summary: "Set the labels on a GitHub issue."
  }, (request) => project.githubIssues({
    number: request.params.number, labels: routes.requestBody(request).labels,
    operation: "set-labels", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("GET", "/pull-requests", {
    summary: "List GitHub pull requests for this project."
  }, (request) => project.githubPullRequests({
    ...routes.requestQuery(request), operation: "list", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("GET", "/pull-requests/:number", {
    summary: "Read a GitHub pull request."
  }, (request) => project.githubPullRequests({
    number: request.params.number, operation: "read", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("GET", "/issues/:number", {
    summary: "Read a GitHub issue and its comments."
  }, (request) => project.githubIssues({
    ...routes.requestQuery(request), number: request.params.number, operation: "read", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("POST", "/issues/:number/comments", {
    bodyLimit: 300_000,
    summary: "Comment on this project's GitHub issue."
  }, (request) => project.githubIssues({
    body: routes.requestBody(request).body, number: request.params.number,
    originId: routes.requestBody(request).originId,
    operation: "comment", vibe64User: request.vibe64User || null
  }));
  routes.serviceRoute("PATCH", "/issues/:number", {
    summary: "Close or reopen this project's GitHub issue."
  }, (request) => project.githubIssues({
    state: routes.requestBody(request).state, number: request.params.number,
    operation: "state", vibe64User: request.vibe64User || null
  }));
  routes.actionRoute("POST", "/repository/remote", {
    actionId: ACTION_REPOSITORY_REMOTE,
    body: projectRemoteInputValidator,
    buildInput: routes.requestBody,
    summary: "Fetch, pull, push or configure the opened local repository."
  });

  routes.actionRoute("GET", "/projects", {
    actionId: ACTION_LIST_PROJECTS,
    summary: "List selectable Vibe64 projects."
  });
  routes.actionRoute("GET", "/onboarding", {
    actionId: ACTION_READ_ONBOARDING,
    buildInput: routes.requestQuery,
    query: projectOnboardingInputValidator,
    summary: "Inspect project opening state and available templates."
  });
  routes.actionRoute("POST", "/templates/apply", {
    actionId: ACTION_APPLY_TEMPLATE,
    buildInput: routes.requestBody,
    body: projectTemplateInputValidator,
    summary: "Apply a configured template to an empty session source."
  });
  routes.actionRoute("POST", "/projects", {
    actionId: ACTION_CREATE_PROJECT,
    body: projectCreateInputValidator,
    buildInput: routes.requestBody,
    summary: "Create and select a Vibe64 project."
  });
  routes.actionRoute("POST", "/projects/select", {
    actionId: ACTION_SELECT_PROJECT,
    body: projectSelectInputValidator,
    buildInput: routes.requestBody,
    summary: "Select an existing Vibe64 project."
  });
  routes.actionRoute("GET", "/env", {
    actionId: ACTION_READ_ENV,
    buildInput: routes.requestQuery,
    query: projectEnvReadInputValidator,
    summary: "Read project Env values."
  });
  routes.serviceRoute("POST", "/env/reveal", {
    body: projectEnvSecretRevealInputValidator,
    statusCode: envSecretRevealStatusCode,
    summary: "Reveal one project development secret to the Vibe64 owner."
  }, async (request, reply) => {
    if (!project || typeof project.revealEnvSecret !== "function") {
      throw new TypeError("Project Env secret reveal requires vibe64.project.");
    }
    reply
      .header("cache-control", "no-store")
      .header("pragma", "no-cache");
    return project.revealEnvSecret({
      ...routes.requestBody(request),
      vibe64User: request.vibe64User || null
    });
  });
  routes.actionRoute("PUT", "/env/user-values", {
    actionId: ACTION_SAVE_ENV_USER_VALUES,
    body: projectEnvUserValuesInputValidator,
    buildInput: routes.requestBody,
    summary: "Save user-owned project Env values."
  });
  routes.actionRoute("GET", "/settings", {
    actionId: ACTION_READ_PROJECT_SETTINGS,
    buildInput: (request) => withUser(request, routes.requestQuery(request)),
    query: projectSettingsReadInputValidator,
    summary: "Read Vibe64 and source-owned project settings."
  });
  routes.actionRoute("PUT", "/settings/collaboration", {
    actionId: ACTION_SAVE_COLLABORATION_SETTINGS,
    body: projectCollaborationInputValidator,
    buildInput: (request) => withUser(request, routes.requestBody(request)),
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save Genesis collaboration guidance in project source."
  });
  routes.actionRoute("PUT", "/settings/prompt-hints", {
    actionId: ACTION_SAVE_PROJECT_PROMPT_HINTS,
    body: projectPromptHintsInputValidator,
    buildInput: (request) => withUser(request, routes.requestBody(request)),
    statusCode: projectSettingsMutationStatusCode,
    summary: "Save the Vibe64 prompt-suggestion choice."
  });
  routes.actionRoute("PUT", "/settings/development-database", {
    actionId: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
    body: projectDevelopmentDatabaseScopeInputValidator,
    buildInput: routes.requestBody,
    summary: "Choose whether Online manages one development database per session or per project."
  });
  routes.actionRoute("GET", "/settings/engineering", {
    actionId: ACTION_READ_ENGINEERING_SETTINGS,
    buildInput: routes.requestQuery,
    query: projectEngineeringSettingsReadInputValidator,
    summary: "Read the Genesis engineering profile from project source."
  });
  routes.actionRoute("PUT", "/settings/engineering", {
    actionId: ACTION_SAVE_ENGINEERING_PROFILE,
    body: projectEngineeringProfileInputValidator,
    buildInput: routes.requestBody,
    summary: "Save the Genesis engineering profile in project source."
  });
  routes.actionRoute("GET", "/preview-identities", {
    actionId: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
    buildInput: routes.requestQuery,
    query: previewApplicationIdentitiesReadInputValidator,
    summary: "Read repository-managed app identities from project source."
  });
  routes.actionRoute("PUT", "/preview-identities", {
    actionId: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
    body: previewApplicationIdentitiesInputValidator,
    buildInput: routes.requestBody,
    summary: "Save repository-managed app identities to project source."
  });
}

function envSecretRevealStatusCode(response = {}) {
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

function withUser(request, input = {}) {
  return request.vibe64User
    ? {
        ...input,
        vibe64User: request.vibe64User
      }
    : {
        ...input
      };
}

export { registerRoutes };
