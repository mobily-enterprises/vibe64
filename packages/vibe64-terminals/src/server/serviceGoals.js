import { randomUUID } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { claudeNativeMessageId } from "@jskit-ai/assistant-core/server/claude-turn";
import {
  assistantGoalObjective,
  assistantMainAiChanged,
  assistantRoutingFromMetadata,
  assistantRoutingGoalFromMetadata,
  assistantRoutingRequestFromMetadata,
  assistantRoutingRequestIsUnresolved,
  goalStatusIsComplete
} from "@local/vibe64-runtime/shared/assistantRouting";
import {
  requireCompletedConversationRewind,
  requireCompletedNativeConversationReplacement
} from "./assistantChangeover.js";
import {
  assertProjectEffectAdmission,
  currentProjectActionRequestMeta,
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { GOAL_RECOVERY_RETRY_DELAYS_MS, createServiceGoalRecovery } from "./serviceGoalRecovery.js";
import { createServiceGoalLimitReset } from "./serviceGoalLimitReset.js";
import { createServiceGoalChatContinuation } from "./serviceGoalChatContinuation.js";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";

/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").ServiceAssistantPreparation} ServiceAssistantPreparation */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("./types.js").ReadRoutingConfiguration} ReadRoutingConfiguration */

const GOAL_STOP_REQUEST = "assistant_goal_stop_request";
const MAIN_AI_CHANGED_GOAL_NOTICE = "Goal cancelled because the main AI changed in AI setup. The work done so far is kept. " +
  "To continue, choose Goal → Set goal and start it again; it will run on the new main AI.";

/**
 * A goal stop recorded by Cancel without the goal settings lock. Every reader
 * already treats the intent it names as stopped; the next change made under
 * that lock saves the stop and clears the request.
 */
const goalStopRequestFor = session => {
  try {
    return JSON.parse(session.metadata?.[GOAL_STOP_REQUEST] || "null")?.intentId || "";
  } catch {
    return "";
  }
};

const logIntentClearFailure = (logger, sessionId, error) => logOperationalEvent(logger, "warn", {
  component: "vibe64.agent_goal",
  event: "vibe64.agent_goal.intent_clear_failed",
  sessionId,
  code: error?.code,
  error: error?.message
}, "A stopped goal's intent could not be cleared; its stop request stays recorded.");

// Goal-control refusals the caller sees: a state conflict (409) unless named.
const GOAL_REFUSALS = Object.freeze({
  vibe64_goal_settings_busy: "Goal continuation settings are busy. Try the control again.",
  vibe64_goal_command_attachment_pending:
    "The accepted goal command is still waiting for its own native goal attachment. Check its original receipt before retrying.",
  vibe64_goal_changed_before_preparation: "Goal continuation was stopped or changed before preparation.",
  vibe64_goal_server_stopping: "The server is stopping. The goal will be available after restart.",
  vibe64_goal_stopped_during_preparation: "Goal continuation was stopped during preparation.",
  vibe64_goal_settings_saving:
    "The goal started, but its settings are still being saved. Pause it before retrying the settings change."
});

/**
 * @param {keyof typeof GOAL_REFUSALS} code
 * @param {number} [status]
 */
function goalRefusal(code, status = 409) {
  return new AppError(status, GOAL_REFUSALS[code], { code });
}

function readGoalIntent(session) {
  const intent = JSON.parse(session.metadata?.assistant_goal_intent || "null");
  if (intent && (intent.version !== 1 || typeof intent.active !== "boolean" || !intent.id)) {
    throw new Error("Saved goal continuation intent is invalid. Inspect it before resuming.");
  }
  if (intent?.active && goalStopRequestFor(session) === intent.id) return { ...intent, active: false, error: null };
  return intent;
}

async function changeGoalIntent(sessionId, context, change) {
  const store = context.runtime.store;
  const result = await store.runSessionExclusive(sessionId, "assistant-settings", async () => {
    const session = await context.runtime.getSessionWithoutSource(sessionId);
    const latest = readGoalIntent(session);
    const stopRequested = Boolean(goalStopRequestFor(session));
    const changed = change(latest) || (stopRequested ? latest : null);
    if (changed) await store.writeMetadataValue(sessionId, "assistant_goal_intent", JSON.stringify(changed));
    if (stopRequested) await store.writeMetadataValue(sessionId, GOAL_STOP_REQUEST, "null");
  }, { operation: "save-goal-continuation", waitMs: 10_000 });
  if (!result.acquired) throw goalRefusal("vibe64_goal_settings_busy");
}

/**
 * A session's goal: reading and updating it under the agent write, the goal intents this process
 * admitted, stopping and completing them, cancelling a goal when the main AI changed, and recovering
 * or continuing active goals.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ServiceAssistantPreparation} dependencies.assistantPreparation
 * @param {ActionCatalogue} dependencies.actions
 * @param {AssistantRouting} dependencies.assistantRouting
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {ReadRoutingConfiguration} dependencies.readRoutingConfiguration
 * @param {SessionAgentManager} dependencies.sessionAgent
 */
function createServiceGoals({
  state,
  sessionAccess,
  assistantContext,
  assistantPreparation,
  actions,
  assistantRouting,
  logger,
  project,
  publishAgentSessionChanged,
  readRoutingConfiguration,
  sessionAgent
}) {
  const goalRuntimeId = randomUUID();
  const goalAdmissions = new Map();

  /**
   * Cancel answers without waiting for the goal settings lock: it stops a goal admission at once,
   * records the stop, and saves it under that lock afterwards. Shutdown waits for that save.
   */
  async function requestGoalStop(sessionId, context) {
    const intent = readGoalIntent(await context.runtime.getSessionWithoutSource(sessionId));
    if (!intent?.active) return;
    goalAdmissions.get(intent.id)?.abort(new Error("Goal continuation was stopped before dispatch."));
    await context.runtime.store.writeMetadataValue(
      sessionId,
      GOAL_STOP_REQUEST,
      JSON.stringify({ intentId: intent.id, requestedAt: new Date().toISOString() })
    );
    const saving = changeGoalIntent(sessionId, context, () => null).catch(error => logIntentClearFailure(logger, sessionId, error));
    void state.trackShutdownWork(saving);
  }

  async function stopGoalIntent(sessionId, context, expectedId) {
    await changeGoalIntent(sessionId, context, intent => {
      if (!intent?.active || expectedId && intent.id !== expectedId) return null;
      goalAdmissions.get(intent.id)?.abort(new Error("Goal continuation was stopped before dispatch."));
      return { ...intent, active: false, error: null };
    });
  }

  async function completeGoalIntent(sessionId, context, intent, result) {
    if (!intent || result?.ok === false || !result.goal) return;
    // Explicit Stop/Pause can run while native acknowledgement is outstanding.
    await changeGoalIntent(sessionId, context, latest => {
      if (!latest?.active || latest.id !== intent.id) return null;
      if (latest.pending?.messageId && latest.selection?.engineId === "claude" &&
          result.goalCommandId !== claudeNativeMessageId(latest.pending.messageId)) {
        throw goalRefusal("vibe64_goal_command_attachment_pending");
      }
      const segment = latest.pending?.expectedSegmentId;
      const prefix = `${latest.selection?.engineId}:`;
      const threadId = result.threadId || result.goal.threadId || latest.native?.threadId ||
        (typeof segment === "string" && segment.startsWith(prefix) ? segment.slice(prefix.length) : null);
      if (!threadId) throw new Error("The accepted goal's native conversation identity is unavailable.");
      return {
        ...latest,
        daemonId: goalRuntimeId,
        pending: null,
        error: null,
        native: { threadId, createdAt: result.goal.createdAt, objective: result.goal.objective },
        active: !goalStatusIsComplete(result.goal.status)
      };
    });
  }

  /**
   * A goal never continues on a main AI the owner has since replaced in AI
   * setup: the next time it would continue, it is cancelled through the
   * ordinary Cancel goal path and the chat says why. A Custom goal runs the
   * person's own model, and a paused goal is checked when it is resumed.
   */
  async function cancelGoalIfMainAiChanged(sessionId, vibe64User = null, options = {}) {
    const { activeOnly = false } = options;
    const context = await assistantContext.assistantSessionOptions(sessionId, { vibe64User });
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    if (!pinned || pinned.mode === "custom") return false;
    if (activeOnly ? pinned.status !== "active" : goalStatusIsComplete(pinned.status)) return false;
    if (!assistantMainAiChanged(pinned.configuration?.owner, (await readRoutingConfiguration()).owner)) return false;
    const observed = await readAgentGoal(sessionId, context);
    if (observed?.status !== "available" || !observed.goal || goalStatusIsComplete(observed.goal.status)) return false;
    const result = await updateAgentGoal(sessionId, {
      vibe64User,
      action: "cancel",
      threadId: observed.threadId,
      createdAt: observed.goal.createdAt,
      objective: observed.goal.objective
    });
    if (result?.ok === false) throw Object.assign(new Error(result.error || "The goal could not be cancelled."), result);
    const turn = await context.runtime.store.writeConversationSystemMessage(sessionId, {
      messageId: `main-ai-changed-goal-cancelled:${randomUUID()}`,
      text: MAIN_AI_CHANGED_GOAL_NOTICE
    });
    await publishAgentSessionChanged(sessionId, {
      reason: "assistant-routing-changed",
      ...(turn ? { payload: { conversationLogPatch: { type: "upsert-turn", turn } } } : {})
    });
    return true;
  }

  async function recoverSessionGoal(sessionId) {
    let context = await assistantContext.assistantSessionOptions(sessionId);
    let intent = readGoalIntent(context.session);
    if (!intent?.active || intent.daemonId === goalRuntimeId || sessionIsClosing(context.session) ||
        context.session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) return { sessionId, skipped: true };
    requireCompletedNativeConversationReplacement(context.session);
    requireCompletedConversationRewind(context.session);
    if (!Object.hasOwn(intent, "connectionIdentity")) {
      throw new Error("Goal preparation was interrupted before its AI connection was verified. Resume the intended goal explicitly.");
    }
    const actor = await state.assistantRuntime.authorizeProjectMessage(intent.actor, sessionAccess.projectRuntimeContext().projectSlug);
    const pin = assistantRoutingGoalFromMetadata(context.session.metadata);
    context = {
      ...context,
      vibe64User: actor,
      assistantSelection: pin?.selection || intent.selection,
      expectedConnectionIdentity: intent.connectionIdentity
    };
    await sessionAgent.requireAssistantAccess(sessionId, context);
    // Native reconciliation retains custody until the previous execution is
    // verified stopped. It never starts inference or resumes a goal itself.
    const recovered = await sessionAgent.reconcileSessions([context.session], context);
    const failed = value => value?.ok === false || value?.failed?.length || value?.results?.some(failed);
    if (failed(recovered)) throw new Error("The goal's previous execution could not be verified stopped.");
    const native = await sessionAgent.readGoal(sessionId, context);
    if (native.status !== "available") throw new Error("The goal is unavailable after restart. Retry its status before resuming.");
    if (intent.pending) {
      const messageId = intent.pending.messageId;
      let accepted = messageId && await context.runtime.store.conversationMessageIdExists(sessionId, messageId);
      let receipt = null;
      if (!accepted && messageId) {
        // An inspection that fails decides nothing: the delivery stays uncertain.
        receipt = await sessionAgent.inspectMessageAdmission(sessionId, { messageId, threadId: native.threadId }, context)
          .catch(() => null);
        accepted = receipt?.ok !== false && receipt?.admission === "accepted";
      }
      if (!accepted && receipt?.ok !== false && receipt?.admission === "not-admitted") {
        throw new Error("The interrupted goal command never reached the AI, so nothing was sent. Set or resume the goal again.");
      }
      if (!accepted) throw new Error("The interrupted goal command's delivery is uncertain. Check its original receipt before resuming.");
      // The native history owner links this attachment to the exact authored
      // command. Its condition text alone is never sufficient for adoption.
      if (intent.selection?.engineId === "claude") {
        if (!native.goal || native.goalCommandId !== claudeNativeMessageId(messageId)) {
          throw new Error(
            "The accepted goal command is still waiting for its own native goal attachment. Check its original receipt before retrying."
          );
        }
        await completeGoalIntent(sessionId, context, intent, native);
        const latest = readGoalIntent(await context.runtime.getSessionWithoutSource(sessionId));
        if (latest?.id !== intent.id) throw new Error("Goal continuation changed while its attachment was being checked.");
        intent = latest;
      }
    }
    if (!native.goal || goalStatusIsComplete(native.goal.status)) {
      // An unresolved Set may have been accepted without its goal attachment
      // reaching storage. Its existing receipt must not be replaced by a send.
      if (intent.pending) throw new Error("The interrupted goal command needs its saved delivery receipt checked.");
      await stopGoalIntent(sessionId, context, intent.id);
      return { sessionId, completed: true };
    }
    if (!intent?.active || intent.native?.threadId !== native.threadId ||
        intent.native?.createdAt !== native.goal.createdAt || intent.native?.objective !== native.goal.objective) {
      throw new Error("The native goal changed after continuation was requested. Resume the intended goal explicitly.");
    }
    // A blocked goal, one out of credit or at its budget, gets no turn: the person resumes it. One waiting at its
    // usage limit gets none now either: it continues once the limit has reset, at once when it already has.
    if (native.goal.status === "blocked") return { sessionId, blocked: true, reason: native.goal.reason };
    if (native.goal.status === "budgetLimited") return { sessionId, waiting: true, status: native.goal.status };
    if (native.goal.status === "usageLimited") {
      const continuesAt = await limitReset.scheduleGoal(sessionId, context, intent, native.goal);
      const resumesAt = continuesAt === null ? {} : { resumesAt: Math.ceil(continuesAt / 1000) };
      return { sessionId, waiting: true, status: native.goal.status, ...resumesAt };
    }
    if (native.goal.status === "active") {
      const current = await sessionAgent.sessionState(sessionId, context);
      if (current?.ok !== false && current.turn?.active === true && current.thread?.id === native.threadId) {
        await completeGoalIntent(sessionId, context, intent, native);
        return { sessionId, alreadyActive: true };
      }
    }
    const observed = await readCanonicalAgentGoal(sessionId, { vibe64User: actor });
    if (!observed.goal || goalStatusIsComplete(observed.goal.status)) return { sessionId, completed: true };
    const result = await writeAgentGoal(sessionId, {
      action: "resume",
      vibe64User: actor,
      expectedSegmentId: observed.target.segmentId,
      expectedGoalId: observed.goal.id,
      messageId: `goal-restart-${randomUUID()}`
    }, { canonical: true, restartIntentId: intent.id });
    if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
    if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
    return { sessionId, resumed: true };
  }

  // A goal waiting at its AI account's usage limit continues by itself once the limit has reset.
  const limitReset = createServiceGoalLimitReset({
    state,
    logger,
    project,
    sessionAccess,
    assistantContext,
    sessionAgent,
    publishAgentSessionChanged,
    retryDelaysMs: GOAL_RECOVERY_RETRY_DELAYS_MS,
    readGoalIntent,
    changeGoalIntent,
    readCanonicalAgentGoal,
    writeAgentGoal
  });
  state.lifecycle.goalLimitReset = limitReset;
  // The person's chat messages continue a goal: after Stop, and when they ask Main Claude to resume it.
  const chatContinuation = createServiceGoalChatContinuation({
    state,
    logger,
    sessionAccess,
    assistantContext,
    sessionAgent,
    goalRuntimeId,
    readGoalIntent,
    changeGoalIntent,
    readCanonicalAgentGoal,
    writeAgentGoal
  });

  async function applyAgentGoalReadResult(sessionId, context, result) {
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    const recoveryError = readGoalIntent(context.session)?.error;
    if (recoveryError) result = { ...result, error: recoveryError };
    if (result.goal) result = { ...result, goal: limitReset.withResumeTime(sessionId, context.session, result.goal) };
    if (result.status === "available" && (!result.goal || goalStatusIsComplete(result.goal.status))) {
      const intent = readGoalIntent(context.session);
      if (intent?.active && !intent.pending) await stopGoalIntent(sessionId, context, intent.id);
    }
    if (pinned && result.status === "available") {
      // A new goal can become visible before Set acknowledgement saves its pin.
      // Only accepted Set/Resume may replace or reactivate a completed pin.
      if (result.goal && (assistantGoalObjective(result.goal.objective, pinned) !== pinned.objective ||
          goalStatusIsComplete(pinned.status) && !goalStatusIsComplete(result.goal.status))) return result;
      const status = result.goal?.status || "complete";
      if (pinned.status !== status) {
        await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({ ...pinned, status }));
        await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      }
      if (result.goal) {
        return {
          ...result,
          goal: {
            ...result.goal,
            objective: assistantGoalObjective(result.goal.objective, pinned)
          },
          routing: { mode: pinned.mode, selection: pinned.selection }
        };
      }
    }
    return result;
  }

  async function readAgentGoal(sessionId, options = {}) {
    const context = await assistantContext.assistantSessionOptions(sessionId, options);
    const result = await sessionAgent.readGoal(sessionId, { ...context, canonicalGoal: false });
    return applyAgentGoalReadResult(sessionId, context, result);
  }

  /**
   * Reads the goal of the session's canonical Main conversation, with the target its update must name.
   * @param {string} sessionId
   * @param {object} [options]
   */
  async function readCanonicalAgentGoal(sessionId, options = {}) {
    const context = await assistantContext.assistantSessionOptions(sessionId, options);
    let view;
    let target;
    const result = await sessionAgent.readGoal(sessionId, {
      ...context,
      canonicalGoal: true,
      async onGoalResult(nativeResult, readTarget) {
        view = await applyAgentGoalReadResult(sessionId, context, nativeResult);
        target = readTarget;
      }
    });
    return {
      status: view.status,
      goal: result ? { ...limitReset.withResumeTime(sessionId, context.session, result), objective: view.goal.objective } : null,
      target,
      ...(view.routing ? { routing: view.routing } : {}),
      ...(view.error ? { error: view.error } : {})
    };
  }

  /** Updates the goal of the session's Main conversation. */
  function updateAgentGoal(sessionId, input) {
    return writeAgentGoal(sessionId, input, { canonical: false });
  }

  /**
   * Updates the goal of the session's canonical Main conversation at the target its read observed.
   * @param {string} sessionId
   * @param {object} input
   */
  function updateCanonicalAgentGoal(sessionId, input) {
    return writeAgentGoal(sessionId, input, { canonical: true });
  }

  /**
   * The one goal write behind the two update methods. A goal restart names its intent; so does a Resume asked for in
   * chat (continuesIntentId), which also waits for the turn's other follow-up work and is withdrawn when that intent is
   * no longer active, but continues on the current AI connection as Resume goal does.
   */
  async function writeAgentGoal(sessionId, input, options) {
    const { canonical, restartIntentId = null, continuesIntentId = restartIntentId } = options;
    if (input.action === "resume" && await cancelGoalIfMainAiChanged(sessionId, input.vibe64User || null)) {
      return { ok: false, code: "vibe64_goal_main_ai_changed", error: MAIN_AI_CHANGED_GOAL_NOTICE };
    }
    if (["set", "resume"].includes(input.action)) {
      assertProjectEffectAdmission();
      return sessionAccess.runMainAgentWrite(sessionId, input, async (context) => {
        requireCompletedConversationRewind(context.session);
        const previousIntent = readGoalIntent(context.session);
        if (continuesIntentId && (!previousIntent?.active || previousIntent.id !== continuesIntentId || state.lifecycle.closing)) {
          throw new Error("Goal continuation was stopped before recovery.");
        }
        if (input.action === "set" && assistantRoutingFromMetadata(context.session.metadata)?.mode === "auto") {
          return {
            ok: false,
            code: "vibe64_goal_explicit_mode_required",
            error: "Choose Senior or Junior before starting or resuming a goal."
          };
        }
        const pendingRoute = assistantRoutingRequestFromMetadata(context.session.metadata);
        if (assistantRoutingRequestIsUnresolved(pendingRoute, vibe64AssistantSelectionFromMetadata(context.session.metadata)) ||
            pendingRoute?.helper) {
          return { ok: false, error: "Finish or cancel the pending request before starting a goal." };
        }
        const changeover = JSON.parse(context.session.metadata?.assistant_changeover || "null");
        const engineId = vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId;
        if (changeover && changeover.lastEngine !== engineId) {
          return {
            ok: false,
            code: "vibe64_changeover_message_required",
            error: "Send a message to catch this AI up before starting or resuming its goal."
          };
        }
        const duplicate = canonical && input.messageId &&
          await context.runtime.store.conversationMessageIdExists(sessionId, input.messageId);
        let intent;
        let admission;
        let dispatched = false;
        try {
          if (!duplicate) {
            const actor = context.vibe64User || currentProjectRequestContext()?.vibe64User;
            intent = {
              version: 1,
              id: randomUUID(),
              active: true,
              daemonId: goalRuntimeId,
              restartOf: restartIntentId,
              actor: actor ? { username: actor.username, role: actor.role } : null,
              pending: canonical ? {
                action: input.action,
                messageId: input.messageId || null,
                expectedSegmentId: input.expectedSegmentId,
                expectedGoalId: input.expectedGoalId || null,
                objective: input.objective || previousIntent?.native?.objective
              } : null,
              native: input.action === "resume" ? previousIntent?.native || null : null
            };
            admission = new AbortController();
            goalAdmissions.set(intent.id, admission);
            await changeGoalIntent(sessionId, context, latest => {
              if (latest?.id !== previousIntent?.id || latest?.active !== previousIntent?.active) {
                throw goalRefusal("vibe64_goal_changed_before_preparation");
              }
              return intent;
            });
          }
          await assistantPreparation.prepareAgentSkillsInsideAgentWrite(sessionId, context);
          const prepared = await assistantRouting.prepareGoal(sessionId, input, context);
          const goalSelection = prepared.pinned?.selection || vibe64AssistantSelectionFromMetadata(context.session.metadata);
          const connectionIdentity = prepared.pinned?.connectionIdentity ??
            (await sessionAgent.requireAssistantAccess(sessionId, { ...context, assistantSelection: goalSelection })).connectionIdentity;
          if (restartIntentId && previousIntent.connectionIdentity !== (connectionIdentity ?? null)) {
            throw new Error("The goal's AI connection changed. Resume it explicitly with the intended account.");
          }
          if (state.lifecycle.closing) throw goalRefusal("vibe64_goal_server_stopping", 503);
          if (intent) {
            const actor = await state.assistantRuntime.resolveAssistantUser(
              context.vibe64User || currentProjectRequestContext()?.vibe64User
            );
            // Set/Resume are admitted user requests too. Retain only CONTROL
            // identity, so each later goal tool rechecks current project access.
            const requestMeta = currentProjectActionRequestMeta();
            if ((actor || requestMeta) && !prepared.context.browserAuthority) {
              const projectSlug = sessionAccess.projectRuntimeContext().projectSlug;
              const requestContext = requestMeta ? { surface: "app", channel: "internal", requestMeta }
                : await state.assistantRuntime.createActionContext(actor);
              const grant = await actions.execute({
                actionId: "vibe64.sessions.conversation.context.read",
                input: { projectSlug, sessionId },
                context: requestContext
              });
              prepared.context.browserAuthority = {
                sessionId,
                projectSlug,
                actorId: grant.actor.id,
                requestContext
              };
            }
            await changeGoalIntent(sessionId, context, latest => {
              if (!latest?.active || latest.id !== intent.id) throw goalRefusal("vibe64_goal_stopped_during_preparation");
              return {
                ...latest,
                actor: actor ? { username: actor.username, role: actor.role } : null,
                connectionIdentity: connectionIdentity ?? null,
                selection: goalSelection,
                pending: latest.pending ? { ...latest.pending, objective: prepared.input.objective || prepared.pinned?.objective } : null
              };
            });
          }
          const completeResult = async result => {
            if (result?.ok !== false && prepared.pinned) {
              const commit = async () => {
                const latest = await assistantContext.assistantSessionOptions(sessionId, { ...context, session: undefined });
                const previousPin = context.session.metadata.assistant_routing_goal;
                const latestPin = latest.session.metadata.assistant_routing_goal;
                // A settings save can finish while the native goal command is
                // awaiting acknowledgement. Keep its newer pin, then apply any
                // preferences saved before the native goal became observable.
                if (latestPin === previousPin) {
                  await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify(prepared.pinned));
                } else if (JSON.parse(latestPin || "null")?.objective !== prepared.pinned.objective) {
                  return;
                }
                if (latest.session.metadata.assistant_routing !== context.session.metadata.assistant_routing) {
                  const refreshed = await assistantContext.assistantSessionOptions(sessionId, { ...context, session: undefined });
                  const preferences = assistantRoutingFromMetadata(refreshed.session.metadata);
                  if (preferences) await assistantRouting.applyGoalSelection(sessionId, null, preferences, refreshed);
                }
              };
              const committed = await context.runtime.store.runSessionExclusive(
                sessionId,
                "assistant-settings",
                commit,
                { operation: "apply-started-goal-settings", waitMs: 10_000 }
              );
              if (!committed.acquired) {
                throw goalRefusal("vibe64_goal_settings_saving");
              }
            }
            await completeGoalIntent(sessionId, context, intent, result);
            // The command's turn can meet the usage limit, and end, before its goal is saved as accepted.
            if (intent && result?.ok !== false) void state.trackShutdownWork(limitReset.continueWhenLimitResets(sessionId));
            return result;
          };
          dispatched = true;
          const result = await sessionAgent.updateGoal(sessionId, prepared.input, {
            ...assistantContext.applicationToolManifest(prepared.context),
            canonicalGoal: canonical,
            signal: admission?.signal,
            ...(canonical ? { onGoalResult: completeResult } : {})
          });
          return canonical ? result : await completeResult(result);
        } catch (error) {
          if (intent && (!dispatched || error.delivery === "not-sent")) {
            await changeGoalIntent(sessionId, context, latest => latest?.active && latest.id === intent.id
              ? previousIntent || { ...latest, active: false } : null);
          }
          throw error;
        } finally {
          if (intent) goalAdmissions.delete(intent.id);
        }
      }, {
        operation: input.action === "set" ? "set-agent-goal" : "resume-agent-goal",
        ...(continuesIntentId ? { waitMs: AGENT_WRITE_WAIT_MS } : {})
      });
    }
    const context = await assistantContext.assistantSessionOptions(sessionId, input);
    const pinned = assistantRoutingGoalFromMetadata(context.session.metadata);
    // Validate the selected goal before recording the person's stop intent.
    // Native cleanup may fail, but a restart must never undo that intent.
    if (["pause", "cancel"].includes(input.action)) {
      const current = canonical
        ? await readCanonicalAgentGoal(sessionId, context)
        : await readAgentGoal(sessionId, context);
      const same = canonical
        ? current.target?.segmentId === input.expectedSegmentId && current.goal?.id === input.expectedGoalId
        : current.threadId === input.threadId && current.goal?.createdAt === input.createdAt && current.goal?.objective === input.objective;
      const capturedIntent = readGoalIntent(context.session);
      if (same && capturedIntent) await stopGoalIntent(sessionId, context, capturedIntent.id);
    }
    const completeResult = async result => {
      if (result?.ok !== false && result.status === "available" && pinned) {
        await context.runtime.store.writeMetadataValue(sessionId, "assistant_routing_goal", JSON.stringify({
          ...pinned,
          status: result.goal?.status || "complete"
        }));
        await publishAgentSessionChanged(sessionId, { reason: "assistant-routing-changed" });
      }
      return result;
    };
    let nativeInput = input;
    if (!canonical && pinned && input.objective === pinned.objective) {
      const observed = await sessionAgent.readGoal(sessionId, context);
      if (observed?.status === "available" && assistantGoalObjective(observed.goal?.objective, pinned) === input.objective) {
        nativeInput = { ...input, objective: observed.goal.objective };
      }
    }
    const result = await sessionAgent.updateGoal(
      sessionId,
      nativeInput,
      { ...context, canonicalGoal: canonical, ...(canonical ? { onGoalResult: completeResult } : {}) }
    );
    return canonical ? result : completeResult(result);
  }

  /**
   * A Codex account change pauses a goal whose turn is still running on the
   * previous account, so that runtime starts no further turn. Once it has
   * stopped, the goal resumes on the current account as the person who set it.
   */
  async function continueGoalAfterAccountChange(sessionId, options = {}) {
    const { threadId = "" } = options;
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const intent = readGoalIntent(context.session);
    if (!intent?.active || !threadId || intent.native?.threadId !== threadId || state.lifecycle.closing ||
        sessionIsClosing(context.session)) return { sessionId, skipped: true };
    try {
      const actor = await state.assistantRuntime.authorizeProjectMessage(intent.actor, sessionAccess.projectRuntimeContext().projectSlug);
      const observed = await readCanonicalAgentGoal(sessionId, { vibe64User: actor });
      if (observed.goal?.status !== "paused") return { sessionId, skipped: true };
      const result = await updateCanonicalAgentGoal(sessionId, {
        action: "resume",
        vibe64User: actor,
        expectedSegmentId: observed.target.segmentId,
        expectedGoalId: observed.goal.id,
        messageId: `goal-account-change-${randomUUID()}`
      });
      if (result?.ok === false) throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
      return { sessionId, resumed: true };
    } catch (error) {
      logOperationalEvent(
        logger,
        "warn",
        {
          event: "vibe64.agent_goal.account_change_continue_failed",
          component: "vibe64.agent_goal",
          projectSlug: sessionAccess.projectRuntimeContext().projectSlug,
          sessionId,
          actor: String(intent.actor?.username || ""),
          code: error.code,
          error: error.message
        },
        "A goal paused by an account change could not resume; it stays paused."
      );
      return { sessionId, ok: false, code: error.code, error: error.message };
    }
  }

  const recoverActiveGoals = createServiceGoalRecovery({
    state, logger, project, sessionAccess, assistantContext, recoverSessionGoal, readGoalIntent, changeGoalIntent
  });

  async function applyGoalSelection(sessionId, selection, preferences, context) {
    const result = await assistantRouting.applyGoalSelection(sessionId, selection, preferences, context);
    logOperationalEvent(logger, "info", {
      event: "vibe64.assistant_settings.updated",
      component: "vibe64.agent_settings",
      sessionId,
      engineId: selection.engineId,
      modelId: selection.modelId,
      mode: preferences.mode,
      goalSettings: result
    }, "Assistant settings prepared for subsequent turns.");
    return result;
  }

  return Object.freeze({
    applyGoalSelection,
    cancelGoalIfMainAiChanged,
    continueGoalAfterAccountChange,
    continueGoalIntentAfterMessage: chatContinuation.continueAfterMessage,
    continueGoalWhenLimitResets: limitReset.continueWhenLimitResets,
    readAgentGoal,
    readCanonicalAgentGoal,
    readGoalIntent,
    recoverActiveGoals,
    requestGoalResume: chatContinuation.requestResume,
    requestGoalStop,
    resumeGoalAfterTurn: chatContinuation.resumeAfterTurn,
    stopGoalIntent,
    updateAgentGoal,
    updateCanonicalAgentGoal
  });
}

export {
  createServiceGoals
};
