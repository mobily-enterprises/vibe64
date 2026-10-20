import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { practiceProjectAttemptId } from "@local/vibe64-core/server/practiceProjects";
import { readOwnPracticeScope } from "./practiceProjects.js";

// Practice projects are ordinary projects (Learning v2), so the learner edits
// their code in the ordinary Files editor through the project-scoped
// vibe64.source-editor.file.save. This owner, installed on the source editor,
// records that save in the learner's code-authorship ledger while the
// project's own lesson attempt is active. Every other save (another project,
// another person, an ended or missing attempt) is the editor's plain save.
// It replaces the learning-scoped vibe64.training.code.file.save action and
// its lesson-URL route, whose ledgered save it keeps unchanged.
//
// A host with several learner stores (Online: normal and author-preview)
// passes `selectOwners({ actor, attemptId })`, which returns the store's
// { authorship, learners } holding that attempt, or null for none.
function validOwners(owners) {
  if (typeof owners?.authorship?.saveLearnerFile !== "function" || typeof owners?.learners?.readExerciseProjectScope !== "function") {
    throw new TypeError("Lesson code saves require the original authorship and learner owners.");
  }
  return owners;
}

function createTrainingCodeSaveOwner({ authorship, learners, selectOwners } = {}) {
  if (selectOwners !== undefined && typeof selectOwners !== "function") throw new TypeError("Lesson code save selection must be a function.");
  const fixed = selectOwners ? null : validOwners({ authorship, learners });
  const select = selectOwners || (async () => fixed);
  return async function saveCodeFile({ input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const context = currentProjectRequestContext();
    const attemptId = practiceProjectAttemptId(context?.slug);
    const actor = context?.vibe64User;
    if (!attemptId || !actor) return save();
    const selected = await select({ actor, attemptId });
    if (!selected) return save();
    const owners = validOwners(selected);
    // Another person's (or no) attempt: this is not the learner's lesson code.
    const saved = await readOwnPracticeScope({ learners: owners.learners, actor, slug: context.slug, access: "observe",
      malformedIsForeign: true });
    if (!saved?.active) return save();
    return owners.authorship.saveLearnerFile({ actor, attemptId, input, save });
  };
}

export { createTrainingCodeSaveOwner };
