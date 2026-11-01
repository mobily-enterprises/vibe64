import { claudeCatalogueModels } from "@jskit-ai/assistant-core/server/claude-process";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_HELPER_WORKLOAD_LIMITS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  defineVibe64HelperExecutionProfileResolution,
  findVibe64AgentProvider
} from "@local/vibe64-runtime/shared";
import { CLAUDE_CODE_VERSION } from "./claudeCodeProcess.js";
import { claudeConversationError } from "./terminalShared.js";
import { sanitizeOperationText } from "@local/vibe64-core/server/logging";
import { toText } from "@local/vibe64-core/shared/toText";
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("./types.js").ClaudeConversationOwner} ClaudeConversationOwner */
/** @typedef {import("@local/vibe64-core/server/types").CodexProviderConnectionStore} CodexProviderConnectionStore */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64RestoredService} StopVibe64RestoredService */

const ENGINE = VIBE64_ASSISTANT_ENGINE_IDS.CLAUDE;
const TRANSPORT = VIBE64_ASSISTANT_TRANSPORT_IDS.CLAUDE_STREAM_JSON;
// The person's Claude plan, named as AI Accounts names it.
const PLAN_LABEL = findVibe64AgentProvider(ENGINE).accountLabel;
/** The account identity a provider-key connection pins: a fingerprint of its config root, provider and key. */
function claudeProviderAccountIdentity(configRoot, providerId, apiKey) {
  return `sha256:${sha256Hex(JSON.stringify([configRoot, providerId, apiKey]))}`;
}
function claudeCapabilities(initialization, connected, connections = []) {
  const models = claudeCatalogueModels(initialization);
  const external = CURATED_CODEX_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    connected: connections.some((item) => item.id === provider.id && item.claudeReady),
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.label,
      status: "available",
      variants: model.variants.map((id) => ({ id, label: id })),
      capabilities: { images: model.images === true }
    }))
  }));
  const defaultProvider = connected ? { id: "anthropic", models } : external.find((provider) => provider.connected);
  const selected = defaultProvider?.models.find((model) => model.id === "default") || defaultProvider?.models[0];
  const available = connected || external.some((provider) => provider.connected);
  return {
    engineId: ENGINE,
    transportId: TRANSPORT,
    label: "Claude Code",
    agents: [{ id: ENGINE, label: "Claude Code", mode: "primary", description: "Anthropic's native coding agent" }],
    authentication: { management: "account-owner", modes: ["oauth", "api-key"] },
    defaults: {
      agentId: ENGINE,
      modelId: selected?.id || "",
      modelProviderId: defaultProvider?.id || "anthropic",
      variantId: selected?.variants.some((variant) => variant.id === "high") ? "high" : ""
    },
    health: { status: available ? "ready" : "unavailable", message: available ? "" : "Connect Claude Code to use your Claude plan." },
    modelProviders: [{ id: "anthropic", label: PLAN_LABEL, connected, models }, ...external],
    revision: `sha256:${sha256Hex(JSON.stringify({ models, connected, external }))}`
  };
}

/**
 * Account visibility, identity and Helper policy; native queries use the existing owner.
 * @param {object} dependencies
 * @param {ClaudeConversationOwner} dependencies.owner
 * @param {string} dependencies.configRoot
 * @param {CodexProviderConnectionStore} dependencies.providerConnections
 * @param {(context?: object) => Promise<object>} dependencies.accountStatus
 * @param {(context: object) => Promise<boolean>} dependencies.connectionStatus
 * @param {typeof import("./claudeCodeProcess.js").createClaudeCodeProcess} dependencies.createProcess
 * @param {() => string} dependencies.command
 * @param {RunVibe64Command} dependencies.commandRunner
 * @param {StopVibe64RestoredService} dependencies.stopExecution
 * @param {object} dependencies.credentialHome
 * @param {RuntimeEnv} dependencies.env
 */
function createClaudeConversationAccounts({
  owner,
  configRoot,
  providerConnections,
  accountStatus,
  connectionStatus,
  createProcess,
  command,
  commandRunner,
  stopExecution,
  credentialHome,
  env
}) {
  const accountQueries = owner.createAccountQueries({
    accountIdentity,
    createProcess: ({ signal, purpose }) => createProcess({
      command: command(),
      commandRunner,
      stopExecution,
      credentialHome,
      env,
      signal,
      accountQuery: purpose,
      workdir: credentialHome.home,
      toolFree: true,
      onEvent: doNothing
    })
  });
  function accountQueryFailure(failure) {
    if (failure.code === "claude_account_query_failed") throw claudeConversationError(failure.message);
    throw failure;
  }

  async function accountIdentity(context) {
    const selection = context.selection || context.assistantSelection;
    if (curatedCodexProvider(selection?.modelProviderId)) {
      const settings = await providerConnections.claudeProviderSettings(selection.modelProviderId);
      return claudeProviderAccountIdentity(configRoot, settings.providerId, settings.apiKey);
    }
    const account = await accountStatus(context);
    if (account.error) {
      throw claudeConversationError(
        `Claude Code account status could not be checked: ${sanitizeOperationText(account.error).slice(0, 1000)}`,
        "vibe64_claude_account_status_failed"
      );
    }
    const email = toText(account.email).toLowerCase();
    if (!account.loggedIn || !email) {
      throw claudeConversationError("Sign in to Claude Code with your Claude account before continuing.", "vibe64_claude_account_required");
    }
    return `sha256:${sha256Hex(JSON.stringify([configRoot, account.authMethod, email]))}`;
  }

  /**
   * A session's main and temporary chats follow the workspace's current account
   * and keep their history; scoped helpers stay bound to their request's account.
   */
  function prepareAccount(entry) {
    return {
      identity: accountIdentity(entry.context),
      allowAccountChange: entry.main === true || !entry.context.assistantScope,
      get providerId() {
        return entry.context.selection.modelProviderId;
      },
      changedCode: "vibe64_claude_account_changed"
    };
  }

  async function assistantAccess(context) {
    const external = curatedCodexProvider(context.assistantSelection?.modelProviderId);
    if (external) {
      const connection = (await providerConnections.list()).find(({ id }) => id === external.id);
      const available = connection?.claudeReady === true;
      return {
        available,
        missingAccountLabel: available ? "" : external.label,
        connectionIdentity: connection?.claudeConnectionIdentity || "",
        endpointCode: external.id,
        ownerOnly: external.ownerOnly
      };
    }
    const available = await connectionStatus(context);
    return {
      available,
      missingAccountLabel: available ? "" : PLAN_LABEL,
      ownerOnly: true,
      endpointCode: "claude_subscription",
      connectionIdentity: available ? await accountIdentity(context) : ""
    };
  }

  async function capabilities(context, input = {}) {
    const connected = await connectionStatus(context);
    const connections = await providerConnections.list();
    if (input.configuredOnly === true || input.configuredOnly === "true") {
      return claudeCapabilities({ models: [{ value: "sonnet", displayName: "Sonnet" }] }, connected, connections);
    }
    if (input.modelProviderId && input.modelProviderId !== "anthropic") return claudeCapabilities({}, connected, connections);
    if (!connected) return claudeCapabilities({}, false, connections);
    const nativeContext = { ...context, assistantSelection: null, selection: null };
    const catalog = await accountQueries.readCatalogue(nativeContext).catch(accountQueryFailure);
    return claudeCapabilities(catalog, true, connections);
  }

  async function describeProvider(context) {
    return {
      providerId: ENGINE,
      transportId: TRANSPORT,
      accountIdentitySignature: await accountIdentity(context)
    };
  }

  async function readPlanUsage(context) {
    return accountQueries.readPlanUsage(context).catch(accountQueryFailure);
  }

  async function resolveExecutionProfile(context, request) {
    const limits = VIBE64_AGENT_HELPER_WORKLOAD_LIMITS[request.workloadId];
    if (request.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER || !limits) {
      throw claudeConversationError("Unsupported Claude helper execution profile.");
    }
    const modelId = context.assistantSelection?.modelId;
    const modelProviderId = context.assistantSelection?.modelProviderId;
    const catalog = await capabilities(context, { modelProviderId });
    const model = catalog.modelProviders.filter((provider) => provider.connected && (!modelProviderId || provider.id === modelProviderId))
      .flatMap((provider) => provider.models).find((candidate) => candidate.id === modelId);
    const thinking = context.assistantSelection?.variantId || "";
    if (!model || (thinking && !model.variants.some((variant) => variant.id === thinking))) {
      throw claudeConversationError("The selected Claude helper model is unavailable. Choose another in AI Accounts.");
    }
    return defineVibe64HelperExecutionProfileResolution({
      executionProfile: request,
      limits,
      model: modelId,
      providerId: ENGINE,
      revision: `claude-${CLAUDE_CODE_VERSION}-${modelId}-tool-free-v1`,
      thinking
    });
  }
  return Object.freeze({
    prepareAccount,
    queries: accountQueries,
    queryFailure: accountQueryFailure,
    assistantAccess,
    capabilities,
    describeProvider,
    readPlanUsage,
    resolveExecutionProfile
  });
}

const __testables = Object.freeze({ claudeCapabilities });

export { claudeProviderAccountIdentity, createClaudeConversationAccounts, __testables };
