import { computed, inject, provide, ref, unref, watch } from "vue";
import { useCodexProviderConnections } from "./useCodexProviderConnections.js";
import { useVibe64Accounts } from "./useVibe64Accounts.js";
import { AI_CONNECTIONS_ENDPOINT } from "../lib/accountsGateApi.js";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { useAiConnections } from "./useAiConnections.js";
import { AI_CONNECTION_PROVIDER_PATTERN, AI_CONNECTION_REVISION_PATTERN } from "../../shared/aiConnectionIdentity.js";
import { nativeAccountConfigured, providerUnavailableReason } from "../lib/aiConnectionChoices.js";
import { zenAccessTitle, zenCheck, zenCheckIsRunning, zenCheckProgress, zenCheckSummary } from "../lib/zenModelCheck.js";
import { useAiConnectionRemoval } from "./useAiConnectionRemoval.js";
import { useAiKeyEditor } from "./useAiKeyEditor.js";
import { useAiProviderPicker } from "./useAiProviderPicker.js";
import { useConfiguredAiRows } from "./useConfiguredAiRows.js";
import { useModelAccess } from "./useModelAccess.js";
import { useNativeAiSetup } from "./useNativeAiSetup.js";

const AI_CONNECTION_MANAGER_KEY = Symbol("vibe64.aiConnectionManager");

/**
 * What the manager tells its screen: a connection changed or connected, or the manager is busy.
 * @typedef {(event: "busy" | "changed" | "connected", value?: boolean) => void} AiConnectionEmit
 */

/**
 * Every AI connection the owner has, and the state behind adding, managing,
 * removing and routing them: the script of AI Accounts, moved as one piece so
 * the setup screen's Manage and Advanced share one instance. Each concern is its
 * own part; this adds Add a connection, Manage, the Models screen and the busy
 * state over them. followRoute: a providerId/providerRevision in the route
 * opens that provider's key editor.
 * @param {{
 *   endpoint?: string,
 *   isOwner?: import("vue").MaybeRef<boolean>,
 *   emit: AiConnectionEmit,
 *   followRoute?: boolean
 * }} options
 */
function useAiConnectionManager({ endpoint = AI_CONNECTIONS_ENDPOINT, isOwner = false, emit, followRoute = true }) {
  const owner = computed(() => Boolean(unref(isOwner)));
  const addAiOpen = ref(false);
  const catalogProviderId = ref("");
  // The Models screen and the setup it opens on; a team-key request asks the
  // setup screen to start its team DeepSeek step.
  const routingOpen = ref(false);
  const routingSetup = ref("owner");
  const teamKeyRequests = ref(0);
  const routingSaving = ref(false);
  const refreshingAll = ref(false);

  const nativeAccounts = useVibe64Accounts();
  const codexProviders = useCodexProviderConnections({ enabled: owner });

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

  /** An AI tool this computer lacks, so Add connection can say so before anyone starts. */
  function missingTool(id = "") {
    return nativeAccounts.status.value?.missingTools?.find((tool) => tool.id === id) || null;
  }

  const {
    availableProviders,
    checkingOpenCode,
    checkOpenCodeAgain,
    configuredProviderIds,
    filteredProviders,
    openCodeAddAvailable,
    openProviderPicker,
    providerPickerLoading,
    providerPickerOpen,
    providerPickerPending,
    providerSearch
  } = useAiProviderPicker({
    addAiOpen,
    missingTool,
    nativeAccounts,
    connections,
    registryProviders,
    registryLoaded,
    registryLoadError,
    registryIsInitialLoading,
    registryIsFetching,
    reloadRegistry
  });
  const {
    backFromNativeSetup,
    chooseNativeProvider,
    chooseOpenCodeCustomEndpoint,
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
    nativeSetupToolProblem,
    openCodeCustomAvailable
  } = useNativeAiSetup({ owner, nativeAccounts, codexProviders });
  const {
    accountsInitialLoading,
    aiStatusLoaded,
    configuredAiGroups,
    configuredAiRows,
    nativeLoadError
  } = useConfiguredAiRows({
    nativeAccounts,
    codexProviders,
    connections,
    isInitialLoading,
    codexAccount,
    codexConnected,
    claudeAccount,
    claudeConnected
  });
  const {
    catalogPreparationError,
    chooseProvider,
    clearProviderQuery,
    closeEditor,
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
    existingEditorConnection,
    finishConnectionRouting,
    pendingProvider,
    preparedChoice,
    preparingProviderId,
    queryText,
    resetEditor,
    retryPreparedProvider,
    saveEditor
  } = useAiKeyEditor({
    followRoute,
    owner,
    emit,
    addAiOpen,
    providerPickerOpen,
    configuredProviderIds,
    catalogProviderId,
    catalogEngine,
    catalogLoadError,
    catalogProvider,
    connections,
    reloadCatalog,
    saveConnection,
    savingProviderId
  });
  const {
    applyModelAccess,
    applyZenModelAccess,
    confirmModelAccessUnlock,
    modelAccessConfirmOpen,
    modelAccessRunning,
    modelAccessTarget,
    requestModelAccess,
    scheduleZenProgressRefresh,
    zenCheckRunning
  } = useModelAccess({ connections, reload, updateModelAccess, updatingModelAccessProviderId, emit });
  const {
    confirmRemove,
    nativeRemoving,
    removeOpen,
    removeRunning,
    removeTarget,
    requestRemove
  } = useAiConnectionRemoval({ codexProviders, nativeAccounts, removingProviderId, removeConnection, emit });

  // OpenCode stays on offer while its custom endpoint is unset, even with its catalogue exhausted.
  const openCodeChoiceAvailable = computed(() => openCodeAddAvailable.value || openCodeCustomAvailable.value);
  const canAddConnection = computed(() => nativeChoices.value.length > 0 || openCodeChoiceAvailable.value);

  /** Add a connection's choice: an orchestrator's provider picker, or OpenCode's. */
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

  /** OpenCode's provider picker leads to the custom endpoint form. */
  function chooseOpenCodeCustom() {
    nativeSetupActivator.value = document.activeElement;
    providerPickerOpen.value = false;
    chooseOpenCodeCustomEndpoint();
  }

  /** Back from a setup dialog: OpenCode's returns to its own provider picker. */
  function backFromSetup() {
    if (nativeSetupProviderId.value !== "opencode") {
      backFromNativeSetup();
      return;
    }
    nativeSetupOpen.value = false;
    providerPickerOpen.value = true;
  }

  /** Reloads every connection list at once. */
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

  /** Manage on a configured row: its orchestrator's setup dialog, or its OpenCode key editor. */
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

  /** Opens whatever shows one provider: its key editor, setup dialog, the picker or Add a connection. */
  function openProvider(providerId, { providerLabel = "", providerRevision = "" } = {}) {
    if (AI_CONNECTION_PROVIDER_PATTERN.test(providerId) && AI_CONNECTION_REVISION_PATTERN.test(providerRevision)) {
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
    backFromNativeSetup: backFromSetup,
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
    chooseOpenCodeCustom,
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
    openCodeAddAvailable: openCodeChoiceAvailable,
    openCodeCustomAvailable,
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

/** @typedef {ReturnType<typeof useAiConnectionManager>} AiConnectionManager */

/**
 * One manager per screen: its owner provides it, its parts inject it.
 * @param {AiConnectionManager} manager
 * @returns {AiConnectionManager}
 */
function provideAiConnectionManager(manager) {
  provide(AI_CONNECTION_MANAGER_KEY, manager);
  return manager;
}

/**
 * The manager its screen provided.
 * @returns {AiConnectionManager}
 */
function injectAiConnectionManager() {
  return inject(AI_CONNECTION_MANAGER_KEY);
}

export { injectAiConnectionManager, provideAiConnectionManager, useAiConnectionManager };
