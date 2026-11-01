import { runLessonOperation } from "./stepOperations.js";

/** @typedef {import("./types.js").TrainingLearners} TrainingLearners */
/** @typedef {import("./types.js").TrainingPublishLearnerChanged} TrainingPublishLearnerChanged */

/**
 * Colleague's private notes about the person it teaches, read, updated and
 * cleared for the signed-in learner. The learner store keeps them in that
 * learner's own Learning state; the authenticated actor alone selects them, so
 * another learner or the workspace owner can never read them. They never take
 * part in step results or completion.
 * @param {object} dependencies
 * @param {TrainingLearners} dependencies.learners
 * @param {TrainingPublishLearnerChanged} dependencies.publishLearnerChanged
 */
function createTrainingLearnerNotesOperations({ learners, publishLearnerChanged }) {
  async function save(actor, context, input) {
    // The learner's own browser channel is the learner; every other caller of
    // this action is Colleague acting for the same signed-in person.
    const updatedBy = context.channel === "api" ? "learner" : "colleague";
    const result = await learners.saveTeacherNotes({ actor, updatedBy, ...input });
    if (result.changed) await publishLearnerChanged({ actor, reason: "notes" });
    return { ok: true, notes: result.notes, replayed: result.replayed, changed: result.changed };
  }

  async function readNotesForLearner(_input, actor) {
    return { ok: true, notes: await learners.readTeacherNotes({ actor }) };
  }

  function updateNotesForLearner(input, actor, context) {
    return save(actor, context, {
      text: input.text,
      requestId: input.requestId,
      expectedRevision: input.expectedRevision
    });
  }

  function clearNotesForLearner(input, actor, context) {
    return save(actor, context, {
      text: "",
      requestId: input.requestId,
      expectedRevision: input.expectedRevision
    });
  }

  /**
   * The learner's notes.
   * @param {object} input
   * @param {object} context
   */
  function readNotes(input, context) {
    return runLessonOperation(readNotesForLearner, input, context);
  }

  /**
   * Replaces the learner's notes with new text.
   * @param {object} input
   * @param {object} context
   */
  function updateNotes(input, context) {
    return runLessonOperation(updateNotesForLearner, input, context);
  }

  /**
   * Clears the learner's notes.
   * @param {object} input
   * @param {object} context
   */
  function clearNotes(input, context) {
    return runLessonOperation(clearNotesForLearner, input, context);
  }

  return Object.freeze({
    readNotes,
    updateNotes,
    clearNotes
  });
}

export { createTrainingLearnerNotesOperations };
