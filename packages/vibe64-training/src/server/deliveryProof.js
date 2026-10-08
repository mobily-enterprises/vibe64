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

// Consumers retain admission, current actor/turn checks and their transaction owner.
async function promoteTrainingQuestionDeliveries(conversationLog, conversationId, transaction) {
  for (const [index, turn] of conversationLog.entries()) {
    const mark = turn.metadata?.trainingQuestionDelivery;
    const final = turn.messages.findLast(message => message.role === "assistant" && message.text.trim());
    if (mark?.phase !== "prepared" || mark.conversationId !== conversationId || mark.turnId !== turn.turnId ||
        turn.metadata.runtime?.status !== "complete" || !final?.outputId ||
        final.text.trim() !== mark.questionText) continue;
    await transaction.updateTurnMetadata(turn.turnId, { trainingQuestionDelivery: {
      ...mark, phase: "delivered", outputId: final.outputId
    } });
    conversationLog[index] = await transaction.readTurn(turn.turnId);
  }
}

async function stageTrainingQuestionDelivery(transaction, { conversationId, turnId, reference, captured }) {
  const mark = { schemaVersion: 1, reference: structuredClone(reference), questionText: captured.question.text.trim(),
    conversationId, turnId, phase: "prepared" };
  const turn = await transaction.readTurn(turnId);
  const previous = turn?.metadata?.trainingQuestionDelivery;
  if (previous) return previous;
  await transaction.updateTurnMetadata(turnId, { trainingQuestionDelivery: mark });
  return mark;
}

// Original Colleague staging coordination. The host retains its actual admitted
// turn, transaction identity and current-authority check.
async function stageAdmittedTrainingQuestion(reference, {
  actor, teaching, storage, storageId, admitted, requireCurrent, failure
}) {
  const captured = await teaching.captureQuestion({ actor, reference });
  return storage.write(storageId, async transaction => {
    await requireCurrent();
    const mark = await stageTrainingQuestionDelivery(transaction, { ...admitted, reference, captured });
    if (!isDeepStrictEqual(mark.reference, reference)) throw failure("This native turn already stages another question.");
    return mark;
  });
}

function readAcceptedTrainingAnswer(log, { conversationId, turnId, messageId }) {
  const turn = log.find(value => value.turnId === turnId);
  const message = turn?.messages.find(value =>
    value.role === "user" && value.messageId === messageId && value.receipt !== false);
  const captured = message?.data?.trainingQuestion;
  const reference = captured && { attemptId: captured.attemptId, questionId: captured.question?.id,
    assessmentId: captured.question?.assessmentId, issuedRevision: captured.question?.issuedRevision,
    topicHash: captured.pin?.topic?.topicHash, lessonHash: captured.pin?.lesson?.hash };
  const delivery = reference && deliveredQuestion({ record: { conversationLog: log, scopeId: conversationId } }, reference);
  const questionTurn = log.find(value => value.turnId === delivery?.turnId);
  if (!message || !delivery || !isDeepStrictEqual(delivery, captured.delivery) ||
      typeof captured.question?.text !== "string" ||
      captured.question.text.trim() !== questionTurn?.metadata?.trainingQuestionDelivery?.questionText) return null;
  return { message, reference, delivery };
}

async function captureDeliveredTrainingQuestion(log, { conversationId, reference, teaching, actor }) {
  const delivery = deliveredQuestion({ record: { conversationLog: log, scopeId: conversationId } }, reference);
  if (!delivery) return undefined;
  const captured = await teaching?.captureQuestion({ actor, reference });
  return captured ? { ...structuredClone(captured), delivery } : undefined;
}

export { deliveredQuestion, completedPracticalQuestions, promoteTrainingQuestionDeliveries,
  stageTrainingQuestionDelivery, stageAdmittedTrainingQuestion,
  readAcceptedTrainingAnswer, captureDeliveredTrainingQuestion };
