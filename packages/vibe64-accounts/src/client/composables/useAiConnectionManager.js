import { computed, inject, nextTick, onBeforeUnmount, provide, ref, unref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { cliProblem } from "../studio/CliInstallNotice.vue";
import { useCodexProviderConnections } from "./useCodexProviderConnections.js";
import { useVibe64Accounts } from "./useVibe64Accounts.js";
import { AI_CONNECTIONS_ENDPOINT } from "../lib/accountsGateApi.js";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { useAiConnections } from "./useAiConnections.js";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROVIDER_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const AI_CONNECTION_MANAGER_KEY = Symbol("vibe64.aiConnectionManager");

// Every AI connection the owner has, and the state behind adding, managing,
// removing and routing them: the script of AI Accounts, moved as one piece so
// the setup screen's Manage and Advanced share one instance. followRoute: a
// providerId/providerRevision in the route opens that provider's key editor.
function useAiConnectionManager({ endpoint = AI_CONNECTIONS_ENDPOINT, isOwner = false, emit = () => null, followRoute = true } = {}) {
  const owner = computed(() => Boolean(unref(isOwner)));
  const route = useRoute();
  const router = useRouter();
  const addAiOpen = ref(false);
  const nativeSetupOpen = ref(false);
  const nativeProviderPickerOpen = ref(false);
  const nativeSetupOrigin = ref("manage");
  const nativeSetupProviderId = ref("codex");
  const nativeSetupActivator = ref(null);
  const editorActivator = ref(null);
  const nativeRemoving = ref(false);
  const providerPickerOpen = ref(false);
  const providerPickerPending = ref(false);
  const providerSearch = ref("");
  const catalogProviderId = ref("");
  const preparedChoice = ref(null);
  const preparingProviderId = ref("");
  const catalogPreparationError = ref("");
  const editorOpen = ref(false);
  // The Models screen and the setup it opens on; a team-key request asks the
  // setup screen to start its team DeepSeek step.
  const routingOpen = ref(false);
  const routingSetup = ref("owner");
  const teamKeyRequests = ref(0);
  const routingSaving = ref(false);
  const editorRoutingPending = ref(false);
  const editorRoutingSetupError = ref("");
  const nativeRoutingReady = ref(false);
  const nativeRoutingSetupError = ref("");
  const editorOrigin = ref("direct");
  const editorProviderId = ref("");
  const editorProviderRevision = ref("");
  const editorLabel = ref("");
  const editorApiKey = ref("");
  const editorApiKeyVisible = ref(false);
  const editorError = ref("");
  const removeOpen = ref(false);
  const removeTarget = ref(null);
  const modelAccessConfirmOpen = ref(false);
  const modelAccessTarget = ref(null);
  const refreshingAll = ref(false);
  let hydratedRequestIdentity = "";
  let providerPreparationId = 0;
  let zenProgressDisposed = false;
  let zenProgressTimer = null;

  const nativeAccounts = useVibe64Accounts();
  const codexProviders = useCodexProviderConnections({ enabled: owner });
  const nativeModelProviderId = ref("openai");
  const codexProviderSaving = ref(false);

  const {
    catalogEngine,
    catalogLoadError,
    catalogProvider,
    connections,
    isInitialLoading,
    loadError,
    reload,
    reloadCatalog,
    reloadRegistry,
    removeConnection,
    removingProviderId,
    registryIsFetching,
    registryIsInitialLoading,
    registryLoadError,
    registryLoaded,
    registryProviders,
    saveConnection,
    savingProviderId,
    updateModelAccess,
    updatingModelAccessProviderId
  } = useAiConnections({
    endpoint,
    catalogProviderId,
    enabled: owner
  });

  function queryText(value) {
    return String(Array.isArray(value) ? value[0] : value || "").trim();
  }

  const pendingProvider = computed(() => {
    if (!followRoute) return null;
    const id = queryText(route.query.providerId);
    const providerRevision = queryText(route.query.providerRevision);
    if (!PROVIDER_ID_PATTERN.test(id) || !PROVIDER_REVISION_PATTERN.test(providerRevision)) {
      return null;
    }
    return {
      id,
      label: queryText(route.query.providerLabel) || id,
      providerRevision
    };
  });
  const codexAccount = computed(() => {
    const rows = Array.isArray(nativeAccounts.status.value?.accounts)
      ? nativeAccounts.status.value.accounts
      : [];
    return rows.find((account) => String(account?.id || "") === "codex") || null;
  });
  const codexConnected = computed(() => codexAccount.value?.connected === true);
  const claudeAccount = computed(() => nativeAccounts.status.value?.accounts?.find((account) => account.id === "claude") || null);
  const claudeConnected = computed(() => claudeAccount.value?.connected === true);
  function nativeAccountConfigured(account) {
    return account?.connected === true || account?.previouslyLinked === true ||
      ["reconnect_required", "reconnecting"].includes(account?.status);
  }
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
    { id: "codex", label: "Codex", account: codexAccount.value, provider: { id: "openai", label: "GPT", description: "ChatGPT login or OpenAI API key" } }
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
  // AI tools this computer lacks, so Add connection can say so before anyone starts.
  function missingTool(id = "") {
    return nativeAccounts.status.value?.missingTools?.find((tool) => tool.id === id) || null;
  }
  const checkingOpenCode = ref(false);
  async function checkOpenCodeAgain() {
    checkingOpenCode.value = true;
    try {
      await nativeAccounts.refresh();
    } finally {
      checkingOpenCode.value = false;
    }
    if (!missingTool("opencode")) await openProviderPicker();
  }
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
      providerLabel: "GPT"
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
      providerLabel: "Anthropic"
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
  const configuredProviderIds = computed(() => new Set(connections.value.map((connection) => (
    String(connection.id || "")
  ))));
  const availableProviders = computed(() => registryProviders.value.filter((provider) => (
    !configuredProviderIds.value.has(String(provider?.id || ""))
  )));
  const openCodeAddAvailable = computed(() => !registryLoaded.value || Boolean(registryLoadError.value) ||
    availableProviders.value.some((provider) => !providerUnavailableReason(provider)));
  const canAddConnection = computed(() => nativeChoices.value.length > 0 || openCodeAddAvailable.value);
  const filteredProviders = computed(() => {
    const search = providerSearch.value.trim().toLocaleLowerCase();
    if (!search) return availableProviders.value;
    return availableProviders.value.filter((provider) => (
      `${provider?.label || ""}\n${provider?.id || ""}\n${provider?.description || ""}`
        .toLocaleLowerCase()
        .includes(search)
    ));
  });
  const providerPickerLoading = computed(() => Boolean(
    providerPickerPending.value ||
    registryIsInitialLoading.value ||
    (registryIsFetching.value && !registryProviders.value.length)
  ));
  const existingEditorConnection = computed(() => connections.value.find((connection) => (
    connection.id === editorProviderId.value
  )) || null);
  const editorConnectionPolicy = computed(() => (
    catalogProvider.value?.id === editorProviderId.value
      ? catalogProvider.value.connectionPolicy || null
      : null
  ));
  const editorRouteExplanation = computed(() => {
    const policy = editorConnectionPolicy.value;
    if (!policy) return "";
    const access = policy.accessLabel === "Workspace use"
      ? "Authorized workspace members may use this connection."
      : "Only the Vibe64 owner may use this connection; members can suggest main-chat messages for approval.";
    const replacement = existingEditorConnection.value
        ? " Saving a replacement restarts active assistant runtimes with the new key."
        : "";
    const routeNote = String(policy.routeNote || "").trim();
    return `${policy.billingLabel}. ${routeNote ? `${routeNote} ` : ""}${access}${replacement}`;
  });
  const editorCatalogModelCount = computed(() => (
    catalogProvider.value?.id === editorProviderId.value
      ? Number(catalogEngine.value?.page?.total || catalogProvider.value?.models?.length || 0)
      : 0
  ));
  const editorPreparing = computed(() => preparingProviderId.value === editorProviderId.value);
  const editorSaving = computed(() => Boolean(editorProviderId.value) && savingProviderId.value === editorProviderId.value);
  const editorVerificationCopy = computed(() => {
    if (editorPreparing.value) {
      return "Loading the current OpenCode provider details. You can paste the key now; verification becomes available when they are ready.";
    }
    if (editorProviderId.value === "zai") {
      return editorSaving.value
        ? "Checking this key with one tiny GLM-4.7 Flash request on Z.AI's regular API before saving…"
        : "Vibe64 verifies this key with one tiny GLM-4.7 Flash request on Z.AI's regular API before storing it in a host-private file.";
    }
    if (editorProviderId.value === "zai-coding-plan") {
      return editorSaving.value
        ? "Checking this key through Z.AI's Personal Coding Plan route before saving…"
        : "Vibe64 verifies this key through Z.AI's Personal Coding Plan route before storing it in a host-private file.";
    }
    return editorSaving.value
      ? `Checking access with one tiny ${editorLabel.value || "provider"} test request before saving. First use can take up to 30 seconds…`
      : "Vibe64 checks the key and runs a tiny test request before storing it in a host-private file.";
  });
  const editorCanSave = computed(() => Boolean(
    editorProviderId.value &&
    PROVIDER_REVISION_PATTERN.test(editorProviderRevision.value) &&
    editorConnectionPolicy.value &&
    editorApiKey.value.trim() &&
    !editorError.value &&
    !editorPreparing.value &&
    !editorSaving.value
  ));
  const editorBackLabel = computed(() => (
    ["add", "provider-picker"].includes(editorOrigin.value) ? "Back" : "Cancel"
  ));
  const editorEyebrow = computed(() => {
    return existingEditorConnection.value ? "Manage connection" : "Add connection";
  });
  const editorTitle = computed(() => {
    if (existingEditorConnection.value) {
      if (editorProviderId.value === "zai") return "Update regular Z.AI API key";
      if (editorProviderId.value === "zai-coding-plan") return "Update Z.AI Personal Coding Plan key";
      return "Replace provider key";
    }
    if (editorProviderId.value === "zai") return "Connect regular Z.AI API";
    if (editorProviderId.value === "zai-coding-plan") return "Connect Z.AI Personal Coding Plan";
    return `Connect ${editorLabel.value || "provider"}`;
  });
  const removeRunning = computed(() => codexProviders.busy.value || (
    ["codex", "claude"].includes(removeTarget.value?.kind)
      ? nativeRemoving.value
      : Boolean(removingProviderId.value) && removingProviderId.value === String(removeTarget.value?.id || "")
  ));
  const modelAccessRunning = computed(() => (
    Boolean(updatingModelAccessProviderId.value) &&
    updatingModelAccessProviderId.value === String(modelAccessTarget.value?.id || "")
  ));
  const zenCheckRunning = computed(() => connections.value.some((connection) => (
    connection.id === "opencode" &&
    ["starting", "running", "cancelling"].includes(connection.modelAccess?.check?.status)
  )));

  function zenCheck(account = {}) {
    return account.modelAccess?.check || {};
  }

  function zenCheckIsRunning(account = {}) {
    return ["starting", "running", "cancelling"].includes(zenCheck(account).status);
  }

  function zenCheckProgress(account = {}) {
    const check = zenCheck(account);
    return check.total > 0 ? Math.min(100, (check.checked / check.total) * 100) : 0;
  }

  function zenAccessTitle(account = {}) {
    const mode = account.modelAccess?.mode;
    const check = zenCheck(account);
    if (zenCheckIsRunning(account)) return check.status === "cancelling" ? "Stopping model check…" : "Checking Zen models…";
    if (mode === "all") return "All current Zen models enabled";
    if (mode === "verified") return `${Number(check.enabled || 0)} additional Zen models enabled`;
    return "Recommended Zen model only";
  }

  function zenCheckSummary(account = {}) {
    const check = zenCheck(account);
    if (!check.status) return "";
    if (zenCheckIsRunning(account)) {
      const progress = check.total > 0 ? `${check.checked} of ${check.total} checked` : "Reading the current Zen catalogue";
      const current = check.currentModelId ? ` · Now checking ${check.currentModelId}` : "";
      return `${progress}${current}`;
    }
    const unchecked = Math.max(0, Number(check.total || 0) - Number(check.checked || 0));
    const result = `${Number(check.enabled || 0)} enabled · ${Number(check.rejected || 0)} rejected · ${Number(check.retryable || 0)} could not be confirmed · ${unchecked} unchecked`;
    return check.message ? `${result}. ${check.message}` : result;
  }

  function scheduleZenProgressRefresh() {
    if (zenProgressDisposed || zenProgressTimer || !zenCheckRunning.value) return;
    zenProgressTimer = setTimeout(async () => {
      zenProgressTimer = null;
      try {
        await reload();
      } finally {
        scheduleZenProgressRefresh();
      }
    }, 2_000);
  }

  function providerUnavailableReason(provider = {}) {
    if (provider.apiKeyCompatible === false) {
      return "Requires provider-specific account details";
    }
    if (!String(provider.defaultModelId || "").trim()) {
      return "No usable default model is currently available";
    }
    return "";
  }

  async function openProviderPicker() {
    const requestAlreadyPending = providerPickerPending.value;
    providerPickerPending.value = true;
    addAiOpen.value = false;
    providerPickerOpen.value = true;
    if (requestAlreadyPending) return;
    try {
      await reloadRegistry();
    } catch {
      // The resource owns its stable retry state.
    } finally {
      providerPickerPending.value = false;
    }
  }

  function chooseAiType(type = "") {
    if (["codex", "claude"].includes(type)) {
      if (!nativeChoices.value.some((choice) => choice.id === type)) return;
      nativeSetupProviderId.value = type;
      nativeSetupActivator.value = document.activeElement;
      addAiOpen.value = false;
      nativeProviderPickerOpen.value = true;
      return;
    }
    if (type === "opencode") {
      void openProviderPicker();
    }
  }

  function chooseNativeProvider(providerId) {
    if (!nativeAvailableProviders.value.some((provider) => provider.id === providerId)) return;
    nativeModelProviderId.value = providerId;
    nativeSetupOrigin.value = "add";
    nativeProviderPickerOpen.value = false;
    nativeSetupOpen.value = true;
  }

  function backFromNativeSetup() {
    nativeSetupOpen.value = false;
    nativeProviderPickerOpen.value = true;
  }

  watch(addAiOpen, async (open) => {
    if (!open) return;
    try {
      await reloadRegistry();
    } catch {
      // The provider picker retains the registry error and retry action.
    }
  });

  async function refreshAllAccounts() {
    if (refreshingAll.value) return;
    refreshingAll.value = true;
    try {
      await Promise.allSettled([
        reload(),
        nativeAccounts.refresh(),
        codexProviders.resource.reload()
      ]);
    } finally {
      refreshingAll.value = false;
    }
  }

  async function chooseProvider(choice = {}, {
    origin = "direct",
    preserveInput = false
  } = {}) {
    const id = String(choice.id || "");
    if (!id || preparingProviderId.value) return;
    if (origin === "provider-picker" && configuredProviderIds.value.has(id)) return;
    if (!preserveInput) editorActivator.value = document.activeElement;
    preparedChoice.value = choice;
    const preparationId = ++providerPreparationId;
    preparingProviderId.value = id;
    catalogPreparationError.value = "";
    catalogProviderId.value = id;
    editorOrigin.value = origin;
    editorProviderId.value = id;
    editorProviderRevision.value = "";
    editorLabel.value = String(choice.connection?.label || choice.label || id);
    if (!preserveInput) {
      editorApiKey.value = "";
      editorApiKeyVisible.value = false;
      editorError.value = "";
    }
    providerPickerOpen.value = false;
    editorOpen.value = true;
    await nextTick();

    let catalogFailed = false;
    try {
      await reloadCatalog();
    } catch {
      catalogFailed = true;
    }
    if (
      preparationId !== providerPreparationId ||
      !editorOpen.value ||
      editorProviderId.value !== id
    ) {
      return;
    }
    const provider = catalogProvider.value;
    if (
      catalogFailed ||
      catalogLoadError.value ||
      provider?.id !== id ||
      !PROVIDER_REVISION_PATTERN.test(String(provider.definitionRevision || ""))
    ) {
      catalogPreparationError.value = String(
        catalogLoadError.value || "The live OpenCode catalog did not return this provider."
      );
      preparingProviderId.value = "";
      return;
    }
    editorProviderRevision.value = provider.definitionRevision;
    editorLabel.value = String(provider.label || choice.label || id);
    preparingProviderId.value = "";
  }

  function retryPreparedProvider() {
    if (preparedChoice.value) {
      void chooseProvider(preparedChoice.value, {
        origin: editorOrigin.value,
        preserveInput: true
      });
    }
  }

  function resetEditor() {
    providerPreparationId += 1;
    editorOpen.value = false;
    catalogProviderId.value = "";
    preparedChoice.value = null;
    preparingProviderId.value = "";
    catalogPreparationError.value = "";
    editorOrigin.value = "direct";
    editorProviderId.value = "";
    editorProviderRevision.value = "";
    editorLabel.value = "";
    editorApiKey.value = "";
    editorApiKeyVisible.value = false;
    editorError.value = "";
  }

  function closeEditor() {
    if (editorSaving.value) return;
    const origin = editorOrigin.value;
    resetEditor();
    if (origin === "provider-picker") {
      providerPickerOpen.value = true;
    } else if (origin === "add") {
      addAiOpen.value = true;
    }
  }

  async function clearProviderQuery() {
    const query = { ...route.query };
    delete query.providerId;
    delete query.providerLabel;
    delete query.providerRevision;
    await router.replace({ query });
  }

  async function saveEditor() {
    if (!editorCanSave.value) {
      if (!editorApiKey.value.trim()) editorError.value = "Enter the provider API key.";
      return;
    }
    let response = null;
    try {
      response = await saveConnection({
        apiKey: editorApiKey.value,
        label: editorLabel.value,
        providerId: editorProviderId.value,
        providerRevision: editorProviderRevision.value
      });
    } catch (error) {
      editorError.value = String(error?.fieldErrors?.apiKey || "");
      return;
    }
    if (response?.ok !== false) {
      editorRoutingSetupError.value = response?.routing?.ok === false ? response.routing.error : "";
      editorApiKey.value = "";
      editorApiKeyVisible.value = false;
      editorRoutingPending.value = true;
      await clearProviderQuery();
      emit("changed");
    }
  }

  function finishConnectionRouting() {
    editorRoutingPending.value = false;
    resetEditor();
    emit("connected");
  }

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

  function requestRemove(connection = {}) {
    removeTarget.value = connection;
    removeOpen.value = true;
  }

  function requestModelAccess(connection = {}, unlocked = false) {
    if (!connection.modelAccess?.configurable || updatingModelAccessProviderId.value) return;
    modelAccessTarget.value = connection;
    if (unlocked === true) {
      modelAccessConfirmOpen.value = true;
      return;
    }
    void applyModelAccess(false);
  }

  async function confirmModelAccessUnlock() {
    modelAccessConfirmOpen.value = false;
    await applyModelAccess(true);
  }

  async function applyModelAccess(unlocked) {
    const providerId = String(modelAccessTarget.value?.id || "");
    if (!providerId || updatingModelAccessProviderId.value) return null;
    try {
      const response = await updateModelAccess(
        providerId,
        unlocked === true ? "enable-all" : "disable-additional"
      );
      if (response?.ok !== false) emit("changed");
      return response;
    } finally {
      if (!modelAccessConfirmOpen.value) modelAccessTarget.value = null;
    }
  }

  async function applyZenModelAccess(account = {}, operation = "") {
    const providerId = String(account.id || "");
    if (
      providerId !== "opencode" ||
      !operation ||
      updatingModelAccessProviderId.value
    ) {
      return null;
    }
    const response = await updateModelAccess(providerId, operation);
    if (response?.ok !== false) {
      emit("changed");
    }
    return response;
  }

  async function confirmRemove() {
    const target = removeTarget.value;
    const providerId = String(target?.id || "");
    if (!providerId || removeRunning.value) return;
    let response = null;
    try {
      if (target?.kind === "codex-provider") {
        response = await codexProviders.change({ modelProviderId: providerId, engineId: target.engineId, remove: true });
      } else if (["codex", "claude"].includes(target?.kind)) {
        nativeRemoving.value = true;
        response = await nativeAccounts.logout(target.kind);
        if (response?.ok !== false) await nativeAccounts.reloadLocalStatus();
      } else {
        response = await removeConnection(providerId);
      }
    } catch {
      return;
    } finally {
      nativeRemoving.value = false;
    }
    if (response?.ok !== false) {
      removeOpen.value = false;
      removeTarget.value = null;
      emit("changed");
    }
  }

  function manageConfiguredAi(account = {}) {
    nativeModelProviderId.value = account.kind === "codex-provider" ? account.id : account.kind === "claude" ? "anthropic" : "openai";
    if (["codex", "claude", "codex-provider"].includes(account.kind)) {
      nativeSetupOrigin.value = "manage";
      nativeSetupProviderId.value = account.kind === "codex-provider" ? account.engineId || "codex" : account.kind;
      nativeSetupActivator.value = document.activeElement;
      nativeSetupOpen.value = true;
      return;
    }
    void chooseProvider({
      connection: account,
      id: account.id,
      label: account.label
    });
  }

  watch([pendingProvider, owner], ([provider, ownerNow]) => {
    if (!provider) {
      hydratedRequestIdentity = "";
      return;
    }
    if (!ownerNow) return;
    const identity = `${provider.id}:${provider.providerRevision}`;
    if (hydratedRequestIdentity === identity) return;
    hydratedRequestIdentity = identity;
    void chooseProvider(provider);
  }, { immediate: true });

  watch(zenCheckRunning, (running) => {
    if (!running && zenProgressTimer) {
      clearTimeout(zenProgressTimer);
      zenProgressTimer = null;
    }
    if (running) scheduleZenProgressRefresh();
  }, { immediate: true });

  onBeforeUnmount(() => {
    zenProgressDisposed = true;
    if (zenProgressTimer) clearTimeout(zenProgressTimer);
    zenProgressTimer = null;
  });

  function openProvider(providerId, { providerLabel = "", providerRevision = "" } = {}) {
    if (PROVIDER_ID_PATTERN.test(providerId) && PROVIDER_REVISION_PATTERN.test(providerRevision)) {
      void chooseProvider({ id: providerId, label: providerLabel || providerId, providerRevision });
    } else if (["codex", "claude"].includes(providerId)) manageConfiguredAi({ kind: providerId });
    else if (curatedCodexProvider(providerId)) manageConfiguredAi({ kind: "codex-provider", id: providerId });
    else if (providerId === "opencode") void openProviderPicker();
    else addAiOpen.value = true;
  }
  const busy = computed(() => Boolean(routingSaving.value || editorSaving.value || removeRunning.value || modelAccessRunning.value || codexProviderSaving.value));
  watch(busy, (value) => emit("busy", value));

  return {
    accountsInitialLoading,
    addAiOpen,
    aiStatusLoaded,
    applyModelAccess,
    applyZenModelAccess,
    availableProviders,
    backFromNativeSetup,
    busy,
    canAddConnection,
    catalogEngine,
    catalogLoadError,
    catalogPreparationError,
    catalogProvider,
    catalogProviderId,
    checkingOpenCode,
    checkOpenCodeAgain,
    chooseAiType,
    chooseNativeProvider,
    chooseProvider,
    claudeAccount,
    claudeConnected,
    clearProviderQuery,
    closeEditor,
    codexAccount,
    codexConnected,
    codexProviders,
    codexProviderSaving,
    configuredAiGroups,
    configuredAiRows,
    configuredProviderIds,
    confirmModelAccessUnlock,
    confirmRemove,
    connections,
    editorActivator,
    editorApiKey,
    editorApiKeyVisible,
    editorBackLabel,
    editorCanSave,
    editorCatalogModelCount,
    editorConnectionPolicy,
    editorError,
    editorEyebrow,
    editorLabel,
    editorOpen,
    editorOrigin,
    editorPreparing,
    editorProviderId,
    editorProviderRevision,
    editorRouteExplanation,
    editorRoutingPending,
    editorRoutingSetupError,
    editorSaving,
    editorTitle,
    editorVerificationCopy,
    emit,
    existingEditorConnection,
    filteredProviders,
    finishConnectionRouting,
    isInitialLoading,
    isOwner: owner,
    loadError,
    manageConfiguredAi,
    missingTool,
    modelAccessConfirmOpen,
    modelAccessRunning,
    modelAccessTarget,
    nativeAccountConfigured,
    nativeAccounts,
    nativeAvailableProviders,
    nativeChoices,
    nativeConnected,
    nativeLoadError,
    nativeModelProviderId,
    nativeProviderPickerOpen,
    nativeRemoving,
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
    nativeSetupToolProblem,
    openCodeAddAvailable,
    openProvider,
    openProviderPicker,
    pendingProvider,
    preparedChoice,
    preparingProviderId,
    providerPickerLoading,
    providerPickerOpen,
    providerPickerPending,
    providerSearch,
    providerUnavailableReason,
    queryText,
    refreshAllAccounts,
    refreshingAll,
    registryIsFetching,
    registryIsInitialLoading,
    registryLoaded,
    registryLoadError,
    registryProviders,
    reload,
    reloadCatalog,
    reloadRegistry,
    removeConnection,
    removeOpen,
    removeRunning,
    removeTarget,
    removingProviderId,
    requestModelAccess,
    requestRemove,
    resetEditor,
    retryPreparedProvider,
    routingOpen,
    routingSetup,
    routingSaving,
    saveConnection,
    saveEditor,
    savingProviderId,
    scheduleZenProgressRefresh,
    teamKeyRequests,
    updateModelAccess,
    updatingModelAccessProviderId,
    zenAccessTitle,
    zenCheck,
    zenCheckIsRunning,
    zenCheckProgress,
    zenCheckRunning,
    zenCheckSummary
  };
}

// One manager per screen: its owner provides it, its parts inject it.
function provideAiConnectionManager(manager) {
  provide(AI_CONNECTION_MANAGER_KEY, manager);
  return manager;
}

function injectAiConnectionManager() {
  return inject(AI_CONNECTION_MANAGER_KEY);
}

export { injectAiConnectionManager, provideAiConnectionManager, useAiConnectionManager };
