import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { TRAINING_LEARNER_NOTES_ACTIONS } from "./learnerNotesActions.js";
import { TRAINING_STEP_ACTIONS } from "./stepActions.js";
import { TRAINING_ACTIONS } from "./trainingActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

const BODY_LIMIT = 8 * 1024;
// LEARNER_NOTES_MAX_CHARS of Markdown may take up to 16 KiB of escaped JSON.
const NOTES_BODY_LIMIT = 32 * 1024;

/**
 * A request body's fields, without an actor or user it names: the action context supplies those.
 * @param {object} request
 */
function bodyInput(request) {
  const { actor: _actor, vibe64User: _user, ...input } = requestBody(request);
  void _actor;
  void _user;
  return input;
}

/**
 * A request body's fields for one attempt, whose identity comes only from the route.
 * @param {object} request
 */
function attemptBodyInput(request) {
  return { ...bodyInput(request), attemptId: request.params.attemptId };
}

/**
 * A read without input.
 */
function noInput() {
  return {};
}

/**
 * The lesson reader pages long step text; the page is its only query input.
 * @param {object} request
 */
function lessonReadInput(request) {
  const query = requestQuery(request);
  return /^[0-9]{1,2}$/u.test(String(query.page ?? "")) ? { page: Number(query.page) } : {};
}

/**
 * The lesson reader of one attempt, whose identity comes only from the route.
 * @param {object} request
 */
function attemptLessonReadInput(request) {
  return { ...lessonReadInput(request), attemptId: request.params.attemptId };
}

/**
 * HTTP only assembles canonical action inputs. Authentication, pins, revision
 * checks and effects belong to the existing Training actions and owners.
 * @param {RuntimeHttp} http
 */
function registerTrainingRoutes(http) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-training"] }), {
    relativePath: "vibe64/training",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ projectScoped: false })
  });
  routes.actionRoute("GET", "/courses", {
    actionId: TRAINING_ACTIONS.LIST_COURSES,
    buildInput: noInput,
    summary: "Use the canonical Training courses.list operation."
  });
  routes.actionRoute("POST", "/courses", {
    actionId: TRAINING_ACTIONS.CREATE_COURSE,
    bodyLimit: BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training courses.create operation."
  });
  routes.actionRoute("GET", "/available", {
    actionId: TRAINING_ACTIONS.LIST_AVAILABLE_COURSES,
    buildInput: noInput,
    summary: "Use the canonical Training available.list operation."
  });
  routes.actionRoute("POST", "/courses/install", {
    actionId: TRAINING_ACTIONS.INSTALL_COURSE,
    bodyLimit: BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training course.install operation."
  });
  routes.actionRoute("GET", "/learning", {
    actionId: TRAINING_ACTIONS.READ_LEARNING,
    buildInput: noInput,
    summary: "Use the canonical Training learning.read operation."
  });
  routes.actionRoute("POST", "/lessons/start", {
    actionId: TRAINING_ACTIONS.START_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training lesson.start operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/resume", {
    actionId: TRAINING_ACTIONS.RESUME_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training lesson.resume operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/restart", {
    actionId: TRAINING_ACTIONS.RESTART_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training lesson.restart operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/finish", {
    actionId: TRAINING_ACTIONS.FINISH_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training lesson.finish operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/delete", {
    actionId: TRAINING_STEP_ACTIONS.DELETE_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training lesson.delete operation."
  });
  // The lesson reader and step results.
  routes.actionRoute("GET", "/lesson", {
    actionId: TRAINING_STEP_ACTIONS.READ_LESSON,
    buildInput: lessonReadInput,
    summary: "Use the canonical Training lesson.read operation."
  });
  routes.actionRoute("GET", "/attempts/:attemptId/lesson", {
    actionId: TRAINING_STEP_ACTIONS.READ_LESSON,
    buildInput: attemptLessonReadInput,
    summary: "Use the canonical Training lesson.read operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/steps/observe", {
    actionId: TRAINING_STEP_ACTIONS.OBSERVE_STEP,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training step.observe operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/steps/check", {
    actionId: TRAINING_STEP_ACTIONS.RUN_STEP_CHECK,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training step.check.run operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/steps/answer", {
    actionId: TRAINING_STEP_ACTIONS.ANSWER_STEP,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training step.answer operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/steps/done", {
    actionId: TRAINING_STEP_ACTIONS.MARK_STEP_DONE,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training step.done operation."
  });
  // The learner's own "Check my work" on a review step.
  routes.actionRoute("POST", "/attempts/:attemptId/steps/review", {
    actionId: TRAINING_STEP_ACTIONS.RUN_STEP_REVIEW,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training step.review.run operation."
  });
  routes.actionRoute("POST", "/attempts/:attemptId/reader", {
    actionId: TRAINING_STEP_ACTIONS.SAVE_READER,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training reader.save operation."
  });
  // The lesson in progress and the archived lessons.
  routes.actionRoute("GET", "/practice", {
    actionId: TRAINING_STEP_ACTIONS.LIST_PRACTICE,
    buildInput: noInput,
    summary: "Use the canonical Training practice.list operation."
  });
  routes.actionRoute("POST", "/archives/:attemptId/delete", {
    actionId: TRAINING_STEP_ACTIONS.DELETE_ARCHIVED_LESSON,
    bodyLimit: BODY_LIMIT,
    buildInput: attemptBodyInput,
    summary: "Use the canonical Training practice.archived.delete operation."
  });
  // Learn mode: read, and switch between Learn and Develop (L).
  routes.actionRoute("GET", "/learning-mode", {
    actionId: TRAINING_ACTIONS.READ_LEARNING_MODE,
    buildInput: noInput,
    summary: "Use the canonical Training learning-mode.read operation."
  });
  routes.actionRoute("POST", "/learning-mode", {
    actionId: TRAINING_ACTIONS.SET_LEARNING_MODE,
    bodyLimit: BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training learning-mode.set operation."
  });
  // Learner notes: the signed-in learner's own, never another's.
  routes.actionRoute("GET", "/teacher-notes", {
    actionId: TRAINING_LEARNER_NOTES_ACTIONS.READ_NOTES,
    buildInput: noInput,
    summary: "Use the canonical Training learner-notes.read operation."
  });
  routes.actionRoute("POST", "/teacher-notes", {
    actionId: TRAINING_LEARNER_NOTES_ACTIONS.UPDATE_NOTES,
    bodyLimit: NOTES_BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training learner-notes.update operation."
  });
  routes.actionRoute("POST", "/teacher-notes/clear", {
    actionId: TRAINING_LEARNER_NOTES_ACTIONS.CLEAR_NOTES,
    bodyLimit: BODY_LIMIT,
    buildInput: bodyInput,
    summary: "Use the canonical Training learner-notes.clear operation."
  });
}

export { registerTrainingRoutes };
