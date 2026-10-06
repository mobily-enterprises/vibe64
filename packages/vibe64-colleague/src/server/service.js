import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createConversationRuntime, createConversationTranscript, createConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { COLLEAGUE_TOOL_PAYLOAD_LIMIT, instructions } from "./protocol.js";
import { conversationObservation, readWatchedConversation, watchUpdate } from "./attention.js";
import { createConversationSummary } from "./conversationSummary.js";
import { assignmentCommands, assignmentSummary, createAssignmentOperations } from "./assignments.js";

function failure(message, code = "vibe64_colleague_failed", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
  return result;
}
function publicWatch({ cursor, ...watch }) { return watch; }
function colleagueHistoryMessages(turn) {
  return turn.messages.filter(message => message.role !== "system" &&
    (message.role === "user" || !turn.metadata?.runtime || turn.metadata.runtime.status === "complete"));
}
function colleagueBrowserState(current) {
  // Preserve Colleague's existing history visibility. Internal prompts and tool
  // receipts stay in the canonical store; the browser receives presentation.
  const conversationLog = current.conversationLog.flatMap(turn => {
    const messages = colleagueHistoryMessages(turn);
    if (!messages.length) return [];
    const runtime = turn.metadata?.runtime;
    return [{ turnId: turn.turnId, messages,
      user: messages.find(message => message.role === "user") || null,
      assistant: messages.find(message => message.role === "assistant") || null,
      thinking: messages.filter(message => message.role === "thinking"),
      commentary: messages.filter(message => message.role === "commentary"),
      ...(runtime ? { metadata: { runtime: { status: runtime.status, origin: runtime.origin } } } : {}) }];
  });
  const { configuration, ...state } = current;
  return { ...state, conversationLog,
    pendingRequest: current.pendingRequest?.origin === "application" ? null : current.pendingRequest,
    streaming: colleagueBrowserStream(current.streaming) };
}
function colleagueBrowserStream(streaming) {
  return streaming ? { ...streaming, messages: streaming.messages.filter(message =>
    message.origin !== "application" || message.role !== "commentary") } : streaming;
}

function createColleagueService({ actions, accounts, terminals, systemRoot, events, watchPollMs = 30000, watchDebounceMs = 250 }) {
  if (!path.isAbsolute(systemRoot || "")) throw new TypeError("Colleague needs the private application system root.");
  const toolLimits = { maxToolArgumentBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT, maxToolResultBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT };
  const storage = createConversationStorage({
    async readRecord(key) {
      const { record } = await users.get(key);
      return { metadata: record.conversationMetadata || {},
        turns: new Map(record.conversationLog.map(turn => [turn.turnId, turn])) };
    },
    async writeRecord(key, { turns, metadata }, transaction) {
      const state = await users.get(key);
      const conversationLog = await Promise.all([...turns.keys()].map(id => transaction.readTurn(id)));
      const selected = state.selecting;
      const selectedConfiguration = selected?.configuration;
      const committedSelection = selected && metadata.runtime?.engine === selected.engine &&
        JSON.stringify(metadata.runtime.configuration) === JSON.stringify(selectedConfiguration);
      await persist(state, { conversationLog,
        ...(committedSelection ? { assistantSelection: selected.assistantSelection } : {}),
        ...(Object.keys(metadata).length || state.record.conversationMetadata ? { conversationMetadata: metadata } : {}) });
    }
  });
  const transcript = createConversationTranscript({ storage });
  const assignments = createAssignmentOperations({ actions, persist, transcript });
  const summaries = createConversationSummary({ actions, terminals, persist,
    workflowEngineId: async (state, context) => state.record.assistantSelection?.engineId || (await chooseSelection(context)).engineId });
  const users = new Map();
  const runtime = createConversationRuntime({ storage, actions,
    limits: { ...toolLimits, maxToolCalls: 24, maxInputCharacters: COLLEAGUE_TOOL_PAYLOAD_LIMIT },
    async authorize({ context, conversationId, operation }) {
      if (conversationId !== userKey(context)) return false;
      const state = await users.get(conversationId);
      if (!state) return false;
      await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context });
      if (["send", "wake", "tool"].includes(operation)) {
        if (context.colleague.generation !== state.generation || state.stopping) return false;
        if (context.colleague.autonomous && !context.colleague.observationIds.some(id =>
          state.record.observations.some(observation => observation.id === id))) return false;
        await terminals.requireAssistantSelectionAccess(context.assistantSelection, { vibe64User: authenticatedVibe64User(context) });
      }
      return true;
    },
    toolPolicy: ({ actionId, kind, context }) => !context.colleague.autonomous || kind === "query" ||
      !context.colleague.readOnly && assignmentCommands.has(actionId),
    connections: { resolve: ({ integrationId, context }) => terminals.resolveConversationConnection({
      integrationId, assistantSelection: context.assistantSelection
    }, { vibe64User: authenticatedVibe64User(context) }) }
  });
  const conversationSources = new Map();
  let closed = false;
  let resolveName = async () => "Colleague";

  function userKey(context) {
    const user = authenticatedVibe64User(context);
    return Buffer.from(String(user?.uid ?? user?.username ?? "local")).toString("base64url");
  }
  async function stateFor(context) {
    const key = userKey(context);
    if (!users.has(key)) users.set(key, loadState(key));
    return users.get(key);
  }

  async function loadState(key) {
    const root = path.join(systemRoot, "colleague", key);
    let saved;
    try { saved = JSON.parse(await readFile(path.join(root, "conversation.json"), "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (saved && saved.schemaVersion !== 2) throw failure("Run the candidate Vibe64 state upgrade with services stopped before opening this Colleague history; no state was changed.");
    const record = saved || {
      schemaVersion: 2, scopeId: `colleague_${randomUUID().replaceAll("-", "")}`,
      assistantSelection: null, status: "ready", error: "", conversationLog: []
    };
    record.watches ||= [];
    record.observations ||= [];
    const state = {
      key, root, record,
      saving: Promise.resolve(), admission: Promise.resolve(), running: null,
      streamEpoch: randomUUID(), streamRevision: 0,
      generation: 0, connections: new Map(), requestContext: null, streamingReply: null,
      interimReply: null, projectReply: null,
      stopping: false, conversation: null, host: null, selecting: null, observationIds: [],
      watchTimer: null, polling: null, watchDirty: false, watchAdmission: Promise.resolve(),
      browserObservers: new Set()
    };
    if (record.status === "working") {
      record.status = "interrupted";
      record.error ||= "The server restarted. Your history is kept. Inspect unfinished operations before continuing; nothing was repeated.";
    }
    for (const assignment of record.assignments || []) {
      if (assignment.turns.some((turn) => ["reserved", "unknown"].includes(turn.status)) ||
          (assignment.reviewerConversationId && !assignment.reviewCreated)) {
        assignment.status = "needs-user";
        assignment.summary = "An assignment operation was interrupted. Inspect its target before continuing; no request has been repeated.";
        for (const watch of record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "paused";
      }
    }
    return state;
  }

  async function persist(state, conversation = null) {
    const operation = state.saving.then(async () => {
      assignments.suspendDependencies(state);
      await mkdir(state.root, { recursive: true, mode: 0o700 });
      const temporary = path.join(state.root, `conversation.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ ...state.record, ...conversation }), { mode: 0o600 });
        await rename(temporary, path.join(state.root, "conversation.json"));
        if (conversation) Object.assign(state.record, conversation);
      } finally { await rm(temporary, { force: true }); }
    });
    state.saving = operation.catch(() => {});
    void operation.then(() => publishBrowserChange(state)).catch(() => {});
    return operation;
  }

  // Product changes are invalidations, not another conversation transcript.
  // Navigation data is read through the original initiating-browser operation.
  function publishBrowserChange(state) {
    for (const observer of state.browserObservers) {
      void actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: observer.context })
        .then(() => {
          if (!state.browserObservers.has(observer)) return;
          try { Promise.resolve(observer.listener({ type: "application", interimReply: state.interimReply })).catch(() => {}); }
          catch { /* A presentation failure does not own the conversation. */ }
        }, () => {
          state.browserObservers.delete(observer);
          observer.release?.();
        });
    }
  }

  async function attachBrowserObserver(state, observer) {
    if (!state.conversation || observer.release || !state.browserObservers.has(observer)) return;
    if (observer.attaching) return observer.attaching;
    observer.attaching = (async () => {
      const conversation = await runtime.open({ id: state.key, context: observer.context, host: state.host });
      const release = await conversation.subscribe(event => {
        // Both readers apply the same synchronous product projection. Runtime
        // subscriptions reauthorize independently, so their callback order is
        // deliberately not an application presentation guarantee.
        state.projectReply?.(event);
        const interimReply = state.interimReply;
        // Product activity is read through the existing authorized snapshot;
        // model tool inputs and effect receipts are not browser notifications.
        if (event.type === "tool") {
          observer.listener({ type: "presentation", interimReply });
          return;
        }
        // Keep the original autonomous-commentary policy. The shared binding
        // owns streaming and transcript rendering.
        if (event.origin === "application" && event.role === "commentary") {
          // API text can precede its tool classification. Retire that earlier
          // partial when the completed message is identified as commentary.
          if (event.streaming) observer.listener({ type: "message-complete", turnId: event.turnId,
            messageId: event.messageId, streaming: colleagueBrowserStream(event.streaming), interimReply });
          return;
        }
        observer.listener({ ...event, interimReply,
          ...(event.streaming ? { streaming: colleagueBrowserStream(event.streaming) } : {}) });
      });
      if (!state.browserObservers.has(observer)) release();
      else observer.release = release;
    })();
    try { await observer.attaching; }
    finally { observer.attaching = null; }
  }

  function publishReply(state, completedMessage = null) {
    state.streamRevision += 1;
    const user = authenticatedVibe64User(state.requestContext || {});
    const actorId = String(user?.uid || "");
    // Hosted conversations are private to their authenticated actor. Local mode
    // retains HTTP reconciliation when it has no authenticated realtime audience.
    if (!actorId || !events?.publish) return;
    const publish = () => {
      clearTimeout(state.replyTimer);
      state.replyTimer = null;
      void events.publish({
        type: "entity.changed", source: "vibe64", entity: "colleague", operation: "updated",
        entityId: state.record.scopeId, actorId, scope: { kind: "user", id: actorId },
        realtime: { audience: "actor_user", event: "vibe64.colleague.reply.changed", payload: {
          actorId, conversationId: state.record.scopeId,
          streamEpoch: state.streamEpoch, streamRevision: state.streamRevision,
          streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
          completedMessage
        } }
      }).catch(() => {}); // A notification failure cannot fail or repeat a model turn.
    };
    if (state.streamingReply?.text && !completedMessage) {
      if (!state.replyTimer) state.replyTimer = setTimeout(publish, 25);
    } else publish();
  }

  function actionContext(state, connection) {
    // Do not copy the reserved authorization result from a previous action.
    // The host rechecks this real request for every tool and model exchange.
    return {
      surface: "app", channel: "automation", requestMeta: state.requestContext.requestMeta,
      projectSlug: connection.focus?.projectSlug || "",
      colleague: { userKey: state.key, clientId: connection.clientId, focus: connection.focus }
    };
  }

  async function snapshot(state, clientId = "") {
    const page = await transcript.readConversationLogPage(state.key, { limit: 50 });
    const record = state.record;
    const operation = record.conversationLog.at(-1)?.metadata?.applicationTools?.at(-1);
    return {
      ok: true, conversationId: record.scopeId, status: record.status, error: record.error,
      assistantSelection: record.assistantSelection, operation: operation ? {
        id: operation.id, status: operation.status === "running" ? state.running ? "executing" : "unknown"
          : operation.status === "complete" ? "completed" : operation.status, toolName: operation.name
      } : null,
      messages: page.conversationLog.flatMap((turn) => colleagueHistoryMessages(turn).map((message) => ({
        id: message.outputId || message.messageId || `${turn.turnId}:${message.role}`, role: message.role, text: message.text, at: message.at
      }))),
      streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
      streamEpoch: state.streamEpoch, streamRevision: state.streamRevision,
      pagination: page.pagination,
      watches: record.watches.map(publicWatch),
      assignments: (record.assignments || []).map((item) => assignmentSummary(item)),
      navigation: state.connections.get(clientId)?.navigation || null
    };
  }

  async function chooseSelection(context, selection) {
    const user = authenticatedVibe64User(context);
    if (selection) {
      const resolved = await terminals.resolveAssistantSelection(selection, { vibe64User: user });
      await terminals.requireAssistantSelectionAccess(resolved, { vibe64User: user });
      return resolved;
    }
    const choices = requireResult(await accounts.readModelRoutingWorkflows({ vibe64User: user }));
    for (const choice of choices.workflows || []) {
      if (!choice.available) continue;
      const decision = await terminals.resolveAssistantPurpose({ purpose: "senior", workflowEngineId: choice.engineId }, { vibe64User: user });
      if (decision.available) return decision.effectiveSelection;
    }
    throw failure("Connect an AI and configure an available Senior model in AI Accounts before using Colleague.", "vibe64_colleague_model_unavailable");
  }

  async function openConversation(state, context, settings = {}) {
    if (!state.host) {
      const workdir = path.join(state.root, state.record.scopeId);
      await mkdir(workdir, { recursive: true, mode: 0o700 });
      state.host = terminals.createConversationHost({ id: state.record.scopeId, runtimeRoot: workdir, workdir });
    }
    state.conversation = await runtime.open({ id: state.key, context, host: state.host, ...settings });
    await Promise.all([...state.browserObservers].map(observer => attachBrowserObserver(state, observer)));
    return state.conversation;
  }

  async function prepare(state, context, selection) {
    if (!state.record.assistantSelection) state.record.assistantSelection = await chooseSelection(context, selection);
    context.assistantSelection = state.record.assistantSelection;
    const settings = await terminals.resolveConversationConfiguration(context.assistantSelection, instructions,
      { vibe64User: authenticatedVibe64User(context) });
    const conversation = await openConversation(state, context, !state.record.conversationMetadata?.runtime ? settings : {});
    await conversation.retrySave();
    const current = await conversation.read();
    if (current.replacement) throw failure("A model change is unfinished. Select that model again to finish it before sending another message.");
    if (current.configuration.systemPrompt !== instructions) await conversation.configure({ systemPrompt: instructions });
    state.conversation = conversation;
    return conversation;
  }

  async function run(state, connection, generation, message, admission) {
    const isCurrent = () => !closed && generation === state.generation;
    const autonomous = !message;
    let context = actionContext(state, connection);
    const observations = [];
    for (const observation of state.record.observations.slice()) {
      // Persisted notifications may outlive their original project access.
      try {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.source) await readWatch(watch, context);
        else requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: { sessionId: observation.focus.sessionId },
          context: { ...context, projectSlug: observation.focus.projectSlug } }));
        observations.push(observation);
      } catch (error) {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.status === "pending") { watch.status = "paused"; watch.error = `Watching paused: ${error.message}`.slice(0, 512); }
        const assignment = state.record.assignments?.find(item => item.assignmentId === observation.assignmentId);
        if (assignment && ["active", "waiting"].includes(assignment.status)) {
          assignment.status = "needs-user";
          assignment.summary = "Assignment access could not be verified. Resolve access before resuming.";
        }
        state.record.observations = state.record.observations.filter(item => item.id !== observation.id);
        await persist(state);
      }
    }
    if (!isCurrent()) return;
    if (autonomous && !observations.length) { state.record.status = "ready"; await persist(state); return; }
    const assignmentIds = observations.filter(observation => state.record.assignments?.some(assignment =>
      assignment.assignmentId === observation.assignmentId && ["active", "waiting"].includes(assignment.status))).map(observation => observation.assignmentId);
    const observedAssignmentIds = observations.flatMap(observation => observation.assignmentId ? [observation.assignmentId] : []);
    const canRelay = (state.record.assignments || []).some(assignment => observedAssignmentIds.includes(assignment.assignmentId) &&
      assignment.status !== "cancelled" && assignment.links?.some(link => state.record.assignments.some(target =>
        target.assignmentId === link.assignmentId && ["active", "waiting"].includes(target.status))));
    const readOnly = autonomous && !assignmentIds.length && !canRelay;
    context = { ...context, colleague: { ...context.colleague, generation, autonomous, readOnly,
      userMessageIds: message ? [message.messageId] : [], assignmentIds, observedAssignmentIds,
      observationIds: observations.map(observation => observation.id) } };
    state.observationIds = autonomous ? context.colleague.observationIds : [];
    const hadRuntime = Boolean(state.record.conversationMetadata?.runtime);
    let conversation;
    try { conversation = await prepare(state, context, connection.assistantSelection); }
    catch (error) {
      // Before the first runtime exists, setup cannot have reserved or sent this
      // message. Existing runtimes may retain an earlier unknown native receipt.
      if (!hadRuntime && !state.record.conversationMetadata?.runtime) admission.resolve({ ok: false, error: error.message });
      throw error;
    }
    if (!isCurrent()) return;
    const data = { assistantName: await resolveName(), focus: connection.focus,
      userMessageIds: context.colleague.userMessageIds, observations, readOnly, autonomous,
      assignments: (state.record.assignments || []).filter(item => ["active", "waiting", "needs-user"].includes(item.status) || observedAssignmentIds.includes(item.assignmentId))
        .map(item => {
          const { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links } = assignmentSummary(item);
          return { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links };
        }),
      ...(state.record.retiredConversation?.operation ? { previousOperation: state.record.retiredConversation.operation } : {}) };
    const streamId = randomUUID();
    const messageId = message?.messageId || `observation-${randomUUID()}`;
    let replyTurnId = "";
    let progress = null;
    let revision = -1;
    const seenMessages = new Set();
    const projectReply = event => {
      if (!isCurrent()) return;
      if (event.type === "accepted" && event.messageId === messageId) replyTurnId = event.turnId;
      if (!replyTurnId || event.turnId !== replyTurnId) return;
      if (event.type === "tool" && event.call?.status === "running" && !autonomous) {
        // Ported first-interactive acknowledgement: the tool owner has already
        // validated and reserved this call, but has not executed it yet.
        if (!progress) {
          const source = state.streamingReply?.turnId === replyTurnId &&
            state.streamingReply.status === "completed" ? state.streamingReply : null;
          progress = { id: source?.outputId || source?.id || `${replyTurnId}:progress`, turnId: replyTurnId,
            ...(source?.outputId ? { outputId: source.outputId } : {}),
            role: "assistant", text: source?.text.trim() || "Let me check that.",
            at: new Date().toISOString(), status: "completed", streamId, autonomous: false };
        }
        if (state.interimReply === progress && state.streamingReply === progress) return;
        state.interimReply = progress;
        state.streamingReply = progress;
        publishReply(state);
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
          if (nextRevision > revision) { revision = nextRevision; seenMessages.clear(); }
          const key = JSON.stringify([event.messageId, event.role, event.status, event.text]);
          if (seenMessages.has(key)) return;
          seenMessages.add(key);
        }
        if (autonomous && event.role === "commentary") {
          if (state.streamingReply?.id === (event.outputId || event.messageId)) {
            state.streamingReply = null;
            state.interimReply = null;
            publishReply(state);
          }
          return;
        }
        if (progress && (event.role === "commentary" || (event.outputId || event.messageId) === progress.id)) return;
        state.interimReply = null;
        state.streamingReply = { id: event.outputId || event.messageId, turnId: event.turnId,
          ...(event.outputId ? { outputId: event.outputId } : {}), role: "assistant", text: event.text,
          at: new Date().toISOString(), status: event.status === "complete" ? "completed" : "inProgress", streamId, autonomous };
        publishReply(state);
      }
    };
    state.projectReply = projectReply;
    const unsubscribe = await conversation.subscribe(projectReply);
    try {
      const receipt = await conversation[autonomous ? "wake" : "send"]({
        ...(message || { messageId, text: "An update from your watched conversations." }), data
      });
      admission.resolve(receipt);
      const result = await conversation.wait();
      if (!isCurrent()) return;
      const turn = result.conversationLog.find(turn => turn.turnId === receipt.turnId);
      if (turn?.metadata?.runtime?.status !== "complete") throw failure(result.error || "Colleague's response did not complete. Your message is kept.");
      const delivered = new Set(observations.map(observation => observation.id));
      state.record.observations = state.record.observations.filter(observation => !delivered.has(observation.id));
      for (const watch of state.record.watches) {
        if (watch.status === "pending" && observations.some(observation => observation.watchId === watch.watchId)) watch.status = watch.once ? "delivered" : "active";
      }
      state.record.status = "ready";
      state.record.error = "";
      state.streamingReply = null;
      state.interimReply = null;
      await persist(state);
      publishReply(state, { id: turn.assistant.outputId || turn.assistant.messageId, role: "assistant", text: turn.assistant.text,
        at: turn.assistant.at, streamId, autonomous });
      scheduleWatches(state);
    } finally {
      if (state.projectReply === projectReply) state.projectReply = null;
      unsubscribe();
    }
  }

  function startWorker(state, connection, message) {
    const generation = ++state.generation;
    const admission = Promise.withResolvers();
    admission.promise.catch(() => {});
    state.record.status = "working";
    state.interimReply = null;
    state.running = persist(state).then(() => run(state, connection, generation, message, admission))
      .catch(async error => {
        admission.reject(error);
        if (state.generation !== generation) return;
        state.record.status = "failed";
        state.record.error = error.message;
        await persist(state);
      }).finally(() => {
        // A superseded preparation can finish without calling conversation.send.
        // Only that operation's receipt may acknowledge the authored message.
        admission.resolve({ ok: false, error: "Colleague stopped before this message was sent." });
        if (state.generation === generation) {
          state.streamingReply = null;
          state.interimReply = null;
          publishReply(state);
          publishBrowserChange(state);
        }
        state.running = null;
        state.observationIds = [];
        wakeForObservations(state);
      });
    void state.running.catch(() => {});
    return admission.promise;
  }

  function wakeForObservations(state) {
    if (closed || state.stopping || state.running || !state.requestContext || !state.record.observations.length || state.record.status !== "ready") return;
    const observation = state.record.observations[0];
    void startWorker(state, { clientId: "", focus: observation.focus }).catch(() => {});
  }

  function changeWatches(state, operation) {
    const admitted = state.watchAdmission.then(operation);
    state.watchAdmission = admitted.catch(() => {});
    return admitted;
  }

  function scheduleWatches(state, delay = watchPollMs) {
    if (closed || !state.requestContext || !state.record.watches.some((watch) => watch.status === "active")) return;
    if (state.watchTimer && delay === watchPollMs) return;
    clearTimeout(state.watchTimer);
    state.watchTimer = setTimeout(() => {
      state.watchTimer = null;
      void pollWatches(state).catch(() => {});
    }, delay);
    state.watchTimer.unref?.();
  }

  async function readWatch(watch, context) {
    if (!watch.source) return readWatchedConversation(actions, watch, context);
    const read = conversationSources.get(watch.source);
    if (!read) throw failure("This watched conversation source is unavailable in this runtime.");
    return conversationObservation(requireResult(await read(watch, context)));
  }

  async function observeWatch(state, watch) {
    const observation = await readWatch(watch, actionContext(state, { clientId: "", focus: watch }));
    if (closed || watch.status !== "active") return;
    if (watch.assignmentId && !watch.expectedRunId && observation.latestUserMessageId === watch.messageId && observation.runId !== watch.cursor?.runId) {
      watch.expectedRunId = observation.runId;
    }
    const { cursor, reason } = watchUpdate(watch, observation);
    watch.cursor = cursor;
    watch.error = "";
    if (reason) {
      if (watch.assignmentId) {
        const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
        if (!assignment || !["active", "waiting"].includes(assignment.status)) { watch.status = "paused"; return; }
        const turn = assignment.turns.find((item) => item.messageId === watch.messageId);
        const correlated = observation.latestUserMessageId ? observation.latestUserMessageId === watch.messageId
          : Boolean(watch.expectedRunId && observation.runId === watch.expectedRunId);
        if (turn && observation.answered && correlated) turn.answerId = observation.answerId;
        assignment.status = correlated ? "active" : "needs-user";
        assignment.summary = !correlated ? "The conversation changed outside this assignment. Inspect it before continuing."
          : observation.attention ? "The agent needs attention; inspect its latest result." : "An agent answered; evaluating the next step.";
      }
      watch.status = "pending";
      state.record.observations.push({ id: randomUUID(), watchId: watch.watchId, question: watch.question, reason,
        ...(watch.assignmentId ? { assignmentId: watch.assignmentId } : {}),
        ...(watch.source ? { source: watch.source } : {}),
        focus: { projectSlug: watch.projectSlug, sessionId: watch.sessionId, conversationId: watch.conversationId },
        ...observation });
    }
  }

  async function pollWatches(state) {
    if (state.polling) { state.watchDirty = true; return state.polling; }
    state.polling = (async () => {
      for (const watch of state.record.watches) {
        if (closed || !state.requestContext) break;
        if (watch.status !== "active") continue;
        try { await observeWatch(state, watch); }
        catch (error) {
          if (watch.status !== "active") continue;
          watch.status = "paused";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
          const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
          if (assignment && ["active", "waiting"].includes(assignment.status)) {
            assignment.status = "needs-user";
            assignment.summary = "The assignment's conversation could not be read. Resolve the watch error before resuming.";
          }
        }
      }
      await persist(state);
      wakeForObservations(state);
    })().finally(() => {
      state.polling = null;
      const delay = state.watchDirty ? watchDebounceMs : watchPollMs;
      state.watchDirty = false;
      scheduleWatches(state, delay);
    });
    return state.polling;
  }

  events?.register({
    id: "vibe64.colleague.attention",
    matches: (event) => !closed && event.type === "entity.changed" && event.source === "vibe64" && event.entity === "session",
    handle(event) {
      // Publishers may still hold a session write lock. Never await a read here.
      for (const pending of users.values()) void pending.then((state) => {
        const payload = event.realtime?.payload || {};
        if (state.record.watches.some((watch) => watch.status === "active" && watch.sessionId === event.entityId &&
            (!payload.projectSlug || watch.projectSlug === payload.projectSlug))) scheduleWatches(state, watchDebounceMs);
      });
    }
  });

  const service = {
    browserConversations: {
      async open({ id, context } = {}) {
        // Action contributors own authority; never retain their cached result
        // when a subscription or subsequent model operation checks the request.
        if (closed) throw failure("Colleague is shutting down.");
        const request = context?.requestMeta?.request;
        const requestContext = { surface: "app", channel: "internal", requestMeta: request ? {
          ...context.requestMeta, request: { ...request, headers: request.headers, vibe64User: authenticatedVibe64User(context) }
        } : context?.requestMeta, colleague: { userKey: userKey(context), clientId: "", focus: null } };
        await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: requestContext });
        const state = await stateFor(context);
        if (id !== state.record.scopeId) throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
        requestContext.assistantSelection = state.record.assistantSelection;
        async function preparedConversation() {
          if (!state.record.conversationMetadata?.runtime) return null;
          await openConversation(state, requestContext);
          return runtime.open({ id: state.key, context: requestContext, host: state.host });
        }
        return {
          async read(options = {}) {
            await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: requestContext });
            const pageOptions = {};
            for (const key of ["beforeTurnId", "limit"]) {
              if (Object.hasOwn(options, key)) pageOptions[key] = options[key];
            }
            const paged = Object.keys(pageOptions).length > 0;
            const conversation = await preparedConversation();
            // Reading an empty Colleague must not require AI Accounts setup or
            // choose a native engine. Its original transcript remains readable.
            if (!conversation) return colleagueBrowserState({ id, status: "ready", phase: "", error: state.record.error || "", interimReply: state.interimReply,
              capabilities: { steering: true, goals: false, attachments: false }, pendingRequest: null,
              ...(paged ? await transcript.readConversationLogPage(state.key, pageOptions)
                : { conversationLog: await transcript.readConversationLog(state.key) }),
              streaming: { revision: 0, messages: [] } });
            const current = paged ? await conversation.read(pageOptions) : await conversation.read();
            return colleagueBrowserState({ ...current, id, interimReply: state.interimReply,
              capabilities: { ...current.capabilities, steering: true, goals: false, attachments: false } });
          },
          async send(input) {
            if (input.attachmentIds?.length) throw failure("Colleague does not accept attachments.", "conversation_unsupported");
            return actions.execute({ actionId: "vibe64.colleague.message.send", context: requestContext,
              input: { ...input.data, messageId: input.messageId, message: input.text }, deps: { receiptOnly: true } });
          },
          async cancel() {
            return actions.execute({ actionId: "vibe64.colleague.turn.stop", input: {}, context: requestContext });
          },
          async select(input) {
            return actions.execute({ actionId: "vibe64.colleague.model.select", input, context: requestContext });
          },
          async inspectDelivery(input) {
            const conversation = await preparedConversation();
            return conversation ? conversation.inspectDelivery(input) : { status: "unknown", messageId: input.messageId };
          },
          async readGoal() { return null; },
          async updateGoal() {
            throw failure("Colleague does not support native goals.", "conversation_unsupported", 400);
          },
          async subscribe(listener) {
            if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
            const observer = { context: requestContext, listener, release: null };
            state.browserObservers.add(observer);
            try { await preparedConversation(); await attachBrowserObserver(state, observer); }
            catch (error) { state.browserObservers.delete(observer); observer.release?.(); throw error; }
            return () => { state.browserObservers.delete(observer); observer.release?.(); };
          }
        };
      }
    },
    registerConversationSource(name, read) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(name) || typeof read !== "function" || conversationSources.has(name)) {
        throw new TypeError("A conversation source needs a unique name and an authorized reader.");
      }
      conversationSources.set(name, read);
    },
    setNameResolver(resolver) {
      if (typeof resolver !== "function") throw new TypeError("Colleague name resolver must be a function.");
      resolveName = resolver;
    },
    async read(input = {}, context = {}) {
      const state = await stateFor(context);
      state.requestContext = context;
      scheduleWatches(state);
      wakeForObservations(state);
      return snapshot(state, input.clientId);
    },
    async listWatches(_input, context) { return { ok: true, watches: (await snapshot(await stateFor(context))).watches }; },
    async assignment(operation, input, context) {
      const state = await stateFor(context);
      if (operation === "read") return assignments.read(state, input, context);
      return changeWatches(state, async () => {
        if (closed || state.stopping) throw failure("Colleague is stopping.");
        const result = await assignments[operation](state, input, context);
        scheduleWatches(state, watchDebounceMs);
        return result;
      });
    },
    async summarize(input, context) {
      const state = await stateFor(context);
      if (closed || state.stopping || state.summaryRunning) throw failure("Finish or stop the current Colleague summary first.");
      state.requestContext = context;
      const scoped = actionContext(state, { clientId: context.colleague?.clientId || "", focus: { projectSlug: input.projectSlug } });
      state.summaryAbort = new AbortController();
      state.summaryRunning = summaries.read(state, input, scoped).finally(() => { state.summaryRunning = null; state.summaryAbort = null; });
      return state.summaryRunning;
    },
    async watch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        if (closed) throw failure("Colleague is shutting down.");
        const existing = state.record.watches.find((watch) => watch.watchId === input.watchId);
        if (existing) {
          if (["source", "projectSlug", "sessionId", "conversationId", "condition", "question"].some(key => (existing[key] || "") !== (input[key] || "")) ||
              (existing.once !== false) !== (input.once !== false)) throw failure("This watch ID belongs to a different request. Use a new watch ID.");
          return { ok: true, watch: publicWatch(existing) };
        }
        if (state.record.watches.filter((watch) => ["active", "pending", "paused"].includes(watch.status)).length >= 16) throw failure("Cancel an existing watch before adding another; up to 16 can be retained.");
        state.requestContext = context;
        const watch = { watchId: input.watchId, projectSlug: input.projectSlug, sessionId: input.sessionId,
          conversationId: input.conversationId || "", condition: input.condition, question: input.question,
          ...(input.source ? { source: input.source } : {}),
          once: input.once !== false, status: "active", error: "" };
        // Verify access before retaining the target or admitting a notification.
        await observeWatch(state, watch);
        state.record.watches = state.record.watches.filter((item) => !["delivered", "cancelled"].includes(item.status)).concat(watch);
        await persist(state);
        scheduleWatches(state);
        wakeForObservations(state);
        return { ok: true, watch: publicWatch(watch) };
      });
    },
    async cancelWatch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (watch) {
          watch.status = "cancelled";
          const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
          if (assignment && ["active", "waiting"].includes(assignment.status)) {
            assignment.status = "needs-user";
            assignment.summary = "Assignment watching was cancelled. Ask Colleague to resume or cancel the assignment.";
          }
        }
        state.record.observations = state.record.observations.filter((item) => item.watchId !== input.watchId);
        await persist(state);
        if (state.observationIds.length && !state.record.observations.some(item => state.observationIds.includes(item.id))) {
          // Only the notification belongs to this watch. The watched coding
          // conversation keeps running, and the accepted wake remains in history.
          state.generation += 1;
          await state.conversation?.cancel();
          await state.running;
          state.streamingReply = null;
          state.interimReply = null;
          state.record.status = "ready";
          state.record.error = "";
          await persist(state);
          publishReply(state);
          wakeForObservations(state);
        }
        return { ok: true };
      });
    },
    async resumeWatch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (!watch || watch.status !== "paused") throw failure("Only a paused watch can be resumed.");
        if (watch.assignmentId) throw failure("Resume the assignment through assignment.update after a new user instruction.");
        state.requestContext = context;
        watch.status = "active";
        try { await observeWatch(state, watch); }
        catch (error) { watch.status = "paused"; watch.error = error.message; throw error; }
        await persist(state);
        scheduleWatches(state);
        wakeForObservations(state);
        return { ok: true };
      });
    },
    async selectModel(input, context) {
      const state = await stateFor(context);
      const selecting = state.admission.then(async () => {
        if (closed || state.stopping || state.running) throw failure("Finish or stop Colleague's current turn before changing its model.");
        const selected = await chooseSelection(context, input.assistantSelection);
        const settings = await terminals.resolveConversationConfiguration(selected, instructions, { vibe64User: authenticatedVibe64User(context) });
        state.requestContext = context;
        const scoped = { ...actionContext(state, { clientId: "", focus: null }), assistantSelection: selected };
        if (!state.record.conversationMetadata?.runtime) {
          const previous = state.record.assistantSelection;
          state.record.assistantSelection = selected;
          try { await persist(state); } catch (error) { state.record.assistantSelection = previous; throw error; }
          return;
        }
        // The common runtime owns the native change and continuity. Publish the
        // product selection in the same record commit as its final configuration.
        const conversation = await openConversation(state, scoped);
        const current = await conversation.read();
        state.selecting = { ...settings, assistantSelection: selected };
        try {
          await conversation.select({ ...settings, operationId: current.replacement?.operationId || randomUUID(), expectedSegmentId: current.segmentId });
        } finally { state.selecting = null; }
        state.conversation = conversation;
        state.record.status = "ready";
        state.record.error = "";
        await persist(state);
      });
      state.admission = selecting.catch(() => {});
      await selecting;
      return snapshot(state);
    },
    async context(_input, context = {}) {
      const state = await stateFor(context);
      if (context.colleague?.userKey && context.colleague.userKey !== state.key) {
        throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
      }
      if (context.requestMeta?.request) state.requestContext = context;
      const focused = context.colleague?.focus || state.connections.get(context.colleague?.clientId)?.focus || null;
      return { ok: true, focus: focused || {} };
    },
    async focus(input, context) {
      const state = await stateFor(context);
      const connection = state.connections.get(input.clientId) || { clientId: input.clientId };
      connection.focus = input.focus;
      state.connections.set(input.clientId, connection);
      return { ok: true, focus: connection.focus };
    },
    async navigate(input, context) {
      const state = await stateFor(context);
      if (input.planView && (!input.sessionId || input.pane || input.conversationId)) {
        return { ok: false, error: "Choose the exact session's Main chat, without another pane or conversation, to open its plan viewer." };
      }
      if (input.databaseTable && (input.databaseView !== "data" || input.pane !== "database" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Database Data view before selecting a table." };
      }
      if (input.databaseView && (input.pane !== "database" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Database pane before selecting a database view." };
      }
      if ((input.integrationId || input.integrationEnvironment) && (input.pane !== "integrations" ||
          (input.integrationEnvironment !== "production" && !input.sessionId))) {
        return { ok: false, error: "Choose Integrations and either a development session or the production environment." };
      }
      if (!input.sessionId && (input.conversationId || ["session", "changes", "repository", "files", "database", "system", "ai-terminal"].includes(input.pane))) {
        return { ok: false, error: "Choose the exact session before opening this conversation or session view." };
      }
      const connection = state.connections.get(context.colleague?.clientId);
      if (!connection) return { ok: false, error: "The initiating browser is no longer connected." };
      if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
      const command = { id: randomUUID(), projectSlug: input.projectSlug,
        ...(input.managementView ? { managementView: input.managementView } : {}),
        ...(input.pane ? { pane: input.pane } : {}),
        ...(input.integrationId ? { integrationId: input.integrationId } : {}),
        ...(input.integrationEnvironment ? { integrationEnvironment: input.integrationEnvironment } : {}),
        ...(input.databaseView ? { databaseView: input.databaseView } : {}),
        ...(input.databaseTable ? { databaseTable: input.databaseTable } : {}),
        ...(input.planView ? { planView: input.planView } : {}),
        sessionId: input.sessionId || "", conversationId: input.conversationId || "", status: "pending" };
      connection.navigation = command;
      publishBrowserChange(state);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          command.status = "failed";
          connection.acknowledge = null;
          publishBrowserChange(state);
          resolve({ ok: false, error: "The browser did not acknowledge navigation. Open Colleague in that browser and try again." });
        }, 15000);
        connection.acknowledge = (result) => {
          clearTimeout(timer);
          command.status = result.ok ? "completed" : "failed";
          connection.acknowledge = null;
          if (result.focus) connection.focus = result.focus;
          publishBrowserChange(state);
          resolve(result);
        };
      });
    },
    async acknowledgeNavigation(input, context) {
      const state = await stateFor(context);
      const connection = state.connections.get(input.clientId);
      if (!connection || connection.navigation?.id !== input.commandId || !connection.acknowledge) {
        return { ok: false, error: "This navigation command is no longer pending." };
      }
      connection.acknowledge({ ok: input.ok, ...(input.error ? { error: input.error } : {}), ...(input.focus ? { focus: input.focus } : {}) });
      return { ok: true };
    },
    async send(input, context, { receiptOnly = false } = {}) {
      const state = await stateFor(context);
      const admitted = state.admission.then(async () => {
        if (closed) throw failure("Colleague is shutting down.");
        if (state.stopping) throw failure("Colleague is stopping its previous turn. Send again once it has stopped.");
        const previousTurn = state.record.conversationLog.find(turn => turn.messages.some(message => message.messageId === input.messageId));
        const previousMessage = previousTurn?.messages.find(message => message.messageId === input.messageId);
        if (previousMessage) {
          if (previousMessage.text !== input.message) throw failure("This message ID belongs to a different request. Use a new message ID.");
          return { status: "accepted", messageId: input.messageId, turnId: previousTurn.turnId, duplicate: true };
        }
        if (state.running) {
          state.generation += 1;
          await state.conversation?.cancel();
          await state.running;
        }
        state.requestContext = context;
        state.streamingReply = null;
        state.interimReply = null;
        state.record.error = "";
        publishReply(state);
        const previous = state.connections.get(input.clientId) || {};
        const connection = { ...previous, clientId: input.clientId, focus: input.focus || previous.focus || null, assistantSelection: input.assistantSelection };
        state.connections.set(input.clientId, connection);
        return startWorker(state, { ...connection, focus: structuredClone(connection.focus) }, { messageId: input.messageId, text: input.message });
      });
      state.admission = admitted.catch(() => {});
      const receipt = await admitted;
      if (receipt?.ok === false) return receipt;
      return receiptOnly ? receipt : snapshot(state, input.clientId);
    },
    async stop(_input, context) {
      const state = await stateFor(context);
      state.stopping = true;
      await state.admission;
      state.generation += 1;
      state.streamingReply = null;
      state.interimReply = null;
      publishReply(state);
      state.summaryAbort?.abort();
      for (const connection of state.connections.values()) connection.acknowledge?.({ ok: false, error: "Navigation was cancelled when Colleague stopped." });
      state.record.status = "interrupted";
      for (const assignment of state.record.assignments || []) {
        if (!["active", "waiting"].includes(assignment.status)) continue;
        assignment.status = "needs-user";
        assignment.summary = "Colleague was stopped. Ask to resume this assignment when ready.";
        for (const watch of state.record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "paused";
      }
      state.requestContext = context;
      try {
        if (!state.conversation && state.record.conversationMetadata?.runtime) await openConversation(state, actionContext(state, { clientId: "", focus: null }));
        await state.conversation?.cancel();
        await state.running;
        await state.summaryRunning;
        await summaries.cleanup(state, context);
        await persist(state);
      } finally { state.stopping = false; }
      return snapshot(state);
    },
    async wait(context) {
      const state = await stateFor(context);
      await state.admission;
      while (state.running) await state.running;
      return snapshot(state);
    },
    async close() {
      closed = true;
      for (const pending of users.values()) {
        const state = await pending;
        clearTimeout(state.watchTimer);
        clearTimeout(state.replyTimer);
        for (const observer of state.browserObservers) observer.release?.();
        state.browserObservers.clear();
        await state.watchAdmission;
        await state.polling;
        if (state.running || state.summaryRunning || state.record.summaryHelper) await this.stop({}, state.requestContext);
        await state.running;
        await state.saving;
      }
      await runtime.close();
    }
  };
  return service;
}

export { createColleagueService };
