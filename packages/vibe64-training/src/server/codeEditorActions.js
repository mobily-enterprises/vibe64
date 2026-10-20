import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { practiceProjectAttemptId } from "@local/vibe64-core/server/practiceProjects";

// Practice projects are ordinary projects (Learning v2), so the learner edits
// their code in the ordinary Files editor through the project-scoped
// vibe64.source-editor.file.save. This owner, installed on the source editor,
// records that save in the learner's code-authorship ledger while the
// project's own lesson attempt is active. Every other save (another project,
// another person, an ended or missing attempt) is the editor's plain save.
// It replaces the learning-scoped vibe64.training.code.file.save action and
// its lesson-URL route, whose ledgered save it keeps unchanged.
function createTrainingCodeSaveOwner({ authorship, learners } = {}) {
  if (typeof authorship?.saveLearnerFile !== "function" || typeof learners?.readExerciseProjectScope !== "function") {
    throw new TypeError("Lesson code saves require the original authorship and learner owners.");
  }
  return async function saveCodeFile({ input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const context = currentProjectRequestContext();
    const attemptId = practiceProjectAttemptId(context?.slug);
    const actor = context?.vibe64User;
    if (!attemptId || !actor) return save();
    let saved;
    try { saved = await learners.readExerciseProjectScope({ actor, attemptId, access: "observe" }); }
    catch (error) {
      // Another person's (or no) attempt: this is not the learner's lesson code.
      if (["VIBE64_TRAINING_ATTEMPT_MISSING", "VIBE64_TRAINING_EXERCISE_MISSING"].includes(error.code) ||
          error.message === "Use the exact saved exercise attempt ID.") return save();
      throw error;
    }
    if (saved.projectSlug !== context.slug || !saved.active) return save();
    return authorship.saveLearnerFile({ actor, attemptId, input, save });
  };
}

export { createTrainingCodeSaveOwner };
