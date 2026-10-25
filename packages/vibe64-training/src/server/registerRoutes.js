import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

// HTTP only assembles canonical action inputs. Authentication, pins, revision
// checks and effects belong to the existing Training actions and owners.
function registerTrainingRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, {
    projectScoped: false, routeRelativePath: "vibe64/training", routeSurface: "app",
    tags: ["studio", "vibe64-training"]
  });
  const actionRoute = (method, suffix, operation, bodyLimit = 8 * 1024) => routes.actionRoute(method, suffix, {
    actionId: `vibe64.training.${operation}`,
    ...(method === "POST" ? { bodyLimit } : {}),
    buildInput(request) {
      const { actor: _actor, vibe64User: _user, ...input } = method === "POST" ? routes.requestBody(request) : {};
      void _actor;
      void _user;
      // The lesson reader pages long step text; the page is its only query input.
      const query = operation === "lesson.read" ? routes.requestQuery(request) : {};
      const page = /^[0-9]{1,2}$/u.test(String(query.page ?? "")) ? { page: Number(query.page) } : {};
      // The path identity (attemptId) comes only from the route.
      const identities = suffix.includes(":attemptId") ? { attemptId: request.params.attemptId } : {};
      return { ...input, ...page, ...identities };
    },
    summary: `Use the canonical Training ${operation} operation.`
  });
  actionRoute("GET", "/courses", "courses.list");
  actionRoute("POST", "/courses", "courses.create");
  actionRoute("GET", "/available", "available.list");
  actionRoute("POST", "/courses/install", "course.install");
  actionRoute("GET", "/learning", "learning.read");
  actionRoute("POST", "/lessons/start", "lesson.start");
  actionRoute("POST", "/attempts/:attemptId/resume", "lesson.resume");
  actionRoute("POST", "/attempts/:attemptId/restart", "lesson.restart");
  actionRoute("POST", "/attempts/:attemptId/finish", "lesson.finish");
  actionRoute("POST", "/attempts/:attemptId/delete", "lesson.delete");
  // Learning v2 reader and step results (contract C3).
  actionRoute("GET", "/lesson", "lesson.read");
  actionRoute("GET", "/attempts/:attemptId/lesson", "lesson.read");
  actionRoute("POST", "/attempts/:attemptId/steps/observe", "step.observe");
  actionRoute("POST", "/attempts/:attemptId/steps/check", "step.check.run");
  actionRoute("POST", "/attempts/:attemptId/steps/answer", "step.answer");
  actionRoute("POST", "/attempts/:attemptId/steps/done", "step.done");
  // The learner's own "Check my work" on a review step.
  actionRoute("POST", "/attempts/:attemptId/steps/review", "step.review.run");
  actionRoute("POST", "/attempts/:attemptId/reader", "reader.save");
  // The lesson in progress and the archived lessons (Rev 4 C2).
  actionRoute("GET", "/practice", "practice.list");
  actionRoute("POST", "/archives/:attemptId/delete", "practice.archived.delete");
  // Learn mode: read, and switch between Learn and Develop (L).
  actionRoute("GET", "/learning-mode", "learning-mode.read");
  actionRoute("POST", "/learning-mode", "learning-mode.set");
  // Learner notes (contract C7): the signed-in learner's own, never another's.
  // LEARNER_NOTES_MAX_CHARS of Markdown may take up to 16 KiB of escaped JSON.
  actionRoute("GET", "/teacher-notes", "learner-notes.read");
  actionRoute("POST", "/teacher-notes", "learner-notes.update", 32 * 1024);
  actionRoute("POST", "/teacher-notes/clear", "learner-notes.clear");
}

export { registerTrainingRoutes };
