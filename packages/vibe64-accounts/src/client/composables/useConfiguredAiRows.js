import { computed } from "vue";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { nativeAccountConfigured } from "../lib/aiConnectionChoices.js";

/**
 * Every configured AI connection as one row per orchestrator and provider,
 * grouped by orchestrator, and whether the lists behind them have loaded.
 */
function useConfiguredAiRows({
  nativeAccounts,
  codexProviders,
  connections,
  isInitialLoading,
  codexAccount,
  codexConnected,
  claudeAccount,
  claudeConnected
}) {
  const configuredAiRows = computed(() => [
    ...(nativeAccountConfigured(codexAccount.value) ? [{
      ownerOnly: codexAccount.value?.ownerOnly,
      billingLabel: codexAccount.value?.username || "Codex account",
      engineId: "codex",
      id: "codex",
      kind: "codex",
      modelProviderId: "openai",
      connected: codexConnected.value,
      keyHint: codexConnected.value ? "Connected" : "Reconnect required",
      managementUrl: "",
      modelLabel: "Available for Codex sessions",
      providerLabel: "OpenAI"
    }] : []),
    ...(nativeAccountConfigured(claudeAccount.value) ? [{
      ownerOnly: true,
      billingLabel: claudeAccount.value?.username || "Claude account",
      engineId: "claude",
      id: "claude",
      kind: "claude",
      modelProviderId: "anthropic",
      connected: claudeConnected.value,
      keyHint: claudeConnected.value ? "Connected" : "Reconnect required",
      managementUrl: "https://claude.ai/settings/billing",
      modelLabel: "Choose its models in Models",
      providerLabel: "Claude"
    }] : []),
    ...codexProviders.connections.value.flatMap((connection) => {
      const provider = curatedCodexProvider(connection.id);
      return (connection.configuredEngines || []).map((engineId) => ({
        ...connection,
        engineId,
        connected: engineId === "claude" ? connection.claudeReady : connection.connected,
        kind: "codex-provider",
        modelProviderId: connection.id,
        providerLabel: provider.label,
        billingLabel: provider.description,
        ownerOnly: Boolean(provider.ownerOnly),
        keyHint: (engineId === "claude" ? connection.claudeReady : connection.connected) ? "Connected" : "Reconnect required",
        modelLabel: provider.models.map(({ label }) => label).join(" · ")
      }));
    }),
    ...connections.value.map((connection) => ({
      ...connection,
      engineId: "opencode",
      kind: "opencode",
      modelProviderId: connection.id,
      modelLabel: connection.id === "zai"
          ? "GLM-4.7 Flash is ready for new sessions"
          : connection.id === "opencode"
            ? "Zen key ready; choose model access below"
          : "Choose its models in Models",
      providerLabel: connection.productLabel || connection.label
    }))
  ]);
  const configuredAiGroups = computed(() => [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "opencode", label: "OpenCode" }
  ].map((engine) => ({ ...engine, accounts: configuredAiRows.value.filter((account) => account.engineId === engine.id) }))
    .filter((engine) => engine.accounts.length));
  const aiStatusLoaded = computed(() => Boolean(
    nativeAccounts.status.value && Array.isArray(nativeAccounts.status.value.accounts)
  ));
  const nativeLoadError = computed(() => String(nativeAccounts.loadError.value || codexProviders.loadError.value || ""));
  const accountsInitialLoading = computed(() => Boolean(
    isInitialLoading.value || codexProviders.resource.isInitialLoading.value || (!aiStatusLoaded.value && nativeAccounts.isLoading.value)
  ));

  return {
    accountsInitialLoading,
    aiStatusLoaded,
    configuredAiGroups,
    configuredAiRows,
    nativeLoadError
  };
}

export { useConfiguredAiRows };
