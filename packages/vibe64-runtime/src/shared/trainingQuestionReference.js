import { createSchema } from "@jskit-ai/kernel/shared/validators";

const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 64 };
const attemptId = { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
const requestId = { ...text, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const assessmentId = { ...text, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const hash = { ...text, pattern: "^[a-f0-9]{64}$" };
const trainingQuestionReferenceSchema = createSchema({
  attemptId, questionId: requestId, assessmentId,
  issuedRevision: { ...revision, min: 1 }, topicHash: hash, lessonHash: hash
});

const trainingQuestionIdentityFields = Object.freeze({ text, attemptId, requestId, assessmentId, revision });
export { trainingQuestionReferenceSchema, trainingQuestionIdentityFields };
