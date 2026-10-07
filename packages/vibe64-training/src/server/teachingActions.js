import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { operationError } from "./actions.js";
import { trainingQuestionReferenceSchema } from "./teaching.js";

const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 64 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const output = { mode: "replace", schema: createSchema({
  ok: { type: "boolean", required: true }, revision,
  replayed: { type: "boolean", required: true },
  assessmentId: text, questionText: { ...text, maxLength: 2048 },
  reference: { type: "object", required: true, schema: trainingQuestionReferenceSchema },
  delivery: { ...text, enum: ["prepared"] }
}) };

function createTrainingTeachingActions({ colleague } = {}) {
  if (typeof colleague?.requireTrainingQuestionTurn !== "function" || typeof colleague?.stageTrainingQuestion !== "function") {
    throw new TypeError("Question preparation requires the original Colleague turn admission and question staging owners.");
  }
  return Object.freeze([withVibe64ActionContext({
    id: "vibe64.training.question.prepare", version: 1, kind: "command", idempotency: "domain_native",
    input: { mode: "create", schema: createSchema({
      attemptId: { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
      expectedRevision: revision,
      requestId: { ...text, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
      assessmentId: { ...text, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" },
      text: { ...text, maxLength: 2048 },
      assistance: { ...text, enum: ["none", "hint", "demonstration", "substantial"] }
    }) }, output: null,
    extensions: { assistant: { alwaysAvailable: true, output,
      description: "Prepare one short question for an assessment in the signed-in learner's exact ready lesson, after reading its fresh teaching brief and current revision. Normally select a remaining assessment; repeat a passed one only for explicitly requested practice or reassessment, retaining its prior pass. A saved checkpoint alone does not select the next question. Use this only in your current admitted interactive teaching turn, after the current diagram cue completes or when there is no cue. Record the help actually provided; never infer none from absent history. Retain the same request ID and contents for an uncertain retry. The saved question is only prepared: after success, your entire next FINAL answer must exactly equal the returned questionText, with no preface, explanation, new cue or progress sentence. Vibe64 marks delivery only from that actual canonical final. This does not grade an answer or grant a pass. If saving or staging is unconfirmed, read or retry the same preparation; do not claim the question was delivered." } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Sign in before preparing a lesson question."), { code: "vibe64_auth_required", statusCode: 401 });
      const teaching = context.trainingTeaching;
      if (typeof teaching?.prepareQuestion !== "function") {
        throw Object.assign(new Error("Question preparation is unavailable in this installation."), { code: "VIBE64_TRAINING_TEACHING_UNAVAILABLE", statusCode: 503 });
      }
      let saved;
      try {
        await colleague.requireTrainingQuestionTurn(context);
        saved = await teaching.prepareQuestion({ actor, attemptId: input.attemptId,
          expectedRevision: input.expectedRevision, requestId: input.requestId,
          assessmentId: input.assessmentId, text: input.text, assistance: input.assistance });
        await colleague.stageTrainingQuestion(saved.reference, context);
        return { ok: true, revision: saved.revision, replayed: saved.replayed,
          assessmentId: saved.snapshot.question.assessmentId, questionText: saved.snapshot.question.text,
          reference: saved.reference, delivery: "prepared" };
      } catch (cause) {
        if (saved) {
          throw Object.assign(new Error("The question is saved but its native staging was not confirmed. It is not confirmed delivered. Retry this same question request in an admitted interactive turn before asking it."), {
            code: cause.code || "VIBE64_TRAINING_QUESTION_STAGE_UNCONFIRMED",
            ...(cause.statusCode ? { statusCode: cause.statusCode } : {}), questionPrepared: true,
            revision: saved.revision, cause
          });
        }
        if (cause.code === "ACTION_VALIDATION_FAILED") throw cause;
        throw operationError(cause);
      }
    }
  }, { projectScoped: false })]);
}

export { createTrainingTeachingActions };
