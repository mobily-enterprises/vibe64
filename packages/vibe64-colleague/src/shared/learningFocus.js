// The Learning environment (L) sits above the app. A command that opens or
// minimises it is confirmed only by the browser's reported L state; an
// attempt/step selection must be the one actually shown. Both hosts' navigators
// and the server's acknowledgement check use this one rule.
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

// The focus fields L reports through a host's controller (open, surface,
// attemptId and stepId, each a value or a ref): its open state, the visible
// surface, and the current lesson step, kept while L is minimised so Colleague
// can teach that step. No controller reports nothing.
export function learningPanelFocus(controller) {
  if (!controller) return {};
  const learningOpen = read(controller.open) === true;
  const surface = read(controller.surface);
  const attemptId = read(controller.attemptId);
  const stepId = read(controller.stepId);
  return {
    learningOpen,
    ...(learningOpen && ["courses", "lesson"].includes(surface) ? { learningSurface: surface } : {}),
    ...(attemptId ? { learningAttemptId: attemptId, ...(stepId ? { learningStepId: stepId } : {}) } : {})
  };
}

// Applies a navigation command's `learning` part ({ open, attemptId?, stepId? })
// through the host's L controller; the caller then waits for learningPanelMatches.
export async function applyLearningNavigation(controller, learning) {
  if (!controller) throw new Error("Learning is unavailable in this view.");
  const { open, attemptId, stepId } = learning;
  if (open) await controller.show({ ...(attemptId ? { attemptId } : {}), ...(stepId ? { stepId } : {}) });
  else await controller.minimise();
}
