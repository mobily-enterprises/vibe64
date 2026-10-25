import {
  createOpenCodeMainMessagePreparation,
  publishMainConversationEvent
} from "./mainConversationBinding.js";
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
} from "./sessionRenewalReceipts.js";
import {
  createOpenCodeServerProcess,
  createOpenCodeHostPreparation,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  verifyOpenCodeApiKey
} from "./opencodeServerProcess.js";
import process from "node:process";
import {
  prepareAgentSessionCommandEnvironment
} from "./agentCommandEnvironment.js";
import {
  recordSessionGitCommandActor as writeSessionGitCommandActor
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

function createOpenCodeSessionRegistration({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  agentSessionCommand = null,
  codexGitCommand = null,
  command = "",
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  getAssistantManager = () => null,
  listConnections = async () => [],
  logger = null,
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  projectService,
  publishSessionChanged: publishApplicationSessionChanged = async () => null,
  publishConversation,
  runNativeDetachedConversation,
  readCatalogCommand = readOpenCodeCatalog,
  readZenModelsCommand = readOpenCodeZenModelIds,
  recordGitActor = writeSessionGitCommandActor,
  resolveConnection = async () => null,
  verifyConnectionCommand = verifyOpenCodeApiKey
} = {}) {
  if (!projectService) {
    throw new TypeError("OpenCode terminal controllers require vibe64.project.");
  }
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
    agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
    codexGitCommand, command, createServerProcess, env, getAssistantManager,
    listConnections, prepareCommandEnvironment, projectService, resolveConnection,
    sharedRuntime
  });
  const presentation = createOpenCodeConversationPresentation({ getAssistantManager, publishSessionChanged, turns, temporaryConversations });
  const events = createOpenCodeConversationEvents({ projectService, publishSessionChanged, sharedRuntime, presentation });
  const mainMessagePreparation = createOpenCodeMainMessagePreparation({
    projectService, env, recordGitActor, hostPreparation, events, presentation
  });
  const { contextFor } = mainMessagePreparation;
  const accounts = createOpenCodeConversationAccounts({
    command, createServerProcess, env, listConnections, readCatalogCommand,
    readZenModelsCommand, sharedRoots: hostPreparation.sharedRoots, verifyConnectionCommand,
    mainMessagePreparation, resolveConnection
  });
  const scopedPreparation = createOpenCodeScopedPreparation({
    projectService, contextFor, hostPreparation, events, publishSessionChanged, prepareSessionCleanup
  });

  const lifecyclePreparation = createOpenCodeLifecyclePreparation({
    projectService, getAssistantManager, sharedRuntime, hostPreparation,
    mainMessagePreparation, events, presentation, resolveConnection
  });
  const renewalPreparation = createOpenCodeSessionRenewalPreparation({
    mainMessagePreparation, hostPreparation, lifecyclePreparation
  });

  const terminals = createOpenCodeInteractiveTerminals({
    sharedRuntime, contextFor, hostPreparation, env, recordGitActor
  });

  function prepareSessionCleanup(sessionId = "", options = {}) {
    return lifecyclePreparation.prepareSessionCleanup(sessionId, options);
  }

  const provider = createOpenCodeSessionAgentProvider({
    sharedRuntime, hostPreparation, accounts, mainMessagePreparation, scopedPreparation,
    lifecyclePreparation, renewalPreparation, terminals, publishSessionChanged,
    prepareSessionCleanup, runNativeDetachedConversation
  });
  return { provider, hostPreparation, accounts, terminals };
}

export {
  createOpenCodeSessionRegistration
};
