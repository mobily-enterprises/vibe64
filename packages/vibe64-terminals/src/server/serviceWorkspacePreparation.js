import { captureProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { agentWriteBusyError, runVibe64RenewalAgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { renewalSession } from "./serviceSessionAccess.js";
import { inProjectContext } from "./workspaceSetupRules.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */

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
 */
function createServiceWorkspacePreparation({
  sessionAccess,
  project,
  publishSessionChanged,
  restartPreviewAfterSetup,
  workspaceSetup
}) {
  async function invalidateWorkspaceSetup(context, diagnostic = "Run this session's declared setup steps after updating its source.") {
    await workspaceSetup.invalidate({ ...context, diagnostic });
    await sessionAccess.publishTerminalSessionChanged("agentTerminal", context.session.sessionId, "workspace-setup-updated");
  }

  async function prepareWorkspaceSetup(sessionId = "", options = {}) {
    return sessionAccess.runMainAgentWrite(sessionId, options, async (context) => {
      const setup = await prepareWorkspaceSetupInsideAgentWrite(sessionId, context);
      if (options.waitForCompletion && setup.completion) {
        await setup.completion;
      }
      return setup;
    }, { operation: "prepare-workspace", waitMs: options.waitMs });
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
      agentRequested = false,
      publish = false,
      renewal = false,
      rerunFailed = false,
      retry = false,
      runtime: existingRuntime = null,
      session: existingSession = null,
      signal = null
    } = options;
    const requestContext = captureProjectRequestContext();
    const runtime = existingRuntime || await project.createRuntimeWithoutSource();
    const session = existingSession || await runtime.getSessionWithoutSource(sessionId);
    const setup = await workspaceSetup.start({
      agentRequested,
      renewal,
      rerunFailed,
      retry,
      runtime,
      session,
      signal
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
    invalidateWorkspaceSetup,
    prepareRenewalWorkspaceSetup,
    prepareWorkspaceSetup,
    waitForWorkspaceSetup,
    workspaceSetupIsPrepared,
    workspaceSetupIsRunning
  });
}

export {
  createServiceWorkspacePreparation
};
