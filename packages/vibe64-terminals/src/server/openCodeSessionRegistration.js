import { publishMainConversationEvent } from "./mainConversationBinding.js";
import { createOpenCodeMainMessagePreparation } from "./mainConversationMessages.js";
import {
  createOpenCodeSessionAgentProvider
} from "./agent/providers/opencodeSessionAgentProvider.js";
import {
  createOpenCodeSharedRuntime
} from "@jskit-ai/assistant-core/server/opencode-process";
import {
  createOpenCodeLifecyclePreparation
} from "./openCodeLifecyclePreparation.js";
import {
  createOpenCodeConversationAccounts
} from "./openCodeConversationAccounts.js";
import {
  createOpenCodeConversationPresentation
} from "./openCodeConversationPresentation.js";
import {
  createOpenCodeConversationEvents
} from "./openCodeConversationEvents.js";
import {
  createOpenCodeScopedPreparation
} from "./openCodeScopedPreparation.js";
import {
  createOpenCodeInteractiveTerminals
} from "./openCodeInteractiveTerminals.js";
import {
  createOpenCodeSessionRenewalPreparation
} from "./openCodeSessionRenewal.js";
import { createOpenCodeHostPreparation } from "./openCodeHostPreparation.js";
import {
  createOpenCodeServerProcess,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  verifyOpenCodeApiKey
} from "./opencodeServerProcess.js";
import process from "node:process";
import {
  prepareAgentSessionCommandEnvironment
} from "./agentCommandEnvironment.js";
import {
  recordSessionGitCommandActor
} from "./sessionGitCommandActor.js";
import {
  opencodeTerminalNamespace
} from "./terminalShared.js";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

/** @typedef {import("./types.js").PublishNativeConversation} PublishNativeConversation */
/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").ListAssistantConnections} ListAssistantConnections */
/** @typedef {import("./types.js").ResolveAssistantConnection} ResolveAssistantConnection */

/**
 * @param {object} dependencies
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {string} [dependencies.command]
 * @param {typeof createOpenCodeServerProcess} [dependencies.createServerProcess]
 * @param {RuntimeEnv} [dependencies.env]
 * @param {() => SessionAgentManager} dependencies.getAssistantManager
 * @param {ListAssistantConnections} dependencies.listConnections
 * @param {RuntimeLogger} dependencies.logger
 * @param {typeof prepareAgentSessionCommandEnvironment} [dependencies.prepareCommandEnvironment]
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {PublishNativeConversation} dependencies.publishConversation
 * @param {(request: object) => Promise<unknown>} dependencies.runNativeDetachedConversation
 * @param {typeof readOpenCodeCatalog} [dependencies.readCatalogCommand]
 * @param {typeof readOpenCodeZenModelIds} [dependencies.readZenModelsCommand]
 * @param {typeof writeSessionGitCommandActor} [dependencies.recordGitActor]
 * @param {ResolveAssistantConnection} dependencies.resolveConnection
 * @param {typeof verifyOpenCodeApiKey} [dependencies.verifyConnectionCommand]
 */
function createOpenCodeSessionRegistration({
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexGitCommand,
  command = "",
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  getAssistantManager,
  listConnections,
  logger,
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  project,
  publishSessionChanged: publishApplicationSessionChanged,
  publishConversation,
  runNativeDetachedConversation,
  readCatalogCommand = readOpenCodeCatalog,
  readZenModelsCommand = readOpenCodeZenModelIds,
  recordGitActor = recordSessionGitCommandActor,
  resolveConnection,
  verifyConnectionCommand = verifyOpenCodeApiKey
}) {
  const publishSessionChanged = publishMainConversationEvent.bind(
    null, opencodeTerminalNamespace, publishApplicationSessionChanged, publishConversation
  );
  const sharedRuntime = createOpenCodeSharedRuntime({
    onStop: details => {
      vibe64SessionDebugLog("server.opencode.shared-process.stop", details);
      logOperationalEvent(logger, /failed|lost/u.test(details.reason) ? "warn" : "info", {
        component: "vibe64.opencode",
        event: "vibe64.opencode.shared_process_stop",
        ...details
      }, "Stopping the shared OpenCode process.");
    }
  });
  const { turns, temporaryConversations } = sharedRuntime;
  const hostPreparation = createOpenCodeHostPreparation({
    agentDatabaseCommand,
    agentEnvCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    command,
    createServerProcess,
    env,
    getAssistantManager,
    listConnections,
    prepareCommandEnvironment,
    project,
    resolveConnection,
    sharedRuntime
  });
  const presentation = createOpenCodeConversationPresentation({
    getAssistantManager,
    publishSessionChanged,
    turns,
    temporaryConversations,
    logger
  });
  const events = createOpenCodeConversationEvents({
    project,
    publishSessionChanged,
    sharedRuntime,
    presentation
  });
  const mainMessagePreparation = createOpenCodeMainMessagePreparation({
    project,
    env,
    recordGitActor,
    hostPreparation,
    events,
    presentation
  });
  const { contextFor } = mainMessagePreparation;
  const accounts = createOpenCodeConversationAccounts({
    command,
    createServerProcess,
    env,
    listConnections,
    readCatalogCommand,
    readZenModelsCommand,
    sharedRoots: hostPreparation.sharedRoots,
    verifyConnectionCommand,
    mainMessagePreparation,
    resolveConnection
  });
  const scopedPreparation = createOpenCodeScopedPreparation({
    project,
    contextFor,
    hostPreparation,
    events,
    publishSessionChanged,
    prepareSessionCleanup,
    logger
  });

  const lifecyclePreparation = createOpenCodeLifecyclePreparation({
    project,
    getAssistantManager,
    sharedRuntime,
    hostPreparation,
    mainMessagePreparation,
    events,
    presentation,
    resolveConnection
  });
  const renewalPreparation = createOpenCodeSessionRenewalPreparation({
    mainMessagePreparation,
    hostPreparation,
    lifecyclePreparation
  });

  const terminals = createOpenCodeInteractiveTerminals({
    sharedRuntime,
    contextFor,
    hostPreparation,
    env,
    recordGitActor
  });

  function prepareSessionCleanup(sessionId = "", options = {}) {
    return lifecyclePreparation.prepareSessionCleanup(sessionId, options);
  }

  const provider = createOpenCodeSessionAgentProvider({
    sharedRuntime,
    hostPreparation,
    accounts,
    mainMessagePreparation,
    scopedPreparation,
    lifecyclePreparation,
    renewalPreparation,
    terminals,
    publishSessionChanged,
    prepareSessionCleanup,
    runNativeDetachedConversation
  });
  return Object.freeze({
    provider,
    hostPreparation,
    accounts,
    terminals
  });
}

export {
  createOpenCodeSessionRegistration
};
