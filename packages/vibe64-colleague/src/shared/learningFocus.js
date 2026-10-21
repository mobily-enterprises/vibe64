// Courses sits above the app beside L in Learn mode. A command that opens or
// closes it is confirmed only by the browser's reported Courses state; an
// attempt/step selection must be the one actually shown. Both hosts'
// navigators and the server's acknowledgement check use this one rule.
export function learningPanelMatches(command, focus) {
  const learning = command.learning;
  if (!learning) return true;
  if ((focus?.learningOpen === true) !== learning.open) return false;
  if (!learning.open || !learning.attemptId) return true;
  return focus.learningSurface === "lesson" && focus.learningAttemptId === learning.attemptId &&
    (!learning.stepId || focus.learningStepId === learning.stepId);
}

// Vue's unref without importing Vue: this module also runs on the server.
const read = (value) => value?.__v_isRef === true ? value.value : value;

// The focus fields the host's Learning controller reports (each a value or a
// ref): whether Courses is open, its visible surface, and the current lesson
// attempt and step, kept while Courses is closed so Colleague can teach that
// step. No controller reports nothing.
export function learningPanelFocus(controller) {
  if (!controller) return {};
  const learningOpen = read(controller.coursesOpen) === true;
  const surface = read(controller.surface);
  const attemptId = read(controller.mode)?.currentAttemptId;
  const stepId = read(controller.stepId);
  return {
    learningOpen,
    ...(learningOpen && ["courses", "progress", "archived", "lesson"].includes(surface) ? { learningSurface: surface } : {}),
    ...(attemptId ? { learningAttemptId: attemptId, ...(stepId ? { learningStepId: stepId } : {}) } : {})
  };
}

// Applies a navigation command's `learning` part ({ open, attemptId?, stepId? })
// through the host's Learning controller; the caller then waits for
// learningPanelMatches.
export async function applyLearningNavigation(controller, learning) {
  if (!controller) throw new Error("Courses is unavailable in this view.");
  const { open, attemptId, stepId } = learning;
  if (open) await controller.openCourses({ ...(attemptId ? { attemptId } : {}), ...(stepId ? { stepId } : {}) });
  else await controller.closeCourses();
}
