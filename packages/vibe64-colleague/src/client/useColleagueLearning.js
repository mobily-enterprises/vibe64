import { computed, unref, watch } from "vue";
import { applyLearningNavigation } from "../shared/learningFocus.js";

/**
 * Colleague's side of the shared Learning controller (L and Courses): the
 * header's current-step button, and on a phone giving way to Courses and
 * coming back when the learner closes it.
 * @param {object} options
 * @param {import("vue").ComputedRef<object | null>} options.learningController
 * @param {import("vue").Ref<boolean>} options.xs
 * @param {import("vue").ComputedRef<boolean>} options.shown
 * @param {() => Promise<void>} options.toggleConversation
 * @param {() => void} options.reopenConversation
 * @param {(error: unknown) => void} options.reportFailure
 */
function useColleagueLearning({ learningController, xs, shown, toggleConversation, reopenConversation, reportFailure }) {
  // The header's current-step button reads only the Learning controller's client
  // state; it shows that step in the Learn page's Lesson pane.
  const learningStep = computed(() => {
    const controller = learningController.value;
    // Only Learn mode teaches; Develop's Colleague shows no lesson step.
    const mode = unref(controller?.mode);
    const attemptId = mode?.on === true ? unref(controller.lessonAttemptId) ?? mode.currentAttemptId : "";
    const stepId = unref(controller?.stepId);
    const lesson = unref(controller?.lesson);
    const steps = Array.isArray(lesson?.steps) ? lesson.steps : [];
    const index = steps.findIndex(step => step?.id === stepId);
    if (!attemptId || !stepId || index < 0 || lesson.attempt?.ended) return null;
    const results = unref(controller.results);
    // lesson.read names the steps this attempt has passed.
    const passed = (Array.isArray(lesson?.passedStepIds) && lesson.passedStepIds.includes(stepId))
      || (Array.isArray(results) && results.some(result => result?.stepId === stepId && result.outcome === "passed"));
    return { attemptId, stepId, lessonTitle: String(lesson.title || ""), title: String(steps[index].title || ""),
      position: index + 1, total: steps.length, passed };
  });
  // The same compact button in the drawer header (desktop) or the phone dialog
  // header; both stay mounted (the dialog is eager), so only one carries it.
  const stepButton = computed(() => learningStep.value && {
    class: ["vibe64-colleague__step-button", { "vibe64-colleague__step-button--passed": learningStep.value.passed }],
    variant: "flat", rounded: "pill", height: 32, "data-test": "colleague-current-step",
    "aria-label": `Show the current lesson step: ${learningStep.value.title}`,
    title: `Current lesson step: ${learningStep.value.title}`
  });
  /**
   * Step N/M: the Lesson pane at this step. A phone shows one surface, so
   * Colleague's full-screen dialog minimises to show it (the avatar brings it back).
   */
  function showLearningStep() {
    const step = learningStep.value;
    const controller = learningController.value;
    if (!step) return;
    const show = () => applyLearningNavigation(controller, { attemptId: step.attemptId, stepId: step.stepId });
    if (xs.value && shown.value) toggleConversation().then(show).catch(reportFailure);
    else Promise.resolve(show()).catch(reportFailure);
  }
  // A phone shows one surface. When Colleague's dialog gave way to Courses and
  // the learner then closes Courses themselves, the dialog comes back (not the
  // app behind it). Show me, Teach me and app navigation close Courses to show
  // something else, so they never bring the dialog back.
  let returnFromLearning = false;
  /** Minimises Colleague's dialog so Courses shows, remembering to come back. */
  function leaveForLearning() {
    returnFromLearning = true;
    return toggleConversation();
  }
  watch(() => unref(learningController.value?.coursesOpen) === true, (learningOpen, wasOpen) => {
    // On a phone, Colleague's dialog comes back when the learner closes the
    // Courses it gave way to.
    if (learningOpen || !wasOpen) return;
    const back = returnFromLearning && learningController.value?.hiddenBy === "learner";
    returnFromLearning = false;
    if (back && xs.value) reopenConversation();
  });
  return { learningStep, stepButton, showLearningStep, leaveForLearning };
}

export { useColleagueLearning };
