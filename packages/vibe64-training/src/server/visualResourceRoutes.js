import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { TRAINING_VISUAL_RESOURCE_ACTION, TRAINING_VISUAL_CHECKPOINT_ACTION } from "./visualResourceActions.js";

const TRAINING_VISUAL_RESOURCE_API_PATH = "/api/vibe64/training/attempts/:attemptId/visuals/:visualId";

function registerTrainingVisualResourceRoutes(http, { learningScoped = false } = {}) {
  const routes = createVibe64FeatureRoutes(http, { projectScoped: false, routeSurface: "app",
    routeRelativePath: learningScoped
      ? "learning/:learningAttemptId/vibe64/sessions/:sessionId/training" : "vibe64/training" });
  const suffix = learningScoped ? "/visuals/:visualId" : "/attempts/:attemptId/visuals/:visualId";
  const target = request => learningScoped
    ? { attemptId: request.params.learningAttemptId, learningAttemptId: request.params.learningAttemptId,
      sessionId: request.params.sessionId, visualId: request.params.visualId }
    : { attemptId: request.params.attemptId, visualId: request.params.visualId };
  routes.serviceRoute("POST", suffix, { summary: "Confirm the lesson diagram checkpoint" }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      const { learningAttemptId: _claimedLearningAttempt, ...body } = request.body || {};
      return await request.executeAction({ actionId: TRAINING_VISUAL_CHECKPOINT_ACTION,
        input: { ...body, ...target(request) } });
    } catch (error) {
      return reply.code(Number.isInteger(error?.statusCode) ? error.statusCode : 400).send(vibe64ErrorResponse(error, {
        fallbackCode: "VIBE64_TRAINING_VISUAL_CHECKPOINT_FAILED", fallbackMessage: "The lesson diagram checkpoint was not confirmed."
      }));
    }
  });
  routes.serviceRoute("GET", suffix, { summary: "Read the pinned lesson diagram" }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    try {
      return await request.executeAction({ actionId: TRAINING_VISUAL_RESOURCE_ACTION,
        input: target(request) });
    } catch (error) {
      return reply.code(Number.isInteger(error?.statusCode) ? error.statusCode : 400).send(vibe64ErrorResponse(error, {
        fallbackCode: "VIBE64_TRAINING_VISUAL_RESOURCE_FAILED", fallbackMessage: "The pinned lesson diagram could not be read."
      }));
    }
  });
}

export { TRAINING_VISUAL_RESOURCE_API_PATH, registerTrainingVisualResourceRoutes };
