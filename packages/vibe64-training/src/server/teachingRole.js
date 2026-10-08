// These existing teacher operations belong to the admitted Main lesson teacher.
// Colleague retains lesson lifecycle, progress reads and authoring coordination.
const TRAINING_TEACHER_ACTION_IDS = Object.freeze([
  "vibe64.training.question.prepare", "vibe64.training.answer.evaluate",
  "vibe64.training.practical.evaluate", "vibe64.training.visual.open",
  "vibe64.training.visual.command", "vibe64.training.visual.cue",
  "vibe64.training.visual.cue.read", "vibe64.training.visual.snapshot",
  "vibe64.training.practical.read"
]);

function isTrainingTeacherAction(actionId) {
  return TRAINING_TEACHER_ACTION_IDS.includes(actionId);
}

function requireTrainingMainTeacher(context, methods) {
  if (context.colleague) {
    throw Object.assign(new Error("Colleague supervises lessons and authoring. Use the saved lesson's Main teacher for questions, assessment and diagrams."), {
      code: "VIBE64_TRAINING_SUPERVISOR_ONLY", statusCode: 403
    });
  }
  const coordinator = context.trainingMain;
  if (!coordinator || methods.some(name => typeof coordinator[name] !== "function")) {
    throw Object.assign(new Error("This operation requires the saved lesson's admitted Main teacher. The required teaching facility is unavailable; no teaching effect was performed."), {
      code: "VIBE64_TRAINING_MAIN_UNAVAILABLE", statusCode: 503
    });
  }
  return coordinator;
}

export { TRAINING_TEACHER_ACTION_IDS, isTrainingTeacherAction, requireTrainingMainTeacher };
