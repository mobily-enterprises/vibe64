import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createConversationTranscript, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { COLLEAGUE_TOOL_PAYLOAD_LIMIT, instructions, outputSchema, readEnvelope } from "./protocol.js";
import { readWatchedConversation, watchUpdate } from "./attention.js";
import { createConversationSummary } from "./conversationSummary.js";
import { assignmentCommands, assignmentSummary, createAssignmentOperations } from "./assignments.js";

const activeStates = new Set(["starting", "inProgress"]);
function failure(message, code = "vibe64_colleague_failed", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
  return result;
}
function publicWatch({ cursor, ...watch }) { return watch; }

function createColleagueService({ actions, accounts, terminals, systemRoot, events, watchPollMs = 30000, watchDebounceMs = 250 }) {
  if (!path.isAbsolute(systemRoot || "")) throw new TypeError("Colleague needs the private application system root.");
  const toolLimits = { maxToolArgumentBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT, maxToolResultBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT };
  const catalog = createServiceToolCatalog(actions, toolLimits);
  const observationCatalog = createServiceToolCatalog({
    listDefinitions: () => actions.listDefinitions().filter((definition) => definition.kind === "query"),
    execute: (input) => actions.execute(input)
  }, toolLimits);
  const assignmentCatalog = createServiceToolCatalog({
    listDefinitions: () => actions.listDefinitions().filter((definition) => definition.kind === "query" || assignmentCommands.has(definition.id)),
    execute: (input) => actions.execute(input)
  }, toolLimits);
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  const assignments = createAssignmentOperations({ actions, persist, transcript });
  const summaries = createConversationSummary({ actions, terminals, persist,
    workflowEngineId: async (state, context) => state.record.assistantSelection?.engineId || (await chooseSelection(context)).engineId });
  const users = new Map();
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
    if (saved && saved.schemaVersion !== 1) throw failure("This Colleague history needs a compatible Vibe64 release; no state was changed.");
    const record = saved || {
      schemaVersion: 1, scopeId: `colleague_${randomUUID().replaceAll("-", "")}`,
      conversationId: "", assistantSelection: null, status: "ready", error: "", operation: null,
      runId: "", currentTurnId: "", conversationLog: []
    };
    record.watches ||= [];
    record.observations ||= [];
    await storage.write(key, async (transaction) => {
      for (const turn of record.conversationLog) {
        for (const message of turn.messages) await transaction.appendMessage(turn.turnId, message);
      }
    });
    const state = {
      key, root, record,
      saving: Promise.resolve(), admission: Promise.resolve(), running: null,
      generation: 0, pendingMessages: [], connections: new Map(), requestContext: null,
      needsObservation: Boolean(saved?.runId || saved?.status === "working"), stopping: false, nextConnection: null,
      watchTimer: null, polling: null, watchDirty: false, watchAdmission: Promise.resolve()
    };
    if (record.operation?.status === "executing") {
      record.operation = { ...record.operation, status: "unknown" };
      record.error = "The server restarted before the operation result was saved. Inspect its target before retrying.";
    }
    if (record.status === "working") {
      record.status = "interrupted";
      record.error ||= "The server restarted. Your history is kept; send a message to continue.";
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

  async function persist(state) {
    const operation = state.saving.then(async () => {
      assignments.suspendDependencies(state);
      state.record.conversationLog = await transcript.readConversationLog(state.key);
      await mkdir(state.root, { recursive: true, mode: 0o700 });
      const temporary = path.join(state.root, `conversation.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(state.record), { mode: 0o600 });
        await rename(temporary, path.join(state.root, "conversation.json"));
      } finally { await rm(temporary, { force: true }); }
    });
    state.saving = operation.catch(() => {});
    return operation;
  }

  function scope(state) {
    const workdir = path.join(state.root, state.record.scopeId);
    return { id: state.record.scopeId, runtimeRoot: workdir, workdir, environment: {}, stableContext: instructions };
  }
  function providerOptions(state) {
    return { assistantSelection: state.record.assistantSelection, vibe64User: authenticatedVibe64User(state.requestContext) };
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
    return {
      ok: true, conversationId: record.scopeId, status: record.status, error: record.error,
      assistantSelection: record.assistantSelection, operation: record.operation ? {
        id: record.operation.id, status: record.operation.status, toolName: record.operation.toolName
      } : null,
      messages: page.conversationLog.flatMap((turn) => turn.messages.map((message) => ({
        id: message.messageId || `${turn.turnId}:${message.role}`, role: message.role, text: message.text, at: message.at
      }))),
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

  async function prepare(state, selection) {
    if (!state.record.assistantSelection) state.record.assistantSelection = await chooseSelection(state.requestContext, selection);
    await terminals.requireAssistantSelectionAccess(state.record.assistantSelection, providerOptions(state));
    await mkdir(scope(state).workdir, { recursive: true, mode: 0o700 });
    if (state.needsObservation && state.record.conversationId) {
      const observed = requireResult(await terminals.readEphemeralAgentConversation(scope(state), {
        conversationId: state.record.conversationId, persistent: true, runId: state.record.runId
      }, providerOptions(state)));
      if (activeStates.has(observed.status)) throw failure("The previous native turn is still running. Stop Colleague before sending another message.");
      state.needsObservation = false;
    }
    if (!state.record.conversationId) {
      const created = requireResult(await terminals.createEphemeralAgentConversation(scope(state), { persistent: true }, providerOptions(state)));
      if (!created?.conversationId) throw failure("The provider did not create a Colleague conversation.");
      state.record.conversationId = created.conversationId;
      await persist(state);
    }
  }

  async function run(state, connection, generation) {
    const isCurrent = () => !closed && generation === state.generation;
    let autonomous = !state.pendingMessages.length;
    const userMessageIds = [];
    let context = actionContext(state, connection);
    let activeCatalog, toolSet, tools, toolProject;
    let feedback = "";
    let invalidResponses = 0;
    await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context });
    await prepare(state, connection.assistantSelection);
    for (let step = 0; step < 24 && isCurrent(); step += 1) {
      if (state.pendingMessages.length) {
        autonomous = false;
        connection = state.nextConnection;
        context = actionContext(state, connection);
      }
      await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context });
      if (!isCurrent()) return;
      const messages = state.pendingMessages.splice(0);
      userMessageIds.push(...messages.map((message) => message.messageId));
      let replyTurnId = state.record.currentTurnId;
      const observations = [];
      for (const observation of state.record.observations.slice()) {
        // Persisted notifications may outlive their original project access.
        try {
          requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: { sessionId: observation.focus.sessionId },
            context: { ...context, projectSlug: observation.focus.projectSlug } }));
          observations.push(observation);
        } catch (error) {
          const watch = state.record.watches.find((item) => item.watchId === observation.watchId);
          if (watch?.status === "pending") { watch.status = "paused"; watch.error = `Watching paused: ${error.message}`.slice(0, 512); }
          const assignment = state.record.assignments?.find((item) => item.assignmentId === observation.assignmentId);
          if (assignment && ["active", "waiting"].includes(assignment.status)) {
            assignment.status = "needs-user";
            assignment.summary = "Assignment access could not be verified. Resolve access before resuming.";
          }
          state.record.observations = state.record.observations.filter((item) => item.id !== observation.id);
          await persist(state);
        }
      }
      if (autonomous && !observations.length) { state.record.status = "ready"; await persist(state); return; }
      const assignmentIds = observations.filter((observation) => state.record.assignments?.some((assignment) =>
        assignment.assignmentId === observation.assignmentId && ["active", "waiting"].includes(assignment.status))).map((observation) => observation.assignmentId);
      const observedAssignmentIds = observations.flatMap((observation) => observation.assignmentId ? [observation.assignmentId] : []);
      const canRelay = (state.record.assignments || []).some((assignment) => observedAssignmentIds.includes(assignment.assignmentId) &&
        assignment.status !== "cancelled" && assignment.links?.some((link) => state.record.assignments.some((target) =>
          target.assignmentId === link.assignmentId && ["active", "waiting"].includes(target.status))));
      context = { ...actionContext(state, connection), colleague: {
        ...actionContext(state, connection).colleague, userMessageIds, assignmentIds, observedAssignmentIds
      } };
      const readOnly = autonomous && !assignmentIds.length && !canRelay;
      const nextCatalog = autonomous ? (readOnly ? observationCatalog : assignmentCatalog) : catalog;
      if (activeCatalog !== nextCatalog || toolProject !== context.projectSlug) {
        activeCatalog = nextCatalog;
        toolProject = context.projectSlug;
        toolSet = activeCatalog.resolveToolSet(context);
        tools = toolSet.tools.map(activeCatalog.toOpenAiToolSchema);
      }
      const prompt = JSON.stringify({
        assistantName: await resolveName(),
        focus: connection.focus, userMessages: messages,
        observations, readOnly, autonomous,
        assignments: (state.record.assignments || []).filter((item) => ["active", "waiting", "needs-user"].includes(item.status) || observedAssignmentIds.includes(item.assignmentId))
          .map((item) => {
            const { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links } = assignmentSummary(item);
            return { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links };
          }),
        // A new native conversation gets bounded written history, including after
        // a model change or a restart between native creation and first admission.
        ...(!state.record.runId ? { recentConversation: (await snapshot(state)).messages.slice(-24)
          .filter((message) => !messages.some((pending) => pending.messageId === message.id))
          .map(({ role, text }) => ({ role, text: text.slice(0, 2000) })) } : {}),
        previousOperation: state.record.operation,
        feedback, tools
      });
      state.needsObservation = true;
      const started = requireResult(await terminals.startEphemeralAgentConversationTurn(scope(state), {
        conversationId: state.record.conversationId, persistent: true,
        messageId: randomUUID(), message: prompt, outputSchema, policy: "read"
      }, providerOptions(state)));
      state.record.runId = started.runId || "";
      await persist(state);
      if (!isCurrent()) {
        await terminals.stopEphemeralAgentConversation(scope(state), { conversationId: state.record.conversationId, persistent: true, runId: state.record.runId }, providerOptions(state));
        return;
      }
      let response = started;
      if (activeStates.has(started.status)) {
        const target = { conversationId: state.record.conversationId, persistent: true, runId: state.record.runId };
        try {
          response = requireResult(await terminals.waitForEphemeralAgentConversationTurn(scope(state), target, providerOptions(state)));
        } catch (error) {
          if (!isCurrent()) return;
          // A lost completion notification is not a lost answer. Reconcile the
          // exact native turn before reporting failure; never start a replacement.
          const observed = await terminals.readEphemeralAgentConversation(scope(state), target, providerOptions(state)).catch(() => null);
          if (!observed?.ok || observed.status !== "completed" || observed.runId !== target.runId) throw error;
          response = observed;
        }
      }
      if (!isCurrent()) return;
      if (activeStates.has(response.status)) throw failure("The provider has not finished this response. Your message is retained.");
      state.needsObservation = false;
      if (state.pendingMessages.length) {
        feedback = "The user supplied new steering while you were responding. No operation from that response was executed. Follow their latest message.";
        continue;
      }
      if (autonomous && !observations.some((item) => state.record.observations.some((pending) => pending.id === item.id))) {
        state.record.status = "ready";
        await persist(state);
        return;
      }
      let envelope;
      try {
        envelope = readEnvelope(response.rawText || response.text || response.message || response.messages?.filter((message) => message.role === "assistant").at(-1)?.text || "");
      } catch {
        if (++invalidResponses > 2) throw failure("The model did not return a valid Colleague response. Your message is kept; try another model or retry.", "vibe64_colleague_response_invalid");
        feedback = "Your completed response did not match the required envelope. No tool was executed. Return exactly one valid JSON reply or tool envelope.";
        continue;
      }
      if (envelope.kind === "reply") {
        if (autonomous) {
          const turn = await transcript.writeConversationSystemMessage(state.key, { text: "An update from your watched conversations." });
          replyTurnId = turn.turnId;
        }
        await transcript.upsertConversationAssistantMessage(state.key, { turnId: replyTurnId, text: envelope.text });
        const delivered = new Set(observations.map((observation) => observation.id));
        state.record.observations = state.record.observations.filter((observation) => !delivered.has(observation.id));
        for (const watch of state.record.watches) {
          if (watch.status === "pending" && observations.some((observation) => observation.watchId === watch.watchId)) watch.status = watch.once ? "delivered" : "active";
        }
        scheduleWatches(state);
        await state.admission;
        if (state.pendingMessages.length) { feedback = "Continue with the user's new message."; continue; }
        state.record.status = "ready";
        state.record.error = "";
        await persist(state);
        return;
      }
      const operation = { id: randomUUID(), toolName: envelope.toolName, arguments: envelope.arguments, status: "executing" };
      state.record.operation = operation;
      await persist(state);
      if (!isCurrent()) { operation.status = "cancelled"; await persist(state); return; }
      const result = await activeCatalog.executeToolCall({ toolName: envelope.toolName, argumentsText: envelope.arguments, context, toolSet });
      operation.result = result;
      operation.status = !result.ok && result.error?.status >= 500 ? "unknown" : "completed";
      await persist(state);
      if (operation.status === "unknown") throw failure("The operation did not return a verified result. Its outcome is unknown; inspect the target before retrying.");
      feedback = JSON.stringify({ toolName: envelope.toolName, result });
    }
    if (isCurrent()) throw failure("Colleague reached this turn's operation limit. The completed results are kept; send a follow-up to continue.");
  }

  function startWorker(state, connection) {
    const generation = ++state.generation;
    state.record.status = "working";
    state.running = persist(state).then(() => run(state, connection, generation))
      .catch(async (error) => {
        if (state.generation !== generation) return;
        state.record.status = "failed";
        state.record.error = error.message;
        await persist(state);
      }).finally(() => {
        state.running = null;
        if (!closed && !state.stopping && state.record.status === "ready") {
          if (state.pendingMessages.length) startWorker(state, state.nextConnection);
          else wakeForObservations(state);
        }
      });
    // The request returns after admission; the UI reads any failure from state.
    // Keep an observed promise even when persistence itself fails.
    void state.running.catch(() => {});
  }

  function wakeForObservations(state) {
    if (closed || state.stopping || state.running || !state.requestContext || !state.record.observations.length || state.record.status !== "ready") return;
    const observation = state.record.observations[0];
    startWorker(state, { clientId: "", focus: observation.focus });
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

  async function observeWatch(state, watch) {
    const observation = await readWatchedConversation(actions, watch, actionContext(state, { clientId: "", focus: watch }));
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

  return {
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
        if (existing) return { ok: true, watch: publicWatch(existing) };
        if (state.record.watches.filter((watch) => ["active", "pending", "paused"].includes(watch.status)).length >= 16) throw failure("Cancel an existing watch before adding another; up to 16 can be retained.");
        state.requestContext = context;
        const watch = { watchId: input.watchId, projectSlug: input.projectSlug, sessionId: input.sessionId,
          conversationId: input.conversationId || "", condition: input.condition, question: input.question,
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
        if (state.needsObservation && state.record.conversationId && state.record.status !== "ready") {
          const observed = requireResult(await terminals.readEphemeralAgentConversation(scope(state), {
            conversationId: state.record.conversationId, persistent: true, runId: state.record.runId
          }, { assistantSelection: state.record.assistantSelection, vibe64User: authenticatedVibe64User(context) }));
          if (activeStates.has(observed.status)) throw failure("Stop Colleague's previous native turn before changing its model.");
        }
        const selected = await chooseSelection(context, input.assistantSelection);
        const changed = ["engineId", "modelProviderId", "modelId", "agentId", "variantId"]
          .some((key) => (state.record.assistantSelection?.[key] || "") !== (selected[key] || ""));
        const previous = { ...state.record };
        state.record.assistantSelection = selected;
        if (changed) {
          state.record.conversationId = "";
          state.record.runId = "";
          state.record.status = "ready";
          state.record.error = "";
        }
        try { await persist(state); }
        catch (error) { Object.assign(state.record, previous); throw error; }
        if (changed) state.needsObservation = false;
      });
      state.admission = selecting.catch(() => {});
      await selecting;
      return snapshot(state);
    },
    async context(_input, context = {}) {
      const state = await stateFor(context);
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
      if (input.databaseView && (input.pane !== "database" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Database pane before selecting a database view." };
      }
      if (input.integrationId && (input.pane !== "integrations" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Integrations view before opening an integration." };
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
        ...(input.databaseView ? { databaseView: input.databaseView } : {}),
        sessionId: input.sessionId || "", conversationId: input.conversationId || "", status: "pending" };
      connection.navigation = command;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          command.status = "failed";
          connection.acknowledge = null;
          resolve({ ok: false, error: "The browser did not acknowledge navigation. Open Colleague in that browser and try again." });
        }, 15000);
        connection.acknowledge = (result) => {
          clearTimeout(timer);
          command.status = result.ok ? "completed" : "failed";
          connection.acknowledge = null;
          if (result.focus) connection.focus = result.focus;
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
    async send(input, context) {
      const state = await stateFor(context);
      const admitted = state.admission.then(async () => {
        if (closed) throw failure("Colleague is shutting down.");
        if (state.stopping) throw failure("Colleague is stopping its previous turn. Send again once it has stopped.");
        if (await transcript.conversationMessageIdExists(state.key, input.messageId)) return;
        const turn = await transcript.writeConversationUserMessage(state.key, { text: input.message, messageId: input.messageId });
        state.record.currentTurnId = turn.turnId;
        state.requestContext = context;
        state.pendingMessages.push({ messageId: input.messageId, text: input.message });
        state.record.error = "";
        await persist(state);
        const previous = state.connections.get(input.clientId) || {};
        const connection = { ...previous, clientId: input.clientId, focus: input.focus || previous.focus || null, assistantSelection: input.assistantSelection };
        state.connections.set(input.clientId, connection);
        state.nextConnection = { ...connection, focus: structuredClone(connection.focus) };
        if (!state.running) startWorker(state, state.nextConnection);
      });
      state.admission = admitted.catch(() => {});
      await admitted;
      return snapshot(state, input.clientId);
    },
    async stop(_input, context) {
      const state = await stateFor(context);
      state.stopping = true;
      await state.admission;
      state.generation += 1;
      state.summaryAbort?.abort();
      state.pendingMessages = [];
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
        if (state.record.conversationId && state.record.runId) requireResult(await terminals.stopEphemeralAgentConversation(scope(state), {
          conversationId: state.record.conversationId, persistent: true, runId: state.record.runId
        }, providerOptions(state)));
        await state.running;
        await state.summaryRunning;
        await summaries.cleanup(state, context);
        state.needsObservation = false;
        await persist(state);
      } finally { state.stopping = false; }
      return snapshot(state);
    },
    async wait(context) { const state = await stateFor(context); await state.admission; await state.running; return snapshot(state); },
    async close() {
      closed = true;
      for (const pending of users.values()) {
        const state = await pending;
        clearTimeout(state.watchTimer);
        await state.watchAdmission;
        await state.polling;
        if (state.running || state.summaryRunning || state.record.summaryHelper) await this.stop({}, state.requestContext);
        await state.running;
        await state.saving;
      }
    }
  };
}

export { createColleagueService };
