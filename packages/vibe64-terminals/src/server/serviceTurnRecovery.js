/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";
import { owesStep } from "./assistantRoutingRequests.js";

// After a restart the AI can still be busy or slow to start, so a pass that could not check every session runs again
// after each of these delays, as goal recovery does.
const TURN_RECOVERY_RETRY_DELAYS_MS = Object.freeze([30_000, 2 * 60_000, 10 * 60_000]);

/**
 * A recovery pass's start, in the operational log. Production logs at warn, and a restart's recovery is what an
 * operator reads after an incident, so its lines are warnings: a pass that found nothing says so too.
 */
function logRecoveryPass(logger, component, event, fields, message) {
  logOperationalEvent(logger, "warn", { component, event: `${component}.${event}`, ...fields }, message);
}

/**
 * A pass's outcome for each session that had something to recover, then its totals and each session it skipped, with
 * why, so an operator reads why a session was not resumed.
 * @param {RuntimeLogger} logger
 * @param {string} component
 * @param {Array<Record<string, any>>} results
 * @param {(result: Record<string, any>) => boolean} nothingToDo the results that only count
 */
function logRecoveryResults(logger, component, results, nothingToDo) {
  const totals = {};
  for (const result of results) {
    const outcome = result.ok === false ? "failed" : Object.keys(result).find(name =>
      result[name] === true && !["ok"].includes(name)) || "checked";
    totals[outcome] = (totals[outcome] || 0) + 1;
    if (result.ok === false || nothingToDo(result)) continue;
    const reason = result.reason ? ` (${result.reason})` : "";
    logRecoveryPass(logger, component, "recovery_outcome", { ...result, outcome }, `After the restart: ${outcome}${reason}.`);
  }
  logRecoveryPass(
    logger,
    component,
    "recovery_finished",
    {
      sessions: results.length,
      totals,
      skipped: results.filter(result => result.skipped === true).map(({ projectSlug, sessionId, chat, reason }) =>
        ({ projectSlug, sessionId, ...(chat ? { chat } : {}), reason }))
    },
    "Vibe64 finished checking for work the previous server was running."
  );
}

/**
 * Whether a chat's request was at work when an earlier server ended: being sent, or its turn running (and the
 * person had not stopped it), or waiting out the short wait before Vibe64 resumes it, or owing a step another turn
 * came before (assistantRoutingOwedSteps.js).
 * @param {Record<string, string> | undefined} metadata the chat's routing metadata
 */
function requestWasWorking(metadata) {
  const request = assistantRoutingRequestForDisplay(metadata || {});
  if (!request || request.stopped === true) return false;
  // A resume waiting out its backoff, or a step owed to a turn that came first, whose end the next server decides.
  if (request.status === "waiting") return Boolean(request.resumeAt && request.followup) || owesStep(request);
  return request.status === "working" && ["accepted", "pending", "sending", "routing", "uncertain"].includes(request.delivery);
}

/**
 * Whether a session's Main chat was at work when an earlier server ended: its request, or an agent run that still
 * says it is working, unless restart recovery stopped that request and it has not been sent again since
 * (assistantRoutingInterruptions.js stopUnrecovered).
 * @param {{ metadata?: Record<string, string>, agentRuns?: object[] }} session
 */
function sessionWasWorking(session) {
  const request = assistantRoutingRequestForDisplay(session.metadata || {});
  if (request?.serverRunId && request.recoveryStopped === request.serverRunId) return false;
  return requestWasWorking(session.metadata) || sessionHasActiveAgentRun(session);
}

/**
 * The restart recovery of the open projects' chat turns: each Main chat and temporary chat whose AI was at work when
 * the previous server ended is reconciled now, instead of when someone next opens it, as the person it ran for (the
 * request's sender). Reconciliation stops what is left of the old turn and ends it; routing then writes the red entry
 * and resumes the turn once, or says why not (assistantRoutingOutcomes.js). Its stale "working" state, which Save,
 * Update and the session list read, ends with it. After a planned restart (@local/vibe64-core/server/plannedRestart),
 * a chat its notice told whose turn ended before the restart, as an AI does once it has written where it is, goes on
 * too, once, with the restart's note, unless the person stopped it; a chat that was at work is resumed as an
 * interrupted turn alone. A temporary chat that holds an AI task is its task's to continue (vibe64-ai-tasks), and a
 * goal's turn its goal recovery's. The last pass stops a turn it could not settle, such as one whose sender the
 * project no longer authorizes: it waits for Continue with its red entry saying why, once, so no later restart tries
 * it again unseen. A turn the server before still runs is left to it.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {(sessionId: string, options: object) => Promise<object>} dependencies.ensureAgentSession
 * @param {AssistantRouting} dependencies.mainChatRouting Main chat's routing: it stops a turn the last pass could not
 *   settle, and resumes a chat after a planned restart
 * @param {SessionConversations} dependencies.sessionConversations the temporary chats: their reconciliation, and the
 *   same two operations
 * @param {{ toldBeforeRestart: (chat: { sessionId: string, conversationId: string }) => Promise<boolean> }}
 *   dependencies.plannedRestart the planned restart reader: the chats the notice this server restarted for told
 * @param {import("./types.js").ServerRun} dependencies.serverRun
 */
function createServiceTurnRecovery({
  state,
  logger,
  project,
  sessionAccess,
  assistantContext,
  ensureAgentSession,
  mainChatRouting,
  sessionConversations,
  plannedRestart,
  serverRun
}) {
  /** Stops a chat's turn the last pass could not settle ("" is Main chat). */
  const stopUnrecoveredTurn = (sessionId, conversationId, input) => (conversationId
    ? sessionConversations.stopUnrecoveredTemporaryTurn(sessionId, { conversationId }, input)
    : mainChatRouting.stopUnrecovered(sessionId, {}, input));
  /** Resumes a chat the planned restart's notice told whose turn ended before it, and says what it did. */
  const resumeAfterPlannedRestart = (sessionId, conversationId, options) => (conversationId
    ? sessionConversations.resumeTemporaryTurnAfterPlannedRestart(sessionId, { ...options, conversationId })
    : mainChatRouting.resumeAfterPlannedRestart(sessionId, options));

  async function actorFor(request) {
    const sender = request?.submittedBy || null;
    return sender
      ? state.assistantRuntime.authorizeProjectMessage(sender, sessionAccess.projectRuntimeContext().projectSlug)
      : null;
  }

  /** A request an earlier server still running sent is that server's: this pass is retried after it exits. */
  async function stillRunning(request) {
    if (await serverRun.isRunning(request?.serverRunId || "")) {
      throw Object.assign(
        new Error("The server that sent this turn is still stopping; Vibe64 tries again shortly."),
        { code: "vibe64_turn_previous_server_running" }
      );
    }
  }

  /**
   * Settles each chat of a session whose turn was at work, as the person it ran for. A chat that cannot be settled is
   * reported, and on the last pass stopped, while the session's other chats go on.
   * @param {string} sessionId
   * @param {boolean} last whether no pass follows this one
   */
  async function recoverSessionTurns(sessionId, last) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const session = context.session;
    if (sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
      return [{ sessionId, skipped: true, reason: "session-not-open" }];
    }
    const results = [];
    // reconcile's result is what it did, or nothing when it reconciled the chat.
    const recover = async (chat, request, reconcile) => {
      try {
        await stillRunning(request);
        results.push({ sessionId, chat, ...(await reconcile(await actorFor(request)) || { reconciled: true }) });
      } catch (error) {
        const stops = last && error?.code !== "vibe64_turn_previous_server_running";
        const stopped = stops && await stopUnrecoveredTurn(sessionId, chat === "main" ? "" : chat, {
          messageId: request?.messageId || "",
          error: String(error?.message || "The turn could not be recovered.").slice(0, 500)
        }).catch(() => false);
        results.push({ sessionId, chat, ok: false, code: error?.code, error: error?.message, ...(stopped ? { stopped: true } : {}) });
      }
    };
    /**
     * One chat: at work, it is reconciled, which is also its resume after a planned restart; otherwise a chat the
     * planned restart's notice told goes on, unless the person stopped it. Routing resumes it once: a request this
     * server has sent since is not resumed again.
     */
    const settle = async (chat, conversationId, request, working, reconcile) => {
      if (working) return recover(chat, request, reconcile);
      if (!await plannedRestart.toldBeforeRestart({ sessionId, conversationId })) return undefined;
      if (request?.stopped === true) {
        results.push({ sessionId, chat, skipped: true, reason: "stopped-by-person" });
        return undefined;
      }
      return recover(chat, request, actor => resumeAfterPlannedRestart(sessionId, conversationId, actor ? { vibe64User: actor } : {}));
    };
    await settle("main", "", assistantRoutingRequestForDisplay(session.metadata), sessionWasWorking(session), async actor => {
      const result = await ensureAgentSession(sessionId, actor ? { vibe64User: actor } : {});
      if (result?.ok === false) {
        throw Object.assign(new Error(result.error || "The session's AI could not be reconciled."), { code: result.code });
      }
    });
    for (const record of await context.runtime.store.listSessionConversations(sessionId)) {
      if (record.state === "closing" || record.task) continue;
      const { conversationId, routingMetadata } = record;
      const request = assistantRoutingRequestForDisplay(routingMetadata);
      await settle(conversationId, conversationId, request, requestWasWorking(routingMetadata), async actor => {
        await sessionConversations.reconcileTemporaryConversation(sessionId, { conversationId, ...(actor ? { vibe64User: actor } : {}) });
      });
    }
    return results.length ? results : [{ sessionId, skipped: true, reason: "nothing-working" }];
  }

  /** @param {boolean} retrying whether another pass follows this one */
  async function recoverTurnsPass(retrying) {
    const results = [];
    const reportFailure = result => {
      results.push(result);
      logOperationalEvent(logger, "warn", {
        ...result,
        event: "vibe64.turn_resume.recovery_failed",
        component: "vibe64.turn_resume"
      }, "A turn interrupted by the previous server needs attention after restart.");
    };
    const failure = (error, target) => ({ ...target, ok: false, code: error?.code, error: error?.message });
    const listed = await project.listProjects();
    if (listed?.ok === false) throw new Error(listed.error || "Turn recovery could not list projects.");
    const openProjects = openProjectRuntimeRecords(listed);
    logRecoveryPass(logger, "vibe64.turn_resume", "recovery_started", {
      retrying, serverRunId: serverRun.id, openProjects: openProjects.map(record => record.slug)
    }, "Vibe64 is checking the open projects for AI turns the previous server was running.");
    for (const projectRecord of openProjects) {
      if (state.lifecycle.closing) break;
      try {
        await project.runInProjectContext(projectRecord.slug, async () => {
          for (const session of await sessionAccess.listOpenProjectRuntimeSessions()) {
            if (state.lifecycle.closing) break;
            try {
              for (const result of await recoverSessionTurns(session.sessionId, !retrying)) {
                const row = { projectSlug: projectRecord.slug, ...result };
                if (row.ok === false) reportFailure(row);
                else results.push(row);
              }
            } catch (error) {
              reportFailure(failure(error, { projectSlug: projectRecord.slug, sessionId: session.sessionId }));
            }
          }
        });
      } catch (error) {
        reportFailure(failure(error, { projectSlug: projectRecord.slug }));
      }
    }
    logRecoveryResults(logger, "vibe64.turn_resume", results, result => result.reason === "nothing-working");
    return { ok: results.every(result => result.ok !== false), results };
  }

  /**
   * Run once per server after every feature has booted, beside goal recovery. A session it could not reconcile is
   * tried again after each retry delay, and the last pass stops a turn it still cannot settle; one already reconciled
   * is no longer working and is skipped, so no turn is resumed twice. Shutdown cancels the next pass.
   */
  function recoverInterruptedTurns({ retryDelaysMs = TURN_RECOVERY_RETRY_DELAYS_MS } = {}) {
    if (state.lifecycle.turnRecovery) return state.lifecycle.turnRecovery;
    const retryAfter = (failed, delays) => {
      if (!failed || !delays.length || state.lifecycle.closing) return;
      const [delay, ...later] = delays;
      state.lifecycle.turnRecoveryTimer = setTimeout(() => {
        if (state.lifecycle.closing) return;
        state.lifecycle.turnRecoveryRetry = recoverTurnsPass(later.length > 0).then(result => retryAfter(!result.ok, later), error => {
          logOperationalEvent(logger, "warn", {
            component: "vibe64.turn_resume",
            event: "vibe64.turn_resume.recovery_failed",
            code: error?.code,
            error: error?.message
          }, "Interrupted turns could not be recovered after server restart.");
          retryAfter(true, later);
        });
      }, delay);
      state.lifecycle.turnRecoveryTimer.unref();
    };
    state.lifecycle.turnRecovery = recoverTurnsPass(retryDelaysMs.length > 0);
    state.lifecycle.turnRecovery.then(result => retryAfter(!result.ok, retryDelaysMs), () => retryAfter(true, retryDelaysMs));
    return state.lifecycle.turnRecovery;
  }

  return recoverInterruptedTurns;
}

export {
  TURN_RECOVERY_RETRY_DELAYS_MS,
  createServiceTurnRecovery,
  logRecoveryPass,
  logRecoveryResults,
  requestWasWorking,
  sessionWasWorking
};
