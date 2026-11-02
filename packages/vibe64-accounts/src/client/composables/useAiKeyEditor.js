import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AI_CONNECTION_PROVIDER_PATTERN, AI_CONNECTION_REVISION_PATTERN } from "../../shared/aiConnectionIdentity.js";

/** A route query value as trimmed text. */
function queryText(value) {
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

/**
 * The OpenCode key editor: it confirms a catalogue provider's current
 * definition, checks and saves its key, then hands over to that connection's
 * routing step. With followRoute, a providerId and providerRevision in the
 * route open the editor for that provider.
 */
function useAiKeyEditor({
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
}) {
  const route = useRoute();
  const router = useRouter();
  const editorActivator = ref(null);
  const preparedChoice = ref(null);
  const preparingProviderId = ref("");
  const catalogPreparationError = ref("");
  const editorOpen = ref(false);
  const editorRoutingPending = ref(false);
  const editorRoutingSetupError = ref("");
  const editorOrigin = ref("direct");
  const editorProviderId = ref("");
  const editorProviderRevision = ref("");
  const editorLabel = ref("");
  const editorApiKey = ref("");
  const editorApiKeyVisible = ref(false);
  const editorError = ref("");
  let hydratedRequestIdentity = "";
  let providerPreparationId = 0;

  const pendingProvider = computed(() => {
    if (!followRoute) return null;
    const id = queryText(route.query.providerId);
    const providerRevision = queryText(route.query.providerRevision);
    if (!AI_CONNECTION_PROVIDER_PATTERN.test(id) || !AI_CONNECTION_REVISION_PATTERN.test(providerRevision)) {
      return null;
    }
    return {
      id,
      label: queryText(route.query.providerLabel) || id,
      providerRevision
    };
  });
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
    AI_CONNECTION_REVISION_PATTERN.test(editorProviderRevision.value) &&
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

  /** Opens the editor for a provider and confirms its current catalogue definition. */
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
      !AI_CONNECTION_REVISION_PATTERN.test(String(provider.definitionRevision || ""))
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

  /** Confirms the same provider again, keeping the key already typed. */
  function retryPreparedProvider() {
    if (preparedChoice.value) {
      void chooseProvider(preparedChoice.value, {
        origin: editorOrigin.value,
        preserveInput: true
      });
    }
  }

  /** Closes the editor and forgets its provider and key. */
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

  /** Closes the editor, back to the picker or Add a connection it came from. */
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

  /** Removes the provider a route asked for from the route. */
  async function clearProviderQuery() {
    const query = { ...route.query };
    delete query.providerId;
    delete query.providerLabel;
    delete query.providerRevision;
    await router.replace({ query });
  }

  /** Checks and saves the key, then shows the connection's routing step. */
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

  /** Ends the routing step and the editor with the provider connected. */
  function finishConnectionRouting() {
    editorRoutingPending.value = false;
    resetEditor();
    emit("connected");
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

  return {
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
  };
}

export { useAiKeyEditor };
