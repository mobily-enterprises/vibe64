import { trainingQuestionReferenceSchema, trainingQuestionIdentityFields } from "@local/vibe64-runtime/shared/training-question-reference";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { validateSnapshot } from "./learnerState.js";

const { text, attemptId, requestId, assessmentId, revision } = trainingQuestionIdentityFields;
const prepareSchema = createSchema({
  attemptId, expectedRevision: revision, requestId, assessmentId,
  text: { ...text, maxLength: 2048 },
  assistance: { ...text, enum: ["none", "hint", "demonstration", "substantial"] }
});
const checkpointSchema = createSchema({
  attemptId, expectedRevision: revision, requestId, visualId: assessmentId,
  snapshot: { type: "object", required: true }
});


function failure(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function questionSnapshot(state, attempt) {
  const resume = attempt.learning?.resume;
  const question = resume?.pendingQuestion;
  if (!question) throw failure("VIBE64_TRAINING_QUESTION_MISSING", "Prepare this lesson's question before admitting an answer.");
  if (!question.assistance || !question.issuedRevision) {
    throw failure("VIBE64_TRAINING_QUESTION_PROVENANCE_MISSING", "This saved question has no issued revision or assistance provenance. Explicitly prepare a new question before grading.");
  }
  const pin = structuredClone(attempt.pin);
  Object.freeze(pin.course);
  Object.freeze(pin.topic);
  Object.freeze(pin.lesson);
  Object.freeze(pin);
  return Object.freeze({
    schemaVersion: 1, learnerId: state.progress.learnerId,
    attemptId: attempt.attemptId, pin, resumeRevision: resume.revision,
    question: Object.freeze({ ...question })
  });
}

function questionReference(snapshot) {
  return Object.freeze({ attemptId: snapshot.attemptId, questionId: snapshot.question.id,
    assessmentId: snapshot.question.assessmentId, issuedRevision: snapshot.question.issuedRevision,
    topicHash: snapshot.pin.topic.topicHash, lessonHash: snapshot.pin.lesson.hash });
}

function questionPreparationReady(attempt, lesson, assessmentId) {
  return attempt.preparation.phase === "ready" ||
    attempt.preparation.phase === "reserved" && !lesson.lesson.exercise &&
    lesson.lesson.assessments.some(item => item.id === assessmentId && item.kind === "answer");
}

function createTrainingTeachingOwner({ learners, content } = {}) {
  if (!learners?.readState || !learners?.saveLessonResume || !content?.readLesson) {
    throw new TypeError("Teaching requires the original learner-state and installed-content facilities.");
  }

  async function activeLesson(actor, requestedAttemptId, assessmentId, learningScope) {
    const state = await learners.readState({ actor, includeCompletion: true });
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    if (!attempt || attempt.attemptId !== requestedAttemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Use this learner's exact active lesson attempt.");
    }
    const lesson = await content.readLesson({ ...attempt.pin.topic,
      lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const learningVisual = typeof learningScope?.noExercise === "boolean" &&
      learningScope.learnerId === state.progress.learnerId &&
      learningScope.attemptId === requestedAttemptId &&
      isDeepStrictEqual(learningScope.pin, attempt.pin) &&
      (learningScope.noExercise
        ? attempt.preparation.phase === "reserved" && !lesson.lesson.exercise
        : attempt.preparation.phase === "ready" && Boolean(attempt.preparation.initialSessionId) && Boolean(lesson.lesson.exercise));
    if ((learningScope && !learningVisual) || (!questionPreparationReady(attempt, lesson, assessmentId) && !learningVisual)) {
      throw failure("VIBE64_TRAINING_PREPARATION_REQUIRED", "Finish the saved exercise preparation before preparing or capturing a question.");
    }
    return { state, attempt, lesson };
  }

  // Actor and assistance are admitted host facts, not learner-supplied claims.
  async function prepareQuestion({ actor, ...input } = {}, facilities) {
    const { requireCurrent, assertCurrent, signal } = facilities || {};
    const value = validateContent(prepareSchema, input, "Question preparation");
    if (!value.text.trim()) throw new Error("Prepare a nonempty question.");
    const { state, attempt, lesson } = await activeLesson(actor, value.attemptId, value.assessmentId);
    if (!lesson.lesson.assessments.some(item => item.id === value.assessmentId)) {
      throw new Error("Prepare an assessment declared in this exact installed lesson.");
    }
    const previous = attempt.learning?.resume;
    const sameIdentity = previous?.pendingQuestion?.id === value.requestId;
    const question = { id: value.requestId, assessmentId: value.assessmentId,
      text: value.text, assistance: value.assistance,
      issuedRevision: sameIdentity ? previous.pendingQuestion.issuedRevision : state.revision + 1 };
    if (requireCurrent) await requireCurrent();
    assertCurrent?.();
    signal?.throwIfAborted();
    if (sameIdentity) {
      if (canonicalJson(previous.pendingQuestion) !== canonicalJson(question)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This question identity already retained different text, assessment or assistance.");
      }
      // A later visual checkpoint may retain the issued question while changing
      // the resume request ID. Replaying preparation must not overwrite it.
      if (previous.requestId !== value.requestId) {
        const snapshot = questionSnapshot(state, attempt);
        return { revision: state.revision, replayed: true, snapshot, reference: questionReference(snapshot) };
      }
    }
    const saved = await learners.saveLessonResume({ actor, attemptId: value.attemptId,
      expectedRevision: value.expectedRevision, requestId: value.requestId,
      resume: { stage: previous?.stage || "question", pendingQuestion: question,
        visuals: previous?.visuals || [], summary: previous?.summary || "" } }, ...(facilities ? [facilities] : []));
    if (!questionPreparationReady(saved.attempt, lesson, value.assessmentId)) {
      throw failure("VIBE64_TRAINING_PREPARATION_REQUIRED", "The saved exercise preparation changed before question admission.");
    }
    const snapshot = questionSnapshot(state, saved.attempt);
    return { revision: saved.revision, replayed: saved.replayed,
      snapshot, reference: questionReference(snapshot) };
  }

  async function saveVisualCheckpoint({ actor, ...input } = {}, facilities) {
    const { learningScope, requireCurrent, assertCurrent, signal } = facilities || {};
    if (learningScope && typeof requireCurrent !== "function") {
      throw new TypeError("A learning diagram checkpoint requires its fresh exact session authority.");
    }
    const value = validateContent(checkpointSchema, input, "Visual checkpoint");
    validateSnapshot(value.snapshot);
    const { state, attempt, lesson } = await activeLesson(actor, value.attemptId, undefined, learningScope);
    const visual = lesson.visuals.find(item => item.id === value.visualId)?.visual;
    if (!visual || !visual.states.includes(value.snapshot.state)) {
      throw new Error("Save a semantic state declared by this exact installed lesson visual.");
    }
    if (requireCurrent) await requireCurrent();
    assertCurrent?.();
    signal?.throwIfAborted();
    const previous = attempt.learning?.resume;
    const savedVisual = previous?.visuals.find(item => item.visualId === value.visualId);
    const unchanged = savedVisual && canonicalJson(savedVisual.snapshot) === canonicalJson(value.snapshot);
    if (previous?.requestId === value.requestId && !unchanged) {
      throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This checkpoint request already retained different visual state.");
    }
    if (previous?.requestId !== value.requestId && unchanged) {
      return { revision: state.revision, replayed: false, unchanged: true };
    }
    const visuals = (previous?.visuals || []).filter(item => item.visualId !== value.visualId);
    visuals.push({ visualId: value.visualId, snapshot: value.snapshot });
    const saved = await learners.saveLessonResume({ actor, attemptId: value.attemptId,
      expectedRevision: value.expectedRevision, requestId: value.requestId,
      resume: { stage: previous?.stage || "visual", pendingQuestion: previous?.pendingQuestion || null,
        visuals, summary: previous?.summary || "" } }, ...(facilities ? [facilities] : []));
    return { revision: saved.revision, replayed: saved.replayed, unchanged: false };
  }

  async function capturedLesson(actor, reference) {
    const expected = validateContent(trainingQuestionReferenceSchema, reference, "Submitted question reference");
    const { state, attempt, lesson } = await activeLesson(actor, expected.attemptId, expected.assessmentId);
    const snapshot = questionSnapshot(state, attempt);
    if (canonicalJson(questionReference(snapshot)) !== canonicalJson(expected)) {
      throw failure("VIBE64_TRAINING_QUESTION_STALE", "The submitted question or lesson checkpoint changed. Show the current question before admitting another answer.");
    }
    return { snapshot, attempt, lesson };
  }

  async function captureQuestion({ actor, reference } = {}) {
    return (await capturedLesson(actor, reference)).snapshot;
  }

  async function capturePractical({ actor, reference } = {}) {
    const { snapshot, attempt, lesson } = await capturedLesson(actor, reference);
    const assessment = lesson.lesson.assessments.find(item => item.id === snapshot.question.assessmentId);
    const producer = { "workspace-navigation": "workspace", "return-to-colleague": "colleague", "try-the-application": "exercise" }[assessment?.id];
    const checkMatches = assessment?.id === "try-the-application"
      ? assessment.evidence?.check === "orientation-response" : !assessment?.evidence?.check;
    if (!producer || assessment.kind !== "practical" || assessment.evidence?.producer !== producer ||
        assessment.evidence.operation !== assessment.id || !checkMatches) {
      throw failure("VIBE64_TRAINING_PRACTICAL_UNAVAILABLE", "This question does not declare a supported native practical observation.");
    }
    return Object.freeze({ snapshot,
      target: Object.freeze({ projectSlug: attempt.projectSlug, sessionId: attempt.preparation.initialSessionId }),
      assessment: Object.freeze({ id: assessment.id, evidence: Object.freeze({ ...assessment.evidence }) }) });
  }

  async function readQuestionReference({ actor, completedPracticals = [] } = {}) {
    const state = await learners.readState({ actor, includeCompletion: true });
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const question = attempt?.learning?.resume?.pendingQuestion;
    if (!attempt || !question?.assistance || !question.issuedRevision) return null;
    const lesson = await content.readLesson({ ...attempt.pin.topic,
      lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    if (!questionPreparationReady(attempt, lesson, question.assessmentId)) return null;
    const reference = questionReference(questionSnapshot(state, attempt));
    if (Array.isArray(completedPracticals) && completedPracticals.length <= 64 && completedPracticals.some(proof =>
      proof && canonicalJson(proof.reference) === canonicalJson(reference) &&
      attempt.learning?.submissions.some(result => result.kind === "practical" && result.outcome === "passed" &&
        result.assessmentId === reference.assessmentId && result.rubricRevision === attempt.pin.lesson.hash &&
        result.submissionId === proof.submissionId && result.evidence.observationId === proof.observationId))) return null;
    return reference;
  }

  return { prepareQuestion, captureQuestion, capturePractical, readQuestionReference, saveVisualCheckpoint };
}

export { createTrainingTeachingOwner, trainingQuestionReferenceSchema };
