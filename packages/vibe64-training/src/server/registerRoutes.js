import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

// HTTP only assembles canonical action inputs. Authentication, pins, revision
// checks and effects belong to the existing Training actions and owners.
function registerTrainingRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, {
    projectScoped: false, routeRelativePath: "vibe64/training", routeSurface: "app",
    tags: ["studio", "vibe64-training"]
  });
  const actionRoute = (method, suffix, operation, attempt = false) => routes.actionRoute(method, suffix, {
    actionId: `vibe64.training.${operation}`,
    ...(method === "POST" ? { bodyLimit: 8 * 1024 } : {}),
    buildInput(request) {
      const { actor: _actor, vibe64User: _user, ...input } = method === "POST" ? routes.requestBody(request) : {};
      void _actor;
      void _user;
      return attempt ? { ...input, attemptId: request.params.attemptId } : input;
    },
    summary: `Use the canonical Training ${operation} operation.`
  });
  actionRoute("GET", "/courses", "courses.list");
  actionRoute("GET", "/learning", "learning.read");
  actionRoute("GET", "/attempts/:attemptId/brief", "teaching-brief.read", true);
  actionRoute("POST", "/lessons/start", "lesson.start");
  actionRoute("POST", "/attempts/:attemptId/resume", "lesson.resume", true);
  actionRoute("POST", "/attempts/:attemptId/end", "lesson.end", true);
  actionRoute("POST", "/attempts/:attemptId/continue", "lesson.continue", true);
}

export { registerTrainingRoutes };
