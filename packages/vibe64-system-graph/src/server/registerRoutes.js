import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  http,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    systemGraph
  } = {}
) {
  if (!systemGraph || typeof systemGraph.readStatus !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 System Graph API.");
  }
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });
  const sessionRoute = "/system-graph/sessions/:sessionId";

  routes.serviceRoute("GET", `${sessionRoute}/subsystems`, {
    summary: "Read authored subsystem responsibilities and operation/data associations."
  }, (request) => systemGraph.readSubsystems({ sessionId: request.params.sessionId }));

  routes.serviceRoute("GET", `${sessionRoute}/status`, {
    summary: "Read Genesis Machine and Program City availability for an active session."
  }, (request) => {
    return systemGraph.readStatus({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", `${sessionRoute}/cities/machine`, {
    summary: "Read the native Genesis Machine City for an active session."
  }, (request) => {
    return systemGraph.readMachineCity({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", `${sessionRoute}/cities/program`, {
    summary: "Read the native Genesis Program City for an active session."
  }, (request) => {
    return systemGraph.readProgramCity({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", `${sessionRoute}/refresh`, {
    bodyLimit: 16 * 1024,
    summary: "Synchronously refresh both Genesis Cities for an active session."
  }, (request) => {
    return systemGraph.refresh({
      sessionId: request.params.sessionId
    });
  });
}

export {
  registerRoutes
};
