/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";

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
 * A pass's outcome for each session that had something to recover, then its totals.
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
    { sessions: results.length, totals },
    "Vibe64 finished checking for work the previous server was running."
  );
}

/**
 * Whether a chat's request was at work when an earlier server ended: being sent, or its turn running (and the
 * person had not stopped it), or waiting out the short wait before Vibe64 resumes it.
 * @param {Record<string, string> | undefined} metadata the chat's routing metadata
 */
function requestWasWorking(metadata) {
  const request = assistantRoutingRequestForDisplay(metadata || {});
  if (!request || request.stopped === true) return false;
  if (request.status === "waiting") return Boolean(request.resumeAt && request.followup);
  return request.status === "working" && ["accepted", "pending", "sending", "routing", "uncertain"].includes(request.delivery);
}

/**
 * Whether a session's Main chat was at work when an earlier server ended: its request, or an agent run that still
 * says it is working.
 * @param {{ metadata?: Record<string, string>, agentRuns?: object[] }} session
 */
function sessionWasWorking(session) {
  return requestWasWorking(session.metadata) || sessionHasActiveAgentRun(session);
}

/**
 * The restart recovery of the open projects' chat turns: each Main chat and temporary chat whose AI was at work when
 * the previous server ended is reconciled now, instead of when someone next opens it, as the person it ran for (the
 * request's sender). Reconciliation stops what is left of the old turn and ends it; routing then writes the red entry
 * and resumes the turn once, or says why not (assistantRoutingOutcomes.js). Its stale "working" state, which Save,
 * Update and the session list read, ends with it. A temporary chat that holds an AI task is its task's to continue
 * (vibe64-ai-tasks), and a goal's turn its goal recovery's.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {(sessionId: string, options: object) => Promise<object>} dependencies.ensureAgentSession
 * @param {(sessionId: string, options: object) => Promise<unknown>} dependencies.reconcileTemporaryConversation
 * @param {import("./types.js").ServerRun} dependencies.serverRun
 */
function createServiceTurnRecovery({
  state,
  logger,
  project,
  sessionAccess,
  assistantContext,
  ensureAgentSession,
  reconcileTemporaryConversation,
  serverRun
}) {
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

  async function recoverSessionTurns(sessionId) {
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const session = context.session;
    if (sessionIsClosing(session) || session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
      return [{ sessionId, skipped: true, reason: "session-not-open" }];
    }
    const results = [];
    if (sessionWasWorking(session)) {
      const request = assistantRoutingRequestForDisplay(session.metadata);
      await stillRunning(request);
      const actor = await actorFor(request);
      const result = await ensureAgentSession(sessionId, actor ? { vibe64User: actor } : {});
      if (result?.ok === false) {
        throw Object.assign(new Error(result.error || "The session's AI could not be reconciled."), { code: result.code });
      }
      results.push({ sessionId, chat: "main", reconciled: true });
    }
    const conversations = await context.runtime.store.listSessionConversations(sessionId);
    for (const record of conversations) {
      if (record.state === "closing" || record.task || !requestWasWorking(record.routingMetadata)) continue;
      const request = assistantRoutingRequestForDisplay(record.routingMetadata);
      await stillRunning(request);
      const actor = await actorFor(request);
      await reconcileTemporaryConversation(sessionId, {
        conversationId: record.conversationId,
        ...(actor ? { vibe64User: actor } : {})
      });
      results.push({ sessionId, chat: record.conversationId, reconciled: true });
    }
    return results.length ? results : [{ sessionId, skipped: true, reason: "nothing-working" }];
  }

  async function recoverTurnsPass(retrying) {
    const results = [];
    const reportFailure = (error, target) => {
      const result = { ...target, ok: false, code: error?.code, error: error?.message };
      results.push(result);
      logOperationalEvent(logger, "warn", {
        ...result,
        event: "vibe64.turn_resume.recovery_failed",
        component: "vibe64.turn_resume"
      }, "A turn interrupted by the previous server needs attention after restart.");
    };
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
              const sessionResults = await recoverSessionTurns(session.sessionId);
              for (const result of sessionResults) results.push({ projectSlug: projectRecord.slug, ...result });
            } catch (error) {
              reportFailure(error, { projectSlug: projectRecord.slug, sessionId: session.sessionId });
            }
          }
        });
      } catch (error) {
        reportFailure(error, { projectSlug: projectRecord.slug });
      }
    }
    logRecoveryResults(logger, "vibe64.turn_resume", results, result => result.reason === "nothing-working");
    return { ok: results.every(result => result.ok !== false), results };
  }

  /**
   * Run once per server after every feature has booted, beside goal recovery. A session it could not reconcile is
   * tried again after each retry delay; one already reconciled is no longer working and is skipped, so no turn is
   * resumed twice. Shutdown cancels the next pass.
   */
  function recoverInterruptedTurns({ retryDelaysMs = TURN_RECOVERY_RETRY_DELAYS_MS } = {}) {
    if (state.lifecycle.turnRecovery) return state.lifecycle.turnRecovery;
    const retryAfter = (failed, delays) => {
      if (!failed || !delays.length || state.lifecycle.closing) return;
      const [delay, ...later] = delays;
      state.lifecycle.turnRecoveryTimer = setTimeout(() => {
        if (state.lifecycle.closing) return;
        state.lifecycle.turnRecoveryRetry = recoverTurnsPass(true).then(result => retryAfter(!result.ok, later), error => {
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
    state.lifecycle.turnRecovery = recoverTurnsPass(false);
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
