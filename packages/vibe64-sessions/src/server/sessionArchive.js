import { AppError } from "@jskit-ai/kernel/server/runtime";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { assistantRoutingRequestFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { createHeldRequests } from "./heldRequests.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionArchivePreparation} SessionArchivePreparation */

// A composed host's preparation of each archive (for example preserving what
// the session wrote) is provided through this token; without one an archive
// prepares nothing.
const SESSION_ARCHIVE_PREPARATION_TOKEN = "vibe64.sessions.archive-preparation";

/** @type {SessionArchivePreparation} */
async function prepareNothingForArchive() {}

// An archive the page started and this editor no longer holds (it restarted, or the first request never arrived):
// its repeat archives nothing. Startup resumes an archive whose progress it recorded.
const ARCHIVE_NOT_FOLLOWED = Object.freeze({
  code: "vibe64_session_archive_not_followed",
  error: "Vibe64 restarted or lost this archive while it ran. Check the session list, and archive the session again " +
    "if it is still there."
});

/** @param {unknown} prepare */
function assertArchivePreparation(prepare) {
  if (prepare && typeof prepare !== "function") {
    throw new TypeError("Session archive preparation must be a function or null.");
  }
}

// A session's persisted archive progress. Unreadable progress is refused with
// one coded error so recovery never guesses at what was already removed.
const SESSION_ARCHIVE_STATUSES = new Set(["running", "failed"]);
const SESSION_ARCHIVE_PHASES = new Set(["stopping", "resources", "source"]);
function readSessionArchiveOperation(metadata) {
  const stored = normalizeText(metadata?.session_archive_operation);
  if (!stored) return null;
  let operation = null;
  try {
    operation = JSON.parse(stored);
  } catch { /* Refused below. */ }
  if (!operation || typeof operation !== "object" || Array.isArray(operation) ||
    !SESSION_ARCHIVE_STATUSES.has(operation.status) || !SESSION_ARCHIVE_PHASES.has(operation.phase)) {
    throw Object.assign(new Error("Session archive state is invalid; its recovery evidence was preserved."), {
      code: "vibe64_session_archive_state_invalid"
    });
  }
  return operation;
}

/**
 * Archive: stop the session's work, release its resources, then remove its
 * source, recording each durable phase so startup resumes an interrupted one.
 * A host may add idempotent preparation between those phases. `archiveSession`
 * is the assistant tool's and startup's; `startSessionArchive` is the page's,
 * held while it goes on (`heldRequests.js`), and `close`, at shutdown,
 * resolves once every held archive has ended.
 * @param {object} dependencies
 * @param {SessionArchivePreparation} dependencies.archivePreparation
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 */
function createSessionArchive({
  archivePreparation,
  logger,
  project,
  terminals,
  setupRunner,
  publishSessionChanged
}) {
  /**
   * Stopping: preview, AI turns and remaining tools stop before anything is removed.
   * The session's live conversations also leave memory: once its source is gone
   * they cannot be reopened, and a later account change would fail on them.
   */
  async function stopSessionWork(runtime, session) {
    const { sessionId } = session;
    await terminals.closeSessionTerminals(sessionId, { session, forgetConversationBinding: true });
    await terminals.removeOutputResultsForSession(sessionId);
    // The final close: renewal and changeover never reach here.
    await terminals.removeSessionCommandHelpers(sessionId, { runtime });
  }

  /**
   * The host's preparation runs on every attempt, at whichever phase. Without
   * one the session is not read for it.
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {string} phase
   */
  async function runArchivePreparation(runtime, sessionId, phase) {
    if (archivePreparation === prepareNothingForArchive) return;
    const prepared = await archivePreparation({
      phase,
      runtime,
      session: await runtime.getSessionWithoutSource(sessionId)
    });
    if (prepared?.ok === false) {
      throw Object.assign(new Error(prepared.error || "Session archive preparation failed."), {
        code: prepared.code || "vibe64_session_archive_preparation_failed"
      });
    }
  }

  /**
   * Resources: the project releases what it holds for the session.
   */
  async function releaseSessionResources(sessionId) {
    const released = await project.releaseSessionResources({ sessionId });
    if (released?.ok === false) {
      throw new Error(released.error || "Session resources could not be archived.");
    }
  }

  /**
   * `stage` names what the archive does: `session-write` (waiting for the session's assistant write), `stopping`
   * (its work), `preparing` (the host's preparation), `resources`, then `source`.
   * @param {string} sessionId
   * @param {object} input
   * @param {{ stage?: (name: string) => void }} [controls]
   */
  async function archiveSession(sessionId, input, { stage = doNothing } = {}) {
    return sessionResult(async () => {
      if (setupRunner.isRunning(sessionId)) {
        throw vibe64Error("Wait for workspace preparation to finish before archiving this session.", "vibe64_workspace_setup_running");
      }
      const runtime = await project.createRuntimeWithoutSource();
      let routingCancelled = false;
      let closesFinished = false;
      const cancelledRouting = new Map();
      while (true) {
        stage("session-write");
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          if (setupRunner.isRunning(sessionId)) {
            throw vibe64Error("Wait for workspace preparation to finish before archiving this session.", "vibe64_workspace_setup_running");
          }
          const currentSession = await runtime.getSessionWithoutSource(sessionId);
          await runtime.store.assertSessionNotPinned(sessionId);
          const conversations = await runtime.store.listSessionConversations(sessionId);
          const routingRequests = [{ metadata: currentSession.metadata }, ...conversations.map(record => ({
            conversationId: record.conversationId,
            metadata: record.routingMetadata
          }))].map(({ conversationId, metadata }) => ({
            conversationId,
            request: assistantRoutingRequestFromMetadata(metadata)
          }));
          const renewalSessions = await runtime.store.listSessionsForRenewal();
          const reservedSuccessor = renewalSessions.find((session) => (
            ["renewal_pending", "renewal_activating"].includes(normalizeText(session.status)) &&
            normalizeText(session.metadata?.renewed_from) === sessionId
          ));
          if (reservedSuccessor) {
            throw new AppError(
              409,
              "This session has an unfinished renewal. Open its renewal and choose Retry to finish it, or Cancel renewal to discard its fresh session, before archiving this session.",
              { code: "vibe64_session_renewal_blocks_archive" }
            );
          }
          const routingToCancel = routingRequests.filter(({ conversationId, request }) => request?.helper ||
            assistantRoutingStatusIsPending(request) && (!routingCancelled || !request.stopped ||
              cancelledRouting.get(conversationId || "") !== request.messageId));
          if (routingToCancel.length) {
            if (!routingCancelled) return { routingToCancel };
            throw Object.assign(vibe64Error(
              "Chat routing changed while closing. Retry Close to cancel its remaining work.",
              "vibe64_assistant_routing_pending",
              { messageCode: "vibe64_session_archive_routing_changed" }
            ), { retryable: true });
          }
          const sourceCreationFailed = currentSession.sourceReady !== true &&
            normalizeText(currentSession.metadata?.source_creation_failed).toLowerCase() === "yes";
          const previous = readSessionArchiveOperation(currentSession.metadata) || {};
          const operation = {
            phase: previous.status === "failed" && !currentSession.metadata?.session_closing_reason
              ? "stopping"
              : previous.phase || (currentSession.metadata?.source_recovery_saved === "yes" ? "source" : "stopping"),
            startedAt: previous.status === "running" && previous.startedAt || new Date().toISOString(),
            status: "running"
          };
          // A chat whose Close was interrupted finishes closing before the session stops: no Close
          // reaches a chat in the archive, and its Codex and OpenCode conversations would stay in
          // their engine's storage. Its engine can still start while the session has its source.
          if (operation.phase === "stopping" && conversations.some(record => record.state === "closing")) {
            if (!closesFinished) return { closesToFinish: true };
            throw Object.assign(vibe64Error(
              "A chat in this session is still closing. Retry Archive session to finish closing it.",
              "vibe64_conversation_close_unfinished",
              { messageCode: "vibe64_session_archive_close_unfinished" }
            ), { retryable: true });
          }
          const persist = () => runtime.store.writeMetadataValue(sessionId, "session_archive_operation", JSON.stringify(operation));
          async function advanceArchivePhase(phase) {
            operation.phase = phase;
            await persist();
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-archive-progress",
              payload: { clientRefresh: { includeList: true } }
            });
          }
          await persist();
          try {
            const closingSession = await runtime.markSessionClosing(sessionId, {
              reason: "archived"
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-archiving",
              payload: { clientRefresh: { includeList: true } },
              session: closingSession
            });
            stage("stopping");
            if (operation.phase === "stopping") await stopSessionWork(runtime, currentSession);
            stage("preparing");
            await runArchivePreparation(runtime, sessionId, operation.phase);
            if (operation.phase === "stopping") {
              await advanceArchivePhase("resources");
            }
            if (operation.phase === "resources") {
              stage("resources");
              if (!sourceCreationFailed) await releaseSessionResources(sessionId);
              await advanceArchivePhase("source");
            }
            stage("source");
            return await runtime.archiveSession(sessionId);
          } catch (error) {
            operation.status = "failed";
            operation.error = normalizeText(error?.message) || "Session archive failed. Retry archiving this session.";
            await persist().catch(() => null);
            const restoredSession = await runtime.clearSessionClosing(sessionId).catch(() => null);
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-archive-failed",
              payload: { archiveError: operation.error, clientRefresh: { includeList: true } },
              session: restoredSession
            }).catch(() => null);
            throw error;
          }
        }, { operation: "archive-session" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        if (exclusive.value?.routingToCancel) {
          // Routing owns its own agent-write admission and cleanup callbacks.
          // Wait outside the archive lock, then recheck all archive guards.
          for (const { conversationId, request } of exclusive.value.routingToCancel) {
            const cancel = conversationId ? terminals.cancelTemporaryConversationRouting : terminals.cancelAssistantRoutingForSelection;
            if (typeof cancel !== "function") {
              throw Object.assign(vibe64Error(
                "Chat routing cancellation is unavailable. Retry Close after reconnecting the workspace.",
                "vibe64_assistant_routing_pending",
                { messageCode: "vibe64_session_archive_routing_cancel_unavailable" }
              ), { retryable: true });
            }
            await cancel.call(terminals, sessionId, conversationId
              ? { conversationId, messageId: request.messageId }
              : request.messageId, { runtime, vibe64User: trustedAssistantUser(input) });
            cancelledRouting.set(conversationId || "", request.messageId);
          }
          routingCancelled = true;
          continue;
        }
        if (exclusive.value?.closesToFinish) {
          // Close owns its own agent-write admission; it runs outside the archive lock too.
          await terminals.finishInterruptedClosesBeforeArchive(sessionId, { runtime });
          closesFinished = true;
          continue;
        }
        const session = exclusive.value;
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-archived",
          payload: { clientRefresh: { includeList: true } },
          session
        });
        return publicSession(session);
      }
    }, "Vibe64 could not archive this session.");
  }

  async function resumeSessionArchives({ signal = null } = {}) {
    const runtime = await project.createRuntimeWithoutSource();
    // A closed session whose archive cannot be published is reported with the
    // others; it does not stop the open sessions' interrupted archives.
    const published = await runtime.store.recoverSessionArchives();
    const failures = [...published.failures];
    for (const sessionId of published.recovered) {
      await publishSessionChanged(sessionId, {
        reason: "session-archived",
        payload: { clientRefresh: { includeList: true } }
      });
    }
    const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
    for (const session of sessions) {
      if (signal?.aborted) break;
      if (session.status === "archived") continue;
      let operation;
      try {
        operation = readSessionArchiveOperation(session.metadata);
      } catch (error) {
        // One unreadable marker must not stop recovery of the other sessions.
        failures.push({ sessionId: session.sessionId, ok: false, code: error.code, error: error.message });
        continue;
      }
      if (operation?.status === "failed") continue;
      if (operation?.status !== "running" && session.metadata?.session_closing_reason !== "archived") continue;
      const result = await archiveSession(session.sessionId, {});
      if (result?.ok === false) failures.push({ sessionId: session.sessionId, ...result });
    }
    return { failures };
  }

  const heldArchives = createHeldRequests({
    component: "vibe64.session_archive",
    heldAs: "archiving",
    logger,
    notFollowed: ARCHIVE_NOT_FOLLOWED
  });

  /**
   * The page's archive (`POST .../archive`), named by its `requestId`: stopping the session's work, the host's
   * preparation and removing its source can outlast the hosted edge's minute.
   * @param {string} sessionId
   * @param {{ requestId: string, repeat?: boolean }} input
   */
  function startSessionArchive(sessionId, input) {
    return heldArchives.run([sessionId], input, (archive, { stage }) => archiveSession(sessionId, archive, { stage }));
  }

  return Object.freeze({
    archiveSession,
    close: heldArchives.close,
    prepareArchive: archivePreparation,
    resumeSessionArchives,
    startSessionArchive
  });
}

export { SESSION_ARCHIVE_PREPARATION_TOKEN, assertArchivePreparation, createSessionArchive, prepareNothingForArchive };
