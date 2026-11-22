import { setTimeout as delay } from "node:timers/promises";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { captureProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { agentWriteBusyError, runVibe64RenewalAgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { renewalSession } from "./serviceSessionAccess.js";
import { inProjectContext } from "./workspaceSetupRules.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */

// How long an Update waits for a running preparation before it refuses, naming that preparation.
const RUNNING_PREPARATION_WAIT_MS = 20 * 60_000;

/**
 * A session's workspace setup as the service runs it: prepared inside the agent write, for renewal
 * too, invalidated when sources change, and observed while it runs. Each run that succeeds
 * restarts a Preview that was running while it ran, so the Preview runs on what it installed.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ProjectService} dependencies.project
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {(sessionId: string, setup: { finishedAt: string }) => Promise<object>} dependencies.restartPreviewAfterSetup
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 * @param {number} [dependencies.runningPreparationWaitMs] how long an Update waits for a running preparation
 */
function createServiceWorkspacePreparation({
  sessionAccess,
  project,
  publishSessionChanged,
  restartPreviewAfterSetup,
  workspaceSetup,
  runningPreparationWaitMs = RUNNING_PREPARATION_WAIT_MS
}) {
  /**
   * Marks preparation required. `sourceChange` (an Update) keeps the record of the tree last prepared, so
   * preparing a tree that is still that one runs no step.
   */
  async function invalidateWorkspaceSetup(context, {
    diagnostic = "Run this session's declared setup steps after updating its source.",
    sourceChange = false
  } = {}) {
    await workspaceSetup.invalidate({ ...context, diagnostic, sourceChange });
    await sessionAccess.publishTerminalSessionChanged("agentTerminal", context.session.sessionId, "workspace-setup-updated");
  }

  /**
   * Starts preparation inside the agent write and returns once it has started: its completion is awaited
   * outside the lock, so an Update or a message is never held back while the steps run.
   */
  async function prepareWorkspaceSetup(sessionId = "", options = {}) {
    const prepare = (context) => prepareWorkspaceSetupInsideAgentWrite(sessionId, context);
    return sessionAccess.runMainAgentWrite(sessionId, options, prepare, { operation: "prepare-workspace", waitMs: options.waitMs });
  }

  /**
   * What a Preview start and a finished turn need: the running preparation when one runs, nothing when the
   * session is prepared, and otherwise a preparation started. Neither checking nor watching takes the lock.
   * @param {string} sessionId
   * @param {object} [input] the caller's runtime and session, when it has them
   * @param {object} [options] passed to prepareWorkspaceSetup: `waitMs` for the lock, `rerunFailed`
   */
  async function ensureWorkspacePrepared(sessionId, input = {}, options = {}) {
    const running = workspaceSetup.wait(sessionId);
    if (running) return { completion: running, state: null };
    const context = await sessionAccess.sessionContext(sessionId, input);
    if (await workspaceSetup.isPrepared(context)) return { completion: null, state: context.session.workspaceSetup };
    return prepareWorkspaceSetup(sessionId, { ...options, publish: true });
  }

  /**
   * Waits for this session's running preparation, if one runs, saying what it waits for. One still running
   * after `runningPreparationWaitMs` refuses, naming it; `signal` (Update's Cancel) ends the wait.
   * Resolves whether there was a run to wait for.
   * @param {string} sessionId
   * @param {object} [options]
   * @param {(progress: object) => unknown} [options.onProgress]
   * @param {object | null} [options.session]
   * @param {AbortSignal | null} [options.signal]
   */
  async function waitForRunningPreparation(sessionId, { onProgress = doNothing, session = null, signal = null } = {}) {
    const running = workspaceSetup.wait(sessionId);
    if (!running) return false;
    const step = toText(session?.workspaceSetup?.currentLabel);
    const preparing = `The workspace is being prepared${step ? ` (${step})` : ""}`;
    await onProgress({ kind: "workspace-setup-wait", message: `${preparing}; waiting for it to finish.`, stage: "workspace-setup-waiting" });
    const finished = new AbortController();
    const ended = await Promise.race([
      running.then(() => "finished", () => "finished"),
      delay(runningPreparationWaitMs, "timeout", { signal: AbortSignal.any([finished.signal, ...(signal ? [signal] : [])]) })
        .catch(() => "stopped")
    ]).finally(() => finished.abort());
    if (ended === "timeout") {
      throw vibe64Error(`${preparing}. Try again when it finishes.`, "vibe64_workspace_setup_running", { status: 409 });
    }
    return true;
  }

  async function prepareRenewalWorkspaceSetup(sessionId = "", options = {}) {
    const runtime = options.runtime || await project.createRuntimeWithoutSource();
    const exclusive = await runVibe64RenewalAgentWriteExclusive(
      runtime,
      sessionId,
      async () => prepareWorkspaceSetupInsideAgentWrite(sessionId, {
        ...options,
        renewal: true,
        runtime,
        session: await renewalSession(runtime, sessionId)
      }),
      { operation: "prepare-renewal-workspace" }
    );
    if (!exclusive.acquired) throw agentWriteBusyError(exclusive.value || undefined);
    return exclusive.value;
  }

  /**
   * Once a run succeeds, a Preview that was running while it ran restarts on what it installed.
   * @param {string} sessionId
   * @param {Promise<object>} completion the run's final setup state
   * @param {object | null} requestContext the project the run belongs to
   */
  function restartPreviewAfterRun(sessionId, completion, requestContext) {
    const restart = async (state) => {
      if (state?.status !== "succeeded") return;
      const restarted = await restartPreviewAfterSetup(sessionId, state);
      if (restarted?.ok === false) {
        vibe64SessionDebugLog("server.terminals.workspaceSetup.previewRestart.refused", {
          code: restarted.code || "",
          error: restarted.error || "",
          sessionId
        });
      }
    };
    void completion.then((state) => inProjectContext(requestContext, () => restart(state))).catch((error) => {
      vibe64SessionDebugLog("server.terminals.workspaceSetup.previewRestart.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    });
  }

  async function prepareWorkspaceSetupInsideAgentWrite(sessionId = "", options = {}) {
    const {
      publish = false,
      renewal = false,
      rerunFailed = false,
      retry = false,
      runtime: existingRuntime = null,
      session: existingSession = null,
      signal = null,
      vibe64User = null
    } = options;
    const requestContext = captureProjectRequestContext();
    const runtime = existingRuntime || await project.createRuntimeWithoutSource();
    const session = existingSession || await runtime.getSessionWithoutSource(sessionId);
    const setup = await workspaceSetup.start({
      renewal,
      rerunFailed,
      retry,
      runtime,
      session,
      signal,
      vibe64User
    });
    const setupChanged = String(setup.state?.updatedAt || "") !==
      String(session.workspaceSetup?.updatedAt || "");
    // A changed state with a completion is the run this call started.
    if (setupChanged && setup.completion) {
      restartPreviewAfterRun(sessionId, setup.completion, requestContext);
    }
    if (publish && setupChanged) {
      await publishSessionChanged.agentTerminal(sessionId, {
        reason: "workspace-setup-updated",
        session: await runtime.getSessionWithoutSource(sessionId)
      });
      if (setup.completion) {
        const publishCompleted = async () => {
          await publishSessionChanged.agentTerminal(sessionId, {
            reason: "workspace-setup-completed",
            session: await runtime.getSessionWithoutSource(sessionId)
          });
        };
        void setup.completion.then(() => inProjectContext(requestContext, publishCompleted)).catch((error) => {
          vibe64SessionDebugLog("server.terminals.workspaceSetup.publish.error", {
            error: vibe64SessionDebugError(error),
            sessionId
          });
        });
      }
    }
    return setup;
  }

  function workspaceSetupIsRunning(sessionId = "") {
    return workspaceSetup.isRunning(sessionId);
  }

  async function workspaceSetupIsPrepared(sessionId = "") {
    return workspaceSetup.isPrepared(await sessionAccess.sessionContext(assertValidVibe64SessionId(sessionId)));
  }

  function waitForWorkspaceSetup(sessionId = "") {
    return workspaceSetup.wait(sessionId);
  }

  return Object.freeze({
    ensureWorkspacePrepared,
    invalidateWorkspaceSetup,
    prepareRenewalWorkspaceSetup,
    prepareWorkspaceSetup,
    waitForRunningPreparation,
    waitForWorkspaceSetup,
    workspaceSetupIsPrepared,
    workspaceSetupIsRunning
  });
}

export {
  createServiceWorkspacePreparation
};
