import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { MAX_NOTES_CHARS } from "./learnerState.js";
import { requestId, text } from "./actions.js";
import { defineTrainingLearnerAction as definition } from "./stepActions.js";

// Learning v2 learner notes (contract C7): Colleague's private summary of the
// person it teaches. The learner store keeps them in that learner's own
// Learning state; the authenticated actor alone selects them, so another
// learner or the workspace owner can never read them. They never take part in
// step results or completion. The learner sees, edits and clears them in L.
const notesSchema = createSchema({
  text: { type: "string", required: true, noTrim: true, minLength: 0, maxLength: MAX_NOTES_CHARS },
  revision: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  updatedAt: { ...text, required: true, nullable: true, maxLength: 24 },
  updatedBy: { ...text, required: true, nullable: true, enum: ["colleague", "learner"] }
});
const notesOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true }, notes: { type: "object", required: true, schema: notesSchema },
    replayed: { type: "boolean", required: false }, changed: { type: "boolean", required: false }
  })
};
// Required on every change: the 32-entry replay window cannot stop a retry
// that arrives later, but the revision it replaces always refuses older text.
const expectedRevision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };

function createTrainingLearnerNotesActions({ learners, publishLearnerChanged = null } = {}) {
  if (typeof learners?.readTeacherNotes !== "function" || typeof learners?.saveTeacherNotes !== "function") {
    throw new TypeError("Learner notes actions require the original learner store.");
  }

  async function save(actor, context, input) {
    // The learner's own browser channel is the learner; every other caller of
    // this action is Colleague acting for the same signed-in person.
    const updatedBy = context.channel === "api" ? "learner" : "colleague";
    const result = await learners.saveTeacherNotes({ actor, updatedBy, ...input });
    if (result.changed && typeof publishLearnerChanged === "function") await publishLearnerChanged({ actor, reason: "notes" });
    return { ok: true, notes: result.notes, replayed: result.replayed, changed: result.changed };
  }

  return Object.freeze([
    definition("learner-notes.read", {}, { kind: "query", idempotency: "none", output: notesOutput,
      description: "Read your private teacher notes about this person: a short Markdown summary of their strengths, difficulties, preferences and where they are in Learning. Read them when you start teaching (Teach me or a question about their lesson) and adapt how you teach. They belong to this person's own Learning state: only this person, and you acting for them, can read them; the workspace owner cannot. They never decide or change a step result. revision 0 with empty text means there are no notes yet." },
    async (_input, actor) => ({ ok: true, notes: await learners.readTeacherNotes({ actor }) })),
    definition("learner-notes.update", {
      text: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: MAX_NOTES_CHARS }, requestId, expectedRevision
    }, { output: notesOutput,
      description: `Replace your teacher notes about this person with a rewritten short summary (Markdown, at most ${MAX_NOTES_CHARS} characters): their strengths, difficulties, preferences and where they are in Learning. Rewrite the whole summary from the notes you read and what you learned; never append a transcript, and never record secrets, credentials, other people's data, grades or pass/fail judgements. Always pass expectedRevision, the revision from your latest learner-notes.read, so a change the person made in Learning is not overwritten; on a changed-notes refusal read again and combine. Use a new requestId for each rewrite and the same one to retry. The person sees, edits and clears these notes in Learning under 'What my teacher knows about me'. Notes never affect step results.` },
    async (input, actor, context) => save(actor, context, {
      text: input.text, requestId: input.requestId, expectedRevision: input.expectedRevision })),
    definition("learner-notes.clear", { requestId, expectedRevision }, { browser: true, output: notesOutput },
      async (input, actor, context) => save(actor, context, {
        text: "", requestId: input.requestId, expectedRevision: input.expectedRevision }))
  ]);
}

export { createTrainingLearnerNotesActions };
