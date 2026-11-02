import { computed, ref, watch } from "vue";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { cliProblem } from "../studio/CliInstallNotice.vue";
import { nativeAccountConfigured } from "../lib/aiConnectionChoices.js";

/**
 * The Codex and Claude Code sign-ins and the setup dialog that connects or
 * manages them: which provider pairs Add a connection still offers, what the
 * dialog shows, and the routing step a new sign-in leads to.
 */
function useNativeAiSetup({ owner, nativeAccounts, codexProviders }) {
  const nativeSetupOpen = ref(false);
  const nativeProviderPickerOpen = ref(false);
  const nativeSetupOrigin = ref("manage");
  const nativeSetupProviderId = ref("codex");
  const nativeSetupActivator = ref(null);
  const nativeRoutingReady = ref(false);
  const nativeRoutingSetupError = ref("");
  const nativeModelProviderId = ref("openai");
  const codexProviderSaving = ref(false);

  const codexAccount = computed(() => {
    const rows = Array.isArray(nativeAccounts.status.value?.accounts)
      ? nativeAccounts.status.value.accounts
      : [];
    return rows.find((account) => String(account?.id || "") === "codex") || null;
  });
  const codexConnected = computed(() => codexAccount.value?.connected === true);
  const claudeAccount = computed(() => nativeAccounts.status.value?.accounts?.find((account) => account.id === "claude") || null);
  const claudeConnected = computed(() => claudeAccount.value?.connected === true);
  const nativeSetupAccount = computed(() => nativeSetupProviderId.value === "claude" ? claudeAccount.value : codexAccount.value);
  const nativeSetupConnected = computed(() => nativeSetupAccount.value?.connected === true);
  const nativeSetupDetails = computed(() => nativeSetupProviderId.value === "claude" ? {
    label: "Claude Code",
    authLabel: "Sign in with Claude",
    authMode: "browser",
    deviceAuth: false,
    message: "Connect your Claude subscription. Sign in in your browser, then paste the authorization code here."
  } : {
    label: "Codex",
    authLabel: "Login with ChatGPT",
    authMode: "device",
    deviceAuth: true,
    message: "Choose ChatGPT login or an OpenAI API key."
  });
  const nativeChoices = computed(() => [
    { id: "claude", label: "Claude Code", account: claudeAccount.value, provider: { id: "anthropic", label: "Claude", description: "Claude subscription" } },
    { id: "codex", label: "Codex", account: codexAccount.value, provider: { id: "openai", label: "OpenAI", description: "ChatGPT login or OpenAI API key" } }
  ].map(({ account, provider, ...engine }) => ({
    ...engine,
    providers: [
      ...(!nativeAccountConfigured(account) ? [provider] : []),
      ...CURATED_CODEX_PROVIDERS.filter(({ id }) => !codexProviders.connections.value.some(
        (connection) => connection.id === id && connection.configuredEngines?.includes(engine.id)
      ))
    ]
  })).filter((engine) => engine.providers.length));
  const nativeAvailableProviders = computed(() => nativeChoices.value.find((engine) => engine.id === nativeSetupProviderId.value)?.providers || []);
  // A missing or broken CLI keeps the tool's own name and the server's plain explanation.
  const nativeSetupToolProblem = computed(() => cliProblem(nativeSetupAccount.value) ? nativeSetupAccount.value.status : "");
  const nativeSetupRows = computed(() => [{
    ...(nativeSetupAccount.value || { connected: false, id: nativeSetupProviderId.value, status: "missing" }),
    ...nativeSetupDetails.value,
    label: nativeSetupToolProblem.value ? nativeSetupDetails.value.label
      : nativeSetupAccount.value?.username || `${nativeSetupDetails.value.label} account`,
    username: "",
    message: nativeSetupConnected.value ? "Connected"
      : nativeSetupToolProblem.value ? nativeSetupAccount.value.message : nativeSetupDetails.value.message
  }]);

  /** Opens the setup dialog for one provider the picker offers. */
  function chooseNativeProvider(providerId) {
    if (!nativeAvailableProviders.value.some((provider) => provider.id === providerId)) return;
    nativeModelProviderId.value = providerId;
    nativeSetupOrigin.value = "add";
    nativeProviderPickerOpen.value = false;
    nativeSetupOpen.value = true;
  }

  /** Returns from the setup dialog to its provider picker. */
  function backFromNativeSetup() {
    nativeSetupOpen.value = false;
    nativeProviderPickerOpen.value = true;
  }

  /** A sign-in the open dialog started has connected: show its routing step. */
  function nativeConnected(account) {
    if (!owner.value || !nativeSetupOpen.value || account?.id !== nativeSetupProviderId.value) return;
    nativeRoutingSetupError.value = account.routing?.ok === false ? account.routing.error : "";
    nativeRoutingReady.value = true;
  }
  watch(nativeSetupOpen, (open) => {
    if (!open) {
      nativeRoutingReady.value = false;
      nativeRoutingSetupError.value = "";
    }
  });

  return {
    backFromNativeSetup,
    chooseNativeProvider,
    claudeAccount,
    claudeConnected,
    codexAccount,
    codexConnected,
    codexProviderSaving,
    nativeAvailableProviders,
    nativeChoices,
    nativeConnected,
    nativeModelProviderId,
    nativeProviderPickerOpen,
    nativeRoutingReady,
    nativeRoutingSetupError,
    nativeSetupAccount,
    nativeSetupActivator,
    nativeSetupConnected,
    nativeSetupDetails,
    nativeSetupOpen,
    nativeSetupOrigin,
    nativeSetupProviderId,
    nativeSetupRows,
    nativeSetupToolProblem
  };
}

export { useNativeAiSetup };
