import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */
/** @typedef {import("./types.js").SessionWorkspaceSetup} SessionWorkspaceSetup */

/**
 * Save and Update records that outlived their operation: an interrupted one
 * recovered, a failed Update that a later Save or the session's own repository
 * resolved, and a recorded Save's prepared ref retired.
 * @param {object} dependencies
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkOperations} dependencies.workOperations
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createSessionWorkRecovery({
  terminals,
  workOperations,
  workspaceSetup
}) {
  /**
   * Once a Save's outcome is recorded, its prepared ref is no longer recovery
   * evidence. Retiring is best effort: a later recovery still reads the record.
   */
  async function retireRecordedSave(sessionId, operationId, context) {
    if (!normalizeText(operationId)) return;
    try {
      await terminals.retireSessionWorkSave(sessionId, { ...context, operationId });
    } catch (error) {
      vibe64SessionDebugLog("server.sessions.save.retire.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} session
   * @param {object} task
   */
  async function recoverInterruptedSave(runtime, session, task) {
    const failedPublication = task?.status === "failed" && (
      task.stage === "publishing" || task.code === "vibe64_session_save_publication_unknown"
    );
    if (task?.status !== "running" && !failedPublication) {
      return task;
    }
    if (workOperations.operationId("save", session.sessionId) === normalizeText(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkSave(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.saveCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.saveCommit);
      }
      const recorded = await runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovered",
          message: result.cacheMaintenance?.retryable === true
            ? "Interrupted Save recovered. The local clone cache could not be refreshed and will be retried later."
            : result.reconciled === true
              ? "Interrupted Save recovered and reconciled."
              : "Interrupted Save was pushed and needs local reconciliation.",
          status: "ready"
        },
        patch: {
          ...result,
          code: "",
          error: "",
          status: "ready"
        }
      });
      await retireRecordedSave(session.sessionId, task.operationId, { runtime });
      return recorded;
    } catch (error) {
      // A prepared-ref check can prove this failed attempt never published.
      // Preserve its actionable original rejection instead of replacing it
      // with a generic interrupted-Save notice.
      if (failedPublication && task.code !== "vibe64_session_save_publication_unknown" &&
          error.code === "vibe64_session_save_interrupted_retryable") return task;
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovery-failed",
          message: normalizeText(error?.message) || "Interrupted Save needs attention.",
          status: "failed"
        },
        patch: {
          code: normalizeText(error?.code),
          error: normalizeText(error?.message) || "Interrupted Save needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} session
   * @param {object} task
   */
  async function recoverInterruptedUpdate(runtime, session, task) {
    if (task?.status !== "running") {
      return task;
    }
    if (workOperations.operationId("update", session.sessionId) === normalizeText(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkUpdate(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.canonicalCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.canonicalCommit);
      }
      const recovered = await runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovered",
          message: "Interrupted session update recovered.",
          status: "ready"
        },
        patch: { ...result, status: "ready" }
      });
      await workspaceSetup.prepareUpdatedWorkspace(runtime, session.sessionId);
      return recovered;
    } catch (error) {
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovery-failed",
          message: normalizeText(error?.message) || "Interrupted session update needs attention.",
          status: "failed"
        },
        patch: {
          code: normalizeText(error?.code),
          error: normalizeText(error?.message) || "Interrupted session update needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {object | null} [saveResult]
   * @param {object} [options]
   */
  async function resolveSupersededUpdateFailure(runtime, sessionId, saveResult, options = {}) {
    if (saveResult?.reconciled !== true) {
      return null;
    }
    const task = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
    if (task?.status !== "failed") {
      return task || null;
    }
    if (options.knownNewer !== true) {
      const saveUpdatedAt = Date.parse(normalizeText(saveResult.updatedAt));
      const updateUpdatedAt = Date.parse(normalizeText(task.updatedAt));
      if (
        !Number.isFinite(saveUpdatedAt) ||
        !Number.isFinite(updateUpdatedAt) ||
        saveUpdatedAt <= updateUpdatedAt
      ) {
        return task;
      }
    }
    return runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
      event: {
        kind: "update-superseded-by-save",
        message: "The repository issue was resolved by the completed Save.",
        status: "ready"
      },
      patch: {
        code: "",
        error: "",
        resolvedBySaveCommit: normalizeText(saveResult.saveCommit),
        retryable: false,
        status: "ready"
      }
    });
  }

  /**
   * A failed Update that the session's own repository has since repaired
   * outside Save or Update (an assistant or a person using Git directly) no
   * longer applies once its checkout proves all of this: HEAD contains the
   * saved version the Update was trying to reach, or Update has nothing left
   * to apply; no merge, rebase, cherry-pick or revert is unfinished; and no
   * file is conflicted. The record keeps its checkpoint and conflict evidence
   * and gains an event saying why it was resolved. Anything else leaves the
   * failure, and its reason, as it was.
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} session
   * @param {object} task
   */
  async function resolveRepairedUpdateFailure(runtime, session, task) {
    if (task?.status !== "failed") {
      return task;
    }
    let evidence;
    try {
      evidence = await terminals.inspectSessionUpdateFailure(session.sessionId, {
        runtime,
        session,
        targetCommit: normalizeText(task.conflictRecovery?.canonicalCommit)
      });
    } catch (error) {
      // Unreadable evidence proves nothing; the failure stays.
      vibe64SessionDebugLog("server.sessions.updateFailure.inspect.error", {
        error: vibe64SessionDebugError(error),
        sessionId: session.sessionId
      });
      return task;
    }
    const reached = evidence?.targetInHead === true;
    if (
      normalizeText(evidence?.gitOperation) ||
      !Array.isArray(evidence?.unmergedPaths) || evidence.unmergedPaths.length > 0 ||
      (!reached && evidence?.updateNeeded !== false)
    ) {
      return task;
    }
    return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
      event: {
        kind: "update-resolved-in-repository",
        message: reached
          ? "The session now contains the saved version this Update was trying to apply, with no unfinished Git operation or conflicted file, so the Update failure no longer applies."
          : "The session already contains the latest saved version, with no unfinished Git operation or conflicted file, so the Update failure no longer applies.",
        status: "ready"
      },
      patch: {
        code: "",
        error: "",
        resolvedAtCommit: normalizeText(evidence.sessionHead),
        retryable: false,
        status: "ready"
      },
      /**
       * Only the failure that was inspected; a newer Update keeps its own record.
       */
      shouldWrite: ({ previous }) => previous.status === "failed" &&
        normalizeText(previous.operationId) === normalizeText(task.operationId)
    });
  }

  return Object.freeze({
    recoverInterruptedSave,
    recoverInterruptedUpdate,
    resolveRepairedUpdateFailure,
    resolveSupersededUpdateFailure,
    retireRecordedSave
  });
}

export { createSessionWorkRecovery };
