import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { TRAINING_VISUAL_RESOURCE_ACTION } from "./visualResourceActions.js";

const TRAINING_VISUAL_RESOURCE_API_PATH = "/api/vibe64/training/attempts/:attemptId/visuals/:visualId";

function registerTrainingVisualResourceRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, { projectScoped: false, routeSurface: "app", routeRelativePath: "vibe64/training" });
  routes.serviceRoute("GET", "/attempts/:attemptId/visuals/:visualId", { summary: "Read the pinned lesson diagram" }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return await request.executeAction({ actionId: TRAINING_VISUAL_RESOURCE_ACTION,
        input: { attemptId: request.params.attemptId, visualId: request.params.visualId } });
    } catch (error) {
      return reply.code(Number.isInteger(error?.statusCode) ? error.statusCode : 400).send(vibe64ErrorResponse(error, {
        fallbackCode: "VIBE64_TRAINING_VISUAL_RESOURCE_FAILED", fallbackMessage: "The pinned lesson diagram could not be read."
      }));
    }
  });
}

export { TRAINING_VISUAL_RESOURCE_API_PATH, registerTrainingVisualResourceRoutes };
