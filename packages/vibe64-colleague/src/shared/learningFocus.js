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
