import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { listProjectSessions, readProjectPreview, sendProjectMessage } from "./projectMessage.js";
import { createAgentEnvCommandService } from "./agentEnvCommand.js";
import { createAgentDatabaseCommandService } from "./agentDatabaseCommand.js";
import { createAgentPagesCommandService } from "./agentPagesCommand.js";
import { createAgentPreviewCommandService } from "./agentPreviewCommand.js";
import { createAgentSessionCommandService } from "./agentSessionCommand.js";
import { createServicesCommandGroup } from "./agentServicesCommand.js";
import { NO_HELPER_COMMAND_GROUPS } from "./helperCommandGroups.js";
import { NO_SERVICE_CONTROL } from "./serviceControl.js";
import { createCodexGitCommandService } from "./codexGitCommand.js";
import { createOutputTargetTerminalController } from "./outputTargetTerminal.js";
import { previewStartedBefore } from "./outputTargetLaunchStart.js";
import { sessionTerminalAdmissionFailure } from "./serviceSessionTerminals.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("./types.js").StagingEnvironmentProvider} StagingEnvironmentProvider */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").RunVibe64Command} RunVibe64Command */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */
/** @typedef {import("./types.js").ServiceAssistant} ServiceAssistant */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceWorkspacePreparation} ServiceWorkspacePreparation */
/** @typedef {import("./types.js").TerminalSessionChangedPublishers} TerminalSessionChangedPublishers */

/**
 * The command helpers a session's assistant runs (Git, Preview, Env, Database and Session) and the output target
 * terminal the Preview command launches.
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env
 * @param {ServiceAssistant["inspectAssistantAccess"]} dependencies.inspectAssistantAccess
 * @param {RuntimeLogger} dependencies.logger
 * @param {number} [dependencies.previewPrepareWaitMs] how long a Preview restart waits at most for its run's Prepare steps
 * @param {StagingEnvironmentProvider} dependencies.stagingEnvironmentProvider
 * @param {import("./types.js").ProductionEnvironmentProvider} [dependencies.productionEnvironmentProvider]
 * @param {ProjectService} dependencies.project
 * @param {ProjectServices} dependencies.projectServices
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {TerminalSessionChangedPublishers} dependencies.publishSessionChanged
 * @param {AssistantRouting["recordOutcome"]} dependencies.recordWorkflowOutcome
 * @param {() => Pick<AssistantRouting, "handPlanToSenior" | "handActionOn">} dependencies.routingHandoffs routing's plan
 *   and act handoffs, read when the plan command hands a request on: routing is built after the command services
 * @param {RunVibe64Command} dependencies.runCodexGitGatewayCommand
 * @param {SavedEnvValueLinks} dependencies.savedEnvValueLinks
 * @param {import("./types.js").HelperCommandGroup[]} dependencies.helperCommandGroups a host's own vibe64-helper groups, or none
 * @param {import("./types.js").ServiceControl} dependencies.serviceControl the host's control of the servers it runs for a
 *   project, which vibe64-helper services calls, or NO_SERVICE_CONTROL
 * @param {ServiceAssistant["sendAgentMessage"]} dependencies.sendAgentMessage
 * @param {ReturnType<typeof import("./mainChatNote.js").createMainChatNote>} dependencies.noteMainChat Vibe64's note to
 *   Main chat's running turn
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceState} dependencies.state
 * @param {ServiceWorkspacePreparation} dependencies.workspacePreparation
 */
function createServiceCommandServices({
  env,
  inspectAssistantAccess,
  logger,
  previewPrepareWaitMs,
  stagingEnvironmentProvider,
  productionEnvironmentProvider,
  project,
  projectServices,
  publishAgentSessionChanged,
  publishSessionChanged,
  recordWorkflowOutcome,
  routingHandoffs,
  runCodexGitGatewayCommand,
  savedEnvValueLinks,
  helperCommandGroups,
  serviceControl,
  sendAgentMessage,
  noteMainChat,
  sessionAccess,
  state,
  workspacePreparation
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
    logger,
    previewPrepareWaitMs,
    ensureWorkspacePrepared: (sessionId, context = {}) => workspacePreparation.ensureWorkspacePrepared(sessionId, context, {
      rerunFailed: context.rerunFailedSetup === true
    }),
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
    stagingEnvironmentProvider,
    productionEnvironmentProvider,
    project,
    savedEnvValueLinks
  });
  const agentDatabaseCommand = createAgentDatabaseCommandService({
    logger,
    project,
    readDatabaseTools: () => state.slots.databaseToolsProvider
  });
  const agentPagesCommand = createAgentPagesCommandService({
    logger,
    project,
    readPages: () => state.slots.pagesProvider
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
    retryWorkspaceSetup: sessionId => workspacePreparation.prepareWorkspaceSetup(sessionId, {
      publish: true,
      retry: true
    }),
    // The sessions feature fills it; while it is absent, as Vibe64 starts or stops, Update waits.
    updateSessionWork: async (sessionId, input) => state.slots.sessionUpdate
      ? state.slots.sessionUpdate(sessionId, input)
      : {
          ok: false,
          code: "vibe64_session_update_unavailable",
          error: "Update is unavailable while Vibe64 starts or stops."
        },
    // The sessions feature fills it; while it is absent, as Vibe64 starts or stops, Save is unavailable.
    saveSessionWork: async (sessionId, input) => state.slots.sessionSave
      ? state.slots.sessionSave(sessionId, input)
      : {
          ok: false,
          code: "vibe64_session_save_unavailable",
          error: "Save is unavailable while Vibe64 starts or stops."
        },
    previewStartedBefore,
    // The Need help feature fills it; while it is absent, as Vibe64 starts or stops, need-help is unavailable.
    readNeedHelp: () => state.slots.needHelp,
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
    // A turn's repeated commands, and a database server a command started, are told to its AI as Vibe64's note, for
    // the person whose request it runs while they may still use the project, as a planned restart's note is.
    noteAgent: async (sessionId, message, { actor, projectSlug, nextTurn = false }) => {
      const vibe64User = actor ? await authorizeProjectMessage(actor, projectSlug).catch(() => null) : null;
      return noteMainChat(sessionId, { message, nextTurn }, vibe64User ? { vibe64User } : {});
    },
    handPlanToSenior: (sessionId, input, options) => routingHandoffs().handPlanToSenior(sessionId, input, options),
    handActionOn: (sessionId, input, options) => routingHandoffs().handActionOn(sessionId, input, options),
    // vibe64-helper's services group, on the host's control of the servers it runs and the session's Need help, which a
    // shared database server's restart or stop needs; then the host's own groups.
    helperCommandGroups: [
      createServicesCommandGroup({
        serviceControl: serviceControl ?? NO_SERVICE_CONTROL,
        readNeedHelp: () => state.slots.needHelp,
        logger
      }),
      ...(helperCommandGroups ?? NO_HELPER_COMMAND_GROUPS)
    ],
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    project
  });

  return Object.freeze({
    agentDatabaseCommand,
    agentEnvCommand,
    agentPagesCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    outputTarget
  });
}

export {
  createServiceCommandServices
};
