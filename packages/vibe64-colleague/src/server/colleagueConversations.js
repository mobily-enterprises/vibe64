import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { COLLEAGUE_TOOL_LIMITS, COLLEAGUE_TOOL_PAYLOAD_LIMIT, instructions, learnInstructions } from "./protocol.js";
import { COLLEAGUE_MODEL_UNAVAILABLE, failure, requireResult } from "./colleagueFailure.js";
import { colleagueBrowserStream, releaseObserver, trimIncompleteSurrogate } from "./colleaguePresentation.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */

/**
 * A thread's conversation with its model: the API and native conversation
 * runtimes and their admission, opening, moving between them and preparing a
 * conversation, its browser observers, and choosing Colleague's model.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {AccountsService} dependencies.accounts
 * @param {TerminalsService} dependencies.terminals
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 */
function createColleagueConversations({ actions, accounts, terminals, serviceState, records, threads }) {
  const runtimeOptions = { storage: records.storage, toolCatalog: records.catalog, persistCommentary: false,
    limits: { ...COLLEAGUE_TOOL_LIMITS, maxToolCalls: 24, maxInputCharacters: COLLEAGUE_TOOL_PAYLOAD_LIMIT,
      maxFinalReplyCharacters: 16_000, maxApiToolProgressCharacters: 280,
      maxInitialNativeHistoryMessages: 24, maxInitialNativeHistoryMessageCharacters: 2_000,
      codexFinalizingGraceMs: 500, codexFinalizingGraceAfterHistoryRead: true, codexFailureDetailGraceMs: 500 },
    async authorize({ context, conversationId, operation }) {
      // Stopping and releasing a handle need neither a live login nor a live
      // thread: only this service holds a handle, and it stops or releases one
      // only after its own admission (Stop, a lesson's close, hiding a thread,
      // a Claude account change, shutdown). Refusing would leave the turn
      // running and the handle held.
      if (operation === "cancel" || operation === "dispose") {
        const owner = serviceState.conversationOwners.get(conversationId);
        return owner?.record.runtimeId === conversationId && owner.userKey === threads.userKey(context);
      }
      const state = await threads.stateFor(context);
      if (conversationId !== state.record.runtimeId) return false;
      await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context });
      if (["send", "wake", "tool"].includes(operation)) {
        if (context.colleague.generation !== state.generation || state.stopping) return false;
        if (context.colleague.autonomous && !context.colleague.observationIds.some(id =>
          state.record.observations.some(observation => observation.id === id))) return false;
        await terminals.requireAssistantSelectionAccess(context.assistantSelection, { vibe64User: authenticatedVibe64User(context) });
      }
      return true;
    },
    connections: { resolve: ({ integrationId, context }) => terminals.resolveConversationConnection({
      integrationId, assistantSelection: context.assistantSelection
    }, { vibe64User: authenticatedVibe64User(context) }) }
  };
  const runtime = createConversationRuntime(runtimeOptions);
  // The same backend/catalogue has two server-owned policies, but each product
  // runtimeId owns only one live handle. Direct API keeps its original policy.
  const nativeRuntime = createConversationRuntime({ ...runtimeOptions, completedEnvelope: true,
    // Native wake admission measures the serialized frame in UTF-16 units:
    // existing L context/framing + 2L raw arguments + L result object + 2L
    // result copied into feedback. Argument/result byte gates remain 256 KiB.
    limits: { ...runtimeOptions.limits, maxInputCharacters: 6 * COLLEAGUE_TOOL_PAYLOAD_LIMIT,
      maxOutputCharacters: 1_670_455 } });

  async function attachBrowserObserver(state, observer, transferring = false) {
    if (state.transfer && !transferring) await state.transfer;
    threads.assertCurrentConversation(state, observer.context.colleague?.conversationId);
    if (!state.conversation || observer.release || !state.browserObservers.has(observer)) return;
    if (observer.attaching) return observer.attaching;
    observer.attaching = (async () => {
      state.opening += 1;
      let conversation;
      try { conversation = await state.runtimeOwner.open({ id: state.record.runtimeId, context: observer.context, host: state.host }); }
      finally { state.opening -= 1; }
      const release = await conversation.subscribe(event => {
        // Both readers apply the same synchronous product projection. Runtime
        // subscriptions reauthorize independently, so their callback order is
        // deliberately not an application presentation guarantee.
        if (observer.context.colleague?.conversationId !== state.record.scopeId) return;
        // readable-check: allow optional-call - data: a reply projection exists only while a worker runs
        const projected = state.projectReply?.(event);
        const interimReply = state.interimReply;
        if (event.completedEnvelope === true) {
          observer.listener(projected ? { ...projected, interimReply } : { type: "presentation", interimReply });
          return;
        }
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
          ...(event.type === "message" && event.status === "inProgress"
            ? { text: trimIncompleteSurrogate(event.text) } : {}),
          ...(event.streaming ? { streaming: colleagueBrowserStream(event.streaming) } : {}) });
      });
      if (!state.browserObservers.has(observer)) release();
      else observer.release = release;
    })();
    try { await observer.attaching; }
    finally { observer.attaching = null; }
  }

  /**
   * The person's routed Colleague: the owner's or the team setup's Colleague
   * role. For the owner, recommendations are saved first as session creation
   * does, so an AI connected outside the in-app sign-in is usable without a
   * manual Save; a team member's send never writes a setup.
   */
  async function routedColleague(user) {
    await accounts.initializeModelRouting({ vibe64User: user });
    return terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: user });
  }

  /**
   * An exact selection, or the routed Colleague.
   */
  async function chooseSelection(context, selection) {
    const user = authenticatedVibe64User(context);
    if (selection) {
      const resolved = await terminals.resolveAssistantSelection(selection, { vibe64User: user });
      await terminals.requireAssistantSelectionAccess(resolved, { vibe64User: user });
      return resolved;
    }
    const decision = await routedColleague(user);
    if (!decision.available) throw failure(COLLEAGUE_MODEL_UNAVAILABLE, "vibe64_colleague_model_unavailable");
    return decision.effectiveSelection;
  }

  /**
   * Read-only: says whether a send could choose a model now. An unset
   * Colleague role counts when an AI is connected, because a send saves the
   * recommended setup first. Only a definite answer counts; a failed read
   * is left to the send.
   */
  async function selectionAvailable(context) {
    try {
      const user = authenticatedVibe64User(context);
      const decision = await terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: user });
      if (decision.available || decision.reasonCode !== "vibe64_assistant_role_unconfigured") return decision.available;
      const catalog = requireResult(await terminals.listAssistantCapabilities({ configuredOnly: "true" }, { vibe64User: user }));
      return (catalog.engines || []).some((engine) => (engine.modelProviders || []).some((provider) => provider.connected === true));
    } catch {
      return true;
    }
  }

  async function openConversation(state, context, settings = {}, transferring = false) {
    if (state.transfer && !transferring) await state.transfer;
    const scopeId = state.record.scopeId, runtimeId = state.record.runtimeId;
    threads.assertCurrentConversation(state, context.colleague?.conversationId);
    let host = state.host;
    if (!host) {
      const workdir = path.join(state.root, scopeId);
      await mkdir(workdir, { recursive: true, mode: 0o700 });
      threads.assertCurrentConversation(state, scopeId);
      host = state.host || terminals.createConversationHost({ id: scopeId, runtimeRoot: workdir, workdir, allowAccountChange: true });
      state.host = host;
    }
    state.opening += 1;
    let conversation;
    try {
      const saved = state.record.conversationMetadata?.runtime;
      const engine = saved?.replacement?.request?.engine === "api" ? "api" : saved?.engine || settings.engine;
      state.runtimeOwner ||= engine === "api" ? runtime : nativeRuntime;
      conversation = await state.runtimeOwner.open({ id: runtimeId, context, host, ...settings });
      threads.assertCurrentConversation(state, scopeId);
      state.conversation = conversation;
    } finally { state.opening -= 1; }
    await Promise.all([...state.browserObservers].map(observer => attachBrowserObserver(state, observer, transferring)));
    threads.assertCurrentConversation(state, scopeId);
    return conversation;
  }

  async function transferConversation(state, context, owner) {
    if (state.runtimeOwner === owner) return state.conversation;
    if (state.opening || [...state.browserObservers].some(observer => observer.attaching)) {
      throw failure("Wait for Colleague's current conversation observer to open before changing its model.");
    }
    const gate = Promise.withResolvers();
    state.transfer = gate.promise;
    try {
      for (const observer of state.browserObservers) {
        releaseObserver(observer);
        observer.release = null;
      }
      // Never open the destination unless the exact previous owner confirmed
      // its disposal. A failed release keeps that owner's handle and binding.
      if (state.conversation) requireResult(await state.conversation.dispose());
      state.conversation = null;
      state.runtimeOwner = owner;
      return await openConversation(state, context, {}, true);
    } finally {
      try { await Promise.all([...state.browserObservers].map(observer => attachBrowserObserver(state, observer, true))); }
      finally { state.transfer = null; gate.resolve(); }
    }
  }

  const promptFor = state => state.thread.kind === "learn" ? learnInstructions : instructions;

  async function prepare(state, context, selection, systemPrompt = promptFor(state)) {
    if (!state.record.assistantSelection) state.record.assistantSelection = await chooseSelection(context, selection);
    context.assistantSelection = state.record.assistantSelection;
    const settings = await terminals.resolveConversationConfiguration(context.assistantSelection, systemPrompt,
      { vibe64User: authenticatedVibe64User(context) });
    const conversation = await openConversation(state, context, !state.record.conversationMetadata?.runtime ? settings : {});
    await conversation.retrySave();
    const current = await conversation.read();
    if (current.replacement) throw failure("A model change is unfinished. Select that model again to finish it before sending another message.");
    if (current.configuration.systemPrompt !== systemPrompt) await conversation.configure({ systemPrompt });
    state.conversation = conversation;
    return conversation;
  }

  return Object.freeze({
    runtime, nativeRuntime, attachBrowserObserver, openConversation, transferConversation,
    promptFor, prepare, chooseSelection, selectionAvailable
  });
}

export { createColleagueConversations };
