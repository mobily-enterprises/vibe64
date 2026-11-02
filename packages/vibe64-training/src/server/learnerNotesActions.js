import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { MAX_NOTES_CHARS } from "./learnerState.js";
import { NOT_A_TOOL, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { requestId, revision, text } from "./actionSchemas.js";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").TrainingLearnerNotesOperations} TrainingLearnerNotesOperations */

// Colleague's private summary of the person it teaches; the learner sees, edits
// and clears it in L.
const TRAINING_LEARNER_NOTES_ACTIONS = Object.freeze({
  CLEAR_NOTES: "vibe64.training.learner-notes.clear",
  READ_NOTES: "vibe64.training.learner-notes.read",
  UPDATE_NOTES: "vibe64.training.learner-notes.update"
});
const notesSchema = createSchema({
  text: { type: "string", required: true, noTrim: true, minLength: 0, maxLength: MAX_NOTES_CHARS },
  revision: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  updatedAt: { ...text, required: true, nullable: true, maxLength: 24 },
  updatedBy: { ...text, required: true, nullable: true, enum: ["colleague", "learner"] }
});
const notesOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    notes: { type: "object", required: true, schema: notesSchema },
    replayed: { type: "boolean", required: false },
    changed: { type: "boolean", required: false }
  })
};
/**
 * Training's learner notes actions, each one call on its notes operation.
 * @param {object} dependencies
 * @param {TrainingLearnerNotesOperations} dependencies.learnerNotes
 */
function createTrainingLearnerNotesActions({ learnerNotes }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: TRAINING_LEARNER_NOTES_ACTIONS.READ_NOTES,
      input: { mode: "create", schema: createSchema({}) },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: notesOutput,
          description: "Read your private teacher notes about this person: a short Markdown summary of their strengths, difficulties, preferences and where they are in Learning. Read them when you start teaching (Teach me or a question about their lesson) and adapt how you teach. They belong to this person's own Learning state: only this person, and you acting for them, can read them; the workspace owner cannot. They never decide or change a step result. revision 0 with empty text means there are no notes yet."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => learnerNotes.readNotes(input, context)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_LEARNER_NOTES_ACTIONS.UPDATE_NOTES,
      input: {
        mode: "create",
        schema: createSchema({
          text: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: MAX_NOTES_CHARS },
          requestId,
          // Required on every change: the 32-entry replay window cannot stop a retry that arrives later, but the
          // revision it replaces always refuses older text.
          expectedRevision: revision
        })
      },
      extensions: {
        assistant: {
          alwaysAvailable: true,
          output: notesOutput,
          description: `Replace your teacher notes about this person with a rewritten short summary (Markdown, at most ${MAX_NOTES_CHARS} characters): their strengths, difficulties, preferences and where they are in Learning. Rewrite the whole summary from the notes you read and what you learned; never append a transcript, and never record secrets, credentials, other people's data, grades or pass/fail judgements. Always pass expectedRevision, the revision from your latest learner-notes.read, so a change the person made in Learning is not overwritten; on a changed-notes refusal read again and combine. Use a new requestId for each rewrite and the same one to retry. The person sees, edits and clears these notes in Learning under 'What my teacher knows about me'. Notes never affect step results.`
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input, context) => learnerNotes.updateNotes(input, context)
    }),
    // The learner's own Clear in Learning; it is not one of Colleague's tools.
    // A repeated requestId replays its saved clear.
    Object.freeze({
      ...VIBE64_COMMAND,
      id: TRAINING_LEARNER_NOTES_ACTIONS.CLEAR_NOTES,
      input: { mode: "create", schema: createSchema({ requestId, expectedRevision: revision }) },
      channels: ["api"],
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input, context) => learnerNotes.clearNotes(input, context)
    })
  ]);
}

export { createTrainingLearnerNotesActions, TRAINING_LEARNER_NOTES_ACTIONS };
