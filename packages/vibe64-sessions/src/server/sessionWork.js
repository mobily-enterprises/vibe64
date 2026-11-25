import crypto from "node:crypto";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { createSessionPullRequests } from "./sessionPullRequests.js";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";
import { cachedRepositoryUpdateCheck, persistRepositoryUpdateCheck } from "./sessionRepositoryUpdates.js";
import { nameNewerSavedRefusal, recordSessionSave, workNewerSaved } from "./sessionNewerSaved.js";
import { refuseDuringRepositoryAiTask, runningRepositoryAiTask, sessionResult } from "./sessionResults.js";
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
const WORK_TASK_IDS = Object.freeze({ save: SESSION_SAVE_TASK_ID, update: SESSION_UPDATE_TASK_ID });

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

// The Update stops that put the session back as it was before Update ran, unless they say it was not `undone`.
const UPDATE_STOPPED_CODES = new Set([
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
 * What an Update moved: this session's own repository (its saved commit, status
 * and changed files) and each copy it updated. The answer's other fields are
 * the update check made afterwards, whose `canonicalCommit` and `connected`
 * replace the Update's own, so its callers read these here.
 * @param {{ canonicalCommit?: string, connected?: object[], status?: string, updatedPathCount?: number, updatedPaths?: string[] }} result
 */
function updateMoves(result) {
  return {
    canonicalCommit: result.canonicalCommit,
    connected: (result.connected || []).filter(entry => entry.status !== "failed"),
    status: result.status,
    updatedPathCount: result.updatedPathCount || 0,
    updatedPaths: result.updatedPaths || []
  };
}

/**
 * The copy whose Update failed, as the Update's own failure: a conflict first,
 * so its review and repair run as the session's own conflict does. `updated`
 * keeps what the Update did move (this session's own repository and the other
 * copies), so its caller still learns which files changed.
 * @param {{ connected?: object[] }} result
 */
function connectedUpdateFailure(result) {
  const failed = (result.connected || []).filter(copy => copy.status === "failed");
  const copy = failed.find(entry => entry.conflictRecovery) || failed[0];
  if (!copy) return null;
  return vibe64Error(copy.error, copy.code || "vibe64_connected_copy_update_failed", {
    details: {
      conflictPaths: copy.conflictPaths || [],
      conflictRecovery: copy.conflictRecovery || null,
      connectedRepository: copy.name,
      undone: copy.undone !== false,
      updated: updateMoves(result)
    },
    status: 409
  });
}

/**
 * A session's work, in its own repository and its connected copies: its
 * current changes, the Save that publishes them, the Update that rebases them
 * onto the saved versions, and a pull request for them.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionWorkRecovery} dependencies.recovery
 * @param {SessionUpdateChecks} dependencies.repositoryUpdates
 * @param {TerminalsService} dependencies.terminals
 * @param {SessionWorkOperations} dependencies.workOperations
 * @param {SessionWorkspaceSetup} dependencies.workspaceSetup
 */
function createSessionWork({
  logger,
  project,
  publishSessionChanged,
  recovery,
  repositoryUpdates,
  terminals,
  workOperations,
  workspaceSetup
}) {
  const activeWorkInspections = new Map();
  // Per kind, by session: the answer to the Save or Update a button started, until that work records its start in
  // its task or is refused before starting.
  const startingWork = Object.freeze({ save: new Map(), update: new Map() });
  // The Saves and Updates a button started, until each has ended.
  const startedWork = new Set();

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
      const [latestOperation, latestUpdateOperation, repositoryAiTask] = await Promise.all([
        runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
        runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID),
        // A repository AI task holds Save and Update until it ends: the session shows it being fixed, not needing help.
        runningRepositoryAiTask(runtime, sessionId)
      ]);
      const activeSaveOperationId = normalizeText(workOperations.operationId("save", sessionId));
      const activeUpdateOperationId = normalizeText(workOperations.operationId("update", sessionId));
      // How many newer saved versions main has, when, from whom and how many files: what the page and the AI say.
      const newerSaved = workNewerSaved(work, cachedRepositoryUpdateCheck(current));
      return {
        ...work,
        ...(newerSaved ? { newerSaved } : {}),
        activeOperation: activeSaveOperationId
          ? { kind: "save", operationId: activeSaveOperationId }
          : activeUpdateOperationId
            ? { kind: "update", operationId: activeUpdateOperationId }
            : null,
        operation: latestOperation || operation,
        updateOperation: latestUpdateOperation || updateOperation,
        ...(repositoryAiTask ? { repositoryAiTask } : {}),
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

  const pullRequests = createSessionPullRequests({ logger, project, publishSessionChanged, terminals });

  /**
   * What a Save or Update button's request is answered with once its work runs: the operation and its task as it is
   * now (null when the task already holds a later operation). The page follows that task to its outcome.
   * @param {"save" | "update"} kind
   * @param {string} sessionId
   * @param {string} operationId
   * @param {object | null} [task] the task as the work recorded its start, read again when absent
   */
  async function runningWorkAnswer(kind, sessionId, operationId, task = null) {
    const current = task || await (await project.createRuntimeWithoutSource())
      .store.readBackgroundTask(sessionId, WORK_TASK_IDS[kind]);
    return {
      ok: true,
      operation: normalizeText(current?.operationId) === operationId ? current : null,
      operationId,
      running: true
    };
  }

  /**
   * A Save or Update for a request that must not wait for it to finish: the Save and Update buttons'. The hosted edge
   * in front of a workspace ends a request after about a minute, while an Update or Save of several connected
   * repositories runs for minutes. The answer comes once the work has recorded its start in its task (the agent-write
   * lock is waited for at most ten seconds first), or is the refusal that stopped it before it started, the same one
   * the waiting call returns. The work then runs to its end whatever happens to the request; its task holds its
   * progress and outcome, and its publications announce them. A request while one runs, or while one is starting,
   * gets that one, never a second.
   * @param {"save" | "update"} kind
   * @param {string} sessionId
   * @param {object} input
   * @param {(input: object) => Promise<object>} run the waiting Save or Update, given `onStarted`
   */
  async function startSessionWork(kind, sessionId, input, run) {
    const normalizedSessionId = normalizeText(sessionId);
    const starting = startingWork[kind].get(normalizedSessionId);
    if (starting) return starting;
    const runningId = normalizeText(workOperations.operationId(kind, normalizedSessionId));
    if (runningId) return runningWorkAnswer(kind, normalizedSessionId, runningId);
    const answer = Promise.withResolvers();
    startingWork[kind].set(normalizedSessionId, answer.promise);
    const settle = (value) => {
      if (startingWork[kind].get(normalizedSessionId) === answer.promise) startingWork[kind].delete(normalizedSessionId);
      answer.resolve(value);
    };
    // A refusal before the work started settles the answer; once started, the later outcome no longer can.
    const work = sessionResult(() => run({
      ...input,
      onStarted: task => settle(runningWorkAnswer(kind, normalizedSessionId, normalizeText(task?.operationId), task))
    }), `Vibe64 could not ${kind} this session.`).then((outcome) => {
      settle(outcome);
      startedWork.delete(work);
    });
    startedWork.add(work);
    return answer.promise;
  }

  /**
   * Resolves once every Save and Update a button started, and every pull request the dialog started, has ended and
   * recorded its outcome, as the server's shutdown once waited for them inside their requests.
   */
  async function settleStartedWork() {
    await Promise.allSettled([...startedWork, pullRequests.close()]);
  }

  async function saveSessionWork(sessionId, input) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      const { onStarted = doNothing } = input;
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
            const startedTask = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
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
            onStarted(startedTask);
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
        // Before the other sessions hear of it, so their checks name this session as the one that saved it.
        await recordSessionSave(project, runtime, session, result);
        const changedDuringSave = result.unsavedPathCount || 0;
        // Save keeps the session on its own commit when one was made in it while Save ran.
        const savedMessage = result.cacheMaintenance?.retryable === true
          ? "Session work was saved. The local clone cache could not be refreshed and will be retried later."
          : result.reconciled === true
            ? "Session work was saved."
            : "Session work was saved, but a Git commit was made in this session while Save ran, so the session stays on that commit, with every change kept. Nothing was lost. Update brings it onto the saved version.";
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
        // its earlier version has nothing new to learn either, and neither has the AI that ran this Save itself
        // (`requestedByAgent`): its command's answer says what was saved, and a steer could interrupt that command.
        if (result.reconciled === true && input.requestedByAgent !== true) {
          await terminals.noteMainChat(sessionId, { message: saveMainChatNote(result) }, { runtime, vibe64User });
        }
        return {
          ...result,
          operation: task,
          ok: true
        };
      } catch (error) {
        const updateRequired = error?.code === "vibe64_session_save_update_required";
        // Main has newer saved versions: named for the sessions that saved them, as Save recorded them.
        if (updateRequired) await nameNewerSavedRefusal(runtime, error);
        if (!operationStarted) {
          throw error;
        }
        // Nothing to save is Save's answer, not a failure the session needs help with: a note, as Update first is.
        const nothingToSave = error?.code === "vibe64_session_save_no_changes";
        const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
          event: {
            kind: updateRequired ? "save-update-required" : nothingToSave ? "save-no-changes" : "save-failed",
            message: nothingToSave
              ? "Nothing to save: this session has no unsaved work."
              : normalizeText(error?.message) || "Session Save failed.",
            status: updateRequired || nothingToSave ? "ready" : "failed"
          },
          patch: {
            code: normalizeText(error?.code),
            ...(updateRequired
              ? { updateRequired: true, ...(error.details?.newerSaved ? { details: { newerSaved: error.details.newerSaved } } : {}) }
              : nothingToSave ? {} : { error: normalizeText(error?.message) || "Session Save failed." }),
            operationId,
            status: updateRequired || nothingToSave ? "ready" : "failed"
          }
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: normalizeText(input.originId),
          reason: updateRequired ? "session-save-update-required" : nothingToSave ? "session-save-completed" : "session-save-failed",
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
   * The Save no person reviews before it starts: automatic save's, and the one the session's AI runs with
   * `vibe64-helper session save`. It is the ordinary Save, to the destination the session has now, the one Save's
   * review shows; work with nothing new is Save's own refusal, found before Save takes the session.
   * @param {string} sessionId
   * @param {{ requestedByAgent?: boolean, vibe64User?: object | null }} input
   */
  async function saveToCurrentDestination(sessionId, input) {
    const inspection = await inspectSessionWork(sessionId);
    if (inspection?.ok === false) return inspection;
    if (!inspection.unsaved) {
      return { ok: false, code: "vibe64_session_save_no_changes", error: "This session has no work to save." };
    }
    return saveSessionWork(sessionId, { ...input, destinationReview: inspection.destination });
  }

  /**
   * Update: each connected copy, then the session's own repository, onto
   * their saved versions. A copy that cannot be updated stays unchanged and
   * its line says why; the others still update, and the Update then fails
   * with that copy's problem, a conflict being reviewed and repaired like the
   * session's own (`reviewedConflictId` resumes the copy its recovery names).
   * An Update the session's AI runs itself (`requestedByAgent`) steers no
   * running turn: the command that waits for its answer already says which
   * files changed, and a steer could interrupt that very command.
   * @param {string} sessionId
   * @param {object} input
   */
  async function updateSessionWork(sessionId, input) {
    return sessionResult(async () => {
      const { onStarted = doNothing } = input;
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
            const startedTask = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
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
            onStarted(startedTask);
          },
          operationId,
          // Each step is published, as Save's are, so a page that only follows the task shows it as it happens.
          onProgress: async (progress = {}) => {
            await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
              event: {
                kind: normalizeText(progress.kind) || "update-progress",
                message: normalizeText(progress.message),
                status: "running"
              },
              patch: { ...progress, operationId, status: "running" }
            });
            await publishSessionChanged(sessionId, {
              operation: "updated",
              originId: normalizeText(input.originId),
              reason: "session-update-progress",
              session: await runtime.getSessionWithoutSource(sessionId)
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
          await terminals.noteMainChat(sessionId, {
            message: note,
            nextTurn: true,
            ...(input.requestedByAgent === true ? { steer: false } : {})
          }, {
            runtime,
            vibe64User: input.vibe64User || null
          });
        }
        const copyFailure = connectedUpdateFailure(result);
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
          operation: task,
          updated: updateMoves(result)
        };
      } catch (error) {
        if (!operationStarted) {
          throw error;
        }
        // An Update cancelled, or stopped and put back because the session changed while it ran, resolved nothing,
        // so the conflicts it was resuming still stand for the next run. One that left the session, or a connected
        // copy, updated or on a commit made meanwhile (`undone: false`) has no such conflicts left to resume.
        const cancelled = input.signal?.aborted === true;
        const stopped = (cancelled || UPDATE_STOPPED_CODES.has(normalizeText(error?.code))) && error?.details?.undone !== false;
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

  /**
   * The Save button's Save: `saveSessionWork`, answered once it starts (`startSessionWork`).
   * @param {string} sessionId
   * @param {object} input
   */
  function startSessionSave(sessionId, input) {
    return startSessionWork("save", sessionId, input, startInput => saveSessionWork(sessionId, startInput));
  }

  /**
   * The Update button's Update: `updateSessionWork`, answered once it starts (`startSessionWork`).
   * @param {string} sessionId
   * @param {object} input
   */
  function startSessionUpdate(sessionId, input) {
    return startSessionWork("update", sessionId, input, startInput => updateSessionWork(sessionId, startInput));
  }

  return Object.freeze({
    createSessionPullRequest: pullRequests.createSessionPullRequest,
    inspectSessionChangeDiff,
    inspectSessionChanges,
    inspectSessionWork,
    saveSessionWork,
    saveToCurrentDestination,
    settleStartedWork,
    startSessionPullRequest: pullRequests.startSessionPullRequest,
    startSessionSave,
    startSessionUpdate,
    updateSessionWork
  });
}

export { createSessionWork };
