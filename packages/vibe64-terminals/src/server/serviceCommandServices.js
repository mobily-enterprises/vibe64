import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { listProjectSessions, readProjectPreview, sendProjectMessage } from "./projectMessage.js";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { createCodexGitCommandService } from "./codexGitCommand.js";
import { createOutputTargetTerminalController } from "./outputTargetTerminal.js";
import { sessionTerminalAdmissionFailure } from "./serviceSessionTerminals.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").RunVibe64Command} RunVibe64Command */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */
/** @typedef {import("./types.js").ServiceAssistant} ServiceAssistant */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */

/**
 * The command helpers a session's assistant runs (Git, Preview, Env, Database and Session) and the output target
 * terminal the Preview command launches.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {NodeJS.ProcessEnv} dependencies.hostEnv this process's live env, under the configured env
 * @param {ServiceAssistant["inspectAssistantAccess"]} dependencies.inspectAssistantAccess
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProductionEnvironmentProvider} dependencies.productionEnvironmentProvider
 * @param {ProjectService} dependencies.project
 * @param {ProjectServices} dependencies.projectServices
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {AssistantRouting["recordOutcome"]} dependencies.recordWorkflowOutcome
 * @param {RunVibe64Command} dependencies.runCodexGitGatewayCommand
 * @param {SavedEnvValueLinks} dependencies.savedEnvValueLinks
 * @param {ServiceAssistant["sendAgentMessage"]} dependencies.sendAgentMessage
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceState} dependencies.state
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 * @param {WorkspaceSetupRunner} dependencies.workspaceSetup
 */
function createServiceCommandServices({
  env,
  hostEnv,
  inspectAssistantAccess,
  logger,
  productionEnvironmentProvider,
  project,
  projectServices,
  publishAgentSessionChanged,
  publishSessionChanged,
  recordWorkflowOutcome,
  runCodexGitGatewayCommand,
  savedEnvValueLinks,
  sendAgentMessage,
  sessionAccess,
  state,
  workspacePreparation,
  workspaceSetup
}) {
  const codexGitCommand = createCodexGitCommandService({
    env,
    logger,
    project,
    runGatewayCommand: runCodexGitGatewayCommand
  });
  // The output target stops the Preview command's browsers, and the Preview command launches the output target.
  let agentPreviewCommand;
  const outputTarget = createOutputTargetTerminalController({
    ensureProjectServices: projectServices.ensure,
    env,
    hostEnv,
    ensureWorkspacePrepared: async (sessionId, context = {}) => {
      if (await workspaceSetup.isPrepared(context)) {
        return { completion: null, state: context.session.workspaceSetup };
      }
      return workspacePreparation.prepareWorkspaceSetup(sessionId, {
        publish: true,
        rerunFailed: context.rerunFailedSetup === true,
        waitForCompletion: true
      });
    },
    project,
    stopPreviewBrowsers: (sessionId) => agentPreviewCommand.stopBrowsersForSession(sessionId),
    publishSessionChanged: publishSessionChanged.outputTarget,
    sessionAdmissionFailure: (sessionId) => sessionTerminalAdmissionFailure(sessionId, "output")
  });
  agentPreviewCommand = createAgentPreviewCommandService({
    launchTarget: outputTarget,
    logger,
    project,
    publishSessionChanged: publishSessionChanged.outputTarget
  });
  const agentEnvCommand = createAgentEnvCommandService({
    logger,
    productionEnvironmentProvider,
    project,
    savedEnvValueLinks
  });
  const agentDatabaseCommand = createAgentDatabaseCommandService({
    logger,
    project,
    readDatabaseTools: () => state.slots.databaseToolsProvider
  });
  const authorizeProjectMessage = (actor, slug) => state.assistantRuntime.authorizeProjectMessage(actor, slug);
  const assertProjectOpen = () => projectServices.assertOpen(sessionAccess.projectRuntimeContext());

  /**
   * Refuses a project message unless its destination session's assistant is usable and the session is still the
   * open, selected (or active) one.
   * @param {string} sessionId
   * @param {object} options
   */
  async function prepareProjectMessage(sessionId, options) {
    const access = await inspectAssistantAccess(sessionId, options);
    if (access.available !== true || access.canUse !== true) {
      throw vibe64Error(
        access.disabledReason || "The selected session has no available assistant.",
        "vibe64_project_message_assistant_unavailable"
      );
    }
    const { runtime: openState } = await sessionAccess.currentProjectRuntimeOpenState();
    assertProjectOpen();
    const destination = options.requireSelectedSession
      ? await options.runtime.store.readCurrentSession()
      : await options.runtime.store.readSession(sessionId);
    if (!openState.open || destination?.sessionId !== sessionId ||
        (!options.requireSelectedSession && destination.status !== VIBE64_SESSION_STATUS.ACTIVE)) {
      throw vibe64Error(
        "The destination closed, became unavailable or its selected session changed. Check it before sending again.",
        "vibe64_project_message_destination_changed"
      );
    }
  }

  const agentSessionCommand = createAgentSessionCommandService({
    retryWorkspaceSetup: sessionId => workspacePreparation.prepareWorkspaceSetup(sessionId, { publish: true, retry: true }),
    listProjectSessions: input => listProjectSessions(input, {
      project,
      authorize: authorizeProjectMessage,
      assertOpen: assertProjectOpen
    }),
    readProjectPreview: input => readProjectPreview(input, {
      project,
      authorize: authorizeProjectMessage,
      assertOpen: assertProjectOpen,
      launchTarget: outputTarget
    }),
    sendProjectMessage: input => sendProjectMessage(input, {
      project,
      publish: publishAgentSessionChanged,
      authorize: authorizeProjectMessage,
      assertOpen: assertProjectOpen,
      prepare: prepareProjectMessage,
      send: sendAgentMessage,
      reportFailure: (error, receipt) => logOperationalEvent(logger, "warn", {
        component: "vibe64.project_message",
        event: "vibe64.project_message.delivery_failed",
        error: error.message,
        code: error.code,
        sourceProject: input.sourceProject,
        sourceSession: input.sourceSession,
        ...receipt
      }, "Accepted project message failed during asynchronous delivery.")
    }),
    reportWorkflowOutcome: recordWorkflowOutcome,
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    project
  });

  return Object.freeze({
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    outputTarget
  });
}

export {
  createServiceCommandServices
};
