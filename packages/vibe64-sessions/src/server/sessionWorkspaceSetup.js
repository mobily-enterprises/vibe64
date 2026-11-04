import {
  captureProjectRequestContext,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { publicSession, refuseDuringRepositoryAiTask, sessionResult } from "./sessionResults.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */

// A starter's workspace preparation waits this long for a busy session.
const STARTER_PREPARATION_WAIT_MS = 60_000;

/**
 * Session workspace setup through the terminals' own setup.
 * @param {object} dependencies
 * @param {TerminalsService} dependencies.terminals
 */
function createTerminalsSetupRunner({ terminals }) {
  const isRunning = (sessionId) => terminals.workspaceSetupIsRunning(sessionId);

  const start = ({ agentRequested = false, retry = false, runtime, session, waitMs }) => terminals.prepareWorkspaceSetup(
    session.sessionId,
    { agentRequested, retry, runtime, session, waitMs }
  );

  const startRenewal = ({ retry = false, runtime, session }) => terminals.prepareRenewalWorkspaceSetup(
    session.sessionId,
    { retry, runtime, session }
  );

  const wait = (sessionId) => terminals.waitForWorkspaceSetup(sessionId);

  return Object.freeze({
    isRunning,
    start,
    startRenewal,
    wait
  });
}

/**
 * A session's workspace preparation: started for a retry, a starter or an
 * update, and announced to the session once it completes.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 */
function createSessionWorkspaceSetup({
  project,
  publishSessionChanged,
  setupRunner
}) {
  function observeWorkspaceSetup(sessionId, completion, options = {}) {
    const {
      originId = ""
    } = options;
    // readable-check: allow method-probe - data: a setup result carries its completion only once preparation started
    if (!completion || typeof completion.then !== "function") {
      return;
    }
    const context = captureProjectRequestContext();
    const observe = async (workspaceSetup) => {
      const runtime = await project.createRuntimeWithoutSource();
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: normalizeText(originId),
        reason: "workspace-setup-completed",
        session: await runtime.getSessionWithoutSource(sessionId),
        workspaceSetup
      });
    };
    void completion.then(workspaceSetup => context
      ? runWithProjectRequestContext(context, () => observe(workspaceSetup))
      : observe(workspaceSetup)).catch((error) => {
      vibe64SessionDebugLog("server.sessions.workspaceSetup.publish.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    });
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {object} [options]
   */
  async function prepareUpdatedWorkspace(runtime, sessionId, options = {}) {
    try {
      const session = await runtime.getSessionWithoutSource(sessionId);
      const setup = await setupRunner.start({ runtime, session });
      observeWorkspaceSetup(sessionId, setup.completion, options);
      // A consumer reads this checkout next, so it waits for the rebuild.
      if (options.wait) await setup.completion;
    } catch (error) {
      // Preparation cannot turn a completed repository update into a failed rebase.
      vibe64SessionDebugLog("server.sessions.workspaceSetup.afterUpdate.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    }
  }

  /**
   * @param {string} sessionId
   * @param {object} input
   * @param {{ channel?: string }} [context] only a person's own page request is a person
   */
  async function retryWorkspaceSetup(sessionId, input, context = {}) {
    return sessionResult(async () => {
      if (setupRunner.isRunning(sessionId)) {
        throw vibe64Error("Workspace preparation is already running.", "vibe64_workspace_setup_running", {
          messageCode: "vibe64_workspace_setup_already_running"
        });
      }
      const runtime = await project.createRuntimeWithoutSource();
      await refuseDuringRepositoryAiTask(runtime, sessionId, input.aiTaskId);
      const session = await runtime.getSessionWithoutSource(sessionId);
      const status = normalizeText(session.workspaceSetup?.status);
      if (!["ambiguous", "failed", "required", "unconfigured", "succeeded"].includes(status)) {
        throw vibe64Error(
          "Workspace preparation can only be started when it is required, newly configured, finished, or needs a recipe choice.",
          "vibe64_workspace_setup_retry_not_available"
        );
      }
      const setup = await setupRunner.start({
        agentRequested: context.channel !== "api",
        retry: true,
        runtime,
        session
      });
      if (setup?.ok === false) {
        return setup;
      }
      const currentSession = await runtime.getSessionWithoutSource(sessionId);
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: normalizeText(input.originId),
        reason: "workspace-setup-retried",
        session: currentSession
      });
      observeWorkspaceSetup(sessionId, setup.completion, {
        originId: input.originId
      });
      // An AI task's check waits for the run it started: how preparation ended is its answer.
      if (input.aiTaskId) {
        await setup.completion;
        return { ok: true, workspaceSetup: (await runtime.getSessionWithoutSource(sessionId)).workspaceSetup || null };
      }
      return publicSession(currentSession);
    }, "Vibe64 could not retry workspace preparation.");
  }

  /**
   * A starter replaces the Stack of a session that was prepared as empty;
   * prepare it now so the Preview does not wait for host-managed resources.
   * The new session's first AI turn usually holds the session briefly, so
   * preparation waits its turn instead of giving up and leaving the app
   * without its database until something else prepares it.
   */
  async function prepareStarterWorkspace(sessionId) {
    const runtime = await project.createRuntimeWithoutSource();
    const session = await runtime.getSessionWithoutSource(sessionId);
    // The starter's files are unsaved session work that no turn, Save or
    // editor event announces; repository status re-inspects on this reason.
    await publishSessionChanged(sessionId, { operation: "updated", reason: "session-starter-applied", session });
    if (setupRunner.isRunning(sessionId) || session.status !== "active") return;
    const setup = await setupRunner.start({ runtime, session, waitMs: STARTER_PREPARATION_WAIT_MS });
    if (setup?.ok === false) return;
    await publishSessionChanged(sessionId, {
      operation: "updated",
      reason: "workspace-setup-started",
      session: await runtime.getSessionWithoutSource(sessionId)
    });
    observeWorkspaceSetup(sessionId, setup?.completion);
  }

  return Object.freeze({
    observeWorkspaceSetup,
    prepareUpdatedWorkspace,
    retryWorkspaceSetup,
    prepareStarterWorkspace
  });
}

export { createSessionWorkspaceSetup, createTerminalsSetupRunner };
