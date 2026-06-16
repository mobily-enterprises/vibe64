import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

import {
  ACTION_ADD_CUSTOM_DOMAIN,
  ACTION_CHANGE_PUBLIC_NAME,
  ACTION_LIST_DOMAIN_BINDINGS,
  ACTION_LIST_RELEASES,
  ACTION_PUBLISH_PROJECT,
  ACTION_READ_PUBLISH_PLAN,
  ACTION_READ_DEPLOYMENT_STATE,
  ACTION_RESOLVE_HOST_ROUTE,
  ACTION_RESERVE_PUBLIC_NAME,
  ACTION_ROLLBACK_RELEASE,
  ACTION_TLS_ASK,
  ACTION_VALIDATE_PUBLIC_NAME,
  ACTION_VERIFY_CUSTOM_DOMAIN
} from "./actions.js";
import {
  customDomainInputValidator,
  deploymentPublishInputValidator,
  publicNameInputValidator,
  releaseIdInputValidator
} from "./inputSchemas.js";

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 deployment routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-deployments"]
  });

  routes.actionRoute("GET", "/state", {
    actionId: ACTION_READ_DEPLOYMENT_STATE,
    summary: "Read Vibe64 deployment state for the project."
  });

  routes.actionRoute("GET", "/publish-plan", {
    actionId: ACTION_READ_PUBLISH_PLAN,
    summary: "Read the adapter publish plan for the project."
  });

  routes.actionRoute("GET", "/releases", {
    actionId: ACTION_LIST_RELEASES,
    summary: "List deployment releases for the project."
  });

  routes.actionRoute("POST", "/publish", {
    actionId: ACTION_PUBLISH_PROJECT,
    body: deploymentPublishInputValidator,
    buildInput: routes.requestBody,
    summary: "Publish the current project."
  });

  routes.actionRoute("POST", "/releases/rollback", {
    actionId: ACTION_ROLLBACK_RELEASE,
    body: releaseIdInputValidator,
    buildInput: routes.requestBody,
    summary: "Roll back the current route to a previous published release."
  });

  routes.actionRoute("POST", "/public-name/validate", {
    actionId: ACTION_VALIDATE_PUBLIC_NAME,
    body: publicNameInputValidator,
    buildInput: routes.requestBody,
    summary: "Validate a Vibe64 public deployment name."
  });

  routes.actionRoute("POST", "/public-name/reserve", {
    actionId: ACTION_RESERVE_PUBLIC_NAME,
    body: publicNameInputValidator,
    buildInput: routes.requestBody,
    summary: "Reserve a Vibe64 public deployment name."
  });

  routes.actionRoute("POST", "/public-name/change", {
    actionId: ACTION_CHANGE_PUBLIC_NAME,
    body: publicNameInputValidator,
    buildInput: routes.requestBody,
    summary: "Change the Vibe64 public deployment name for this project."
  });

  routes.actionRoute("GET", "/domains", {
    actionId: ACTION_LIST_DOMAIN_BINDINGS,
    summary: "List custom domains for the project deployment."
  });

  routes.actionRoute("POST", "/domains", {
    actionId: ACTION_ADD_CUSTOM_DOMAIN,
    body: customDomainInputValidator,
    buildInput: routes.requestBody,
    summary: "Add a custom domain binding for the project deployment."
  });

  routes.actionRoute("POST", "/domains/verify", {
    actionId: ACTION_VERIFY_CUSTOM_DOMAIN,
    body: customDomainInputValidator,
    buildInput: routes.requestBody,
    summary: "Verify a custom domain DNS binding for the project deployment."
  });

  const ingressRoutes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 deployment ingress routes only accept loopback requests.",
    projectContext,
    projectScoped: false,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-deployments", "ingress"]
  });

  ingressRoutes.actionRoute("GET", "/tls/ask", {
    actionId: ACTION_TLS_ASK,
    buildInput: queryInput("domain"),
    statusCode: (response) => response?.ok === true ? 200 : 403,
    summary: "Approve or reject Caddy on-demand TLS for a deployment hostname."
  });

  ingressRoutes.actionRoute("GET", "/route", {
    actionId: ACTION_RESOLVE_HOST_ROUTE,
    buildInput: queryInput("host"),
    failureStatus: 404,
    summary: "Resolve a deployment hostname to the current published release target."
  });
}

function queryInput(fieldName = "") {
  return (request) => ({
    [fieldName]: request.query?.[fieldName] || request.input?.query?.[fieldName] || ""
  });
}

export { registerRoutes };
