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
      // Path identities (attemptId, practiceId, archiveId) come only from the route.
      const identities = Object.fromEntries(["attemptId", "practiceId", "archiveId"]
        .filter(name => suffix.includes(`:${name}`)).map(name => [name, request.params[name]]));
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
  actionRoute("POST", "/attempts/:attemptId/end", "lesson.end");
  actionRoute("POST", "/attempts/:attemptId/continue", "lesson.continue");
  // Learning v2 reader and step results (contract C3).
  actionRoute("GET", "/lesson", "lesson.read");
  actionRoute("GET", "/attempts/:attemptId/lesson", "lesson.read");
  actionRoute("POST", "/attempts/:attemptId/steps/observe", "step.observe");
  actionRoute("POST", "/attempts/:attemptId/steps/check", "step.check.run");
  actionRoute("POST", "/attempts/:attemptId/steps/answer", "step.answer");
  actionRoute("POST", "/attempts/:attemptId/steps/done", "step.done");
  actionRoute("POST", "/attempts/:attemptId/reader", "reader.save");
  // The learner's practice projects in the learning space (Rev 3 R6).
  actionRoute("GET", "/practice", "practice.list");
  actionRoute("POST", "/practice/:practiceId/open", "practice.open");
  actionRoute("POST", "/practice/:practiceId/archive", "practice.archive");
  actionRoute("POST", "/practice/:practiceId/delete", "practice.delete");
  actionRoute("POST", "/practice/:practiceId/archives/:archiveId/delete", "practice.archived.delete");
  // Learning mode: read, and leave (ends the lesson in progress).
  actionRoute("GET", "/learning-mode", "learning-mode.read");
  actionRoute("POST", "/attempts/:attemptId/learning-mode/leave", "learning-mode.leave");
  // Learner notes (contract C7): the signed-in learner's own, never another's.
  // 4000 characters of Markdown may take up to 16 KiB of escaped JSON.
  actionRoute("GET", "/teacher-notes", "learner-notes.read");
  actionRoute("POST", "/teacher-notes", "learner-notes.update", 32 * 1024);
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
