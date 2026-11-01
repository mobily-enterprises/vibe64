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
 * too, invalidated when sources change, and observed while it runs.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ProjectService} dependencies.project
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 */
function createServiceWorkspacePreparation({
  sessionAccess,
  project,
  publishSessionChanged,
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

  async function prepareWorkspaceSetupInsideAgentWrite(sessionId = "", options = {}) {
    const {
      publish = false,
      renewal = false,
      rerunFailed = false,
      retry = false,
      runtime: existingRuntime = null,
      session: existingSession = null
    } = options;
    const requestContext = captureProjectRequestContext();
    const runtime = existingRuntime || await project.createRuntimeWithoutSource();
    const session = existingSession || await runtime.getSessionWithoutSource(sessionId);
    const setup = await workspaceSetup.start({
      renewal,
      rerunFailed,
      retry,
      runtime,
      session
    });
    const setupChanged = String(setup.state?.updatedAt || "") !==
      String(session.workspaceSetup?.updatedAt || "");
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
