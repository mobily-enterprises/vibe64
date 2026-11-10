import { vibe64Error } from "@local/vibe64-core/server/core";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  answerSessionPreviewOpen,
  writeSessionUiSyncPreviewState
} from "@local/vibe64-core/server/sessionUiSyncState";
import { vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
import { readLastOpenedSessionId, rememberLastOpenedSessionId } from "./lastOpenedSession.js";
import { sessionsOccupyingPolicySlots } from "./sessionPolicySlots.js";
import { presenceActor } from "./sessionPresence.js";
import { sessionContextUsageFromMetadata, sessionRenewalAdvisory } from "./sessionRenewalAdvisory.js";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SessionPresenceService} SessionPresenceService */

function conversationPageOptions(options = {}) {
  const limit = Number.parseInt(String(options.limit || ""), 10);
  return {
    pageUnit: "messages",
    beforeTurnId: normalizeText(options.beforeTurnId),
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10
  };
}

function conversationPage(result = {}, options = {}) {
  if (Array.isArray(result)) {
    return {
      conversationLog: result,
      pagination: {
        beforeTurnId: options.beforeTurnId,
        hasMoreBefore: false,
        limit: options.limit,
        nextBeforeTurnId: ""
      }
    };
  }
  return {
    conversationLog: Array.isArray(result.conversationLog) ? result.conversationLog : [],
    pagination: normalizeObject(result.pagination)
  };
}

/**
 * The project's sessions as people see them: the open and archived lists,
 * one session's state and conversation, its name and pin, the person's
 * current session, and typing presence.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionPresenceService} dependencies.sessionPresence
 * @param {TerminalsService} dependencies.terminals
 */
function createSessionCatalogue({
  project,
  publishSessionChanged,
  sessionPresence,
  terminals
}) {
  function closeSessionPresence() {
    sessionPresence.close();
  }

  async function pinSession(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const result = await runtime.store.runSessionRenewalStateExclusive(sessionId, () => (
        runtime.store.mutateSession(sessionId, async () => {
          const renewal = input.pinned ? await readSessionRenewalState(runtime, sessionId) : null;
          if (renewal && ![SESSION_RENEWAL_STATUS.COMPLETED, SESSION_RENEWAL_STATUS.CANCELLED].includes(renewal.status)) {
            throw vibe64Error("Finish or cancel renewal before pinning this session.", "vibe64_session_pin_renewal_unfinished");
          }
          return runtime.store.updatePinnedSession(sessionId, input.pinned);
        })
      ));
      await publishSessionChanged(sessionId, {
        originId: normalizeText(input.originId),
        reason: "session-pin-changed",
        payload: { clientRefresh: { includeList: true } }
      });
      return { ok: true, ...result };
    }, "The session pin could not be changed.");
  }

  async function renameSession(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const sessionName = await runtime.store.writeSessionLabel(sessionId, input.name);
      await publishSessionChanged(sessionId, {
        originId: normalizeText(input.originId),
        reason: "session-renamed",
        payload: { clientRefresh: { includeList: true } }
      });
      return { ok: true, sessionId, sessionName };
    }, "The session could not be renamed.");
  }

  /**
   * The page an editor's Preview shows, kept as the session's Preview state,
   * and its answer to a request to open a page there.
   */
  async function broadcastSessionPreviewState(sessionId, input) {
    const preview = {
      originId: normalizeText(input.originId),
      projectSlug: normalizeText(input.projectSlug),
      route: normalizeText(input.route),
      sessionId: normalizeText(sessionId),
      title: normalizeText(input.title).slice(0, 256),
      updatedAt: new Date().toISOString()
    };
    const openRequestId = normalizeText(input.openRequestId);
    if (!preview.sessionId || !preview.projectSlug || !preview.originId || (!preview.route && !openRequestId)) {
      return {
        error: "Preview updates require a session, project, origin, and a route or an open request.",
        ok: false
      };
    }
    if (openRequestId) {
      answerSessionPreviewOpen({
        error: input.openError,
        moved: input.opened === true,
        originId: preview.originId,
        projectSlug: preview.projectSlug,
        requestId: openRequestId,
        sessionId: preview.sessionId
      });
    }
    if (preview.route) {
      writeSessionUiSyncPreviewState(preview);
    }
    return {
      ok: true,
      preview
    };
  }

  async function inspectSession(sessionId) {
    return sessionResult(async () => {
      // Realtime chat refreshes read state; source operations own their Git checks.
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const [agentSession, conversation] = await Promise.all([
        session.status !== "archived"
          ? terminals.agentSessionState(sessionId, {
            runtime,
            session
          })
          : null,
        runtime.readConversationLogPage(sessionId, { limit: 1 })
      ]);
      return publicSession(session, {
        ...(agentSession?.ok === false ? {} : { agentSession }),
        renewalAdvisory: sessionRenewalAdvisory({
          contextUsage: sessionContextUsageFromMetadata(session.metadata, {
            expectedThreadId: session.metadata?.agent_identity_conversation_id
          }),
          conversationTurnCount: conversation?.pagination?.totalTurnCount,
          session
        })
      });
    });
  }

  async function listSessions({ vibe64User = null }) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const [summaries, lastOpenedSessionId] = await Promise.all([
        runtime.listSessionSummaries({ statusGroup: "open", includeUnavailable: true }),
        readLastOpenedSessionId(runtime.stateRoot, vibe64User)
      ]);
      const sessions = summaries.filter((session) => !session.unavailable);
      const openSessions = await sessionsOccupyingPolicySlots(runtime, sessions);
      const policy = await project.developmentDatabasePolicy({ openSessions });
      const activityReads = await Promise.allSettled(sessions.map(async (session) => (
        runtime.store.readAgentRunActivity(session.sessionId)
      )));
      return {
        creation: policy.creation,
        // The person's last opened session, while it is still open.
        lastOpenedSessionId: sessions.some((session) => session.sessionId === lastOpenedSessionId) ? lastOpenedSessionId : "",
        limits: policy.limits,
        ok: true,
        sessions: sessions.map((session, index) => {
          const activity = activityReads[index];
          return {
            ...session,
            agentActivity: {
              active: activity.status === "fulfilled" ? activity.value.active : null,
              revision: session.revision
            }
          };
        }),
        unavailableSessions: summaries.filter((session) => session.unavailable)
      };
    });
  }

  /**
   * Archived sessions, newest archival first. With a `sessionLimit`, one page
   * from `sessionOffset` (0 by default) with the whole count and the next
   * page's offset, so a long archive is never sent or shown in one piece;
   * without one, every archived session.
   * @param {{ sessionOffset?: number, sessionLimit?: number }} [input]
   */
  async function listArchivedSessions(input = {}) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const summaries = await runtime.listSessionSummaries({ statusGroup: "archived", includeUnavailable: true });
      const sessions = summaries.filter((session) => !session.unavailable).sort((left, right) => (
        normalizeText(right.archivedAt).localeCompare(normalizeText(left.archivedAt)) ||
        normalizeText(right.sessionId).localeCompare(normalizeText(left.sessionId))
      ));
      const unavailableSessions = summaries.filter((session) => session.unavailable);
      const limit = Number(input.sessionLimit || 0);
      if (!limit) return { ok: true, unavailableSessions, sessions };
      const offset = Number(input.sessionOffset || 0);
      return {
        ok: true,
        unavailableSessions,
        sessions: sessions.slice(offset, offset + limit),
        sessionCount: sessions.length,
        nextSessionOffset: offset + limit < sessions.length ? offset + limit : null
      };
    });
  }

  async function readSessionConversationLog(sessionId, options) {
    return sessionResult(async () => {
      const runtime = await project.createRuntime();
      const pageOptions = conversationPageOptions(options);
      const result = await runtime.readConversationLogPage(sessionId, pageOptions);
      return {
        ...conversationPage(result, pageOptions),
        conversationStream: runtime.store.readConversationStream(sessionId),
        ok: true,
        sessionId
      };
    });
  }

  async function updateSessionPresence(sessionId, input) {
    const actor = presenceActor(input.vibe64User);
    if (!actor) {
      return {
        ok: true,
        status: "unavailable"
      };
    }
    return sessionResult(async () => {
      const projectSlug = normalizeText(currentProjectRequestContext()?.slug);
      if (!projectSlug) {
        return {
          ok: true,
          status: "unavailable"
        };
      }
      const runtime = await project.createRuntimeWithoutSource();
      const status = await runtime.store.readStatus(sessionId);
      if (!vibe64SessionStatusIsOpen(status)) {
        return {
          ok: true,
          status: "unavailable"
        };
      }
      const conversationId = normalizeText(input.conversationId);
      if (conversationId) {
        const conversation = await runtime.store.readSessionConversation(sessionId, conversationId);
        if (!conversation) return { ok: true, status: "unavailable" };
      }
      const result = await sessionPresence.update({
        ...actor,
        ...(conversationId ? { conversationId } : {}),
        originId: input.originId,
        projectSlug,
        sequence: input.sequence,
        sessionId,
        typing: input.typing
      });
      // Someone typing is using the project, so idle cleanup must not close it.
      if (input.typing === true) await terminals.noteProjectRuntimeActivity();
      return result;
    }, "Vibe64 could not update typing presence.");
  }

  /**
   * The browser publishes each session it opens: the project's selected
   * alias (unless pinned) and the person's last opened session.
   */
  async function updateCurrentSession(sessionId, { vibe64User = null }) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const current = await runtime.updateCurrentSession(sessionId);
      if (normalizeText(sessionId)) await rememberLastOpenedSessionId(runtime.stateRoot, vibe64User, normalizeText(sessionId));
      return {
        ok: true,
        sessionId: normalizeText(current.sessionId)
      };
    });
  }

  return Object.freeze({
    closeSessionPresence,
    pinSession,
    renameSession,
    broadcastSessionPreviewState,
    inspectSession,
    listSessions,
    listArchivedSessions,
    readSessionConversationLog,
    updateSessionPresence,
    updateCurrentSession
  });
}

export { createSessionCatalogue };
