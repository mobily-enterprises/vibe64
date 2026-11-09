import crypto from "node:crypto";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";
import { persistRepositoryUpdateCheck } from "./sessionRepositoryUpdates.js";
import { refuseDuringRepositoryAiTask, sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */
/** @typedef {import("./types.js").SessionWorkspaceSetup} SessionWorkspaceSetup */
/** @typedef {ReturnType<typeof import("./sessionWorkRecovery.js").createSessionWorkRecovery>} SessionWorkRecovery */
/** @typedef {import("./types.js").SessionUpdateChecks} SessionUpdateChecks */

const NOTED_PATH_LIMIT = 20;

/**
 * What the main chat's AI is told after Update changed files it may be working on: which ones, so it reads them
 * again. Empty when Update changed no file.
 * @param {{ updatedPaths?: string[], updatedPathCount?: number, connected?: object[] }} result
 */
function updateMainChatNote(result = {}) {
  const sources = [result, ...(result.connected || [])];
  const paths = sources.flatMap(source => source.updatedPaths || []);
  const count = sources.reduce((total, source) => total + (source.updatedPathCount || 0), 0);
  if (!count) return "";
  const listed = paths.slice(0, NOTED_PATH_LIMIT);
  const more = count - listed.length;
  return `Vibe64 updated this session to the saved version. These files changed: ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Re-read them before editing them, and re-run any checks that touch them.`;
}

const UPDATE_STOPPED_CODES = new Set([
  "vibe64_session_update_head_moved",
  "vibe64_session_update_ignored_file",
  "vibe64_session_update_worktree_changed"
]);

/**
 * What the main chat's AI is told after Save moved its session onto the saved version: that its work was saved as
 * it was when Save started, and which files Save itself changed, so it reads them again.
 * @param {{ refreshedPaths?: string[], unsavedPathCount?: number }} result
 */
function saveMainChatNote(result = {}) {
  const paths = result.refreshedPaths || [];
  const listed = paths.slice(0, NOTED_PATH_LIMIT);
  const more = paths.length - listed.length;
  return [
    "Vibe64 saved this session's work as it was when Save started, including unfinished changes.",
    result.unsavedPathCount ? "Changes made to files after that are not saved yet." : "",
    paths.length
      ? `Save also regenerated these files: ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}. Re-read them before editing them.`
      : "Save changed no files, so nothing needs re-reading."
  ].filter(Boolean).join(" ");
}

/**
 * The copy whose Update failed, as the Update's own failure: a conflict first,
 * so its review and repair run as the session's own conflict does.
 * @param {object[]} [connected] Update's results for the copies
 */
function connectedUpdateFailure(connected = []) {
  const failed = connected.filter(copy => copy.status === "failed");
  const copy = failed.find(entry => entry.conflictRecovery) || failed[0];
  if (!copy) return null;
  return vibe64Error(copy.error, copy.code || "vibe64_connected_copy_update_failed", {
    details: { conflictPaths: copy.conflictPaths || [], conflictRecovery: copy.conflictRecovery || null, connectedRepository: copy.name },
    status: 409
  });
}

/**
 * A session's work, in its own repository and its connected copies: its
 * current changes, the Save that publishes them, the Update that rebases them
 * onto the saved versions, and a pull request for them.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionWorkRecovery} dependencies.recovery
 * @param {SessionUpdateChecks} dependencies.repositoryUpdates
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkOperations} dependencies.workOperations
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createSessionWork({
  project,
  publishSessionChanged,
  recovery,
  repositoryUpdates,
  terminals,
  workOperations,
  workspaceSetup
}) {
  const activeWorkInspections = new Map();

  /**
   * The session's work, with each connected copy's in `connected`, after
   * recovering a Save or Update an earlier server left running.
   * @param {string} sessionId
   */
  async function inspectSessionWork(sessionId) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      const existingTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
      const operation = await recovery.recoverInterruptedSave(runtime, session, existingTask);
      const updateTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
      const recoveredUpdateOperation = await recovery.recoverInterruptedUpdate(runtime, session, updateTask);
      const updateOperation = recoveredUpdateOperation?.status === "failed"
        ? await recovery.resolveSupersededUpdateFailure(runtime, sessionId, operation)
        : recoveredUpdateOperation;
      const current = await runtime.getSessionWithoutSource(sessionId);
      const inspectionKey = JSON.stringify([
        runtime.stateRoot,
        sessionId,
        current.metadata?.source_path,
        current.metadata?.base_commit,
        current.metadata?.canonical_commit,
        current.metadata?.connected_copies
      ]);
      let inspection = activeWorkInspections.get(inspectionKey);
      if (!inspection) {
        inspection = Promise.resolve().then(() => terminals.inspectSessionWork(sessionId, {
          runtime,
          session: current
        }));
        activeWorkInspections.set(inspectionKey, inspection);
      }
      let work;
      try {
        work = await inspection;
      } finally {
        // Share only overlapping reads; the next read must inspect current files.
        if (activeWorkInspections.get(inspectionKey) === inspection) {
          activeWorkInspections.delete(inspectionKey);
        }
      }
      // resolveSupersededUpdateFailure returns null when no Save applies.
      await recovery.resolveRepairedUpdateFailure(runtime, session, updateOperation || recoveredUpdateOperation);
      const [latestOperation, latestUpdateOperation] = await Promise.all([
        runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
        runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
      ]);
      const activeSaveOperationId = normalizeText(workOperations.operationId("save", sessionId));
      const activeUpdateOperationId = normalizeText(workOperations.operationId("update", sessionId));
      return {
        ...work,
        activeOperation: activeSaveOperationId
          ? { kind: "save", operationId: activeSaveOperationId }
          : activeUpdateOperationId
            ? { kind: "update", operationId: activeUpdateOperationId }
            : null,
        operation: latestOperation || operation,
        updateOperation: latestUpdateOperation || updateOperation,
        ok: true
      };
    }, "Vibe64 could not inspect this session's work.");
  }

  async function inspectSessionChanges(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      return terminals.inspectSessionChanges(sessionId, {
        ...input,
        runtime,
        session
      });
    }, "Vibe64 could not inspect this session's current changes.");
  }

  async function inspectSessionChangeDiff(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      return terminals.inspectSessionChangeDiff(sessionId, {
        ...input,
        runtime,
        session
      });
    }, "Vibe64 could not inspect this changed file.");
  }

  async function createSessionPullRequest(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntimeWithoutSource();
      const session = await runtime.getSessionWithoutSource(sessionId);
      try {
        return await terminals.createSessionPullRequest(sessionId, {
          destinationReview: input.destinationReview,
          title: input.title,
          body: input.body,
          draft: input.draft,
          operationId: crypto.randomUUID(),
          runtime,
          session,
          vibe64User
        });
      } finally {
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-pull-request",
          session: await runtime.getSessionWithoutSource(sessionId)
        });
      }
    }, "The pull request could not be confirmed. Retry to check GitHub and continue.");
  }

  async function saveSessionWork(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntimeWithoutSource();
      await refuseDuringRepositoryAiTask(runtime, sessionId, input.aiTaskId);
      let session = await runtime.getSessionWithoutSource(sessionId);
      const previous = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
      if (previous?.status === "failed" && (
        previous.stage === "publishing" || previous.code === "vibe64_session_save_publication_unknown"
      )) {
        const recovered = await recovery.recoverInterruptedSave(runtime, session, previous);
        if (recovered?.status === "failed" && recovered.code === "vibe64_session_save_publication_unknown") {
          throw vibe64Error(
            recovered.error || "Inspect the uncertain Save before saving again.",
            "vibe64_session_save_publication_unknown"
          );
        }
        session = await runtime.getSessionWithoutSource(sessionId);
      }
      const operationId = crypto.randomUUID();
      let operationStarted = false;
      try {
        const result = await terminals.saveSessionWork(sessionId, {
          destinationReview: input.destinationReview,
          onRepositoryWriteAcquired: async () => {
            operationStarted = true;
            workOperations.start("save", sessionId, operationId);
            const savedTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
              event: {
                kind: "save-started",
                message: "Saving session work.",
                status: "running"
              },
              patch: {
                assistantHelper: savedTask?.assistantHelper || null,
                operationId,
                status: "running"
              },
              reset: true
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-save-started",
              session: await runtime.getSessionWithoutSource(sessionId)
            });
          },
          operationId,
          onProgress: async (progress = {}) => {
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
              event: {
                kind: normalizeText(progress.kind) || "save-progress",
                message: normalizeText(progress.message),
                status: "running"
              },
              patch: {
                ...progress,
                operationId,
                status: "running"
              }
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-save-progress",
              session: await runtime.getSessionWithoutSource(sessionId)
            });
          },
          runtime,
          session,
          vibe64User
        });
        // A Save of connected copies alone has no commit of the session's own.
        if (result.saveCommit) {
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.saveCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.saveCommit);
          }
        }
        const changedDuringSave = result.unsavedPathCount || 0;
        // Save keeps the session on its own commit when one was made in it while Save ran.
        const savedMessage = result.cacheMaintenance?.retryable === true
          ? "Session work was saved. The local clone cache could not be refreshed and will be retried later."
          : result.reconciled === true
            ? "Session work was saved."
            : "Session work was saved, but a Git commit was made in this session while Save ran, so it still shows its own version, with every change kept. Nothing was lost. Update brings it onto the saved version.";
        const unsavedMessage = result.reconciled === true && changedDuringSave
          ? `${changedDuringSave} ${changedDuringSave === 1 ? "file" : "files"} changed while Save ran; ${changedDuringSave === 1 ? "that change stays" : "those changes stay"} unsaved.`
          : "";
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
          event: {
            kind: result.status,
            message: [
              savedMessage,
              unsavedMessage,
              ...(result.connected || []).map(copy => `[Connected] ${copy.name} saved at ${copy.saveCommit.slice(0, 12)}.`)
            ].filter(Boolean).join("\n"),
            status: "ready"
          },
          patch: {
            ...result,
            code: "",
            status: "ready"
          }
        });
        if (result.saveCommit) {
          await recovery.retireRecordedSave(sessionId, operationId, { runtime });
          await recovery.resolveSupersededUpdateFailure(runtime, sessionId, result, { knownNewer: true });
        }
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-save-completed",
          session: await runtime.getSessionWithoutSource(sessionId)
        });
        if (result.saveCommit) {
          await repositoryUpdates.publishCanonicalChanged(runtime, sessionId, result.saveCommit, {
            originId: input.originId
          });
        }
        // A running turn learns its work so far was saved; an idle one has nothing to act on. A session left on
        // its earlier version has nothing new to learn either.
        if (result.reconciled === true) {
          await terminals.noteMainChat(sessionId, { message: saveMainChatNote(result) }, { runtime, vibe64User });
        }
        return {
          ...result,
          operation: task,
          ok: true
        };
      } catch (error) {
        if (!operationStarted) {
          throw error;
        }
        const updateRequired = error?.code === "vibe64_session_save_update_required";
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
          event: {
            kind: updateRequired ? "save-update-required" : "save-failed",
            message: normalizeText(error?.message) || "Session Save failed.",
            status: updateRequired ? "ready" : "failed"
          },
          patch: {
            code: normalizeText(error?.code),
            ...(updateRequired
              ? { updateRequired: true }
              : { error: normalizeText(error?.message) || "Session Save failed." }),
            operationId,
            status: updateRequired ? "ready" : "failed"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: updateRequired ? "session-save-update-required" : "session-save-failed",
          session: await runtime.getSessionWithoutSource(sessionId),
          task
        });
        throw error;
      } finally {
        workOperations.finish("save", sessionId, operationId);
      }
    }, "Vibe64 could not save this session's work.");
  }

  /**
   * Update: each connected copy, then the session's own repository, onto
   * their saved versions. A copy that cannot be updated stays unchanged and
   * its line says why; the others still update, and the Update then fails
   * with that copy's problem, a conflict being reviewed and repaired like the
   * session's own (`reviewedConflictId` resumes the copy its recovery names).
   * @param {string} sessionId
   * @param {object} input
   */
  async function updateSessionWork(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntimeWithoutSource();
      await refuseDuringRepositoryAiTask(runtime, sessionId, input.aiTaskId);
      const session = await runtime.getSessionWithoutSource(sessionId);
      const reviewedConflictId = normalizeText(input.reviewedConflictId);
      // Ordinary Rebase starts over; only an explicit repair check resumes a conflict.
      const previousTask = reviewedConflictId
        ? await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
        : null;
      const conflictRecovery = previousTask?.status === "failed" &&
        previousTask?.conflictRecovery && typeof previousTask.conflictRecovery === "object"
        ? previousTask.conflictRecovery
        : null;
      const operationId = crypto.randomUUID();
      let operationStarted = false;
      try {
        const result = await terminals.updateSessionWork(sessionId, {
          historyReview: input.historyReview,
          conflictRecovery,
          reviewedConflictId,
          signal: input.signal || null,
          onRepositoryWriteAcquired: async () => {
            operationStarted = true;
            workOperations.start("update", sessionId, operationId);
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
              event: {
                kind: "update-started",
                message: "Updating this session (rebase).",
                status: "running"
              },
              patch: { operationId, requestId: normalizeText(input.requestId), status: "running" },
              reset: true
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-update-started",
              session: await runtime.getSessionWithoutSource(sessionId)
            });
          },
          operationId,
          onProgress: async (progress = {}) => {
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
              event: {
                kind: normalizeText(progress.kind) || "update-progress",
                message: normalizeText(progress.message),
                status: "running"
              },
              patch: { ...progress, operationId, status: "running" }
            });
          },
          runtime,
          session,
          vibe64User: input.vibe64User || null
        });
        await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
        if (result.reconciled === true) {
          await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
        }
        const refreshedSession = await runtime.getSessionWithoutSource(sessionId);
        const refreshedWork = await terminals.inspectSessionWork(sessionId, {
          runtime,
          session: refreshedSession
        });
        const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, refreshedWork);
        // Keep the update active while automatic preparation is starting so
        // invalidation is presented as pending, not a manual setup failure.
        await workspaceSetup.prepareUpdatedWorkspace(runtime, sessionId, {
          originId: input.originId,
          vibe64User: input.vibe64User || null
        });
        const note = updateMainChatNote(result);
        if (note) {
          await terminals.noteMainChat(sessionId, { message: note, nextTurn: true }, {
            runtime,
            vibe64User: input.vibe64User || null
          });
        }
        const copyFailure = connectedUpdateFailure(result.connected);
        if (copyFailure) throw copyFailure;
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
          event: {
            kind: result.status,
            message: [
              result.status === "already_current" ? "This session was already current." : "This session was updated.",
              ...(result.connected || []).map(copy => copy.line)
            ].join("\n"),
            status: "ready"
          },
          patch: {
            ...result,
            code: "",
            conflictPaths: [],
            conflictRecovery: null,
            error: "",
            status: "ready"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-update-completed",
          session: await runtime.getSessionWithoutSource(sessionId)
        });
        return {
          ...result,
          ...updateCheck,
          ok: true,
          operation: task
        };
      } catch (error) {
        if (!operationStarted) {
          throw error;
        }
        // An Update cancelled, or stopped because the session changed while it ran, resolved nothing, so the
        // conflicts it was resuming still stand for the next run.
        const cancelled = input.signal?.aborted === true;
        const stopped = cancelled || UPDATE_STOPPED_CODES.has(normalizeText(error?.code));
        const recovery = error?.details?.conflictRecovery || (stopped ? conflictRecovery : null);
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
          event: {
            kind: cancelled ? "update-cancelled" : "update-failed",
            message: normalizeText(error?.message) || "Session update failed.",
            status: "failed"
          },
          patch: {
            code: normalizeText(error?.code),
            conflictPaths: Array.isArray(error?.details?.conflictPaths)
              ? error.details.conflictPaths
              : recovery?.conflictPaths || [],
            conflictRecovery: recovery,
            connectedRepository: normalizeText(error?.details?.connectedRepository || recovery?.connectedRepository),
            error: normalizeText(error?.message) || "Session update failed.",
            operationId,
            status: "failed"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: "session-update-failed",
          session: await runtime.getSessionWithoutSource(sessionId),
          task
        });
        throw error;
      } finally {
        workOperations.finish("update", sessionId, operationId);
      }
    }, "Vibe64 could not update this session.");
  }

  return Object.freeze({
    createSessionPullRequest,
    inspectSessionChangeDiff,
    inspectSessionChanges,
    inspectSessionWork,
    saveSessionWork,
    updateSessionWork
  });
}

export { createSessionWork };
