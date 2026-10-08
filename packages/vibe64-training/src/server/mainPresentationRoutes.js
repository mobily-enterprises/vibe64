import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { TRAINING_MAIN_PRESENTATION_ACTION, TRAINING_MAIN_PRESENTATION_FOCUS_ACTION,
  TRAINING_MAIN_PRESENTATION_ACK_ACTION } from "./mainPresentationActions.js";

function registerTrainingMainPresentationRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, { projectScoped: false, routeSurface: "app",
    routeRelativePath: "learning/:learningAttemptId/vibe64/sessions/:sessionId/training" });
  const target = request => ({ sessionId: request.params.sessionId,
    learningAttemptId: request.params.learningAttemptId });
  routes.actionRoute("GET", "/presentation", { actionId: TRAINING_MAIN_PRESENTATION_ACTION,
    summary: "Read this Main browser’s pending lesson presentation",
    buildInput: request => ({ clientId: routes.requestQuery(request).clientId, ...target(request) }) });
  routes.actionRoute("POST", "/presentation/focus", { actionId: TRAINING_MAIN_PRESENTATION_FOCUS_ACTION,
    summary: "Report this Main browser’s lesson view", bodyLimit: 16 * 1024,
    buildInput: request => ({ ...routes.requestBody(request), ...target(request) }) });
  routes.actionRoute("POST", "/presentation/ack", { actionId: TRAINING_MAIN_PRESENTATION_ACK_ACTION,
    summary: "Confirm this Main browser’s actual lesson presentation receipt", bodyLimit: 16 * 1024,
    buildInput: request => ({ ...routes.requestBody(request), ...target(request) }) });
}

export { registerTrainingMainPresentationRoutes };
