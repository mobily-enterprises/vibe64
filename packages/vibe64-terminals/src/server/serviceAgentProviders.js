import { CUSTOM_AI_PROVIDER_ID } from "@jskit-ai/assistant-core/shared/native-providers";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { createClaudeConversationHost } from "./agent/providers/claudeConversationHost.js";
import { createSessionAgentManager } from "./agent/sessionAgentManager.js";
import { createCodexSessionRegistration } from "./codexSessionRegistration.js";
import { CLAUDE_PREPARATION_DELIVERY_STAGES } from "./mainConversationBinding.js";
import { createOpenCodeSessionRegistration } from "./openCodeSessionRegistration.js";
import { createServiceProviderAccess } from "./serviceProviderAccess.js";
import { createSessionAttachments } from "./sessionAttachments.js";
import { createHash } from "node:crypto";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").CodexProviderConnectionStore} CodexProviderConnectionStore */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProviderUsage} ProviderUsage */
/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */
/** @typedef {import("./types.js").ReadClaudeAccountStatus} ReadClaudeAccountStatus */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").ServiceCommandServices} ServiceCommandServices */
/** @typedef {import("./types.js").ContinueGoalAfterAccountChange} ContinueGoalAfterAccountChange */
/** @typedef {import("./types.js").ServiceMainConversationHost} ServiceMainConversationHost */
/** @typedef {import("./types.js").ServiceState} ServiceState */

/** @param {RuntimeEnv} env */
function codexToolHomeSourceFromEnv(env) {
  const context = codexRuntimeContext({
    env
  });
  return context?.ok === true ? context.toolHomeSource : "";
}

/**
 * The session's assistants: the Main conversation runtime, the Claude, Codex and OpenCode providers with their
 * command helpers, and the session agent manager that routes to them.
 * @param {object} dependencies
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ServiceMainConversationHost["authorizeMainConversation"]} dependencies.authorizeMainConversation
 * @param {object} dependencies.codexProviderOptions
 * @param {CodexProviderConnectionStore} dependencies.codexProviderConnections
 * @param {object} dependencies.codexTerminalController a host's Codex terminal settings
 * @param {ServiceCommandServices} dependencies.commands
 * @param {ContinueGoalAfterAccountChange} dependencies.continueGoalAfterAccountChange
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {object} dependencies.opencodeTerminalController a host's OpenCode terminal settings
 * @param {ServiceMainConversationHost["prepareMainConversationOperation"]} dependencies.prepareMainConversationOperation
 * @param {ProjectService} dependencies.project
 * @param {ProviderUsage} dependencies.providerUsage
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {ReadClaudeAccountStatus} dependencies.readClaudeAccountStatus
 * @param {object | null} dependencies.runtimeProfile the server's runtime profile, or none
 * @param {ServiceState} dependencies.state
 */
function createServiceAgentProviders({
  assistantContext,
  authorizeMainConversation,
  codexProviderOptions,
  codexProviderConnections,
  codexTerminalController,
  commands,
  continueGoalAfterAccountChange,
  env,
  logger,
  opencodeTerminalController,
  prepareMainConversationOperation,
  project,
  providerUsage,
  publishAgentSessionChanged,
  readClaudeAccountStatus,
  runtimeProfile,
  state
}) {
  const {
    agentDatabaseCommand,
    agentEnvCommand,
    agentPagesCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand
  } = commands;
  const mainConversations = createConversationRuntime({
    engine: "codex",
    hostDeliveryStages: CLAUDE_PREPARATION_DELIVERY_STAGES,
    onDeliveryTiming(event) {
      const slow = event.elapsedMs >= 1000 && ["accepted", "first-response"].includes(event.stage);
      logOperationalEvent(logger, slow || event.stage === "failed" ? "warn" : "info", {
        event: "vibe64.agent_message.delivery_timing",
        component: "vibe64.agent_message",
        sessionId: event.conversationId,
        engineId: event.engine,
        messageId: event.messageId,
        stage: event.stage,
        previousStage: event.previousStage,
        durationMs: event.durationMs,
        elapsedMs: event.elapsedMs,
        timings: event.timings
      }, "Assistant delivery timing.");
    },
    toolCatalog: assistantContext.mainToolCatalog,
    authorize: authorizeMainConversation,
    host: {
      env,
      nativeTools: true,
      conversation: prepareMainConversationOperation
    }
  });
  const runNativeDetachedConversation = request => mainConversations.runNativeDetachedConversation(request);
  const publishConversation = event => mainConversations.publishNative(event);
  const codex = createCodexSessionRegistration({
    ...codexTerminalController,
    listConnections: codexProviderConnections.list,
    connectionStatus: (context) => state.assistantRuntime.codexConnectionStatus(context),
    agentDatabaseCommand,
    agentEnvCommand,
    agentPagesCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexAppServerProviderOptions: codexProviderOptions,
    codexToolHomeRequired: codexTerminalController.codexToolHomeRequired ?? true,
    codexToolHomeSource: codexTerminalController.codexToolHomeSource || codexToolHomeSourceFromEnv(env),
    codexGitCommand,
    env,
    logger,
    project,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation,
    continueGoalAfterAccountChange,
    runNativeDetachedConversation,
    runtimeProfile
  });
  // OpenCode lists and resolves the owner's custom endpoint beside its own saved
  // connections. A change of address, model or context is a new route.
  async function openCodeCustomConnection() {
    const endpoint = await codexProviderConnections.openCodeEndpoint();
    if (!endpoint) return null;
    const route = createHash("sha256").update(JSON.stringify([endpoint.baseUrl, endpoint.model, endpoint.contextWindow])).digest("hex");
    return {
      modelProviderId: CUSTOM_AI_PROVIDER_ID,
      connected: true,
      productLabel: endpoint.provider.label,
      billingLabel: "Your own model server",
      defaultModelId: endpoint.model,
      apiKey: endpoint.apiKey,
      canonicalUrl: "",
      endpointCode: `custom-${route.slice(0, 16)}`,
      fingerprint: `sha256:${createHash("sha256").update(JSON.stringify([route, endpoint.apiKey])).digest("hex")}`,
      customProvider: endpoint.provider
    };
  }
  async function listOpenCodeConnections(context) {
    const listed = await state.assistantRuntime.listConnections(context);
    const custom = await openCodeCustomConnection();
    if (!custom) return listed;
    const { apiKey: _key, ...row } = custom;
    return [...(Array.isArray(listed) ? listed : []), row];
  }
  // OpenCode's registration reaches the session agent manager that routes to it.
  let sessionAgent;
  const opencode = createOpenCodeSessionRegistration({
    ...opencodeTerminalController,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPagesCommand,
    agentPreviewCommand,
    agentSessionCommand,
    codexGitCommand,
    env,
    getAssistantManager: () => sessionAgent,
    listConnections: listOpenCodeConnections,
    logger,
    project,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation,
    resolveConnection: (context) => context?.modelProviderId === CUSTOM_AI_PROVIDER_ID
      ? openCodeCustomConnection() : state.assistantRuntime.resolveConnection(context),
    runNativeDetachedConversation
  });
  const sessionAttachments = createSessionAttachments({ project, env });
  const claudeProvider = createClaudeConversationHost({
    env,
    project,
    logger,
    publishSessionChanged: publishAgentSessionChanged,
    publishConversation,
    systemRoot: codexProviderOptions.systemRoot,
    runNativeDetachedConversation,
    codexGitCommand,
    agentDatabaseCommand,
    agentEnvCommand,
    agentPagesCommand,
    agentPreviewCommand,
    agentSessionCommand,
    accountStatus: readClaudeAccountStatus,
    connectionStatus: (context) => state.assistantRuntime.claudeConnectionStatus(context)
  });
  const providerAccess = createServiceProviderAccess({
    state,
    claudeProvider,
    codex,
    codexProviderConnections
  });
  const readRoutingConfiguration = () => createAssistantRoutingStore({ systemRoot: codexProviderOptions.systemRoot }).read();
  sessionAgent = createSessionAgentManager({
    attachments: sessionAttachments,
    conversationRuntime: mainConversations,
    readProviderUsage: providerUsage.read,
    resolveAssistantUser: (user) => state.assistantRuntime.resolveAssistantUser(user),
    readRoutingConfiguration,
    providers: [
      claudeProvider,
      codex.provider,
      opencode.provider
    ],
    readAssistantAccess: providerAccess.readAssistantAccess
  });

  return Object.freeze({
    codex,
    mainConversations,
    opencode,
    readRoutingConfiguration,
    sessionAgent,
    sessionAttachments
  });
}

export {
  createServiceAgentProviders
};
