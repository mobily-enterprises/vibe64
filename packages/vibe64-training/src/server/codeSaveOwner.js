import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { practiceIdFromSlug } from "@local/vibe64-core/server/learningSpace";

/** @typedef {import("./types.js").TrainingCodeAuthorship} TrainingCodeAuthorship */

/**
 * Practice projects are ordinary projects, so the learner edits their code in
 * the ordinary Files editor through the project-scoped
 * vibe64.source-editor.file.save. This owner, installed on the source editor,
 * records that save in the learner's code-authorship ledger, which the
 * authorship owner does only while the attempt that owns the practice project
 * (training-<attemptId>) is in progress (learners.activeAttemptForProject).
 * Every other save (another project, another person, no attempt in progress
 * there) is the editor's plain save.
 *
 * A host with several learner stores (for example normal and author-preview)
 * passes `selectOwners({ actor, attemptId })`, which returns the store's
 * { authorship } holding that attempt, or null.
 * @param {object} dependencies
 * @param {TrainingCodeAuthorship} [dependencies.authorship] the authorship owner of a host with one learner store
 * @param {(request: { actor: object, attemptId: string }) => Promise<{ authorship: TrainingCodeAuthorship } | null>} [dependencies.selectOwners]
 */
function createTrainingCodeSaveOwner({ authorship, selectOwners = async () => ({ authorship }) }) {
  return async function saveCodeFile({ input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const context = currentProjectRequestContext();
    // The practice project's slug names its attempt (marker field practiceId).
    const attemptId = practiceIdFromSlug(context?.slug);
    const actor = context?.vibe64User;
    if (!attemptId || !actor) return save();
    const selected = await selectOwners({ actor, attemptId });
    if (!selected) return save();
    return selected.authorship.saveLearnerFile({ actor, attemptId, input, save });
  };
}

export { createTrainingCodeSaveOwner };
