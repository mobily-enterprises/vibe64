import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  http,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });
  const sessionRoute = "/system-graph/sessions/:sessionId";

  for (const [method, suffix, operation, summary] of [
    ["GET", "subsystems", "subsystems.read", "Read authored subsystem responsibilities and operation/data associations."],
    ["GET", "status", "status.read", "Read Genesis Machine and Program City availability for an active session."],
    ["GET", "cities/machine", "machine.read", "Read the native Genesis Machine City for an active session."],
    ["GET", "cities/program", "program.read", "Read the native Genesis Program City for an active session."],
    ["POST", "refresh", "refresh", "Synchronously refresh both Genesis Cities for an active session."]
  ]) routes.actionRoute(method, `${sessionRoute}/${suffix}`, {
    actionId: `vibe64.system-graph.${operation}`,
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    ...(method === "POST" ? { bodyLimit: 16 * 1024 } : {}), summary
  });
}

export {
  registerRoutes
};
