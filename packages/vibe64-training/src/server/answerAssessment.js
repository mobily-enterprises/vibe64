import { isDeepStrictEqual } from "node:util";
import { createTrainingAssessmentGrader } from "./assessmentGrader.js";
import { evidenceSchema } from "./learnerState.js";
import { validateContent } from "./contentSchemas.js";

function failure(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

// Colleague supplies an admitted canonical user message and its existing Helper
// lifetime. This owner grades pinned content and saves through original progress.
function createTrainingAnswerAssessment({ learners, content, teaching } = {}) {
  if (!learners?.readState || !learners?.recordAssessment || !teaching?.captureQuestion || !content?.readLesson) {
    throw new TypeError("Answer assessment requires the original learner, teaching and installed-content owners.");
  }

  async function evaluate(kind, { actor, attemptId, expectedRevision, submissionId, message, observation, checkResult } = {}, { state, context, helper, requireCurrent } = {}) {
    const saved = await learners.readState({ actor, includeCompletion: true });
    const attempt = saved.progress.attempts.find(value => value.attemptId === saved.progress.activeAttemptId);
    const captured = message?.data?.trainingQuestion;
    if (!attempt || attempt.attemptId !== attemptId ||
        attempt.preparation.phase !== "ready" && (kind !== "answer" || attempt.preparation.phase !== "reserved") ||
        message?.role !== "user" || message.receipt === false || !captured || captured.schemaVersion !== 1 ||
        captured.learnerId !== saved.progress.learnerId || captured.attemptId !== attemptId ||
        !isDeepStrictEqual(captured.pin, attempt.pin) ||
        !captured.delivery || Object.keys(captured.delivery).sort().join(",") !== "conversationId,outputId,turnId" ||
        Object.values(captured.delivery).some(value => typeof value !== "string" || !value || value.length > 128)) {
      throw failure("VIBE64_TRAINING_ANSWER_UNADMITTED", "Use the accepted learner message associated with this delivered question and exact active lesson.");
    }
    if (attempt.preparation.phase === "reserved") {
      const lesson = await content.readLesson({ ...attempt.pin.topic,
        lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
      if (lesson.lesson.exercise || !lesson.lesson.assessments.some(item => item.id === captured.question?.assessmentId && item.kind === "answer")) {
        throw failure("VIBE64_TRAINING_ANSWER_UNADMITTED", "Use an answer declared in this exact no-exercise lesson; exercise assessments require their prepared attempt.");
      }
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(submissionId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Evaluate an answer with a stable submission ID and the current learning revision.");
    }
    const question = captured.question;
    let proof = { kind: "answer", learnerId: saved.progress.learnerId,
      attemptId, messageId: message.messageId, questionId: question?.id, text: message.text };
    if (kind === "practical") {
      if (observation?.kind !== "observation" || observation.learnerId !== saved.progress.learnerId ||
          observation.attemptId !== attemptId || observation.questionId !== question?.id ||
          observation.projectSlug !== attempt.projectSlug || observation.sessionId !== attempt.preparation.initialSessionId ||
          observation.assistance !== question?.assistance || !["learner", "teacher"].includes(observation.origin) ||
          typeof observation.operationId !== "string" || !observation.operationId || observation.operationId.length > 128 ||
          typeof observation.text !== "string" || !observation.text.trim() || observation.text.length > 2048) {
        throw failure("VIBE64_TRAINING_PRACTICAL_UNADMITTED", "Use the native observation for this learner's delivered practical question and exact prepared exercise.");
      }
      const lesson = await content.readLesson({ topicId: attempt.pin.topic.topicId, commit: attempt.pin.topic.commit,
        topicHash: attempt.pin.topic.topicHash, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
      const assessment = lesson.lesson.assessments.find(value => value.id === question?.assessmentId);
      if (assessment?.kind !== "practical") throw new Error("Evaluate a native observation only for this pinned practical assessment.");
      proof = { kind: "observation", learnerId: observation.learnerId, attemptId,
        observationId: observation.observationId, observedAt: observation.observedAt,
        projectSlug: observation.projectSlug, sessionId: observation.sessionId,
        producer: observation.producer, operation: observation.operation,
        origin: observation.origin === "teacher" ? "demonstration" : "learner", text: message.text,
        ...(assessment.evidence.check ? { check: assessment.evidence.check } : {}) };
    }
    const evidence = validateContent(evidenceSchema, proof, "Canonical learner assessment evidence");
    if (!evidence.text.trim()) throw new Error("Evaluate the learner's actual nonempty words.");
    const submissions = attempt.learning?.submissions || [];
    const previous = submissions.find(value => value.submissionId === submissionId);
    if (previous) {
      if (previous.assessmentId !== question?.assessmentId || previous.assistance !== question?.assistance ||
          !isDeepStrictEqual(previous.evidence, evidence)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This submission ID already retained different learner evidence.");
      }
      // Native replay reconciles a derived summary without another inference,
      // even when the lesson has since advanced to its next question.
      await requireCurrent?.();
      return learners.recordAssessment({ actor, attemptId, expectedRevision, ...previous });
    }
    const evidenceId = kind === "practical" ? "observationId" : "messageId";
    if (submissions.some(value => value.evidence.kind === evidence.kind && value.evidence[evidenceId] === evidence[evidenceId])) {
      throw failure("VIBE64_TRAINING_EVIDENCE_CONFLICT", "This learner evidence has already been assessed. Read its saved result.");
    }
    if (expectedRevision !== saved.revision) {
      throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning changed. Read the current revision before assessing this answer.");
    }
    const reference = { attemptId, questionId: question?.id, assessmentId: question?.assessmentId,
      issuedRevision: question?.issuedRevision, topicHash: attempt.pin.topic.topicHash, lessonHash: attempt.pin.lesson.hash };
    const current = await teaching.captureQuestion({ actor, reference });
    if (!isDeepStrictEqual(current.question, question)) {
      throw failure("VIBE64_TRAINING_QUESTION_STALE", "The admitted question facts no longer match the saved lesson question.");
    }
    const signal = state?.summaryAbort?.signal;
    if (!signal) throw new Error("Assess an answer within the original admitted Helper lifetime.");
    signal.throwIfAborted();
    const grader = createTrainingAssessmentGrader({ content, helper });
    const result = await grader.grade(state, { pin: attempt.pin, assessmentId: question.assessmentId, evidence,
      ...(kind === "answer" ? { question: { id: question.id, assessmentId: question.assessmentId, text: question.text } } : { checkResult }),
      assistance: question.assistance }, context);
    signal.throwIfAborted();
    await teaching.captureQuestion({ actor, reference });
    signal.throwIfAborted();
    await requireCurrent?.();
    return learners.recordAssessment({ actor, attemptId, expectedRevision, submissionId,
      assessmentId: question.assessmentId, evidence, assistance: question.assistance, ...result });
  }

  return {
    evaluateAnswer: (input, facilities) => evaluate("answer", input, facilities),
    evaluatePractical: (input, facilities) => evaluate("practical", input, facilities)
  };
}

export { createTrainingAnswerAssessment };
