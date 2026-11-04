import { VIBE64_LEARNING_ROUTES, text } from "@/lib/vibe64LearningModel.js";

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {import("./vibe64LearningModel.js").LearningPendingRequestIds} LearningPendingRequestIds */
/** @typedef {import("./vibe64LearningCurrentLesson.js").LearningCurrentLesson} LearningCurrentLesson */
/** @typedef {import("./vibe64LearningModes.js").LearningModes} LearningModes */

// Learner App presses whose observation is still being recorded.
const MAX_EXERCISE_OBSERVATIONS = 8;

/**
 * The current lesson's step actions (check, answer, done, review) and the
 * learner's App presses that answer a step; each confirmed verdict is reread
 * from lesson.read.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 * @param {LearningPendingRequestIds} dependencies.pending
 * @param {LearningCurrentLesson} dependencies.currentLesson
 * @param {LearningModes} dependencies.modes
 */
function createLearningStepActions({ state, request, pending, currentLesson, modes }) {
  const exerciseObservations = new Set();
  // viewer fences everything of one signed-in person.
  let viewer = 0;

  /**
   * A learner's own step result that completes the lesson opens the Finished screen.
   */
  function finishedBy(before, attemptId) {
    if (!before && currentLesson.complete.value && attemptId === state.attemptId) void modes.showFinished().catch(() => {});
  }

  /**
   * One step action; its confirmed verdict is then reread from lesson.read.
   */
  async function stepAction(kind, route, stepId, extra = {}) {
    if (!state.attemptId || state.busy) return null;
    const attemptId = state.attemptId;
    const key = JSON.stringify([attemptId, kind, stepId, extra]);
    const requestId = pending.requestId(key);
    const expected = viewer;
    const before = currentLesson.complete.value;
    state.busy = `${kind}:${stepId}`;
    state.lessonError = "";
    try {
      const result = await request(route(attemptId), { method: "POST", body: { stepId, ...extra, requestId } });
      if (result?.ok === false) throw new Error(result.error || "The step result was not confirmed. Try again.");
      pending.forget(key);
      if (expected === viewer && attemptId === state.attemptId) {
        await currentLesson.loadLesson(attemptId);
        finishedBy(before, attemptId);
      }
      return result;
    } catch (cause) {
      if (expected === viewer) state.lessonError = String(cause?.message || "The step result was not confirmed. Try again.");
      return null;
    } finally {
      if (state.busy === `${kind}:${stepId}`) state.busy = "";
    }
  }

  /**
   * Learner-origin App interaction: the step a press in projectSlug's Preview
   * answers. Only the current step of the current, prepared, not-ended version
   * 2 attempt whose practice project is projectSlug, while Courses does not
   * cover the app, and only when that step declares an automatic response
   * check (code checks always name files). The server's step owner decides
   * everything else.
   */
  function exerciseStep(projectSlug) {
    const value = currentLesson.lesson.value;
    const step = currentLesson.currentStep.value;
    const attempt = value?.attempt;
    if (!state.actorKey || !state.attemptId || state.open || !text(projectSlug) || !(value?.schemaVersion >= 2) ||
        attempt?.attemptId !== state.attemptId || attempt.ended || attempt.preparation?.phase !== "ready" ||
        value.practiceProjectSlug !== projectSlug || step?.check?.kind !== "auto" || step.check.files?.length) return null;
    return { attemptId: state.attemptId, stepId: step.id };
  }

  /**
   * A press can begin only with a current response step; the ticket fences the
   * signed-in viewer, attempt, step and practice project until it finishes.
   */
  function beginExercise(projectSlug) {
    const target = exerciseStep(projectSlug);
    if (!target || exerciseObservations.size >= MAX_EXERCISE_OBSERVATIONS) return null;
    return Object.freeze({
      ...target,
      projectSlug,
      actorKey: state.actorKey,
      viewer
    });
  }

  function exerciseCurrent(ticket) {
    const target = ticket && ticket.viewer === viewer && ticket.actorKey === state.actorKey ? exerciseStep(ticket.projectSlug) : null;
    return Boolean(target && target.attemptId === ticket.attemptId && target.stepId === ticket.stepId);
  }

  /**
   * step.observe: the browser-only receipt of the learner's own press, with the
   * exact identities its declared check verifies against the App server.
   */
  async function finishExercise(ticket, { sessionId, instanceId, interactionId, requestId } = {}) {
    if (!exerciseCurrent(ticket) || !text(sessionId) || exerciseObservations.has(requestId)) return null;
    exerciseObservations.add(requestId);
    const expected = viewer;
    const before = currentLesson.complete.value;
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.stepObserve(ticket.attemptId), { method: "POST", body: {
        stepId: ticket.stepId, observation: { control: "exercise-response",
          exercise: { instanceId, interactionId, requestId },
          workspace: { projectSlug: ticket.projectSlug, sessionId, projectVisible: true, pane: "preview", ready: true } } } });
      if (result?.ok === false) throw new Error(result.error || "The App press was not recorded. Press the App's button again.");
      if (expected === viewer && ticket.attemptId === state.attemptId) {
        await currentLesson.loadLesson(ticket.attemptId);
        finishedBy(before, ticket.attemptId);
      }
      return result;
    } catch (cause) {
      if (expected === viewer) state.lessonError = String(cause?.message || "The App press was not recorded. Press the App's button again.");
      return null;
    } finally {
      exerciseObservations.delete(requestId);
    }
  }

  /**
   * After a reload the current attempt is remembered but not read yet; a
   * practice App announcing itself reads it so the learner's next press can count.
   */
  function prepareExercise(projectSlug) {
    if (!text(projectSlug) || !state.actorKey || !state.attemptId || currentLesson.lesson.value || state.loading) return null;
    return currentLesson.loadLesson(state.attemptId);
  }

  const runCheck = stepId => stepAction("check", VIBE64_LEARNING_ROUTES.stepCheck, stepId);
  const answer = (stepId, selected) => stepAction("answer", VIBE64_LEARNING_ROUTES.stepAnswer, stepId,
    { selected: [...selected].map(Number).sort((left, right) => left - right) });
  const done = stepId => stepAction("done", VIBE64_LEARNING_ROUTES.stepDone, stepId);
  // Check my work on a review step: one press, one review (a repeat with the
  // same work answers from the saved result); failures record nothing.
  const review = stepId => stepAction("review", VIBE64_LEARNING_ROUTES.stepReview, stepId);
  // The step's latest saved review result, if any.
  const savedReview = stepId => currentLesson.results.value.filter(result => result?.stepId === stepId && result.review).at(-1) || null;

  /**
   * Another signed-in viewer: no App press or step action of the previous one lands.
   */
  function reset() {
    viewer += 1;
    exerciseObservations.clear();
  }

  return Object.freeze({
    exerciseStep,
    beginExercise,
    exerciseCurrent,
    finishExercise,
    prepareExercise,
    runCheck,
    answer,
    done,
    review,
    savedReview,
    reset
  });
}

export { createLearningStepActions };
