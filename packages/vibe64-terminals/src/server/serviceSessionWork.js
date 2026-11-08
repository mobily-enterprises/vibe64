import { AppError } from "@jskit-ai/kernel/server/runtime";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { REPOSITORY_UPDATE_CHECK_METADATA } from "@local/vibe64-core/shared";
import {
  assertSessionRepositoryReview,
  sessionConnectedCopies,
  sessionRepositoryDestination
} from "@local/vibe64-core/server/projectRepository";
import { requireCompletedConversationRewind } from "./assistantChangeover.js";
import { recoverConnectedCopySaves, saveConnectedCopies, updateConnectedCopies } from "./sessionConnectedCopies.js";
import {
  connectedCopyOperations,
  conflictReviewFor,
  copiesOnlySaveRecovered,
  recoverConnectedUpdate,
  refuseBehindSessionSave
} from "./serviceSessionConnectedCopies.js";
import { saveError } from "./sessionWorkCommands.js";
import { throwIfUpdateCancelled, updateSessionWork as updateManagedSessionWork } from "./sessionWorkUpdate.js";
import { recoverSessionWorkUpdate as recoverManagedSessionWorkUpdate } from "./sessionWorkUpdateRecovery.js";
import {
  inspectSessionWork as inspectManagedSessionWork,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage as prepareManagedSessionWorkSaveMessage,
  recoverSessionWorkSave as recoverManagedSessionWorkSave,
  retireSessionWorkSave as retireManagedSessionWorkSave,
  saveSessionWork as saveManagedSessionWork
} from "./sessionWorkSave.js";
import { generateSessionSaveCommitMessage } from "./sessionSaveCommitMessage.js";
import { recordSessionGitCommandActor as writeSessionGitCommandActor } from "./sessionGitCommandActor.js";
import { createSessionSource as createManagedSessionSource } from "./sessionSource.js";
import { GENESIS_DERIVED_ARTIFACT_PATHS } from "@local/vibe64-genesis/server";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS, assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { throwIfAgentWriteBusy } from "@local/vibe64-runtime/server/agentWriteLock";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";

/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {ReturnType<typeof import("./serviceAgentConversations.js").createServiceAgentConversations>} ServiceAgentConversations */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */

/**
 * Logs a Save or Update whose derived artifacts Genesis could not regenerate.
 * @param {RuntimeLogger} logger
 * @param {{ derivedArtifactsKept?: { code: string, message: string } } | null} result
 * @param {"save" | "update"} operation
 * @param {string} operationId
 * @param {string} sessionId
 */
function logDerivedArtifactsKept(logger, result, operation, operationId, sessionId) {
  if (!result?.derivedArtifactsKept) return;
  logOperationalEvent(logger, "warn", {
    code: result.derivedArtifactsKept.code,
    component: "vibe64.session_work",
    error: result.derivedArtifactsKept.message,
    event: "vibe64.session_work.derived_artifacts_kept",
    operation,
    operationId,
    sessionId
  }, "Genesis could not regenerate the project's derived artifacts; the work went ahead with the ones it had.");
}

/**
 * A session's work in its repository and its connected copies: the work execution, saving and its
 * recovery, updates, pull requests, the session source and its exclusive reads, and the Git command
 * actor.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {ServiceAgentConversations} dependencies.agentConversations
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 */
function createServiceSessionWork({
  state,
  sessionAccess,
  workspacePreparation,
  agentConversations,
  codexGitCommand,
  env,
  logger,
  project,
  sessionAgent,
  workspaceSetup
}) {
  /**
   * The version name for one Save: the assistant's, or a checkpoint-based one when naming is unavailable.
   */
  async function nameSave(prepared, { agentContext, onProgress = doNothing, operationId, sessionId }) {
    try {
      return await generateSessionSaveCommitMessage({
        agent: sessionAgent,
        agentContext,
        changes: prepared.changes
      });
    } catch (error) {
      // Naming is optional. Leave failed thread ownership intact and let the
      // repository owner enforce the normal checkpoint and publish checks.
      logOperationalEvent(logger, "warn", {
        code: error.code || "vibe64_session_save_message_failed",
        component: "vibe64.session_save",
        event: "vibe64.session_save.message_fallback",
        operationId,
        sessionId
      }, "Assistant naming was unavailable; Save is using a checkpoint-based version name.");
      await onProgress({
        code: error.code || "vibe64_session_save_message_failed",
        kind: "message",
        message: "Assistant naming is unavailable. Saving with a checkpoint-based version name.",
        stage: "message-fallback"
      });
      return {
        executionProfile: null,
        subject: `Save work ${prepared.checkpoint.checkpointTree.slice(0, 12)}`
      };
    }
  }

  function logCacheMaintenance(operationId, sessionId) {
    return (cacheMaintenance = {}) => {
      if (cacheMaintenance.retryable !== true) {
        return;
      }
      logOperationalEvent(logger, "warn", {
        code: cacheMaintenance.code,
        component: "vibe64.session_save",
        event: "vibe64.session_save.cache_maintenance_failed",
        operationId,
        reason: cacheMaintenance.reason,
        sessionId
      }, cacheMaintenance.message || "Vibe64 Save cache maintenance failed.");
    };
  }

  async function saveSessionWorkInsideWrite(sessionId, input, context) {
    const { onProgress = doNothing } = input;
    const { execution, normalizedSessionId, runtime, session } = await sessionWorkExecution(
      sessionId,
      context,
      "session-save",
      { createsCommits: true }
    );
    const projectRecord = await project.readCurrentProject();
    const destination = assertSessionRepositoryReview(projectRecord, session, input.destinationReview);
    const assertWorkflow = async () => {
      if (destination.mode !== "github") return;
      const workflow = await project.readRepositoryWorkflow();
      if (workflow.requirePullRequest && !context.creatingPullRequest &&
          !JSON.parse(session.metadata?.github_pull_request || "null")?.number) {
        throw vibe64Error(
          "This project requires a pull request. Create or open a pull request before saving this session.",
          "vibe64_pull_request_required",
          { messageCode: "vibe64_project_pull_request_required" }
        );
      }
    };
    const agentContext = {
      runtime,
      session,
      vibe64User: input.vibe64User || null
    };
    const copies = sessionConnectedCopies(session);
    // Copies push first, so the session's own work is checked before any push.
    const ownUnsaved = !copies.length || (await inspectManagedSessionWork({
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      project: projectRecord,
      session
    })).unsaved === true;
    if (ownUnsaved) await assertWorkflow();
    const runProjectSourceExclusive = project.runProjectSourceExclusive.bind(project);
    const connected = copies.length ? await saveConnectedCopies({
      beforePush: () => ownUnsaved && refuseBehindSessionSave({
        commandOptions: execution.commandOptions,
        operationId: input.operationId,
        project: projectRecord,
        runCommand: execution.runCommand,
        runProjectSourceExclusive,
        session
      }),
      copies,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      ...connectedCopyOperations({ codexGitCommand, env, runtime, session }, {
        createsCommits: true,
        reason: "session-save",
        runtime,
        vibe64User: input.vibe64User || null
      }),
      nameSave: async (prepared) => (await nameSave(prepared, {
        agentContext,
        operationId: input.operationId,
        sessionId: normalizedSessionId
      })).subject,
      onCacheMaintenance: logCacheMaintenance(input.operationId, normalizedSessionId),
      onProgress,
      operationId: input.operationId,
      project: projectRecord,
      runProjectSourceExclusive,
      session
    }) : [];
    if (!ownUnsaved) {
      if (!connected.length) {
        throw saveError("This session has no work to save.", "vibe64_session_save_no_changes");
      }
      return { connected, ok: true, operationId: input.operationId, reconciled: true, status: "saved" };
    }
    const saveMessageInput = await prepareManagedSessionWorkSaveMessage({
      commandOptions: execution.commandOptions,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      limit: 40,
      operationId: input.operationId,
      project: projectRecord,
      runCommand: execution.runCommand,
      session
    });
    await onProgress({
      checkpointCommit: saveMessageInput.checkpoint.checkpointCommit,
      checkpointTree: saveMessageInput.checkpoint.checkpointTree,
      kind: "message",
      message: "Writing a concise name for this work.",
      stage: "message-writing"
    });
    const commitTitle = await nameSave(saveMessageInput, {
      agentContext,
      onProgress,
      operationId: input.operationId,
      sessionId: normalizedSessionId
    });
    await onProgress({
      executionProfile: commitTitle.executionProfile,
      kind: "message",
      message: "Version name ready.",
      stage: "message-ready"
    });
    const saved = await saveManagedSessionWork({
      checkpoint: saveMessageInput.checkpoint,
      commandOptions: execution.commandOptions,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      message: commitTitle.subject,
      onCacheMaintenance: logCacheMaintenance(input.operationId, normalizedSessionId),
      onProgress: input.onProgress,
      operationId: input.operationId,
      project: projectRecord,
      runCommand: execution.runCommand,
      runProjectSourceExclusive: (operation, options) => project.runProjectSourceExclusive(async () => {
        assertSessionRepositoryReview(await project.readCurrentProject(), session, input.destinationReview);
        await assertWorkflow();
        return operation();
      }, options),
      session
    });
    logDerivedArtifactsKept(logger, saved, "save", input.operationId, normalizedSessionId);
    return { ...saved, commitTitleExecutionProfile: commitTitle.executionProfile, ...(connected.length ? { connected } : {}) };
  }

  async function runSessionRepositoryWrite(
    sessionId,
    options,
    {
      operation: operationName = "repository-write",
      activeCode = "vibe64_session_repository_agent_active",
      activeMessage = "Wait for the assistant turn to finish before changing this session's repository."
    },
    operation
  ) {
    const { onRepositoryWriteAcquired = doNothing } = options;
    const result = await sessionAccess.runMainAgentWrite(sessionId, options, async (context) => {
      if (sessionHasActiveAgentRun(context.session)) {
        const activityCheck = await sessionAgent.ensureSession(sessionId, context);
        context.session = await context.runtime.getSessionWithoutSource(sessionId);
        if (sessionHasActiveAgentRun(context.session)) {
          const error = new Error(activityCheck?.error || activeMessage);
          error.code = activeCode;
          error.retryable = true;
          throw error;
        }
      }
      await onRepositoryWriteAcquired();
      return operation(context);
    }, { operation: operationName, waitMs: 10_000 });
    return throwIfAgentWriteBusy(result);
  }

  /**
   * The Git actor an earlier Save already recorded, for its recovery or retirement.
   */
  async function saveExecution(session, sessionId, purpose) {
    const execution = await codexGitCommand.sessionWorkSaveContext({
      session,
      sessionId: String(sessionId || "").trim()
    });
    if (execution?.ok === false) {
      throw Object.assign(new Error(execution.error || `The Git actor for ${purpose} is not available.`), {
        code: execution.code || "vibe64_session_save_actor_unavailable"
      });
    }
    return execution;
  }

  /**
   * A write that records commits (Save, Update) passes
   * `createsCommits`, so its commands carry the author's own Git name and email.
   */
  async function sessionWorkExecution(sessionId, input = {}, reason = "session-work", options = {}) {
    const { createsCommits = false } = options;
    const normalizedSessionId = String(sessionId || "").trim();
    const read = await sessionAccess.sessionContext(normalizedSessionId, input);
    const { runtime } = read;
    let { session } = read;
    const executionInput = { createsCommits, sessionId: normalizedSessionId, vibe64User: input.vibe64User || null };
    let execution = await codexGitCommand.sessionWorkSaveContext({
      ...executionInput,
      session
    });
    if (execution?.ok === false) {
      const sessionSourceRoot = sessionSourcePath(session);
      const recorded = sessionSourceRoot
        ? await writeSessionGitCommandActor({
          env,
          reason,
          runtime,
          session,
          sourceRoot: sessionSourceRoot,
          threadId: session.metadata?.agent_identity_conversation_id || "",
          vibe64User: input.vibe64User,
          workdir: sessionSourceRoot
        })
        : null;
      if (recorded?.ok !== false && recorded) {
        session = recorded.session || await runtime.getSessionWithoutSource(normalizedSessionId);
        execution = await codexGitCommand.sessionWorkSaveContext({
          ...executionInput,
          session
        });
      }
    }
    if (execution?.ok === false) {
      const error = new Error(execution.error || "The Git actor for this repository operation is not available.");
      error.code = execution.code || "vibe64_session_work_actor_unavailable";
      throw error;
    }
    return { execution, normalizedSessionId, runtime, session };
  }

  async function createSessionSource(input = {}) {
    return project.runProjectSourceExclusive(async () => {
      const source = await createManagedSessionSource({
        ...input,
        env,
        project: await project.readCurrentProject()
      });
      if (input.session?.metadata?.github_pull_request) {
        const session = input.session.metadata.renewed_from
          ? await input.store.readSessionForRenewal(input.session.sessionId)
          : await input.store.readSession(input.session.sessionId);
        const recorded = await writeSessionGitCommandActor({
          env,
          reason: "pull-request-session",
          runtime: input.runtime,
          session,
          sourceRoot: source.sourcePath,
          workdir: source.sourcePath,
          threadId: "",
          vibe64User: input.vibe64User || null
        });
        if (recorded?.ok === false) {
          throw new Error(recorded.error || "Your GitHub identity is unavailable.");
        }
      }
      return source;
    }, { operation: "session-source-create" });
  }

  async function recordSessionGitCommandActor(sessionId, input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: "Session id is required to record the Git command actor."
      };
    }
    const { runtime, session } = await sessionAccess.sessionContext(normalizedSessionId, input);
    const sessionSourceRoot = sessionSourcePath(session);
    if (!sessionSourceRoot) {
      return {
        code: "vibe64_session_git_command_actor_source_root_missing",
        error: "Vibe64 session source root is not available for Git command actor tracking.",
        ok: false
      };
    }
    return writeSessionGitCommandActor({
      env,
      reason: input.reason || "session-interaction",
      runtime,
      session,
      sourceRoot: sessionSourceRoot,
      threadId: session.metadata?.agent_identity_conversation_id || "",
      vibe64User: input.vibe64User || null,
      workdir: sessionSourceRoot
    });
  }

  async function saveSessionWork(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, {
      operation: "save-session-work",
      activeCode: "vibe64_session_save_agent_active",
      activeMessage: "Wait for the assistant turn to finish before saving this work."
    }, (context) => saveSessionWorkInsideWrite(sessionId, input, context));
  }

  async function runSessionSourceReadExclusive(sessionId, operation) {
    const id = assertValidVibe64SessionId(sessionId);
    return runSessionRepositoryWrite(id, {}, {
      operation: "read-session-source",
      activeCode: "vibe64_session_source_read_agent_active",
      activeMessage: "Wait for the assistant turn to finish before reading its committed source snapshot."
    }, async (context) => {
      if (state.lifecycle.closing || context.session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(context.session)) {
        throw new AppError(409, "Committed source reads require an open session that is not closing or renewing.", { code: "vibe64_session_source_read_unavailable" });
      }
      if (workspaceSetup.isRunning(id) || context.session.workspaceSetup?.status === "running") {
        throw Object.assign(new AppError(409, "Workspace setup must finish before reading this session's committed source snapshot.", {
          code: "vibe64_session_source_read_setup_running"
        }), { retryable: true });
      }
      requireCompletedConversationRewind(context.session);
      await agentConversations.assertSessionRenewalIdle(id, context);
      // Repository admission owns the session lease. Save takes this same
      // project lock downstream; acquiring it here preserves that order.
      return project.runProjectSourceExclusive(async () => {
        const session = await context.runtime.getSessionWithoutSource(id);
        const sourceRoot = sessionSourcePath(session);
        if (session.sessionId !== id || !sourceRoot) {
          throw new AppError(409, "This exact session has no available managed source.", { code: "vibe64_session_source_root_missing" });
        }
        return operation({ runtime: context.runtime, session, sourceRoot });
      }, { operation: "read-session-source" });
    });
  }

  async function createSessionPullRequest(sessionId, input = {}) {
    if (
      typeof input.title !== "string" || !input.title.trim() || input.title.length > 256 ||
      (input.body != null && (typeof input.body !== "string" || input.body.length > 65536)) ||
      (input.draft != null && typeof input.draft !== "boolean")
    ) {
      throw vibe64Error(
        "Enter a pull request title and a description of up to 65,536 characters.",
        "vibe64_session_pull_request_input_invalid"
      );
    }
    return runSessionRepositoryWrite(sessionId, input, { operation: "create-pull-request" }, async (context) => {
      const { runtime } = context;
      let session = context.session;
      const projectRecord = await project.readCurrentProject();
      assertSessionRepositoryReview(projectRecord, session, input.destinationReview);
      let source = session.metadata?.github_pull_request
        ? JSON.parse(session.metadata.github_pull_request)
        : await project.preparePullRequestSource(session, input);
      if (source.number) {
        return { ok: true, pullRequest: source };
      }

      // Bind before any remote write: an interrupted attempt must never send a later Save to main.
      await runtime.store.mutateSession(sessionId, async () => {
        await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
        await runtime.store.writeMetadataValue(sessionId, "source_remote_url", `https://github.com/${source.headRepository}.git`);
        await runtime.store.writeMetadataValue(sessionId, "repository_mode", "github");
        await runtime.store.writeMetadataValue(sessionId, REPOSITORY_UPDATE_CHECK_METADATA, "");
      });
      session = await runtime.getSessionWithoutSource(sessionId);
      const recorded = await writeSessionGitCommandActor({
        env,
        reason: "create-pull-request",
        runtime,
        session,
        sourceRoot: sessionSourcePath(session),
        workdir: sessionSourcePath(session),
        threadId: session.metadata?.agent_identity_conversation_id || "",
        vibe64User: input.vibe64User || null
      });
      if (recorded?.ok === false) {
        throw new Error(recorded.error || "Your GitHub identity is unavailable.");
      }
      session = recorded?.session || await runtime.getSessionWithoutSource(sessionId);
      const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "create-pull-request");
      await prepareSessionPullRequestBranch({
        project: await project.readCurrentProject(),
        session,
        commandOptions: execution.commandOptions,
        runCommand: execution.runCommand
      });

      const saved = await saveSessionWorkInsideWrite(sessionId, {
        ...input,
        destinationReview: sessionRepositoryDestination(projectRecord, session)
      }, { ...context, session, creatingPullRequest: true });
      await runtime.store.writeMetadataValue(sessionId, "canonical_commit", saved.saveCommit);
      if (saved.reconciled === true) {
        await runtime.store.writeMetadataValue(sessionId, "base_commit", saved.saveCommit);
      }
      await runtime.store.writeMetadataValue(sessionId, "base_branch", source.headBranch);
      await runtime.store.writeMetadataValue(sessionId, "source_default_branch", source.headBranch);

      source = await project.publishSessionPullRequest(source, input);
      await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
      return { ok: true, pullRequest: source, saveCommit: saved.saveCommit };
    });
  }

  /**
   * `input.signal` (an AI task's Cancel) stops Update before it starts changing the session's files;
   * a Cancel while Update waits for the session ends it before it records a start.
   */
  async function updateSessionWork(sessionId, input = {}) {
    const { onRepositoryWriteAcquired = doNothing, signal = null } = input;
    return runSessionRepositoryWrite(sessionId, {
      ...input,
      async onRepositoryWriteAcquired() {
        throwIfUpdateCancelled(signal);
        await onRepositoryWriteAcquired();
      }
    }, {
      operation: "update-session-work",
      activeCode: "vibe64_session_update_agent_active",
      activeMessage: "Wait for the assistant turn to finish before updating this session."
    }, async (context) => {
      const { execution, runtime, session } = await sessionWorkExecution(sessionId, context, "session-update", { createsCommits: true });
      const projectRecord = await project.readCurrentProject();
      const beforeSourceChange = () => workspacePreparation.invalidateWorkspaceSetup(context);
      const runProjectSourceExclusive = project.runProjectSourceExclusive.bind(project);
      const copies = sessionConnectedCopies(session);
      if (copies.length) {
        await (input.onProgress || doNothing)({ kind: "connected", message: "Updating connected repositories.", stage: "connected-updating" });
      }
      const review = conflictReviewFor(input);
      // Each copy updates on its own: one that cannot leaves the others and this session's own update to proceed.
      const connected = await updateConnectedCopies({
        ...review.connected,
        beforeSourceChange,
        copies,
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        ...connectedCopyOperations({ codexGitCommand, env, runtime, session }, {
          createsCommits: true,
          reason: "session-update",
          runtime,
          vibe64User: input.vibe64User || null
        }),
        onProgress: input.onProgress,
        operationId: input.operationId,
        project: projectRecord,
        runProjectSourceExclusive,
        session,
        signal
      });
      const updated = await updateManagedSessionWork({
        ...review.own,
        beforeSourceChange,
        commandOptions: execution.commandOptions,
        historyReview: input.historyReview,
        onProgress: input.onProgress,
        operationId: input.operationId,
        project: projectRecord,
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        runCommand: execution.runCommand,
        runProjectSourceExclusive,
        session,
        signal
      });
      logDerivedArtifactsKept(logger, updated, "update", input.operationId, sessionId);
      return connected.length ? { ...updated, connected } : updated;
    });
  }

  /**
   * Recovers an interrupted Update: first the copy it was applying, then the session's own repository.
   */
  async function recoverSessionWorkUpdate(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-update" }, async (context) => {
      const { execution, runtime, session } = await sessionWorkExecution(sessionId, context, "session-update-recovery", {
        createsCommits: true
      });
      const recoveryInput = {
        beforeSourceChange: () => workspacePreparation.invalidateWorkspaceSetup(context),
        project: await project.readCurrentProject(),
        recovery: input.recovery || {},
        runProjectSourceExclusive: project.runProjectSourceExclusive.bind(project),
        session
      };
      const connected = await recoverConnectedUpdate({ ...recoveryInput, codexGitCommand, env, runtime });
      const recovered = await recoverManagedSessionWorkUpdate({
        ...recoveryInput,
        commandOptions: execution.commandOptions,
        runCommand: execution.runCommand
      });
      return connected ? { ...recovered, connected: [connected] } : recovered;
    });
  }

  /**
   * Recovers an interrupted Save: first each copy it pushed but did not record, then the session's own
   * repository.
   */
  async function recoverSessionWorkSave(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-save" }, async ({ runtime, session }) => {
      const projectRecord = await project.readCurrentProject();
      const runProjectSourceExclusive = project.runProjectSourceExclusive.bind(project);
      const connected = await recoverConnectedCopySaves({
        copies: sessionConnectedCopies(session),
        ...connectedCopyOperations({ codexGitCommand, env, runtime, session }),
        operationId: input.recovery?.operationId,
        project: projectRecord,
        runProjectSourceExclusive,
        session
      });
      const execution = await saveExecution(session, sessionId, "Save recovery");
      let recovered;
      try {
        recovered = await recoverManagedSessionWorkSave({
          commandOptions: execution.commandOptions,
          project: projectRecord,
          recovery: input.recovery || {},
          runCommand: execution.runCommand,
          runProjectSourceExclusive,
          session
        });
      } catch (error) {
        if (!await copiesOnlySaveRecovered(error, { project: projectRecord, runtime, session })) throw error;
        return { connected, ok: true, operationId: input.recovery?.operationId, reconciled: true, recovered: true, status: "saved" };
      }
      return connected.length ? { ...recovered, connected } : recovered;
    });
  }

  /**
   * Retiring deletes only a Vibe64-internal ref and never touches the
   * worktree, so it takes the write lock (serialising with Save and its
   * recovery) without waiting for an assistant turn the person may already
   * have started after Save finished.
   */
  async function retireSessionWorkSave(sessionId, input = {}) {
    const result = await sessionAccess.runMainAgentWrite(sessionId, input, async ({ session }) => {
      const execution = await saveExecution(session, sessionId, "retiring this Save");
      await retireManagedSessionWorkSave({
        commandOptions: execution.commandOptions,
        operationId: input.operationId,
        project: await project.readCurrentProject(),
        runCommand: execution.runCommand,
        session
      });
      return { ok: true };
    }, { operation: "retire-session-save", waitMs: 10_000 });
    if (result?.ok === false) {
      throw Object.assign(new Error(result.error), { code: result.code, details: result.details, retryable: true });
    }
    return result;
  }

  return Object.freeze({
    createSessionPullRequest,
    createSessionSource,
    recordSessionGitCommandActor,
    recoverSessionWorkSave,
    recoverSessionWorkUpdate,
    retireSessionWorkSave,
    runSessionSourceReadExclusive,
    saveSessionWork,
    sessionWorkExecution,
    updateSessionWork
  });
}

export {
  createServiceSessionWork
};
