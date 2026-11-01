import { randomUUID } from "node:crypto";
import { runBoundedAssistantToolLoop, readAssistantResponseEnvelope, readPartialAssistantReply } from "@jskit-ai/assistant-core/server";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { nativeInstructions, nativeLearnInstructions } from "./protocol.js";
import { conversationObservation, readWatchedConversation, watchUpdate } from "./attention.js";
import { stateObservation, stateWatchUpdate } from "./watchSources.js";
import { assignmentSummary, suspendAssignment } from "./assignments.js";
import { failure, requireResult } from "./colleagueFailure.js";
import { WATCH_UPDATE_NOTICE, trimIncompleteSurrogate } from "./colleaguePresentation.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").WatchSources} WatchSources */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueConversations} ColleagueConversations */
/** @typedef {import("./types.js").ColleagueNameResolver} ColleagueNameResolver */

/**
 * A completed reply delivered these observations: drop them and settle the
 * watches that were waiting on them.
 */
function markObservationsDelivered(record, observations) {
  const delivered = new Set(observations.map(observation => observation.id));
  record.observations = record.observations.filter(observation => !delivered.has(observation.id));
  for (const watch of record.watches) {
    if (watch.status === "pending" && observations.some(observation => observation.watchId === watch.watchId)) {
      watch.status = watch.once ? "delivered" : "active";
    }
  }
}

/**
 * Colleague's worker: one turn at a time per thread, on the API or a native
 * conversation, started by the person's send or woken by an observation, and
 * the polling of active watches that produces those observations.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {TerminalsService} dependencies.terminals
 * @param {WatchSources} dependencies.watchSources
 * @param {number} dependencies.watchPollMs
 * @param {number} dependencies.watchDebounceMs
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueConversations} dependencies.conversations
 * @param {ColleagueNameResolver} dependencies.resolveName
 */
function createColleagueWorker({
  actions,
  terminals,
  watchSources,
  watchPollMs,
  watchDebounceMs,
  serviceState,
  records,
  threads,
  conversations,
  resolveName
}) {
  async function workerContext(state, connection, generation, autonomous, userMessageIds, isCurrent) {
    let context = threads.actionContext(state, connection);
    const observations = [];
    for (const observation of state.record.observations.slice()) {
      // Persisted notifications may outlive their original project access.
      try {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.source) await readWatch(watch, context);
        else requireResult(await actions.execute({
          actionId: "vibe64.sessions.inspect",
          input: { sessionId: observation.focus.sessionId },
          context: { ...context, projectSlug: observation.focus.projectSlug }
        }));
        observations.push(observation);
      } catch (error) {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.status === "pending") {
          watch.status = "paused";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
        }
        suspendAssignment(
          state.record,
          observation.assignmentId,
          "Assignment access could not be verified. Resolve access before resuming."
        );
        state.record.observations = state.record.observations.filter(item => item.id !== observation.id);
        await records.persist(state);
      }
    }
    if (!isCurrent()) return null;
    if (autonomous && !observations.length) {
      state.record.status = "ready";
      await records.persist(state);
      return null;
    }
    const assignmentIds = observations.filter(observation => state.record.assignments?.some(assignment =>
      assignment.assignmentId === observation.assignmentId &&
        ["active", "waiting"].includes(assignment.status))).map(observation => observation.assignmentId);
    const observedAssignmentIds = observations.flatMap(observation => observation.assignmentId ? [observation.assignmentId] : []);
    const canRelay = (state.record.assignments || []).some(assignment => observedAssignmentIds.includes(assignment.assignmentId) &&
      assignment.status !== "cancelled" && assignment.links?.some(link => state.record.assignments.some(target =>
        target.assignmentId === link.assignmentId && ["active", "waiting"].includes(target.status))));
    const readOnly = autonomous && !assignmentIds.length && !canRelay;
    context = {
      ...context,
      colleague: {
        ...context.colleague,
        generation,
        autonomous,
        readOnly,
        userMessageIds,
        assignmentIds,
        observedAssignmentIds,
        observationIds: observations.map(observation => observation.id)
      }
    };
    state.operationRunId = randomUUID();
    state.operationContext = context;
    state.observationIds = autonomous ? context.colleague.observationIds : [];
    return { context, observations, readOnly, observedAssignmentIds };
  }

  async function workerData(state, connection, currentContext, autonomous) {
    return {
      assistantName: await resolveName(),
      focus: connection.focus,
      userMessageIds: currentContext.context.colleague.userMessageIds,
      observations: currentContext.observations,
      readOnly: currentContext.readOnly,
      autonomous,
      assignments: (state.record.assignments || []).filter(item =>
        ["active", "waiting", "needs-user"].includes(item.status) || currentContext.observedAssignmentIds.includes(item.assignmentId))
        .map(item => {
          const {
            assignmentId,
            projectSlug,
            sessionId,
            conversationId,
            status,
            summary,
            turnLimit,
            turnsUsed,
            waitingForAssignmentId,
            links
          } = assignmentSummary(item);
          return {
            assignmentId,
            projectSlug,
            sessionId,
            conversationId,
            status,
            summary,
            turnLimit,
            turnsUsed,
            waitingForAssignmentId,
            links
          };
        }),
      ...(state.record.retiredConversation?.operation ? { previousOperation: state.record.retiredConversation.operation } : {})
    };
  }

  async function runApi(state, connection, generation, message, admission, controller) {
    const isCurrent = () =>
      !serviceState.lifecycle.closed && !state.stopping && !controller.signal.aborted && generation === state.generation;
    const autonomous = !message;
    const currentContext = await workerContext(state, connection, generation, autonomous, message ? [message.messageId] : [], isCurrent);
    if (!currentContext) return;
    const { context, observations } = currentContext;
    const hadRuntime = Boolean(state.record.conversationMetadata?.runtime);
    let conversation;
    try { conversation = await conversations.prepare(state, context, connection.assistantSelection); }
    catch (error) {
      // Before the first runtime exists, setup cannot have reserved or sent this
      // message. Existing runtimes may retain an earlier unknown native receipt.
      if (!hadRuntime && !state.record.conversationMetadata?.runtime) admission.resolve({ ok: false, error: error.message });
      throw error;
    }
    if (!isCurrent()) return;
    if (state.runtimeOwner === conversations.nativeRuntime) {
      // First setup stays in the tracked preparation lifetime. Only the actual
      // prepared owner decides whether this request needs native app admission.
      if (message) {
        const turn = await records.transcript.writeConversationUserMessage(state.record.runtimeId, {
          messageId: message.messageId,
          text: message.text
        });
        if (!turn) throw failure("The authored Colleague message could not be admitted.");
        state.pendingMessages.push({ ...message, turnId: turn.turnId });
        state.nextConnection = connection;
        admission.resolve({ status: "accepted", messageId: message.messageId, turnId: turn.turnId, origin: "user" });
      }
      return runNative(state, connection, generation, controller);
    }
    const data = await workerData(state, connection, currentContext, autonomous);
    const streamId = randomUUID();
    const messageId = message?.messageId || `observation-${randomUUID()}`;
    let replyTurnId = "";
    let progress = null;
    let revision = -1;
    const seenMessages = new Set();
    const projectReply = event => {
      if (!isCurrent()) return;
      if (event.type === "accepted" && event.messageId === messageId) {
        replyTurnId = event.turnId;
      }
      if (!replyTurnId || event.turnId !== replyTurnId) return;
      if (event.type === "tool" && event.call?.status === "running" && !autonomous) {
        // Ported first-interactive acknowledgement: the tool owner has already
        // validated and reserved this call, but has not executed it yet.
        if (!progress) {
          const source = state.streamingReply?.turnId === replyTurnId &&
            state.streamingReply.status === "completed" ? state.streamingReply : null;
          progress = {
            id: source?.outputId || source?.id || `${replyTurnId}:progress`,
            turnId: replyTurnId,
            ...(source?.outputId ? { outputId: source.outputId } : {}),
            role: "assistant",
            text: source?.text.trim() || "Let me check that.",
            at: new Date().toISOString(),
            status: "completed",
            streamId,
            autonomous: false
          };
        }
        if (state.interimReply === progress && state.streamingReply === progress) return;
        state.interimReply = progress;
        state.streamingReply = progress;
        records.publishReply(state);
        return;
      }
      if (event.type === "settled") {
        state.interimReply = null;
        return;
      }
      if (event.type === "message" && ["assistant", "commentary"].includes(event.role)) {
        const nextRevision = event.streaming?.revision;
        if (Number.isSafeInteger(nextRevision)) {
          if (nextRevision < revision) return;
          if (nextRevision > revision) {
            revision = nextRevision;
            seenMessages.clear();
          }
          const key = JSON.stringify([event.messageId, event.role, event.status, event.text]);
          if (seenMessages.has(key)) return;
          seenMessages.add(key);
        }
        if (autonomous && event.role === "commentary") {
          if (state.streamingReply?.id === (event.outputId || event.messageId)) {
            state.streamingReply = null;
            state.interimReply = null;
            records.publishReply(state);
          }
          return;
        }
        if (progress && (event.role === "commentary" || (event.outputId || event.messageId) === progress.id)) return;
        state.interimReply = null;
        state.streamingReply = {
          id: event.outputId || event.messageId,
          turnId: event.turnId,
          ...(event.outputId ? { outputId: event.outputId } : {}),
          role: "assistant",
          text: event.status === "complete" ? event.text : trimIncompleteSurrogate(event.text),
          at: new Date().toISOString(),
          status: event.status === "complete" ? "completed" : "inProgress",
          streamId,
          autonomous
        };
        records.publishReply(state);
      }
    };
    state.projectReply = projectReply;
    const unsubscribe = await conversation.subscribe(projectReply);
    try {
      const receipt = await conversation[autonomous ? "wake" : "send"]({
        ...(message ? { messageId: message.messageId, text: message.text }
          : { messageId, text: WATCH_UPDATE_NOTICE }),
        data
      });
      admission.resolve(receipt);
      const result = await conversation.wait();
      if (!isCurrent()) return;
      const turn = result.conversationLog.find(candidate => candidate.turnId === receipt.turnId);
      if (turn?.metadata?.runtime?.status !== "complete") {
        throw failure(result.error || "Colleague's response did not complete. Your message is kept.");
      }
      markObservationsDelivered(state.record, observations);
      state.record.status = "ready";
      state.record.error = "";
      state.streamingReply = null;
      state.interimReply = null;
      await records.persist(state);
      records.publishReply(state, {
        id: turn.assistant.outputId || turn.assistant.messageId,
        role: "assistant",
        text: turn.assistant.text,
        at: turn.assistant.at,
        streamId,
        autonomous
      });
      scheduleWatches(state);
    } finally {
      if (state.projectReply === projectReply) state.projectReply = null;
      unsubscribe();
    }
  }

  async function runNative(state, connection, generation, controller) {
    const isCurrent = () =>
      !serviceState.lifecycle.closed && !state.stopping && generation === state.generation && !controller.signal.aborted;
    let autonomous = !state.pendingMessages.length;
    const userMessageIds = [];
    let feedback = "", progressAlreadySaid = "", progress = null;
    let currentContext, prepared, receipt, release, replyTurnId = "", internalMessageId = "";
    let toolSet, toolProject, toolAutonomous, toolReadOnly;
    let streamId = randomUUID();
    const projectReply = event => {
      if (!isCurrent() || state.pendingMessages.length) return;
      if (event.type === "accepted" && event.messageId === internalMessageId) receipt = event;
      if (!receipt || event.turnId !== receipt.turnId) return;
      if (event.type === "tool" && event.call?.id === prepared?.toolCallId && event.call.status === "running") {
        if (!autonomous && !progressAlreadySaid) {
          // This exact completed envelope has already passed the shared parser
          // and durable reservation; it alone supplies the first intent sentence.
          progressAlreadySaid = readAssistantResponseEnvelope(prepared.text).text?.trim() || "Let me check that.";
          progress = {
            id: `${replyTurnId}:progress`,
            turnId: replyTurnId,
            role: "assistant",
            text: progressAlreadySaid,
            at: new Date().toISOString(),
            status: "completed",
            streamId: randomUUID(),
            autonomous: false
          };
        }
        state.streamingReply = progress;
        state.interimReply = progress;
        records.publishReply(state);
        return;
      }
      if (event.completedEnvelope !== true || event.type !== "message" || event.role !== "assistant") return;
      const saved = state.record.conversationLog.find(turn => turn.turnId === receipt.turnId);
      if (saved?.metadata?.runtime?.nativeToolAttempt === true) {
        state.streamingReply = progress;
        records.publishReply(state);
        return;
      }
      const text = readPartialAssistantReply(event.text);
      if (!text) return;
      state.streamingReply = {
        id: `${replyTurnId}:assistant`,
        turnId: replyTurnId,
        role: "assistant",
        text,
        at: new Date().toISOString(),
        status: "inProgress",
        streamId,
        autonomous
      };
      state.interimReply = null;
      records.publishReply(state);
      // Only decoded product text crosses the browser boundary. A completed
      // native frame is still unvalidated until the shared loop settles it.
      return {
        type: "message",
        role: "assistant",
        turnId: replyTurnId,
        messageId: `${replyTurnId}:assistant`,
        text,
        status: "inProgress",
        origin: autonomous ? "application" : "user"
      };
    };
    state.projectReply = projectReply;
    try {
      await runBoundedAssistantToolLoop({ prompt: "", signal: controller.signal,
        policy: { maximumResponses: 24 }, completedEnvelope: true,
        limitError: failure("Colleague reached this turn's operation limit. The completed results are kept; send a follow-up to continue."),
        invalidResponseError: ({ nativeToolAttempt }) => failure(nativeToolAttempt
          ? "The model could not send its tool request through Colleague. No application action ran in that response. Your message is kept; retry or choose another model."
          : "The model did not return a valid Colleague response. Your message is kept; try another model or retry.",
          "vibe64_colleague_response_invalid"),
        async complete(_prompt, { outputSchema, previousResponse }) {
          release?.();
          release = null;
          controller.signal.throwIfAborted();
          if (state.pendingMessages.length) {
            autonomous = false;
            progress = null;
            progressAlreadySaid = "";
            connection = state.nextConnection;
          }
          await actions.execute({
            actionId: "vibe64.colleague.context.read",
            input: {},
            context: threads.actionContext(state, connection)
          });
          controller.signal.throwIfAborted();
          const messages = state.pendingMessages.splice(0);
          userMessageIds.push(...messages.map(message => message.messageId));
          if (messages.length) replyTurnId = messages.at(-1).turnId;
          currentContext = await workerContext(state, connection, generation, autonomous, [...userMessageIds], isCurrent);
          if (!currentContext) return {};
          if (!feedback && previousResponse?.kind === "invalid") {
            state.streamingReply = progress;
            records.publishReply(state);
            feedback = previousResponse.nativeToolAttempt
              ? "You called a Vibe64 application tool as a native runtime tool. No application action ran in that response. Do not report that the application tools are unavailable. Return the intended kind=tool envelope through StructuredOutput or completed JSON, following toolUsage; Vibe64 will execute it and provide the result."
              : "Your completed response did not match the required envelope. No tool was executed. Return exactly one valid JSON reply or tool envelope.";
          } else if (!feedback && previousResponse?.kind === "tool") {
            feedback = JSON.stringify({ toolName: previousResponse.toolName, result: previousResponse.result });
          }
          if (!toolSet || toolProject !== currentContext.context.projectSlug || toolAutonomous !== autonomous ||
              toolReadOnly !== currentContext.readOnly) {
            toolSet = records.catalog.resolveToolSet(currentContext.context);
            toolProject = currentContext.context.projectSlug;
            toolAutonomous = autonomous;
            toolReadOnly = currentContext.readOnly;
          }
          const tools = toolSet.tools.map(records.catalog.toOpenAiToolSchema);
          const native = state.thread.kind === "learn" ? nativeLearnInstructions : nativeInstructions;
          const systemPrompt = `${native}\n\nAvailable application tools:\n${JSON.stringify(tools)}`;
          const conversation = await conversations.prepare(state, currentContext.context, connection.assistantSelection, systemPrompt);
          await conversation.configure({ outputSchema });
          controller.signal.throwIfAborted();
          const data = await workerData(state, connection, currentContext, autonomous);
          const operation = state.record.conversationLog.findLast(turn =>
            turn.metadata?.applicationTools?.length)?.metadata.applicationTools.at(
            -1
          );
          const text = JSON.stringify({
            ...data,
            userMessages: messages.map(message => ({
              messageId: message.messageId,
              text: message.text
            })),
            progressAlreadySaid,
            previousOperation: operation ? {
              ...operation,
              toolName: operation.name,
              status: operation.status === "running" ? "executing" : operation.status === "complete" ? "completed" : operation.status
            }
              : data.previousOperation,
            feedback
          });
          feedback = "";
          internalMessageId = randomUUID();
          receipt = null;
          prepared = null;
          streamId = randomUUID();
          state.streamingReply = progress;
          state.interimReply = progress;
          release = await conversation.subscribe(projectReply);
          try { receipt = await conversation.wake({ messageId: internalMessageId, text }, { excludedMessageIds: [...userMessageIds] }); }
          catch (error) {
            if (!isCurrent()) throw error;
            const observed = await conversation.inspectDelivery({ messageId: internalMessageId }).catch(() => null);
            if (observed?.status !== "accepted" || observed.recoveryLimitation) throw error;
            receipt = observed;
          }
          let result;
          try { result = await conversation.wait(); }
          catch (error) {
            if (!isCurrent()) throw error;
            const observed = await conversation.inspectDelivery({ messageId: internalMessageId }).catch(() => null);
            if (observed?.status !== "accepted" || observed.turnId !== receipt.turnId || observed.recoveryLimitation) throw error;
          }
          controller.signal.throwIfAborted();
          let turn = await records.storage.read(state.record.runtimeId, transaction => transaction.readTurn(receipt.turnId));
          if (turn?.metadata?.runtime?.status !== "complete") {
            // Delivery confirmation cannot turn a settled native failure into
            // a successful response or reopen its stopped execution.
            if (!["failed", "interrupted", "cancelled"].includes(turn?.metadata?.runtime?.status)) {
              const observed = await conversation.inspectDelivery({ messageId: internalMessageId });
              if (observed.status !== "accepted" || observed.turnId !== receipt.turnId || observed.recoveryLimitation) {
                throw failure("Colleague's response did not complete. Your message is kept.");
              }
              turn = await records.storage.read(state.record.runtimeId, transaction => transaction.readTurn(receipt.turnId));
            }
            if (turn?.metadata?.runtime?.status !== "complete") throw failure(turn?.metadata?.runtime?.error || result?.error ||
              "Colleague's response did not complete. Your message is kept.");
          }
          prepared = await conversation.prepareCompletedResponse({ messageId: internalMessageId, turnId: receipt.turnId },
            { signal: controller.signal, toolSet });
          return prepared;
        },
        async settle({ phase, response }) {
          controller.signal.throwIfAborted();
          if (!isCurrent() || !currentContext) return "end";
          if (phase === "before-parse") {
            await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: currentContext.context });
            if (state.pendingMessages.length) {
              feedback = "The user supplied new steering while you were responding. No operation from that response was executed. Follow their latest message.";
              return "continue";
            }
            if (autonomous &&
                !currentContext.observations.some(item => state.record.observations.some(pending => pending.id === item.id))) {
              state.record.status = "ready";
              await records.persist(state);
              return "end";
            }
            return "use";
          }
          if (autonomous) {
            const turn = await records.transcript.writeConversationSystemMessage(state.record.runtimeId, { text: WATCH_UPDATE_NOTICE });
            replyTurnId = turn.turnId;
          }
          const turn = await prepared.publishReply({ turnId: replyTurnId });
          markObservationsDelivered(state.record, currentContext.observations);
          scheduleWatches(state);
          // Original late-admission boundary: a final written while a new
          // request is entering does not end the shared response allowance.
          await state.admission;
          controller.signal.throwIfAborted();
          if (state.pendingMessages.length) {
            feedback = "Continue with the user's new message.";
            return "continue";
          }
          state.record.status = "ready";
          state.record.error = "";
          state.streamingReply = null;
          state.interimReply = null;
          await records.persist(state);
          records.publishReply(state, {
            id: turn.assistant.messageId,
            role: "assistant",
            text: response.text,
            at: turn.assistant.at,
            streamId,
            autonomous
          });
          return "end";
        }
      });
    } finally {
      release?.();
      if (state.projectReply === projectReply) state.projectReply = null;
    }
  }

  function startWorker(state, connection, message, native = false) {
    const generation = ++state.generation;
    const controller = new AbortController();
    state.workerAbort = controller;
    const admission = Promise.withResolvers();
    admission.promise.catch(() => {});
    state.record.status = "working";
    state.interimReply = null;
    state.running = records.persist(state).then(async () => {
      if (native === null) {
        const context = threads.actionContext(state, connection);
        const selected = state.record.assistantSelection || await conversations.chooseSelection(context, connection.assistantSelection);
        const settings = await terminals.resolveConversationConfiguration(selected, conversations.promptFor(state),
          { vibe64User: authenticatedVibe64User(context) });
        native = settings.engine !== "api";
      }
      return native ? runNative(state, connection, generation, controller)
        : runApi(state, connection, generation, message, admission, controller);
    })
      .catch(async error => {
        admission.reject(error);
        if (state.generation !== generation) return;
        state.record.status = "failed";
        state.record.error = error.message;
        await records.persist(state);
      }).finally(() => {
        // A superseded preparation can finish without calling conversation.send.
        // Only that operation's receipt may acknowledge the authored message.
        admission.resolve({ ok: false, error: "Colleague stopped before this message was sent." });
        if (state.generation === generation) {
          state.streamingReply = null;
          state.interimReply = null;
          records.publishReply(state);
          records.publishBrowserChange(state);
        }
        state.running = null;
        if (state.workerAbort === controller) state.workerAbort = null;
        state.observationIds = [];
        if (state.generation === generation) {
          state.operationContext = null;
          state.operationRunId = "";
        }
        if (!serviceState.lifecycle.closed && !state.stopping && state.record.status === "ready") {
          if ((native || state.runtimeOwner === conversations.nativeRuntime) &&
              state.pendingMessages.length) void startWorker(state, state.nextConnection, null, true).catch(() => {});
          else wakeForObservations(state);
        }
      });
    void state.running.catch(() => {});
    return admission.promise;
  }

  function wakeForObservations(state) {
    if (serviceState.lifecycle.closed ||
        state.stopping ||
        state.rotating ||
        state.running ||
        !state.requestContext ||
        !state.record.observations.length ||
        state.record.status !== "ready" || serviceState.visible.get(state.userKey) !== state) return;
    const observation = state.record.observations[0];
    // Reserve the worker synchronously; its preparation resolves the actual
    // backend before the first wake, without an untracked parallel preparation.
    void startWorker(state, { clientId: "", focus: observation.focus }, null,
      state.runtimeOwner ? state.runtimeOwner === conversations.nativeRuntime : null).catch(() => {});
  }

  function scheduleWatches(state, delay = watchPollMs) {
    // A released Learn thread's watches ended with its lesson attempt.
    if (serviceState.lifecycle.closed || state.released || state.rotating || !state.requestContext ||
        !state.record.watches.some((watch) => watch.status === "active")) return;
    if (state.watchTimer && delay === watchPollMs) return;
    clearTimeout(state.watchTimer);
    state.watchTimer = setTimeout(() => {
      state.watchTimer = null;
      void pollWatches(state).catch(() => {});
    }, delay);
    state.watchTimer.unref();
  }

  /**
   * A watch without a source is a project's own coding conversation.
   */
  function watchSource(watch) {
    if (!watch.source) return null;
    const source = watchSources.get(watch.source);
    if (!source) throw failure("This watch's source is unavailable in this runtime.");
    return source;
  }

  async function readWatch(watch, context) {
    const source = watchSource(watch);
    if (!source) return readWatchedConversation(actions, watch, context);
    if (source.kind === "state") return stateObservation(source, await source.read({ ...watch.input }, context));
    return conversationObservation({
      ...requireResult(await source.read(watch, context)),
      replyDuringWork: watch.condition === "reply" && !watch.assignmentId
    });
  }

  async function observeWatch(state, watch) {
    const observation = await readWatch(watch, threads.actionContext(state, { clientId: "", focus: watch }));
    if (serviceState.lifecycle.closed || state.released || watch.status !== "active") return;
    if (watch.assignmentId &&
        !watch.expectedRunId &&
        observation.latestUserMessageId === watch.messageId &&
        observation.runId !== watch.cursor?.runId) {
      watch.expectedRunId = observation.runId;
    }
    const { cursor, reason } = (watchSource(watch)?.kind === "state" ? stateWatchUpdate : watchUpdate)(watch, observation);
    watch.cursor = cursor;
    watch.error = "";
    if (reason) {
      if (watch.assignmentId) {
        const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
        if (!assignment || !["active", "waiting"].includes(assignment.status)) {
          watch.status = "paused";
          return;
        }
        const turn = assignment.turns.find((item) => item.messageId === watch.messageId);
        const correlated = observation.latestUserMessageId ? observation.latestUserMessageId === watch.messageId
          : Boolean(watch.expectedRunId && observation.runId === watch.expectedRunId);
        if (turn && observation.answered && correlated) turn.answerId = observation.answerId;
        assignment.status = correlated ? "active" : "needs-user";
        assignment.summary = !correlated ? "The conversation changed outside this assignment. Inspect it before continuing."
          : observation.attention
            ? "The agent needs attention; inspect its latest result."
            : "An agent answered; evaluating the next step.";
      }
      watch.status = "pending";
      state.record.observations.push({
        id: randomUUID(),
        watchId: watch.watchId,
        question: watch.question,
        reason,
        ...(watch.assignmentId ? { assignmentId: watch.assignmentId } : {}),
        ...(watch.source ? { source: watch.source } : {}),
        focus: { projectSlug: watch.projectSlug, sessionId: watch.sessionId, conversationId: watch.conversationId },
        ...observation
      });
    }
  }

  async function pollWatches(state) {
    if (state.released) return;
    if (state.rotating) {
      state.watchDirty = true;
      return;
    }
    if (state.polling) {
      state.watchDirty = true;
      return state.polling;
    }
    state.polling = (async () => {
      for (const watch of state.record.watches) {
        if (serviceState.lifecycle.closed || !state.requestContext) break;
        if (watch.status !== "active") continue;
        try {
          await observeWatch(state, watch);
        }
        catch (error) {
          if (watch.status !== "active") continue;
          watch.status = "paused";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
          suspendAssignment(
            state.record,
            watch.assignmentId,
            "The assignment's conversation could not be read. Resolve the watch error before resuming."
          );
        }
      }
      await records.persist(state);
      wakeForObservations(state);
    })().finally(() => {
      state.polling = null;
      const delay = state.watchDirty ? watchDebounceMs : watchPollMs;
      state.watchDirty = false;
      scheduleWatches(state, delay);
    });
    return state.polling;
  }

  return Object.freeze({
    startWorker,
    wakeForObservations,
    scheduleWatches,
    observeWatch
  });
}

export { createColleagueWorker };
