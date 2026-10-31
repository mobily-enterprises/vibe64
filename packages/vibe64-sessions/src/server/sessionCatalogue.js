import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { writeSessionUiSyncPreviewState } from "@local/vibe64-core/server/sessionUiSyncState";
import { vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
import { readLastOpenedSessionId, rememberLastOpenedSessionId } from "./lastOpenedSession.js";
import { record } from "./record.js";
import { sessionsOccupyingPolicySlots } from "./sessionPolicySlots.js";
import { presenceActor } from "./sessionPresence.js";
import { sessionContextUsageFromMetadata, sessionRenewalAdvisory } from "./sessionRenewalAdvisory.js";
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { text } from "./trimmedText.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/sessionRealtimeEvents").createSessionChangedPublisher>} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {ReturnType<typeof import("./sessionPresence.js").createSessionPresenceService>} SessionPresenceService */

function conversationPageOptions(options = {}) {
  const limit = Number.parseInt(String(options.limit || ""), 10);
  return {
    pageUnit: "messages",
    beforeTurnId: text(options.beforeTurnId),
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
    pagination: record(result.pagination)
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
function createSessionCatalogue({ project, publishSessionChanged, sessionPresence, terminals }) {
  return Object.freeze({
    closeSessionPresence() {
      sessionPresence.close();
    },

    async pinSession(sessionId, input) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const result = await runtime.store.runSessionRenewalStateExclusive(sessionId, () => (
          runtime.store.mutateSession(sessionId, async () => {
            const renewal = input.pinned ? await readSessionRenewalState(runtime, sessionId) : null;
            if (renewal && ![SESSION_RENEWAL_STATUS.COMPLETED, SESSION_RENEWAL_STATUS.CANCELLED].includes(renewal.status)) {
              throw Object.assign(new Error("Finish or cancel renewal before pinning this session."), { code: "vibe64_session_pin_unavailable" });
            }
            return runtime.store.updatePinnedSession(sessionId, input.pinned);
          })
        ));
        await publishSessionChanged(sessionId, {
          originId: text(input.originId),
          reason: "session-pin-changed",
          payload: { clientRefresh: { includeList: true } }
        });
        return { ok: true, ...result };
      }, "The session pin could not be changed.");
    },

    async renameSession(sessionId, input) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const sessionName = await runtime.store.writeSessionLabel(sessionId, input.name);
        await publishSessionChanged(sessionId, {
          originId: text(input.originId), reason: "session-renamed",
          payload: { clientRefresh: { includeList: true } }
        });
        return { ok: true, sessionId, sessionName };
      }, "The session could not be renamed.");
    },

    async broadcastSessionPreviewState(sessionId, input) {
      const preview = {
        originId: text(input.originId),
        projectSlug: text(input.projectSlug),
        route: text(input.route),
        sessionId: text(sessionId),
        title: text(input.title).slice(0, 256),
        updatedAt: new Date().toISOString()
      };
      if (!preview.sessionId || !preview.projectSlug || !preview.route || !preview.originId) {
        return {
          error: "Preview updates require a session, project, route, and origin.",
          ok: false
        };
      }
      writeSessionUiSyncPreviewState(preview);
      return {
        ok: true,
        preview
      };
    },

    async inspectSession(sessionId) {
      return sessionResult(async () => {
        // Realtime chat refreshes read state; source operations own their Git checks.
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
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
    },

    async listSessions({ vibe64User = null }) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const [summaries, lastOpenedSessionId] = await Promise.all([
          runtime.listSessionSummaries({ statusGroup: "open", includeUnavailable: true }),
          readLastOpenedSessionId(runtime.stateRoot, vibe64User)
        ]);
        const sessions = summaries.filter((session) => !session.unavailable);
        const openSessions = await sessionsOccupyingPolicySlots(runtime, sessions);
        const policy = await project.developmentDatabasePolicy({ openSessions });
        const activityReads = await Promise.allSettled(sessions.map(async (session) => (
          runtime.store.readAgentRuns(session.sessionId)
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
                active: activity.status === "fulfilled" ? activity.value.some((run) => run.active) : null,
                revision: session.revision
              }
            };
          }),
          unavailableSessions: summaries.filter((session) => session.unavailable)
        };
      });
    },

    async listArchivedSessions() {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const summaries = await runtime.listSessionSummaries({ statusGroup: "archived", includeUnavailable: true });
        return {
          ok: true,
          unavailableSessions: summaries.filter((session) => session.unavailable),
          sessions: summaries.filter((session) => !session.unavailable).sort((left, right) => (
            text(right.archivedAt).localeCompare(text(left.archivedAt)) ||
            text(right.sessionId).localeCompare(text(left.sessionId))
          ))
        };
      });
    },

    async readSessionConversationLog(sessionId, options) {
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
    },

    async updateSessionPresence(sessionId, input) {
      const actor = presenceActor(input.vibe64User);
      if (!actor) {
        return {
          ok: true,
          status: "unavailable"
        };
      }
      return sessionResult(async () => {
        const projectSlug = text(currentProjectRequestContext()?.slug);
        if (!projectSlug) {
          return {
            ok: true,
            status: "unavailable"
          };
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        const status = await runtime.store.readStatus(sessionId);
        if (!vibe64SessionStatusIsOpen(status)) {
          return {
            ok: true,
            status: "unavailable"
          };
        }
        const conversationId = text(input.conversationId);
        if (conversationId) {
          const conversation = await runtime.store.readSessionConversation(sessionId, conversationId);
          if (!conversation) return { ok: true, status: "unavailable" };
        }
        return sessionPresence.update({
          ...actor,
          ...(conversationId ? { conversationId } : {}),
          originId: input.originId,
          projectSlug,
          sequence: input.sequence,
          sessionId,
          typing: input.typing
        });
      }, "Vibe64 could not update typing presence.");
    },

    // The browser publishes each session it opens: the project's selected
    // alias (unless pinned) and the person's last opened session.
    async updateCurrentSession(sessionId = "", { vibe64User = null }) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const current = await runtime.updateCurrentSession(sessionId);
        if (text(sessionId)) await rememberLastOpenedSessionId(runtime.stateRoot, vibe64User, text(sessionId));
        return {
          ok: true,
          sessionId: text(current.sessionId)
        };
      });
    }
  });
}

export { createSessionCatalogue };
