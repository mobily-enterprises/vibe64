import {
  assertSessionRepositoryReview,
  sessionConnectedContribution,
  sessionRepositoryDestination
} from "@local/vibe64-core/server/projectRepository";
import { requireCompletedConversationRewind } from "./assistantChangeover.js";
import { changeIncomingContribution as changeManagedIncomingContribution } from "./sessionIncomingContributions.js";
import {
  recoverSessionWorkUpdate as recoverManagedSessionWorkUpdate,
  updateSessionWork as updateManagedSessionWork
} from "./sessionWorkUpdate.js";
import {
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
 * A session's work in its repository: the work execution, saving and its recovery, updates and
 * incoming contributions, pull requests, the session source and its exclusive reads, and the Git
 * command actor.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {ServiceAgentConversations} dependencies.agentConversations
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
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
  projectService,
  sessionAgent,
  workspaceSetup
}) {
  async function saveSessionWorkInsideWrite(sessionId, input, context) {
    const { execution, normalizedSessionId, runtime, session } = await sessionWorkExecution(
      sessionId,
      context,
      "session-save",
      { createsCommits: true }
    );
    const project = await projectService.readCurrentProject();
    const destination = assertSessionRepositoryReview(project, session, input.destinationReview);
    const assertWorkflow = async () => {
      if (destination.mode !== "github") return;
      const workflow = await projectService.readRepositoryWorkflow();
      if (workflow.requirePullRequest && !sessionConnectedContribution(session) && !context.creatingPullRequest &&
          !JSON.parse(session.metadata?.github_pull_request || "null")?.number) {
        const error = new Error("This project requires a pull request. Create or open a pull request before saving this session.");
        error.code = "vibe64_pull_request_required";
        throw error;
      }
    };
    await assertWorkflow();
    // readable-check: allow optional-call - input validation: a caller's optional check that connected work is saved
    const connectedWorkSnapshots = await input.assertConnectedWorkSaved?.();
    const saveMessageInput = await prepareManagedSessionWorkSaveMessage({
      commandOptions: execution.commandOptions,
      connectedWorkSnapshots,
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      limit: 40,
      operationId: input.operationId,
      project,
      runCommand: execution.runCommand,
      session
    });
    // readable-check: allow optional-call - input validation: a caller's optional progress stream
    await input.onProgress?.({
      checkpointCommit: saveMessageInput.checkpoint.checkpointCommit,
      checkpointTree: saveMessageInput.checkpoint.checkpointTree,
      kind: "message",
      message: "Writing a concise name for this work.",
      stage: "message-writing"
    });
    const agentContext = {
      runtime,
      session,
      vibe64User: input.vibe64User || null
    };
    let commitTitle;
    try {
      commitTitle = await generateSessionSaveCommitMessage({
        agent: sessionAgent,
        agentContext,
        changes: saveMessageInput.changes
      });
    } catch (error) {
      // Naming is optional. Leave failed thread ownership intact and let the
      // repository owner enforce the normal checkpoint and publish checks.
      commitTitle = {
        executionProfile: null,
        subject: `Save work ${saveMessageInput.checkpoint.checkpointTree.slice(0, 12)}`
      };
      logOperationalEvent(logger, "warn", {
        code: error.code || "vibe64_session_save_message_failed",
        component: "vibe64.session_save",
        event: "vibe64.session_save.message_fallback",
        operationId: input.operationId,
        sessionId: normalizedSessionId
      }, "Assistant naming was unavailable; Save is using a checkpoint-based version name.");
      // readable-check: allow optional-call - input validation: a caller's optional progress stream
      await input.onProgress?.({
        code: error.code || "vibe64_session_save_message_failed",
        kind: "message",
        message: "Assistant naming is unavailable. Saving with a checkpoint-based version name.",
        stage: "message-fallback"
      });
    }
    // readable-check: allow optional-call - input validation: a caller's optional progress stream
    await input.onProgress?.({
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
      onCacheMaintenance(cacheMaintenance = {}) {
        if (cacheMaintenance.retryable !== true) {
          return;
        }
        logOperationalEvent(logger, "warn", {
          code: cacheMaintenance.code,
          component: "vibe64.session_save",
          event: "vibe64.session_save.cache_maintenance_failed",
          operationId: input.operationId,
          reason: cacheMaintenance.reason,
          sessionId: normalizedSessionId
        }, cacheMaintenance.message || "Vibe64 Save cache maintenance failed.");
      },
      onProgress: input.onProgress,
      operationId: input.operationId,
      project,
      readConnectedWorkSnapshots: input.assertConnectedWorkSaved,
      runCommand: execution.runCommand,
      runProjectSourceExclusive: (operation, options) => projectService.runProjectSourceExclusive(async () => {
        assertSessionRepositoryReview(await projectService.readCurrentProject(), session, input.destinationReview);
        await assertWorkflow();
        return operation();
      }, options),
      session
    });
    return {
      ...saved,
      commitTitleExecutionProfile: commitTitle.executionProfile
    };
  }

  async function runSessionRepositoryWrite(
    sessionId = "",
    options = {},
    {
      operation: operationName = "repository-write",
      activeCode = "vibe64_session_repository_agent_active",
      activeMessage = "Wait for the assistant turn to finish before changing this session's repository."
    } = {},
    operation
  ) {
    const result = await sessionAccess.runMainAgentWrite(sessionId, options, async (context) => {
      if (sessionHasActiveAgentRun(context.session)) {
        const activityCheck = await sessionAgent.ensureSession(sessionId, context);
        context.session = await context.runtime.getSession(sessionId, { inspectSource: false });
        if (sessionHasActiveAgentRun(context.session)) {
          const error = new Error(activityCheck?.error || activeMessage);
          error.code = activeCode;
          error.retryable = true;
          throw error;
        }
      }
      // readable-check: allow optional-call - input validation: a caller's optional observer of the repository write lock
      await options.onRepositoryWriteAcquired?.();
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
   * A write that records commits (Save, Update, Merge contribution) passes
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
        session = recorded.session || await runtime.getSession(normalizedSessionId, { inspectSource: false });
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
    // readable-check: allow method-probe - test asserts error: a project service without the source mutation lock is refused
    if (typeof projectService.runProjectSourceExclusive !== "function") {
      const error = new Error("Session source creation requires the project source mutation lock.");
      error.code = "vibe64_project_source_lock_unavailable";
      throw error;
    }
    return projectService.runProjectSourceExclusive(async () => {
      const source = await createManagedSessionSource({
        ...input,
        env,
        project: await projectService.readCurrentProject()
      });
      if (input.session?.metadata?.github_pull_request || input.session?.metadata?.connected_contribution) {
        const session = input.session.metadata.renewed_from
          ? await input.store.readSessionForRenewal(input.session.sessionId)
          : await input.store.readSession(input.session.sessionId);
        const recorded = await writeSessionGitCommandActor({
          env,
          reason: input.session.metadata.connected_contribution
            ? "connected-contribution-session"
            : "pull-request-session",
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

  async function runConnectedSessionSave(sessionId, input, operation) {
    return runSessionRepositoryWrite(sessionId, input, {
      operation: "save-connected-work",
      activeCode: "vibe64_session_save_agent_active",
      activeMessage: "Wait for the assistant turn to finish before saving connected work."
    }, operation);
  }

  /**
   * Internal server facility: callbacks are never accepted by an action or
   * model. Snapshot validation/installation remains with its content owner.
   */
  async function runConnectedSourcePreparation(sessionId, input, operation) {
    if (typeof operation !== "function") throw new TypeError("Connected preparation requires an internal source operation.");
    return runSessionRepositoryWrite(sessionId, input, { operation: "prepare-connected-sources" }, operation);
  }

  async function runSessionSourceReadExclusive(sessionId, operation) {
    const id = assertValidVibe64SessionId(sessionId);
    if (typeof operation !== "function") {
      throw new TypeError("Exclusive session source reads require an internal operation.");
    }
    // readable-check: allow method-probe - test asserts error: a project service without the source mutation lock is refused
    if (typeof projectService.runProjectSourceExclusive !== "function") {
      throw Object.assign(new Error("Session source reads require the project source mutation lock."), {
        code: "vibe64_project_source_lock_unavailable"
      });
    }
    return runSessionRepositoryWrite(id, {}, {
      operation: "read-session-source",
      activeCode: "vibe64_session_source_read_agent_active",
      activeMessage: "Wait for the assistant turn to finish before reading its committed source snapshot."
    }, async (context) => {
      if (state.lifecycle.closing || context.session.status !== VIBE64_SESSION_STATUS.ACTIVE || sessionIsClosing(context.session)) {
        throw Object.assign(new Error("Committed source reads require an open session that is not closing or renewing."), {
          code: "vibe64_session_source_read_unavailable",
          statusCode: 409
        });
      }
      if (workspaceSetup.isRunning(id) || context.session.workspaceSetup?.status === "running") {
        throw Object.assign(new Error("Workspace setup must finish before reading this session's committed source snapshot."), {
          code: "vibe64_session_source_read_setup_running",
          statusCode: 409,
          retryable: true
        });
      }
      requireCompletedConversationRewind(context.session);
      await agentConversations.assertSessionRenewalIdle(id, context);
      // Repository admission owns the session lease. Save takes this same
      // project lock downstream; acquiring it here preserves that order.
      return projectService.runProjectSourceExclusive(async () => {
        const session = await context.runtime.getSession(id, { inspectSource: false });
        const sourceRoot = sessionSourcePath(session);
        if (session.sessionId !== id || !sourceRoot) {
          throw Object.assign(new Error("This exact session has no available managed source."), {
            code: "vibe64_session_source_root_missing",
            statusCode: 409
          });
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
      throw new Error("Enter a pull request title and a description of up to 65,536 characters.");
    }
    return runSessionRepositoryWrite(sessionId, input, { operation: "create-pull-request" }, async (context) => {
      const { runtime } = context;
      let session = context.session;
      const project = await projectService.readCurrentProject();
      assertSessionRepositoryReview(project, session, input.destinationReview);
      let source = session.metadata?.github_pull_request
        ? JSON.parse(session.metadata.github_pull_request)
        : await projectService.preparePullRequestSource(session, input);
      if (source.number) {
        return { ok: true, pullRequest: source };
      }

      // Bind before any remote write: an interrupted attempt must never send a later Save to main.
      await runtime.store.mutateSession(sessionId, async () => {
        await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
        await runtime.store.writeMetadataValue(sessionId, "source_remote_url", `https://github.com/${source.headRepository}.git`);
        await runtime.store.writeMetadataValue(sessionId, "repository_mode", "github");
        await runtime.store.writeMetadataValue(sessionId, "repository_update_check", "");
      });
      session = await runtime.getSession(sessionId, { inspectSource: false });
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
      session = recorded?.session || await runtime.getSession(sessionId, { inspectSource: false });
      const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "create-pull-request");
      await prepareSessionPullRequestBranch({
        // readable-check: allow optional-call - input validation: a caller's optional check that connected work is saved
        connectedWorkSnapshots: await input.assertConnectedWorkSaved?.(),
        project: await projectService.readCurrentProject(),
        session,
        commandOptions: execution.commandOptions,
        runCommand: execution.runCommand
      });

      const saved = await saveSessionWorkInsideWrite(sessionId, {
        ...input,
        destinationReview: sessionRepositoryDestination(project, session)
      }, { ...context, session, creatingPullRequest: true });
      await runtime.store.writeMetadataValue(sessionId, "canonical_commit", saved.saveCommit);
      if (saved.reconciled === true) {
        await runtime.store.writeMetadataValue(sessionId, "base_commit", saved.saveCommit);
      }
      await runtime.store.writeMetadataValue(sessionId, "base_branch", source.headBranch);
      await runtime.store.writeMetadataValue(sessionId, "source_default_branch", source.headBranch);

      source = await projectService.publishSessionPullRequest(source, input);
      await runtime.store.writeMetadataValue(sessionId, "github_pull_request", JSON.stringify(source));
      return { ok: true, pullRequest: source, saveCommit: saved.saveCommit };
    });
  }

  async function updateSessionWork(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, {
      operation: "update-session-work",
      activeCode: "vibe64_session_update_agent_active",
      activeMessage: "Wait for the assistant turn to finish before updating this session."
    }, async (context) => {
      const { execution, session } = await sessionWorkExecution(sessionId, context, "session-update", { createsCommits: true });
      return updateManagedSessionWork({
        beforeSourceChange: () => workspacePreparation.invalidateWorkspaceSetup(context),
        commandOptions: execution.commandOptions,
        historyReview: input.historyReview,
        conflictRecovery: input.conflictRecovery,
        reviewedConflictId: input.reviewedConflictId,
        onProgress: input.onProgress,
        operationId: input.operationId,
        project: await projectService.readCurrentProject(),
        derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
        runCommand: execution.runCommand,
        runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
        session
      });
    });
  }

  async function recoverSessionWorkUpdate(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-update" }, async (context) => {
      const { execution, session } = await sessionWorkExecution(
        sessionId,
        context,
        "session-update-recovery",
        { createsCommits: true }
      );
      return recoverManagedSessionWorkUpdate({
        beforeSourceChange: () => workspacePreparation.invalidateWorkspaceSetup(context),
        commandOptions: execution.commandOptions,
        project: await projectService.readCurrentProject(),
        recovery: input.recovery || {},
        runCommand: execution.runCommand,
        runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
        session
      });
    });
  }

  async function recoverSessionWorkSave(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, { operation: "recover-session-save" }, async ({ session }) => {
      const execution = await saveExecution(session, sessionId, "Save recovery");
      return recoverManagedSessionWorkSave({
        commandOptions: execution.commandOptions,
        project: await projectService.readCurrentProject(),
        recovery: input.recovery || {},
        runCommand: execution.runCommand,
        runProjectSourceExclusive: projectService.runProjectSourceExclusive.bind(projectService),
        session
      });
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
        project: await projectService.readCurrentProject(),
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

  async function changeIncomingContribution(sessionId, input = {}) {
    return runSessionRepositoryWrite(sessionId, input, { operation: "incoming-contribution" }, context =>
      projectService.runProjectSourceExclusive(async () => {
        const { project } = await projectService.incomingRepository({
          ...input,
          action: input.action === "review-repair" ? "merge" : input.action
        });
        // A receiving action belongs to its current actor, not the person
        // whose previous coding turn recorded this session's Git identity.
        const recorded = await recordSessionGitCommandActor(sessionId, {
          ...context,
          vibe64User: input.vibe64User,
          reason: "incoming-contribution"
        });
        if (recorded?.ok === false) throw Object.assign(new Error(recorded.error), { code: recorded.code });
        const session = await context.runtime.getSession(sessionId, { inspectSource: false });
        const { execution } = await sessionWorkExecution(sessionId, { ...context, session }, "incoming-contribution",
          { createsCommits: input.action !== "discard" });
        return changeManagedIncomingContribution({
          project,
          session,
          action: input.action,
          derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
          id: input.id,
          review: input.review,
          repairReview: input.repairReview,
          commandOptions: execution.commandOptions,
          runCommand: execution.runCommand
        });
      }, { operation: `incoming-${input.action}` }));
  }

  return Object.freeze({
    changeIncomingContribution,
    createSessionPullRequest,
    createSessionSource,
    recordSessionGitCommandActor,
    recoverSessionWorkSave,
    recoverSessionWorkUpdate,
    retireSessionWorkSave,
    runConnectedSessionSave,
    runConnectedSourcePreparation,
    runSessionSourceReadExclusive,
    saveSessionWork,
    sessionWorkExecution,
    updateSessionWork
  });
}

export {
  createServiceSessionWork
};
