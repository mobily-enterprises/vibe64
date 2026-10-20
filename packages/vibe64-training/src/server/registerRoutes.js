import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

// HTTP only assembles canonical action inputs. Authentication, pins, revision
// checks and effects belong to the existing Training actions and owners.
function registerTrainingRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, {
    projectScoped: false, routeRelativePath: "vibe64/training", routeSurface: "app",
    tags: ["studio", "vibe64-training"]
  });
  const actionRoute = (method, suffix, operation, attempt = false, bodyLimit = 8 * 1024) => routes.actionRoute(method, suffix, {
    actionId: `vibe64.training.${operation}`,
    ...(method === "POST" ? { bodyLimit } : {}),
    buildInput(request) {
      const { actor: _actor, vibe64User: _user, ...input } = method === "POST" ? routes.requestBody(request) : {};
      void _actor;
      void _user;
      // The lesson reader pages long step text; the page is its only query input.
      const query = operation === "lesson.read" ? routes.requestQuery(request) : {};
      const page = /^[0-9]{1,2}$/u.test(String(query.page ?? "")) ? { page: Number(query.page) } : {};
      return attempt ? { ...input, ...page, attemptId: request.params.attemptId } : { ...input, ...page };
    },
    summary: `Use the canonical Training ${operation} operation.`
  });
  actionRoute("GET", "/courses", "courses.list");
  actionRoute("POST", "/courses", "courses.create");
  actionRoute("GET", "/available", "available.list");
  actionRoute("POST", "/courses/install", "course.install");
  actionRoute("GET", "/learning", "learning.read");
  actionRoute("GET", "/attempts/:attemptId/brief", "teaching-brief.read", true);
  actionRoute("POST", "/lessons/start", "lesson.start");
  actionRoute("POST", "/attempts/:attemptId/resume", "lesson.resume", true);
  actionRoute("POST", "/attempts/:attemptId/end", "lesson.end", true);
  actionRoute("POST", "/attempts/:attemptId/continue", "lesson.continue", true);
  // Learning v2 reader, step results and practice deletion (contract C3).
  actionRoute("GET", "/lesson", "lesson.read");
  actionRoute("GET", "/attempts/:attemptId/lesson", "lesson.read", true);
  actionRoute("POST", "/attempts/:attemptId/steps/observe", "step.observe", true);
  actionRoute("POST", "/attempts/:attemptId/steps/check", "step.check.run", true);
  actionRoute("POST", "/attempts/:attemptId/steps/answer", "step.answer", true);
  actionRoute("POST", "/attempts/:attemptId/steps/done", "step.done", true);
  actionRoute("POST", "/attempts/:attemptId/reader", "reader.save", true);
  actionRoute("POST", "/attempts/:attemptId/practice/delete", "practice.delete", true);
  // Learner notes (contract C7): the signed-in learner's own, never another's.
  // 4000 characters of Markdown may take up to 16 KiB of escaped JSON.
  actionRoute("GET", "/teacher-notes", "learner-notes.read");
  actionRoute("POST", "/teacher-notes", "learner-notes.update", false, 32 * 1024);
  actionRoute("POST", "/teacher-notes/clear", "learner-notes.clear");
}

// Hosted snapshot admission stays with its existing owner. This adapter only
// reads the already saved trial; it never captures source or reserves a lesson.
function registerTrainingAuthorPreviewRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, {
    projectScoped: false, routeRelativePath: "vibe64/training", routeSurface: "app",
    tags: ["studio", "vibe64-training"]
  });
  routes.actionRoute("GET", "/author-preview", {
    actionId: "vibe64.training.author-preview.read", buildInput: () => ({}),
    summary: "Read the authenticated owner's saved isolated author trial."
  });
}

export { registerTrainingRoutes, registerTrainingAuthorPreviewRoutes };
