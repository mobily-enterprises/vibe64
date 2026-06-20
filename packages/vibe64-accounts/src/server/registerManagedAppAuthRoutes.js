import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

import {
  VIBE64_MANAGED_APP_AUTH_SERVICE
} from "./managedAppAuthService.js";

function registerManagedAppAuthRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    projectScoped = true
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 app auth routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    projectScoped,
    tags: ["studio", "vibe64-managed-app-auth"]
  });

  routes.serviceRoute("GET", "", {
    summary: "Read Vibe64 managed app auth status."
  }, (request) => service(app).getStatus(queryInput(routes, request)));

  routes.serviceRoute("POST", "/connect", {
    bodyLimit: 1024 * 32,
    summary: "Validate and store a Supabase PAT for Vibe64 managed app auth."
  }, (request) => service(app).connect(withVibe64User(request, routes.requestBody(request))));

  routes.serviceRoute("POST", "/setup", {
    bodyLimit: 1024 * 32,
    summary: "Configure a Supabase PAT and create Vibe64 managed app auth projects."
  }, (request) => service(app).setup(withVibe64User(request, routes.requestBody(request))));

  routes.serviceRoute("POST", "/sync", {
    summary: "Sync Vibe64 managed app auth settings."
  }, (request) => service(app).sync(withVibe64User(request, routes.requestBody(request))));

  routes.serviceRoute("POST", "/smtp-login", {
    bodyLimit: 1024 * 16,
    summary: "Save SMTP login used by Vibe64 managed app auth."
  }, (request) => service(app).saveSmtpLogin(withVibe64User(request, routes.requestBody(request))));

  routes.serviceRoute("POST", "/smtp-login/disconnect", {
    summary: "Remove SMTP login used by Vibe64 managed app auth."
  }, (request) => service(app).disconnectSmtpLogin(withVibe64User(request, routes.requestBody(request))));

  routes.serviceRoute("POST", "/disconnect", {
    summary: "Remove the stored Supabase PAT for Vibe64 managed app auth."
  }, (request) => service(app).disconnect(withVibe64User(request, routes.requestBody(request))));
}

function service(app) {
  return app.make(VIBE64_MANAGED_APP_AUTH_SERVICE);
}

function queryInput(routes, request) {
  return withVibe64User(request, routes.requestQuery(request));
}

function withVibe64User(request, input = {}) {
  if (!request.vibe64User) {
    return {
      ...input
    };
  }
  return {
    ...input,
    vibe64User: request.vibe64User
  };
}

export { registerManagedAppAuthRoutes };
