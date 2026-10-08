import { isDeepStrictEqual } from "node:util";

  function deliveredQuestion(state, reference) {
    for (const turn of state.record.conversationLog.toReversed()) {
      const mark = turn.metadata?.trainingQuestionDelivery;
      if (mark?.phase !== "delivered" || mark.conversationId !== state.record.scopeId || mark.turnId !== turn.turnId ||
          turn.metadata.runtime?.status !== "complete" || turn.metadata.runtime.supersededBy ||
          (reference !== undefined && !isDeepStrictEqual(mark.reference, reference))) continue;
      const final = turn.messages.findLast(message => message.role === "assistant" && message.text.trim());
      if (final?.outputId && final.outputId === mark.outputId && final.text.trim() === mark.questionText) {
        return { conversationId: mark.conversationId, turnId: mark.turnId, outputId: mark.outputId };
      }
    }
    return null;
  }

  function completedPracticalQuestions(state) {
    const proofs = [];
    for (const turn of state.record.conversationLog.toReversed()) {
      for (const call of (turn.metadata?.applicationTools || []).toReversed()) {
        if (call.name !== "assistant_action_execute" || call.status !== "complete" || call.result?.ok !== true) continue;
        let request;
        try { request = JSON.parse(call.arguments); } catch { continue; }
        const result = call.result.result;
        const saved = result?.result;
        const input = request?.input;
        if (request?.actionId !== "vibe64.training.practical.evaluate" || result?.actionId !== request.actionId ||
            result.version !== 1 || saved?.ok !== true || saved.outcome !== "passed" ||
            !input?.submissionId || saved.submissionId !== input.submissionId || !input.observationId) continue;
        const message = turn.messages.find(value => value.role === "user" && value.receipt !== false && value.messageId === input.messageId);
        const captured = message?.data?.trainingQuestion;
        if (captured?.schemaVersion !== 1 || !captured.pin?.topic?.topicHash || !captured.pin?.lesson?.hash ||
            captured.attemptId !== input.attemptId || saved.assessmentId !== captured.question?.assessmentId ||
            saved.completion?.lessonHash !== captured.pin.lesson.hash) continue;
        const reference = { attemptId: captured.attemptId, questionId: captured.question.id,
          assessmentId: captured.question.assessmentId, issuedRevision: captured.question.issuedRevision,
          topicHash: captured.pin.topic?.topicHash, lessonHash: captured.pin.lesson.hash };
        const delivery = deliveredQuestion(state, reference);
        if (!delivery || !isDeepStrictEqual(delivery, captured.delivery)) continue;
        if (!proofs.some(proof => proof.submissionId === input.submissionId && isDeepStrictEqual(proof.reference, reference))) {
          proofs.push({ reference, submissionId: input.submissionId, observationId: input.observationId });
          if (proofs.length === 64) return proofs;
        }
      }
    }
    return proofs;
  }

export { deliveredQuestion, completedPracticalQuestions };
