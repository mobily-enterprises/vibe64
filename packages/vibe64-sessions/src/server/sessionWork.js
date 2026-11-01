import crypto from "node:crypto";
import { sessionConnectedSubmissions } from "@local/vibe64-core/server/projectRepository";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";
import { persistRepositoryUpdateCheck } from "./sessionRepositoryUpdates.js";
import { sessionResult } from "./sessionResults.js";
import { text } from "./trimmedText.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SessionWorkOperations} SessionWorkOperations */
/** @typedef {import("./types.js").SessionWorkspaceSetup} SessionWorkspaceSetup */
/** @typedef {ReturnType<typeof import("./sessionWorkRecovery.js").createSessionWorkRecovery>} SessionWorkRecovery */
/** @typedef {ReturnType<typeof import("./sessionRepositoryUpdates.js").createSessionRepositoryUpdates>} SessionRepositoryUpdates */
/** @typedef {ReturnType<typeof import("./connectedContributions.js").createConnectedContributions>} ConnectedContributions */

/**
 * A session's own work: its current changes, the Save that publishes them,
 * the Update that rebases them onto the saved project version, and a pull
 * request for them.
 * @param {object} dependencies
 * @param {ConnectedContributions} dependencies.connectedContributions
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionWorkRecovery} dependencies.recovery
 * @param {SessionRepositoryUpdates} dependencies.repositoryUpdates
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkOperations} dependencies.workOperations
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createSessionWork({
  connectedContributions,
  project,
  publishSessionChanged,
  recovery,
  repositoryUpdates,
  terminals,
  workOperations,
  workspaceSetup
}) {
  const activeWorkInspections = new Map();

  async function inspectSessionWork(sessionId, requestContext = {}, {
    includeConnected = true,
    inspectContributionPublication = false,
    knownSubmittedCommit = ""
  } = {}) {
    return sessionResult(async () => {
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      const session = await runtime.getSession(sessionId, {
        inspectSource: false
      });
      const existingTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
      const operation = await recovery.recoverInterruptedSave(runtime, session, existingTask);
      const confirmedContributionCommit = text(operation?.verifiedCommit) || knownSubmittedCommit;
      const updateTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
      const recoveredUpdateOperation = await recovery.recoverInterruptedUpdate(runtime, session, updateTask);
      const updateOperation = recoveredUpdateOperation?.status === "failed"
        ? await recovery.resolveSupersededUpdateFailure(runtime, sessionId, operation)
        : recoveredUpdateOperation;
      const inspectionKey = JSON.stringify([
        runtime.stateRoot,
        sessionId,
        session.metadata?.source_path,
        session.metadata?.base_commit,
        session.metadata?.canonical_commit,
        inspectContributionPublication,
        confirmedContributionCommit
      ]);
      let inspection = activeWorkInspections.get(inspectionKey);
      if (!inspection) {
        inspection = Promise.resolve().then(() => terminals.inspectSessionWork(sessionId, {
          runtime,
          session,
          ...(inspectContributionPublication ? {
            inspectContributionPublication: true,
            knownSubmittedCommit: confirmedContributionCommit
          } : {})
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
      const activeSaveOperationId = text(workOperations.operationId("save", sessionId));
      const activeUpdateOperationId = text(workOperations.operationId("update", sessionId));
      let connected = [];
      let connectedInspectionError = "";
      if (includeConnected) {
        try {
          connected = await connectedContributions.inspectConnectedWork(session, requestContext);
        } catch (error) {
          // Receiving status must not hide Main Save. Its separate publication
          // preflight repeats the authorized inspection and refuses unknowns.
          connectedInspectionError = text(error?.message) || "Connected repository status is unavailable. Retry Save to check it again.";
        }
      }
      return {
        ...work,
        connected,
        connectedInspectionError,
        connectedSaveRequired: connected.some(item => item.needsSave),
        connectedRequirementsPresent: sessionConnectedSubmissions(session).length > 0,
        connectedReview: connected.map(({ projectSlug, destination }) => ({ projectSlug, destination })),
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
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      const session = await runtime.getSession(sessionId, {
        inspectSource: false
      });
      return terminals.inspectSessionChanges(sessionId, {
        ...input,
        runtime,
        session
      });
    }, "Vibe64 could not inspect this session's current changes.");
  }

  async function inspectSessionChangeDiff(sessionId, input) {
    return sessionResult(async () => {
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      const session = await runtime.getSession(sessionId, {
        inspectSource: false
      });
      return terminals.inspectSessionChangeDiff(sessionId, {
        ...input,
        runtime,
        session
      });
    }, "Vibe64 could not inspect this changed file.");
  }

  async function createSessionPullRequest(sessionId, input, requestContext) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      try {
        return await terminals.createSessionPullRequest(sessionId, {
          assertConnectedWorkSaved: () => connectedContributions.assertConnectedWorkSaved(runtime, sessionId, requestContext),
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
          originId: text(input.originId),
          reason: "session-pull-request",
          session: await runtime.getSession(sessionId, { inspectSource: false })
        });
      }
    }, "The pull request could not be confirmed. Retry to check GitHub and continue.");
  }

  async function saveSessionWork(sessionId, input = {}, requestContext = {}) {
    if (input.connectedReview !== undefined) return connectedContributions.saveConnectedWork(sessionId, input, requestContext);
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      let session = await runtime.getSession(sessionId, {
        inspectSource: false
      });
      const previous = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
      if (previous?.status === "failed" && (
        previous.stage === "publishing" || previous.code === "vibe64_session_save_publication_unknown"
      )) {
        const recovered = await recovery.recoverInterruptedSave(runtime, session, previous);
        if (recovered?.status === "failed" && recovered.code === "vibe64_session_save_publication_unknown") {
          throw Object.assign(new Error(recovered.error || "Inspect the uncertain Save before saving again."), {
            code: recovered.code
          });
        }
        session = await runtime.getSession(sessionId, { inspectSource: false });
      }
      const operationId = crypto.randomUUID();
      let operationStarted = false;
      try {
        const result = await terminals.saveSessionWork(sessionId, {
          destinationReview: input.destinationReview,
          assertConnectedWorkSaved: () => connectedContributions.assertConnectedWorkSaved(runtime, sessionId, requestContext),
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
              originId: text(input.originId),
              reason: "session-save-started",
              session: await runtime.getSession(sessionId, { inspectSource: false })
            });
          },
          operationId,
          onProgress: async (progress = {}) => {
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
              event: {
                kind: text(progress.kind) || "save-progress",
                message: text(progress.message),
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
              originId: text(input.originId),
              reason: "session-save-progress",
              session: await runtime.getSession(sessionId, { inspectSource: false })
            });
          },
          runtime,
          session,
          vibe64User
        });
        await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.saveCommit);
        if (result.reconciled === true) {
          await runtime.store.writeMetadataValue(sessionId, "base_commit", result.saveCommit);
        }
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
          event: {
            kind: result.status,
            message: result.cacheMaintenance?.retryable === true
              ? "Session work was saved. The local clone cache could not be refreshed and will be retried later."
              : result.reconciled === true
                ? "Session work was saved."
                : "Session work was pushed and needs local reconciliation.",
            status: "ready"
          },
          patch: {
            ...result,
            code: "",
            status: "ready"
          }
        });
        await recovery.retireRecordedSave(sessionId, operationId, { runtime });
        await recovery.resolveSupersededUpdateFailure(runtime, sessionId, result, { knownNewer: true });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-save-completed",
          session: await runtime.getSession(sessionId, { inspectSource: false })
        });
        await repositoryUpdates.publishCanonicalChanged(runtime, sessionId, result.saveCommit, {
          originId: input.originId
        });
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
            message: text(error?.message) || "Session Save failed.",
            status: updateRequired ? "ready" : "failed"
          },
          patch: {
            code: text(error?.code),
            ...(updateRequired
              ? { updateRequired: true }
              : { error: text(error?.message) || "Session Save failed." }),
            operationId,
            status: updateRequired ? "ready" : "failed"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: updateRequired ? "session-save-update-required" : "session-save-failed",
          session: await runtime.getSession(sessionId, { inspectSource: false }),
          task
        });
        throw error;
      } finally {
        workOperations.finish("save", sessionId, operationId);
      }
    }, "Vibe64 could not save this session's work.");
  }

  async function updateSessionWork(sessionId, input = {}) {
    return sessionResult(async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      const reviewedConflictId = text(input.reviewedConflictId);
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
          onRepositoryWriteAcquired: async () => {
            operationStarted = true;
            workOperations.start("update", sessionId, operationId);
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
              event: {
                kind: "update-started",
                message: "Updating this session (rebase).",
                status: "running"
              },
              patch: { operationId, requestId: text(input.requestId), status: "running" },
              reset: true
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: text(input.originId),
              reason: "session-update-started",
              session: await runtime.getSession(sessionId, { inspectSource: false })
            });
          },
          operationId,
          onProgress: async (progress = {}) => {
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
              event: {
                kind: text(progress.kind) || "update-progress",
                message: text(progress.message),
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
        const refreshedSession = await runtime.getSession(sessionId, { inspectSource: false });
        const refreshedWork = await terminals.inspectSessionWork(sessionId, {
          runtime,
          session: refreshedSession
        });
        const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, refreshedWork);
        // Keep the update active while automatic preparation is starting so
        // invalidation is presented as pending, not a manual setup failure.
        // A connected refresh that changed nothing leaves its setup alone.
        if (!(input.connectedRefresh === true && result.status === "already_current")) {
          await workspaceSetup.prepareUpdatedWorkspace(runtime, sessionId, {
            originId: input.originId,
            wait: input.connectedRefresh === true
          });
        }
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
          event: {
            kind: result.status,
            message: result.status === "already_current" ? "This session was already current." : "This session was updated.",
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
          originId: text(input.originId),
          reason: "session-update-completed",
          session: await runtime.getSession(sessionId, { inspectSource: false })
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
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
          event: {
            kind: "update-failed",
            message: text(error?.message) || "Session update failed.",
            status: "failed"
          },
          patch: {
            code: text(error?.code),
            conflictPaths: Array.isArray(error?.details?.conflictPaths)
              ? error.details.conflictPaths
              : [],
            conflictRecovery: error?.details?.conflictRecovery || null,
            error: text(error?.message) || "Session update failed.",
            operationId,
            status: "failed"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-update-failed",
          session: await runtime.getSession(sessionId, { inspectSource: false }),
          task
        });
        throw error;
      } finally {
        workOperations.finish("update", sessionId, operationId);
      }
    }, "Vibe64 could not update this session.");
  }

  return Object.freeze({
    inspectSessionWork,
    inspectSessionChanges,
    inspectSessionChangeDiff,
    createSessionPullRequest,
    saveSessionWork,
    updateSessionWork
  });
}

export { createSessionWork };
