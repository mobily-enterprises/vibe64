import path from "node:path";
import { randomUUID } from "node:crypto";
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";
import { createTrainingPresentationCoordination, publicCue } from "./presentationCoordination.js";
import { isDeepStrictEqual } from "node:util";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { createRetainedConversationHelper } from "@local/vibe64-terminals/server/retainedConversationHelper";
import { evaluateAdmittedTrainingAssessment } from "./conversationAssessment.js";
import { createTrainingPracticalObservations } from "./practicalObservations.js";
import { captureDeliveredTrainingQuestion, deliveredQuestion, completedPracticalQuestions, promoteTrainingQuestionDeliveries,
  readAcceptedTrainingAnswer, stageAdmittedTrainingQuestion } from "./deliveryProof.js";

const MAIN_TEACHING_ACTION_IDS = Object.freeze([
  "vibe64.training.learning.read", "vibe64.training.teaching-brief.read",
  "vibe64.training.question.prepare", "vibe64.training.answer.evaluate",
  "vibe64.training.visual.open", "vibe64.training.visual.command", "vibe64.training.visual.cue",
  "vibe64.training.visual.cue.read", "vibe64.training.visual.snapshot",
  "vibe64.training.practical.read", "vibe64.training.practical.evaluate"
]);
function failure(message, code = "VIBE64_TRAINING_MAIN_UNADMITTED", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// Main supplies its original native target and canonical Store. Training retains
// the original question/answer proof, Helper coordination and sole progress owner.
function createTrainingMainTeaching({ teaching, assessment, checks } = {}) {
  if (!teaching?.prepareQuestion || !assessment?.evaluateAnswer) {
    throw new TypeError("Main teaching requires the original question and assessment owners.");
  }
  const evaluations = new Map();
  const conversations = new Map();
  async function freshAuthority(current, runtime, sessionId, actions, access = "write") {
    const scope = runtime.learningScope;
    const authority = current.browserAuthority;
    if (!authority || authority.sessionId !== sessionId || authority.learningAttemptId !== scope.attemptId ||
        authority.actorId !== scope.learnerId) throw failure("Use this learning conversation's original authorized request.");
    if (scope.noExercise === false) {
      // Validate the original source before reading the fresh authority grant;
      // access can change while this filesystem read is pending.
      await runtime.getNativeExecutionRoot(sessionId);
    }
    const grant = await actions.execute({ actionId: access === "observe"
      ? "vibe64.sessions.conversation.context.read" : "vibe64.sessions.conversation.teaching-context.read",
      input: { sessionId, learningAttemptId: scope.attemptId }, context: authority.requestContext });
    if (grant.actor.id !== scope.learnerId || !isDeepStrictEqual(grant.project?.learningScope, scope)) {
      throw failure("The learner, conversation or pinned lesson changed before teaching.");
    }
    if (scope.noExercise === false && !grant.project.slug) {
      throw failure("This practice conversation has no confirmed source project.");
    }
    current.signal?.throwIfAborted();
    return grant;
  }
  async function captureMessage({ input, context: current, runtime, sessionId, actions }) {
    // Accepted UUID replay owns its original captured facts before recapture.
    const { clientId, trainingQuestion, data: _untrustedData, ...message } = input;
    await freshAuthority(current, runtime, sessionId, actions);
    const log = await runtime.store.readConversationLog(sessionId);
    const saved = log.flatMap(turn => turn.messages).find(message => message.messageId === input.messageId);
    if (saved) {
      await freshAuthority(current, runtime, sessionId, actions);
      if (saved.text !== (input.displayMessage ?? input.message ?? input.text)) throw failure("This message ID belongs to different words.");
      return { ...message, ...(saved.data !== undefined ? { data: structuredClone(saved.data) } : {}) };
    }
    await freshAuthority(current, runtime, sessionId, actions);
    if (clientId !== undefined && (typeof clientId !== "string" || !clientId.trim() || clientId.length > 128)) {
      throw failure("Use this browser’s exact bounded Main client identity.");
    }
    let captured;
    if (trainingQuestion) {
      try { captured = await captureDeliveredTrainingQuestion(log, { conversationId: sessionId,
        reference: trainingQuestion, teaching, actor: authenticatedVibe64User(current.browserAuthority.requestContext) }); }
      catch { /* A stale question leaves actual words ordinary and ungraded. */ }
    }
    await freshAuthority(current, runtime, sessionId, actions);
    return { ...message, ...(captured || clientId !== undefined ? { data: {
      ...(clientId !== undefined ? { clientId } : {}), ...(captured ? { trainingQuestion: captured } : {})
    } } : {}) };
  }
  async function completeConversation({ runtime, sessionId, outerTurnId, outcome, nativeTurn }) {
    if (!nativeTurn || nativeTurn.active || nativeTurn.outerTurnId !== outerTurnId) return;
    const state = conversations.get(`${runtime.stateRoot}\0${sessionId}`);
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
      for (const connection of state?.connections.values() || []) {
        const origin = connection.origin;
        const cue = connection.cue;
        if (!cue || !origin || cue.phase !== "armed" || origin.generation !== state.generation ||
            origin.nativeThreadId !== nativeTurn.threadId || origin.nativeTurnId !== nativeTurn.turnId ||
            origin.nativeOuterTurnId !== outerTurnId) continue;
        const authored = log.find(value => value.turnId === origin.admitted.turnId);
        const user = authored?.messages.find(message => message.role === "user" && message.receipt !== false &&
          message.messageId === origin.admitted.messageId && message.data?.clientId === connection.clientId);
        const final = authored?.assistant;
        const canonicalFinal = final?.role === "assistant" && final.text.trim() && final.outputId &&
          authored.messages.some(message => message.role === "assistant" && message.messageId === final.messageId &&
            message.outputId === final.outputId && message.text === final.text);
        try {
          const nativeFinal = state.binding?.native.readFinalAssistantResult?.({
            threadId: nativeTurn.threadId, turnId: nativeTurn.turnId
          });
          const written = nativeFinal?.conversationTurn;
          const savedFinal = written?.assistant;
          if (outcome !== "completed" || authored?.metadata?.runtime?.error ||
              !user || user.messageId !== latest?.messageId || !canonicalFinal || authored.metadata?.runtime?.supersededBy ||
              !state.binding || !isDeepStrictEqual(state.binding.scope, scope) ||
              nativeFinal?.threadId !== nativeTurn.threadId || nativeFinal.turnId !== nativeTurn.turnId ||
              written?.turnId !== origin.admitted.turnId || savedFinal?.role !== "assistant" ||
              savedFinal.messageId !== final.messageId || savedFinal.outputId !== final.outputId ||
              savedFinal.text !== final.text || nativeFinal.text.trim() !== final.text.trim()) {
            throw failure("The explanation was not confirmed by its original native final result.");
          }
          await freshAuthority(origin.current, runtime, sessionId, state.binding.actions);
          origin.admitted.assertCurrent();
          state.presentation.bindOutput(connection, { role: "assistant", status: "complete", outputId: final.outputId }, state.generation);
        } catch {
          state.presentation.failCue(connection, state.generation);
        }
      }
      if (!turn) return;
      await transaction.updateTurnMetadata(turn.turnId, { runtime: { ...turn.metadata.runtime,
        status: outcome === "completed" ? "complete" : outcome } });
      turn.metadata.runtime = { ...turn.metadata.runtime, status: outcome === "completed" ? "complete" : outcome };
      await promoteTrainingQuestionDeliveries([turn], sessionId, transaction);
    });
    if (state?.binding) await state.binding.native.notifyPresentation?.({ type: "configuration" });
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
    const result = reference ? await teaching.readQuestionReference({ actor: grant.user, completedPracticals: completedPracticalQuestions({ record: { conversationLog: log, scopeId: sessionId } }) }) : null;
    const after = await actions.execute({ actionId: "vibe64.sessions.conversation.context.read", input, context: authority.requestContext });
    if (after.actor.id !== grant.actor.id || !isDeepStrictEqual(after.project?.learningScope, scope)) throw failure("The observed learning conversation changed.");
    return isDeepStrictEqual(result, reference) ? result : null;
  }
  function helperFor(runtime, sessionId, terminals) {
    const key = `${runtime.stateRoot}\0${sessionId}`;
    let state = conversations.get(key);
    if (state) return state;
    state = { helperTurnId: null, retainedTurnId: null, cleanupContext: null,
      connections: new Map(), generation: 0, binding: null, practicalAdmission: Promise.resolve() };
    state.presentation = createTrainingPresentationCoordination({ changed() {
      const notification = state.binding?.native.notifyPresentation?.({ type: "configuration" });
      void notification?.catch(() => {});
    } });
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
  function retirePresentationState(state) {
    for (const connection of state.connections.values()) {
      state.presentation.retireCue(connection);
      connection.acknowledge?.({ ok: false, error: "This Main lesson conversation was retired." });
    }
    state.generation += 1;
    state.connections.clear();
    state.binding = null;
  }
  function presentationResult(state, clientId) {
    const connection = state?.connections.get(clientId);
    return { ok: true, connected: Boolean(connection && state.binding),
      ...(connection?.navigation ? { navigation: structuredClone(connection.navigation) } : {}),
      ...(connection?.cue ? { cue: publicCue(connection.cue) } : {}) };
  }
  async function presentationState({ runtime, sessionId, context: current, actions, access }) {
    if (typeof runtime.learningScope?.noExercise !== "boolean") throw failure("This presentation requires an authorized pinned lesson.");
    await freshAuthority(current, runtime, sessionId, actions, access);
    const state = conversations.get(`${runtime.stateRoot}\0${sessionId}`);
    if (state && (!state.binding || !isDeepStrictEqual(state.binding.scope, runtime.learningScope))) {
      throw failure("The original Main lesson binding is no longer current.");
    }
    return state;
  }
  async function readPresentation({ input, ...current }) {
    const state = await presentationState({ ...current, access: "observe" });
    return presentationResult(state, input.clientId);
  }
  async function focusPresentation({ input, ...current }) {
    const state = await presentationState({ ...current, access: "observe" });
    if (!state?.binding) throw failure("Connect this Main lesson conversation before opening its presentation controls.");
    const projectSlug = current.runtime.learningScope.noExercise ? ""
      : (await freshAuthority(current.context, current.runtime, current.sessionId, current.actions, "observe")).project.slug;
    if ((input.focus.projectSlug || "") !== projectSlug || input.focus.sessionId && input.focus.sessionId !== current.sessionId) {
      throw failure("Report only this Main lesson’s actual view.");
    }
    const connection = state.connections.get(input.clientId) || { clientId: input.clientId };
    const focus = { ...input.focus, projectSlug, sessionId: current.sessionId };
    state.presentation.retireForFocus(connection, focus);
    connection.focus = focus;
    state.connections.set(input.clientId, connection);
    return { ok: true, focus };
  }
  async function acknowledgePresentation({ input, ...current }) {
    const state = await presentationState({ ...current, access: "write" });
    if (!state?.binding) throw failure("The Main lesson presentation is no longer connected.");
    const connection = state.connections.get(input.clientId);
    return state.presentation.acknowledge(connection, input, { conversationId: mainConversationId({
      learningAttemptId: current.runtime.learningScope.attemptId, sessionId: current.sessionId }) });
  }
  async function cleanupConversation({ runtime, sessionId, terminals, context }) {
    const key = `${runtime.stateRoot}\0${sessionId}`;
    const state = helperFor(runtime, sessionId, terminals);
    retirePresentationState(state);
    await state.practicalAdmission;
    await evaluations.get(key)?.catch(() => {});
    await state.helper.cleanup(state.cleanupContext || context);
    state.cleanupContext = null;
    state.helperTurnId = null;
  }
  // The original browser observer remains independent of an active native
  // turn. It uses the current completed question and the saved false lesson
  // target; new gesture collection is serialized in this same connection owner.
  async function practicalContext({ runtime, sessionId, context: current, actions, clientId }) {
    if (runtime.learningScope?.noExercise !== false) throw failure("This lesson has no prepared practical workspace.");
    const state = await presentationState({ runtime, sessionId, context: current, actions, access: "write" });
    const connection = state?.connections.get(clientId);
    if (!state?.binding || !connection) throw failure("Use the original connected Main browser for this practical question.");
    const generation = state.generation, native = state.binding.native;
    let log = [];
    const requireCurrent = reference => {
      current.signal?.throwIfAborted();
      if (state.generation !== generation || state.binding?.native !== native ||
          !isDeepStrictEqual(state.binding?.scope, runtime.learningScope) || state.connections.get(clientId) !== connection ||
          reference && !deliveredQuestion({ record: { conversationLog: log, scopeId: sessionId } }, reference)) {
        throw failure("Repeat the practical task in its current connected lesson question.");
      }
    };
    const authorizeCurrent = async reference => {
      log = await runtime.store.readConversationLog(sessionId);
      // The connection was admitted before this read; reauthorize after its
      // awaited storage work so revocation cannot admit a gesture or replay.
      await freshAuthority(current, runtime, sessionId, actions);
      requireCurrent(reference);
    };
    await authorizeCurrent();
    const context = { ...current.browserAuthority.requestContext, signal: current.signal,
      trainingPractical: teaching, trainingChecks: checks };
    delete context.vibe64Action;
    return { state, connection, context, targetInput: { learningAttemptId: runtime.learningScope.attemptId, sessionId },
      requireCurrent, authorizeCurrent };
  }
  async function observeTrainingPractical({ input, ...current }) {
    const prepared = await practicalContext({ ...current, clientId: input.clientId });
    const { state, connection, context, targetInput, requireCurrent, authorizeCurrent } = prepared;
    const observations = createTrainingPracticalObservations({ actions: current.actions, failure });
    const observing = state.practicalAdmission.then(() => observations.observe({ ...input,
      conversationId: mainConversationId({ learningAttemptId: current.runtime.learningScope.attemptId, sessionId: current.sessionId }) }, {
      connection, context, targetInput, requireCurrent: () => requireCurrent(input.reference),
      authorizeCurrent: () => authorizeCurrent(input.reference)
    }));
    state.practicalAdmission = observing.catch(() => {});
    return observing;
  }
  async function readTrainingPractical({ clientId, ...current }) {
    const prepared = await practicalContext({ ...current, clientId });
    const { connection, context, targetInput, requireCurrent, authorizeCurrent } = prepared;
    const observations = createTrainingPracticalObservations({ actions: current.actions, failure });
    const facts = await observations.read({ connection, context, targetInput,
      requireCurrent: () => requireCurrent(connection.trainingPractical?.reference) });
    await authorizeCurrent(connection.trainingPractical?.reference);
    return { ok: true, ...facts };
  }
  function bindConversation({ runtime, sessionId, actions, native, terminals }) {
    const scope = runtime.learningScope;
    if (typeof scope?.noExercise !== "boolean" || !actions?.execute || !native?.readTurn || !terminals) {
      throw new TypeError("Main teaching requires its exact pinned learning runtime and original native owners.");
    }
    const storage = runtime.store.conversationStorage;
    const key = `${runtime.stateRoot}\0${sessionId}`;
    const helperState = helperFor(runtime, sessionId, terminals);
    const helper = helperState.helper;
    if (helperState.binding && helperState.binding.native !== native) retirePresentationState(helperState);
    helperState.binding = { runtime, scope: structuredClone(scope), sessionId, native, actions };

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
      // These original Training actions are learner-scoped. The exact Main
      // WRITE grant and native coordinator own the bound attempt/session;
      // retaining a Session route here would demand a model-supplied session ID.
      const original = current.browserAuthority.requestContext;
      const request = original.requestMeta?.request;
      const params = { ...request?.params };
      if (params.learningAttemptId !== undefined && params.learningAttemptId !== scope.attemptId) {
        throw failure("Retain this learning conversation’s original target.");
      }
      delete params.learningAttemptId;
      const context = { ...original, ...(request ? { requestMeta: { ...original.requestMeta,
        request: { ...request, params, vibe64User: grant.user } } } : {}),
      runtime, assistantSelection: current.assistantSelection, trainingTeaching: teaching, trainingAssessment: assessment };
      const coordinator = {
        async requireAttempt(attemptId, requestedSessionId) {
          if (attemptId !== undefined && attemptId !== scope.attemptId) throw failure("Read only this bound pinned attempt.");
          if (requestedSessionId !== undefined && requestedSessionId !== sessionId) throw failure("Use only this bound learning conversation.");
          const { grant } = await requireCurrent(current, admitted);
          return grant.project;
        },
        async requirePresentationAttempt(attemptId) {
          if (attemptId !== scope.attemptId) throw failure("Pilot only this bound pinned attempt.");
          const { grant } = await requireCurrent(current, admitted);
          return scope.noExercise ? scope : { ...scope, projectSlug: grant.project.slug, sessionId };
        },
        async navigatePresentation(presentation, execution) {
          const captured = { ...current, signal: execution.signal };
          const { grant, message, target } = await requireCurrent(captured, admitted);
          const connection = helperState.connections.get(message.data?.clientId);
          if (!connection || helperState.binding?.native !== native || typeof native.notifyPresentation !== "function") {
            return { ok: false, error: "The initiating Main browser is no longer connected." };
          }
          const conversationId = mainConversationId({ learningAttemptId: scope.attemptId, sessionId });
          if (presentation.operation === "cue") {
            // The bound OpenCode owner does not yet expose its exact final-result
            // carrier. Refuse before any browser effect; keep its other visuals.
            if (typeof native.readFinalAssistantResult !== "function") {
              return { ok: false, error: "Narrated lesson cues are unavailable for this native provider until its exact final response can be confirmed." };
            }
            const existing = helperState.presentation.admitCue(connection, { presentation }, {
              conversationId, turnId: admitted.turnId, interactive: true
            });
            if (existing) return existing;
          }
          if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
          await requireCurrent(captured, admitted);
          const command = { id: randomUUID(), projectSlug: scope.noExercise ? "" : grant.project.slug, sessionId, conversationId: "", pane: "preview",
            presentation: structuredClone(presentation), status: "pending" };
          if (presentation.operation === "cue") {
            Object.assign(command.presentation, { navigationId: command.id, clientId: connection.clientId,
              conversationId, turnId: admitted.turnId });
            connection.origin = { admitted, current, nativeThreadId: target.threadId,
              nativeTurnId: target.turnId, nativeOuterTurnId: target.outerTurnId, generation: helperState.generation };
          }
          return helperState.presentation.begin(connection, command, { get generation() { return helperState.generation; } });
        },
        async readPresentationCue(input, execution) {
          const { message } = await requireCurrent({ ...current, signal: execution.signal }, admitted);
          return helperState.presentation.readCue(helperState.connections.get(message.data?.clientId), input,
            { conversationId: mainConversationId({ learningAttemptId: scope.attemptId, sessionId }) });
        },
        async requireTrainingQuestionTurn(execution, input) {
          if (input.attemptId !== scope.attemptId) throw failure("Prepare only this bound attempt’s question.");
          const { message } = await requireCurrent({ ...current, signal: execution.signal }, admitted);
          const connection = helperState.connections.get(message.data?.clientId);
          if (connection && !helperState.presentation.allowsQuestion(connection,
            mainConversationId({ learningAttemptId: scope.attemptId, sessionId }))) {
            throw failure("Finish or explicitly retire this browser’s current explanation before asking a question.");
          }
          return { signal: execution.signal, assertCurrent: admitted.assertCurrent, requireCurrent: () => requireCurrent({ ...current, signal: execution.signal }, admitted) };
        },
        async stageTrainingQuestion(reference, execution) {
          if (reference.attemptId !== scope.attemptId) throw failure("Prepare a question only for this bound attempt.");
          const { target } = await requireCurrent({ ...current, signal: execution.signal }, admitted);
          return stageAdmittedTrainingQuestion(reference, { actor: authenticatedVibe64User(execution), teaching,
            storage, storageId: sessionId, admitted: { ...admitted, nativeOuterTurnId: target.outerTurnId }, failure,
            requireCurrent: () => requireCurrent({ ...current, signal: execution.signal }, admitted) });
        },
        async readTrainingPractical(input, execution) {
          if (input.attemptId !== scope.attemptId) throw failure("Read only this bound attempt's practical facts.");
          const captured = { ...current, signal: execution.signal };
          const { message } = await requireCurrent(captured, admitted);
          if (!message.data?.clientId) throw failure("The accepted explanation has no initiating Main browser.");
          const result = await readTrainingPractical({ runtime, sessionId, context: captured, actions, clientId: message.data.clientId });
          await requireCurrent(captured, admitted);
          return result;
        },
        async evaluateTrainingAnswer(input, execution) {
          return evaluateTraining("answer", input, execution);
        },
        async evaluateTrainingPractical(input, execution) {
          return evaluateTraining("practical", input, execution);
        }
      };
      async function evaluateTraining(kind, input, execution) {
        if (input.attemptId !== scope.attemptId || input.messageId !== admitted.messageId) {
          throw failure("Evaluate only this bound attempt's actual accepted learner message.");
        }
        if (evaluations.has(key)) throw failure("Finish or stop the current grading Helper first.");
        let connection, practical, practicalFacts;
        const guard = async () => {
          const checked = await requireCurrent({ ...current, signal: execution.signal }, admitted);
          if (practical && (helperState.connections.get(checked.message.data?.clientId) !== connection ||
              connection.trainingPractical !== practical ||
              !isDeepStrictEqual({ reference: practical.reference, observation: practical.observation, checkResult: practical.checkResult }, practicalFacts))) {
            throw failure("The native practical observation changed before evaluation finished.");
          }
          return checked;
        };
        const operation = Promise.resolve().then(async () => {
          const { log, message } = await guard();
          const accepted = readAcceptedTrainingAnswer(log, admitted);
          if (!accepted) throw failure("Use an accepted answer associated with its exact delivered native question.");
          if (kind === "practical") {
            connection = helperState.connections.get(message.data?.clientId);
            practical = connection?.trainingPractical;
            if (!practical?.observation || practical.observation.observationId !== input.observationId ||
                !isDeepStrictEqual(practical.reference, accepted.reference)) {
              throw failure("Evaluate only this connection's completed observation for its exact delivered question.");
            }
            practicalFacts = structuredClone({ reference: practical.reference,
              observation: practical.observation, checkResult: practical.checkResult });
          }
          const { grant } = await guard();
          helperState.helperTurnId = admitted.turnId;
          helperState.cleanupContext = { assistantSelection: current.assistantSelection,
            requestMeta: { request: { vibe64User: grant.user } } };
          return evaluateAdmittedTrainingAssessment(kind, {
            attemptId: input.attemptId, expectedRevision: input.expectedRevision, submissionId: input.submissionId,
            message: structuredClone(accepted.message),
            ...(kind === "practical" ? { observation: structuredClone(practicalFacts.observation), checkResult: structuredClone(practicalFacts.checkResult) } : {})
          }, execution, { assessment, signal: execution.signal, requireCurrent: guard, assertCurrent: admitted.assertCurrent,
            helper: { runHelper: (_state, context, value) => helper.runHelper(context, { ...value, signal: execution.signal }) } });
        }).finally(() => { if (evaluations.get(key) === operation) evaluations.delete(key); });
        evaluations.set(key, operation);
        return operation;
      }
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
    completeConversation, readQuestion, cleanupConversation, readPresentation,
    focusPresentation, acknowledgePresentation, observeTrainingPractical, readTrainingPractical
  });
}

export { createTrainingMainTeaching, MAIN_TEACHING_ACTION_IDS };
