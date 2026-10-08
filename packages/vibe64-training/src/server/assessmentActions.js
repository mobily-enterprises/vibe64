import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { operationError } from "./actions.js";

const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 64 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const output = { mode: "replace", schema: createSchema({
  ok: { type: "boolean", required: true }, revision, replayed: { type: "boolean", required: true },
  submissionId: text, assessmentId: text,
  outcome: { ...text, enum: ["passed", "not-yet-passed", "needs-review"] },
  explanation: { ...text, maxLength: 1024 },
  completion: { type: "object", required: true, schema: createSchema({
    lessonCode: text, lessonHash: text,
    required: { type: "integer", required: true, min: 0 }, passed: { type: "integer", required: true, min: 0 },
    completed: { type: "boolean", required: true }
  }) }
}) };

function createTrainingAssessmentActions({ colleague, mainTeaching } = {}) {
  if (!mainTeaching?.bindConversation && (typeof colleague?.evaluateTrainingAnswer !== "function" || typeof colleague?.evaluateTrainingPractical !== "function")) {
    throw new TypeError("Assessment evaluation requires the original Colleague message/observation admission and Helper lifetime.");
  }
  return Object.freeze(["answer", "practical"].map(kind => withVibe64ActionContext({
    id: `vibe64.training.${kind}.evaluate`, version: 1, kind: "command", idempotency: "domain_native",
    input: { mode: "create", schema: createSchema({
      attemptId: { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
      expectedRevision: revision,
      submissionId: { ...text, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
      messageId: { ...text, maxLength: 128 },
      ...(kind === "practical" ? { observationId: { ...text, maxLength: 36,
        pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" } } : {})
    }) }, output: null,
    extensions: { assistant: { alwaysAvailable: true, output,
      description: kind === "practical"
        ? "Evaluate this delivered practical question using the native observation ID from its connected learner controls, the accepted learner explanation message ID in your CURRENT interactive turn, and current learning revision. The native owner checks the exact active exercise, question, producer and any declared App check; you cannot supply words, assistance, paths, commands or a pass. Keep the same submission ID for an uncertain retry. Teacher demonstration and substantial help require an independent follow-up. Missing/stale observation, incomplete check, unavailable Helper, interruption or unconfirmed saving is not a pass. Read retained progress before advancing."
        : "Evaluate a quiz answer using the accepted learner message ID in your CURRENT interactive turn and this active lesson's current revision. Use this only for an actual answer to that delivered question, never a plain resume, setup, project-opening or navigation request. Do not attach a control request to a newly prepared question. The native owner reads the actual words and their delivered-question association; you cannot supply answer text, question, assistance, outcome or a pass. Keep the same submission ID for an uncertain retry. This uses the configured tool-free Helper and exact pinned rubric, then retains the result in original learning progress. Explain its useful feedback and read progress before advancing. Missing question association leaves ordinary chat ungraded; explicitly ask a new question. Unavailable Helper, interruption or unconfirmed saving is not a pass. This does not assess learner-action practicals." } },
    async execute(input, context) {
      if (!authenticatedVibe64User(context)) {
        throw Object.assign(new Error("Sign in before evaluating a lesson answer."), { code: "vibe64_auth_required", statusCode: 401 });
      }
      try {
        const admitted = { attemptId: input.attemptId, expectedRevision: input.expectedRevision,
          submissionId: input.submissionId, messageId: input.messageId };
        const coordinator = context.trainingMain || colleague;
        const saved = kind === "practical"
          ? await coordinator.evaluateTrainingPractical({ ...admitted, observationId: input.observationId }, context)
          : await coordinator.evaluateTrainingAnswer(admitted, context);
        const result = saved.attempt.learning.submissions.find(value => value.submissionId === input.submissionId);
        if (!result) throw new Error("The native learning result did not retain this submission. Read progress before retrying.");
        const completion = saved.completion;
        return { ok: true, revision: saved.revision, replayed: saved.replayed,
          submissionId: result.submissionId, assessmentId: result.assessmentId,
          outcome: result.outcome, explanation: result.explanation,
          completion: { lessonCode: completion.lessonCode, lessonHash: completion.lessonHash,
            required: completion.required, passed: completion.passed, completed: completion.completed } };
      } catch (cause) { throw operationError(cause); }
    }
  }, { projectScoped: false })));
}

export { createTrainingAssessmentActions };
