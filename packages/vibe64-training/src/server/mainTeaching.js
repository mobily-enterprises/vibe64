import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { createRetainedConversationHelper } from "@local/vibe64-terminals/server/retainedConversationHelper";
import { evaluateAdmittedTrainingAssessment } from "./conversationAssessment.js";
import { captureDeliveredTrainingQuestion, deliveredQuestion, promoteTrainingQuestionDeliveries,
  readAcceptedTrainingAnswer, stageAdmittedTrainingQuestion } from "./deliveryProof.js";

const MAIN_TEACHING_ACTION_IDS = Object.freeze([
  "vibe64.training.learning.read", "vibe64.training.teaching-brief.read",
  "vibe64.training.question.prepare", "vibe64.training.answer.evaluate"
]);
function failure(message) {
  return Object.assign(new Error(message), { code: "VIBE64_TRAINING_MAIN_UNADMITTED", statusCode: 409 });
}

// Main supplies its original native target and canonical Store. Training retains
// the original question/answer proof, Helper coordination and sole progress owner.
function createTrainingMainTeaching({ teaching, assessment } = {}) {
  if (!teaching?.prepareQuestion || !assessment?.evaluateAnswer) {
    throw new TypeError("Main teaching requires the original question and assessment owners.");
  }
  const evaluations = new Map();
  const conversations = new Map();
  async function freshAuthority(current, runtime, sessionId, actions) {
    const scope = runtime.learningScope;
    const authority = current.browserAuthority;
    if (!authority || authority.sessionId !== sessionId || authority.learningAttemptId !== scope.attemptId ||
        authority.actorId !== scope.learnerId) throw failure("Use this learning conversation's original authorized request.");
    const grant = await actions.execute({ actionId: "vibe64.sessions.conversation.teaching-context.read",
      input: { sessionId, learningAttemptId: scope.attemptId }, context: authority.requestContext });
    if (grant.actor.id !== scope.learnerId || !isDeepStrictEqual(grant.project?.learningScope, scope)) {
      throw failure("The learner, conversation or pinned lesson changed before teaching.");
    }
    current.signal?.throwIfAborted();
    return grant;
  }
  async function captureMessage({ input, context: current, runtime, sessionId, actions }) {
    // Accepted UUID replay owns its original captured facts before recapture.
    const { trainingQuestion, data: _untrustedData, ...message } = input;
    await freshAuthority(current, runtime, sessionId, actions);
    const log = await runtime.store.readConversationLog(sessionId);
    const saved = log.flatMap(turn => turn.messages).find(message => message.messageId === input.messageId);
    if (saved) {
      await freshAuthority(current, runtime, sessionId, actions);
      if (saved.text !== (input.displayMessage ?? input.message ?? input.text)) throw failure("This message ID belongs to different words.");
      return { ...message, ...(saved.data !== undefined ? { data: structuredClone(saved.data) } : {}) };
    }
    await freshAuthority(current, runtime, sessionId, actions);
    let captured;
    if (trainingQuestion) {
      try { captured = await captureDeliveredTrainingQuestion(log, { conversationId: sessionId,
        reference: trainingQuestion, teaching, actor: authenticatedVibe64User(current.browserAuthority.requestContext) }); }
      catch { /* A stale question leaves actual words ordinary and ungraded. */ }
    }
    await freshAuthority(current, runtime, sessionId, actions);
    return { ...message, ...(captured ? { data: { trainingQuestion: captured } } : {}) };
  }
  async function completeConversation({ runtime, sessionId, outerTurnId, outcome, nativeTurn }) {
    if (!nativeTurn || nativeTurn.active || nativeTurn.outerTurnId !== outerTurnId) return;
    await runtime.store.conversationStorage.write(sessionId, async transaction => {
      const ids = await transaction.listTurnIds();
      const log = await Promise.all(ids.map(id => transaction.readTurn(id)));
      const latest = log.flatMap(turn => turn.messages).findLast(message => message.role === "user" && message.receipt !== false);
      const scope = runtime.learningScope;
      const turn = log.find(value => {
        const mark = value.metadata?.trainingQuestionDelivery;
        return mark?.phase === "prepared" && mark.conversationId === sessionId && mark.turnId === value.turnId &&
          mark.nativeTurnId === nativeTurn.turnId && mark.nativeThreadId === nativeTurn.threadId &&
          mark.nativeOuterTurnId === outerTurnId && mark.reference.attemptId === scope.attemptId &&
          mark.reference.topicHash === scope.pin.topic.topicHash && mark.reference.lessonHash === scope.pin.lesson.hash &&
          value.messages.some(message => message.messageId === mark.messageId && message.messageId === latest?.messageId && message.role === "user");
      });
      if (!turn) return;
      await transaction.updateTurnMetadata(turn.turnId, { runtime: { ...turn.metadata.runtime,
        status: outcome === "completed" ? "complete" : outcome } });
      turn.metadata.runtime = { ...turn.metadata.runtime, status: outcome === "completed" ? "complete" : outcome };
      await promoteTrainingQuestionDeliveries([turn], sessionId, transaction);
    });
  }
  async function readQuestion({ runtime, sessionId, context: current, actions }) {
    const scope = runtime.learningScope;
    const authority = current.browserAuthority;
    if (!authority || authority.sessionId !== sessionId || authority.learningAttemptId !== scope.attemptId) return null;
    const input = { sessionId, learningAttemptId: scope.attemptId };
    const grant = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read", input, context: authority.requestContext });
    if (grant.actor.id !== scope.learnerId || authority.actorId !== scope.learnerId || !isDeepStrictEqual(grant.project?.learningScope, scope)) {
      throw failure("The observed learning conversation changed.");
    }
    const log = await runtime.store.readConversationLog(sessionId);
    const delivery = deliveredQuestion({ record: { conversationLog: log, scopeId: sessionId } });
    const reference = log.find(turn => turn.turnId === delivery?.turnId)?.metadata.trainingQuestionDelivery.reference;
    const result = reference ? await teaching.readQuestionReference({ actor: grant.user }) : null;
    const after = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read", input, context: authority.requestContext });
    if (after.actor.id !== grant.actor.id || !isDeepStrictEqual(after.project?.learningScope, scope)) throw failure("The observed learning conversation changed.");
    return isDeepStrictEqual(result, reference) ? result : null;
  }
  function helperFor(runtime, sessionId, terminals) {
    const key = `${runtime.stateRoot}\0${sessionId}`;
    let state = conversations.get(key);
    if (state) return state;
    state = { helperTurnId: null, retainedTurnId: null, cleanupContext: null };
    state.helper = createRetainedConversationHelper({ terminals,
      root: path.join(runtime.stateRoot, "assistant-helpers", sessionId),
      workflowEngineId: context => context.assistantSelection.engineId,
      receipt: {
        async read() {
          const log = await runtime.store.readConversationLog(sessionId);
          const retained = log.findLast(turn => turn.metadata?.trainingHelper);
          state.retainedTurnId = retained?.turnId;
          return retained?.metadata.trainingHelper || null;
        },
        write(value) {
          const turnId = value ? state.helperTurnId : state.retainedTurnId;
          if (!turnId) throw failure("A grading Helper must belong to an accepted native turn.");
          return runtime.store.conversationStorage.write(sessionId, transaction => transaction.updateTurnMetadata(turnId, { trainingHelper: value }));
        }
      }
    });
    conversations.set(key, state);
    return state;
  }
  async function cleanupConversation({ runtime, sessionId, terminals, context }) {
    const key = `${runtime.stateRoot}\0${sessionId}`;
    const state = helperFor(runtime, sessionId, terminals);
    await evaluations.get(key)?.catch(() => {});
    await state.helper.cleanup(state.cleanupContext || context);
    state.cleanupContext = null;
    state.helperTurnId = null;
  }
  function bindConversation({ runtime, sessionId, actions, native, terminals }) {
    const scope = runtime.learningScope;
    if (!scope?.noExercise || !actions?.execute || !native?.readTurn || !terminals) {
      throw new TypeError("Main teaching requires its exact source-less learning runtime and original native owners.");
    }
    const storage = runtime.store.conversationStorage;
    const key = `${runtime.stateRoot}\0${sessionId}`;
    const helperState = helperFor(runtime, sessionId, terminals);
    const helper = helperState.helper;

    async function requireCurrent(current, admitted) {
      const grant = await freshAuthority(current, runtime, sessionId, actions);
      await terminals.requireAssistantSelectionAccess(current.assistantSelection, { vibe64User: grant.user });
      const log = await runtime.store.readConversationLog(sessionId);
      const turn = log.find(value => value.turnId === admitted.turnId);
      const message = turn?.messages.find(value => value.role === "user" && value.receipt !== false && value.messageId === admitted.messageId);
      const latest = log.flatMap(value => value.messages).findLast(value => value.role === "user" && value.receipt !== false);
      const target = await native.readTurn();
      if (admitted.conversationId !== sessionId || admitted.origin !== "user" || !message || latest?.messageId !== admitted.messageId ||
          !admitted.nativeTurnId || target.turnId !== admitted.nativeTurnId ||
          !admitted.nativeThreadId || target.threadId !== admitted.nativeThreadId || !target.active ||
          !isDeepStrictEqual(target.assistantSelection, current.assistantSelection)) {
        throw failure("Use the actual accepted learner message in this current native teaching turn.");
      }
      await freshAuthority(current, runtime, sessionId, actions);
      admitted.assertCurrent();
      current.signal?.throwIfAborted();
      return { grant, log, message, target };
    }
    async function prepareContext(current, admitted) {
      if (typeof admitted.assertCurrent !== "function") throw failure("The native accepted-request guard is unavailable.");
      const { grant } = await requireCurrent(current, admitted);
      // The route target was already checked by the fresh exact WRITE grant.
      // Original Training actions are learner-scoped, not learning Session routes.
      const original = current.browserAuthority.requestContext;
      const request = original.requestMeta?.request;
      const params = { ...request?.params };
      delete params.learningAttemptId;
      const context = { ...original, ...(request ? { requestMeta: { ...original.requestMeta,
        request: { ...request, params, vibe64User: grant.user } } } : {}),
      runtime, assistantSelection: current.assistantSelection, trainingTeaching: teaching, trainingAssessment: assessment };
      const coordinator = {
        requireAttempt(attemptId) {
          if (attemptId !== undefined && attemptId !== scope.attemptId) throw failure("Read only this bound pinned attempt.");
        },
        async requireTrainingQuestionTurn(execution, input) {
          if (input.attemptId !== scope.attemptId) throw failure("Prepare only this bound attempt’s question.");
          await requireCurrent({ ...current, signal: execution.signal }, admitted);
          return { signal: execution.signal, assertCurrent: admitted.assertCurrent, requireCurrent: () => requireCurrent({ ...current, signal: execution.signal }, admitted) };
        },
        async stageTrainingQuestion(reference, execution) {
          if (reference.attemptId !== scope.attemptId) throw failure("Prepare a question only for this bound attempt.");
          const { target } = await requireCurrent({ ...current, signal: execution.signal }, admitted);
          return stageAdmittedTrainingQuestion(reference, { actor: authenticatedVibe64User(execution), teaching,
            storage, storageId: sessionId, admitted: { ...admitted, nativeOuterTurnId: target.outerTurnId }, failure,
            requireCurrent: () => requireCurrent({ ...current, signal: execution.signal }, admitted) });
        },
        async evaluateTrainingAnswer(input, execution) {
          if (input.attemptId !== scope.attemptId || input.messageId !== admitted.messageId) {
            throw failure("Evaluate only this bound attempt's actual accepted learner message.");
          }
          if (evaluations.has(key)) throw failure("Finish or stop the current grading Helper first.");
          const guard = () => requireCurrent({ ...current, signal: execution.signal }, admitted);
          const operation = Promise.resolve().then(async () => {
            const { log } = await guard();
            const accepted = readAcceptedTrainingAnswer(log, admitted);
            if (!accepted) throw failure("Use an accepted answer associated with its exact delivered native question.");
            const { grant } = await guard();
            helperState.helperTurnId = admitted.turnId;
            helperState.cleanupContext = { assistantSelection: current.assistantSelection,
              requestMeta: { request: { vibe64User: grant.user } } };
            return evaluateAdmittedTrainingAssessment("answer", { ...input, message: structuredClone(accepted.message) }, execution,
              { assessment, signal: execution.signal, requireCurrent: guard, assertCurrent: admitted.assertCurrent,
                helper: { runHelper: (_state, context, value) => helper.runHelper(context, { ...value, signal: execution.signal }) } });
          }).finally(() => { if (evaluations.get(key) === operation) evaluations.delete(key); });
          evaluations.set(key, operation);
          return operation;
        }
      };
      return { ...context, trainingMain: coordinator };
    }
    const bound = Object.freeze({
      applicationTools: { storage, prepareContext },
      readQuestion: current => readQuestion({ runtime, sessionId, context: current, actions }),
      cleanup: context => cleanupConversation({ runtime, sessionId, terminals, context })
    });
    return bound;
  }
  return Object.freeze({ actionIds: MAIN_TEACHING_ACTION_IDS, bindConversation, captureMessage,
    completeConversation, readQuestion, cleanupConversation
  });
}

export { createTrainingMainTeaching, MAIN_TEACHING_ACTION_IDS };
