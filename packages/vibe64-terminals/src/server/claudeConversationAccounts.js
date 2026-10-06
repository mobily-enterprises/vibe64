import { createHash } from "node:crypto";
import { claudeCatalogueModels } from "@jskit-ai/assistant-core/server/claude-process";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { VIBE64_AGENT_HELPER_WORKLOAD_LIMITS, defineVibe64AgentExecutionProfileResolution } from "@local/vibe64-runtime/shared";
import { CLAUDE_CODE_VERSION } from "./claudeCodeProcess.js";
import { claudeConversationError as error } from "./terminalShared.js";

const ENGINE = "claude";
const TRANSPORT = "claude_stream_json";
const text = (value) => String(value ?? "").trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
function claudeCapabilities(initialization, connected, connections = []) {
  const models = claudeCatalogueModels(initialization);
  const external = CURATED_CODEX_PROVIDERS.map((provider) => ({
    id: provider.id, label: provider.label, description: provider.description,
    connected: connections.some((item) => item.id === provider.id && item.claudeReady),
    models: provider.models.map((model) => ({ id: model.id, label: model.label, status: "available",
      variants: model.variants.map((id) => ({ id, label: id })), capabilities: { images: model.images === true } }))
  }));
  const defaultProvider = connected ? { id: "anthropic", models } : external.find((provider) => provider.connected);
  const selected = defaultProvider?.models.find((model) => model.id === "default") || defaultProvider?.models[0];
  const available = connected || external.some((provider) => provider.connected);
  return {
    engineId: ENGINE, transportId: TRANSPORT, label: "Claude Code",
    agents: [{ id: ENGINE, label: "Claude Code", mode: "primary", description: "Anthropic's native coding agent" }],
    authentication: { management: "account-owner", modes: ["oauth", "api-key"] },
    defaults: { agentId: ENGINE, modelId: selected?.id || "", modelProviderId: defaultProvider?.id || "anthropic",
      variantId: selected?.variants.some((variant) => variant.id === "high") ? "high" : "" },
    health: { status: available ? "ready" : "unavailable", message: available ? "" : "Connect Claude Code to use your Claude plan." },
    modelProviders: [{ id: "anthropic", label: "Anthropic", connected, models }, ...external],
    revision: `sha256:${hash(JSON.stringify({ models, connected, external }))}`
  };
}

// Account visibility, identity and Helper policy; native queries use the existing owner.
function createClaudeConversationAccounts({ owner, configRoot, providerConnections, accountStatus, connectionStatus,
  createProcess, command, commandRunner, stopExecution, credentialHome, env }) {
  const accountQueries = owner.createAccountQueries({
    accountIdentity,
    createProcess: () => createProcess({ command, commandRunner, stopExecution, credentialHome, env,
      workdir: credentialHome.home, toolFree: true, onEvent: async () => {} })
  });
  function accountQueryFailure(failure) {
    if (failure.code === "claude_account_query_failed") throw error(failure.message);
    throw failure;
  }

  async function accountIdentity(context) {
    const selection = context.selection || context.assistantSelection;
    if (curatedCodexProvider(selection?.modelProviderId)) {
      const settings = await providerConnections.claudeProviderSettings(selection.modelProviderId);
      return `sha256:${hash(JSON.stringify([configRoot, settings.providerId, settings.apiKey]))}`;
    }
    const account = await accountStatus(context);
    const email = text(account.email).toLowerCase();
    if (!account.loggedIn || !email) {
      throw error("Sign in to Claude Code with your Claude account before continuing.", "vibe64_claude_account_required");
    }
    return `sha256:${hash(JSON.stringify([configRoot, account.authMethod, email]))}`;
  }

  function prepareAccount(entry) {
    return {
      identity: accountIdentity(entry.context),
      get providerId() { return entry.context.selection.modelProviderId; },
      changedCode: "vibe64_claude_account_changed"
    };
  }

  const accounts = {
    prepareAccount, queries: accountQueries, queryFailure: accountQueryFailure,
    async assistantAccess(context) {
      const external = curatedCodexProvider(context.assistantSelection?.modelProviderId);
      if (external) {
        const connection = (await providerConnections.list()).find(({ id }) => id === external.id);
        return { available: connection?.claudeReady === true,
          connectionIdentity: connection?.connectionIdentity || "", endpointCode: external.id,
          ownerOnly: external.ownerOnly };
      }
      const available = await connectionStatus(context);
      return { available, ownerOnly: true, endpointCode: "claude_subscription",
        connectionIdentity: available ? await accountIdentity(context) : "" };
    },
    async capabilities(context, input = {}) {
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
    },
    async describeProvider(context) {
      return {
        providerId: ENGINE,
        transportId: TRANSPORT,
        accountIdentitySignature: await accountIdentity(context)
      };
    },
    async readPlanUsage(context) {
      return accountQueries.readPlanUsage(context).catch(accountQueryFailure);
    },
    async resolveExecutionProfile(context, request) {
      const limits = VIBE64_AGENT_HELPER_WORKLOAD_LIMITS[request.workloadId];
      if (request.profileId !== "helper" || !limits) throw error("Unsupported Claude helper execution profile.");
      const modelId = context.assistantSelection?.modelId;
      const modelProviderId = context.assistantSelection?.modelProviderId;
      const catalog = await accounts.capabilities(context, { modelProviderId });
      const model = catalog.modelProviders.filter((provider) => provider.connected && (!modelProviderId || provider.id === modelProviderId))
        .flatMap((provider) => provider.models).find((model) => model.id === modelId);
      const thinking = context.assistantSelection?.variantId || "";
      if (!model || (thinking && !model.variants.some((variant) => variant.id === thinking))) {
        throw error("The selected Claude helper model is unavailable. Choose another in AI Accounts.");
      }
      return defineVibe64AgentExecutionProfileResolution({
        ...request,
        limits,
        model: modelId,
        thinking,
        providerId: ENGINE,
        revision: `claude-${CLAUDE_CODE_VERSION}-${modelId}-tool-free-v1`,
        policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
        request: { allowProviderModelFallback: false, reasoning: Boolean(thinking), summary: false }
      });
    },
  };
  return Object.freeze(accounts);
}

export { claudeCapabilities, createClaudeConversationAccounts };
