// Courses (from the project menu beside L) is the catalogue above the app in
// Learn mode; the current lesson is read in the Learn page's Lesson pane. A
// command { open } that opens or closes Courses is confirmed only by the
// browser's reported Courses state; a command { attemptId, stepId? } (no open)
// that shows a lesson step only by the Lesson pane actually showing that
// attempt and step (focus pane=lesson), with Courses closed. Both hosts'
// navigators and the server's acknowledgement check use this one rule.
export function learningPanelMatches(command, focus) {
  const learning = command.learning;
  if (!learning) return true;
  if (typeof learning.open === "boolean") return (focus?.learningOpen === true) === learning.open;
  return focus?.learningOpen !== true && focus?.pane === "lesson" && focus.learningAttemptId === learning.attemptId &&
    (!learning.stepId || focus.learningStepId === learning.stepId);
}

// Vue's unref without importing Vue: this module also runs on the server.
const read = (value) => value?.__v_isRef === true ? value.value : value;

// The focus fields the host's Learning controller reports (each a value or a
// ref): whether Courses is open, its visible surface, and the current lesson
// attempt and step, kept while Courses is closed so Colleague can teach that
// step. No controller reports nothing. (Whether the Lesson pane shows is the
// page layout's pane=lesson, which the host reports.)
export function learningPanelFocus(controller) {
  if (!controller) return {};
  const learningOpen = read(controller.coursesOpen) === true;
  const surface = read(controller.surface);
  const attemptId = read(controller.lessonAttemptId) ?? read(controller.mode)?.currentAttemptId;
  const stepId = read(controller.stepId);
  return {
    learningOpen,
    ...(learningOpen && ["courses", "progress", "archived", "lesson"].includes(surface) ? { learningSurface: surface } : {}),
    ...(attemptId ? { learningAttemptId: attemptId, ...(stepId ? { learningStepId: stepId } : {}) } : {})
  };
}

// Applies a navigation command's `learning` part ({ open } or
// { attemptId, stepId? }) through the host's Learning controller; the caller
// then waits for learningPanelMatches. open:true shows Courses where the
// person left it; open:false hides it with its place kept, not as the
// learner's own close; an attempt and step show that step in the Lesson pane.
export async function applyLearningNavigation(controller, learning) {
  if (!controller) throw new Error("Courses is unavailable in this view.");
  const { open, attemptId, stepId } = learning;
  if (open === true) await controller.show();
  else if (open === false) await controller.minimise();
  else await controller.openLesson({ attemptId, ...(stepId ? { stepId } : {}) });
}
