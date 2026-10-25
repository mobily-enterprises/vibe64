import { assistantRoutingRequestFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { publicSession, sessionResult } from "./sessionResults.js";

function text(value = "") {
  return String(value || "").trim();
}

// A session's persisted archive progress. Unreadable progress is refused with
// one coded error so recovery never guesses at what was already removed.
const SESSION_ARCHIVE_STATUSES = new Set(["running", "failed"]);
const SESSION_ARCHIVE_PHASES = new Set(["stopping", "resources", "source"]);
function readSessionArchiveOperation(metadata = {}) {
  const stored = text(metadata?.session_archive_operation);
  if (!stored) return null;
  let operation = null;
  try { operation = JSON.parse(stored); } catch { operation = null; }
  if (!operation || typeof operation !== "object" || Array.isArray(operation) ||
    !SESSION_ARCHIVE_STATUSES.has(operation.status) || !SESSION_ARCHIVE_PHASES.has(operation.phase)) {
    throw Object.assign(new Error("Session archive state is invalid; its recovery evidence was preserved."), {
      code: "vibe64_session_archive_state_invalid"
    });
  }
  return operation;
}

// Archive: stop the session's work, release its resources, then remove its
// source, recording each durable phase so startup resumes an interrupted one.
// A host may add idempotent preparation between those phases.
function createSessionArchive({ project, terminals, setupRunner, publishSessionChanged, trustedAssistantUser }) {
  let archivePreparation = null;

  // Stopping: preview, AI turns and remaining tools stop before anything is removed.
  async function stopSessionWork(runtime, session) {
    const { sessionId } = session;
    await terminals.closeSessionTerminals(sessionId, { session });
    if (typeof terminals.removeOutputResultsForSession === "function") {
      await terminals.removeOutputResultsForSession(sessionId);
    }
    // The final close: renewal and changeover never reach here.
    if (typeof terminals.removeSessionCommandHelpers === "function") {
      await terminals.removeSessionCommandHelpers(sessionId, { runtime });
    }
  }

  // The host's optional preparation runs on every attempt, at whichever phase.
  async function runArchivePreparation(prepare, runtime, sessionId, phase) {
    if (!prepare) return;
    const prepared = await prepare({
      phase,
      runtime,
      session: await runtime.getSession(sessionId, { inspectSource: false })
    });
    if (prepared?.ok === false) {
      throw Object.assign(new Error(prepared.error || "Session archive preparation failed."), {
        code: prepared.code || "vibe64_session_archive_preparation_failed"
      });
    }
  }

  // Resources: the project releases what it holds for the session.
  async function releaseSessionResources(sessionId) {
    if (typeof project.releaseSessionResources !== "function") return;
    const released = await project.releaseSessionResources({ sessionId });
    if (released?.ok === false) {
      throw new Error(released.error || "Session resources could not be archived.");
    }
  }

  async function archiveSession(sessionId, input = {}) {
    // One attempt keeps the same host callback even if configuration changes
    // while terminal shutdown is in progress.
    const prepareArchive = archivePreparation;
    return sessionResult(async () => {
      if (setupRunner.isRunning(sessionId)) {
        const error = new Error("Wait for workspace preparation to finish before archiving this session.");
        error.code = "vibe64_workspace_setup_running";
        throw error;
      }
      const runtime = await project.createRuntime({ inspectSource: false });
      let routingCancelled = false;
      const cancelledRouting = new Map();
      while (true) {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          if (setupRunner.isRunning(sessionId)) {
            throw Object.assign(new Error("Wait for workspace preparation to finish before archiving this session."), {
              code: "vibe64_workspace_setup_running"
            });
          }
          const currentSession = await runtime.getSession(sessionId, {
            inspectSource: false
          });
          await runtime.store.assertSessionNotPinned(sessionId);
          const conversations = await runtime.store.listSessionConversations(sessionId);
          const routingRequests = [{ metadata: currentSession.metadata }, ...conversations.map(record => ({
            conversationId: record.conversationId, metadata: record.routingMetadata
          }))].map(({ conversationId, metadata }) => ({
            conversationId, request: assistantRoutingRequestFromMetadata(metadata)
          }));
          const renewalSessions = await runtime.store.listSessionsForRenewal();
          const reservedSuccessor = renewalSessions.find((session) => (
            ["renewal_pending", "renewal_activating"].includes(text(session.status)) &&
            text(session.metadata?.renewed_from) === sessionId
          ));
          if (reservedSuccessor) {
            const error = new Error("Finish the session renewal using Retry before archiving its original session.");
            error.code = "vibe64_session_renewal_blocks_archive";
            throw error;
          }
          const routingToCancel = routingRequests.filter(({ conversationId, request }) => request?.helper ||
            assistantRoutingStatusIsPending(request) && (!routingCancelled || !request.stopped ||
              cancelledRouting.get(conversationId || "") !== request.messageId));
          if (routingToCancel.length) {
            if (!routingCancelled) return { routingToCancel };
            throw Object.assign(new Error("Chat routing changed while closing. Retry Close to cancel its remaining work."), {
              code: "vibe64_assistant_routing_pending", retryable: true
            });
          }
          const sourceCreationFailed = currentSession.sourceReady !== true &&
            text(currentSession.metadata?.source_creation_failed).toLowerCase() === "yes";
          const previous = readSessionArchiveOperation(currentSession.metadata) || {};
          const operation = {
            phase: previous.status === "failed" && !currentSession.metadata?.session_closing_reason
              ? "stopping"
              : previous.phase || (currentSession.metadata?.source_recovery_saved === "yes" ? "source" : "stopping"),
            startedAt: previous.status === "running" && previous.startedAt || new Date().toISOString(),
            status: "running"
          };
          const persist = () => runtime.store.writeMetadataValue(
            sessionId, "session_archive_operation", JSON.stringify(operation)
          );
          async function advanceArchivePhase(phase) {
            operation.phase = phase;
            await persist();
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: text(input.originId),
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
              originId: text(input.originId),
              reason: "session-archiving",
              payload: { clientRefresh: { includeList: true } },
              session: closingSession
            });
            if (operation.phase === "stopping") await stopSessionWork(runtime, currentSession);
            await runArchivePreparation(prepareArchive, runtime, sessionId, operation.phase);
            if (operation.phase === "stopping") {
              await advanceArchivePhase("resources");
            }
            if (operation.phase === "resources") {
              if (!sourceCreationFailed) await releaseSessionResources(sessionId);
              await advanceArchivePhase("source");
            }
            return await runtime.archiveSession(sessionId);
          } catch (error) {
            operation.status = "failed";
            operation.error = text(error?.message) || "Session archive failed. Retry archiving this session.";
            await persist().catch(() => null);
            const restoredSession = await runtime.clearSessionClosing(sessionId).catch(() => null);
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: text(input.originId),
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
              throw Object.assign(new Error("Chat routing cancellation is unavailable. Retry Close after reconnecting the workspace."), {
                code: "vibe64_assistant_routing_pending", retryable: true
              });
            }
            await cancel.call(terminals, sessionId, conversationId
              ? { conversationId, messageId: request.messageId }
              : request.messageId, { runtime, vibe64User: trustedAssistantUser(input) });
            cancelledRouting.set(conversationId || "", request.messageId);
          }
          routingCancelled = true;
          continue;
        }
        const session = exclusive.value;
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-archived",
          payload: { clientRefresh: { includeList: true } },
          session
        });
        return publicSession(session);
      }
    }, "Vibe64 could not archive this session.");
  }

  function setArchivePreparation(prepare = null) {
    if (prepare !== null && typeof prepare !== "function") {
      throw new TypeError("Session archive preparation must be a function or null.");
    }
    archivePreparation = prepare;
  }

  async function resumeSessionArchives({ signal = null } = {}) {
    const runtime = await project.createRuntime({ inspectSource: false });
    for (const sessionId of await runtime.store.recoverSessionArchives()) {
      await publishSessionChanged(sessionId, {
        reason: "session-archived",
        payload: { clientRefresh: { includeList: true } }
      });
    }
    const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
    const failures = [];
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
      const result = await archiveSession(session.sessionId);
      if (result?.ok === false) failures.push({ sessionId: session.sessionId, ...result });
    }
    return { failures };
  }

  return {
    archiveSession,
    prepareArchive: (context) => archivePreparation?.(context),
    resumeSessionArchives,
    setArchivePreparation
  };
}

export { createSessionArchive };
