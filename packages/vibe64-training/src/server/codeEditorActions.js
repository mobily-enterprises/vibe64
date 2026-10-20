import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { practiceIdFromSlug } from "@local/vibe64-core/server/learningSpace";

// Practice projects are ordinary projects (Learning v2), so the learner edits
// their code in the ordinary Files editor through the project-scoped
// vibe64.source-editor.file.save. This owner, installed on the source editor,
// records that save in the learner's code-authorship ledger, which the
// authorship owner does only while a lesson attempt of that practice project
// is in progress (learners.activeAttemptForPractice). Every other save
// (another project, another person, no attempt in progress there) is the
// editor's plain save.
//
// A host with several learner stores (Online: normal and author-preview)
// passes `selectOwners({ actor, practiceId })`, which returns the store's
// { authorship } holding that practice project's attempt, or null.
function validOwners(owners) {
  if (typeof owners?.authorship?.saveLearnerFile !== "function") {
    throw new TypeError("Lesson code saves require the original authorship owner.");
  }
  return owners;
}

function createTrainingCodeSaveOwner({ authorship, selectOwners } = {}) {
  if (selectOwners !== undefined && typeof selectOwners !== "function") throw new TypeError("Lesson code save selection must be a function.");
  const fixed = selectOwners ? null : validOwners({ authorship });
  const select = selectOwners || (async () => fixed);
  return async function saveCodeFile({ input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const context = currentProjectRequestContext();
    const practiceId = practiceIdFromSlug(context?.slug);
    const actor = context?.vibe64User;
    if (!practiceId || !actor) return save();
    const selected = await select({ actor, practiceId });
    if (!selected) return save();
    return validOwners(selected).authorship.saveLearnerFile({ actor, practiceId, input, save });
  };
}

export { createTrainingCodeSaveOwner };
