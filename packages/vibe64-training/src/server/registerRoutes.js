import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";

// LEARNER_NOTES_MAX_CHARS of Markdown may take up to 16 KiB of escaped JSON.
const BODY_LIMITS = Object.freeze({ "learner-notes.update": 32 * 1024 });

// HTTP only assembles canonical action inputs. Authentication, pins, revision
// checks and effects belong to the existing Training actions and owners.
function registerTrainingRoutes(http) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-training"] }), {
    relativePath: "vibe64/training", surface: "app", wrapHandler: vibe64RouteHandler({ projectScoped: false })
  });
  for (const [method, suffix, operation] of [
    ["GET", "/courses", "courses.list"],
    ["POST", "/courses", "courses.create"],
    ["GET", "/available", "available.list"],
    ["POST", "/courses/install", "course.install"],
    ["GET", "/learning", "learning.read"],
    ["POST", "/lessons/start", "lesson.start"],
    ["POST", "/attempts/:attemptId/resume", "lesson.resume"],
    ["POST", "/attempts/:attemptId/restart", "lesson.restart"],
    ["POST", "/attempts/:attemptId/finish", "lesson.finish"],
    ["POST", "/attempts/:attemptId/delete", "lesson.delete"],
    // Learning v2 reader and step results (contract C3).
    ["GET", "/lesson", "lesson.read"],
    ["GET", "/attempts/:attemptId/lesson", "lesson.read"],
    ["POST", "/attempts/:attemptId/steps/observe", "step.observe"],
    ["POST", "/attempts/:attemptId/steps/check", "step.check.run"],
    ["POST", "/attempts/:attemptId/steps/answer", "step.answer"],
    ["POST", "/attempts/:attemptId/steps/done", "step.done"],
    // The learner's own "Check my work" on a review step.
    ["POST", "/attempts/:attemptId/steps/review", "step.review.run"],
    ["POST", "/attempts/:attemptId/reader", "reader.save"],
    // The lesson in progress and the archived lessons (Rev 4 C2).
    ["GET", "/practice", "practice.list"],
    ["POST", "/archives/:attemptId/delete", "practice.archived.delete"],
    // Learn mode: read, and switch between Learn and Develop (L).
    ["GET", "/learning-mode", "learning-mode.read"],
    ["POST", "/learning-mode", "learning-mode.set"],
    // Learner notes (contract C7): the signed-in learner's own, never another's.
    ["GET", "/teacher-notes", "learner-notes.read"],
    ["POST", "/teacher-notes", "learner-notes.update"],
    ["POST", "/teacher-notes/clear", "learner-notes.clear"]
  ]) routes.actionRoute(method, suffix, {
    actionId: `vibe64.training.${operation}`,
    ...(method === "POST" ? { bodyLimit: BODY_LIMITS[operation] ?? 8 * 1024 } : {}),
    buildInput(request) {
      const { actor: _actor, vibe64User: _user, ...input } = method === "POST" ? requestBody(request) : {};
      void _actor;
      void _user;
      // The lesson reader pages long step text; the page is its only query input.
      const query = operation === "lesson.read" ? requestQuery(request) : {};
      const page = /^[0-9]{1,2}$/u.test(String(query.page ?? "")) ? { page: Number(query.page) } : {};
      // The path identity (attemptId) comes only from the route.
      const identities = suffix.includes(":attemptId") ? { attemptId: request.params.attemptId } : {};
      return { ...input, ...page, ...identities };
    },
    summary: `Use the canonical Training ${operation} operation.`
  });
}

export { registerTrainingRoutes };
