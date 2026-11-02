import { computed, ref, watch } from "vue";
import { providerUnavailableReason } from "../lib/aiConnectionChoices.js";

/**
 * The OpenCode provider picker: the catalogue providers not yet connected, its
 * search, and whether Add a connection can still offer OpenCode.
 */
function useAiProviderPicker({
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
}) {
  const providerPickerOpen = ref(false);
  const providerPickerPending = ref(false);
  const providerSearch = ref("");
  const checkingOpenCode = ref(false);

  const configuredProviderIds = computed(() => new Set(connections.value.map((connection) => (
    String(connection.id || "")
  ))));
  const availableProviders = computed(() => registryProviders.value.filter((provider) => (
    !configuredProviderIds.value.has(String(provider?.id || ""))
  )));
  const openCodeAddAvailable = computed(() => !registryLoaded.value || Boolean(registryLoadError.value) ||
    availableProviders.value.some((provider) => !providerUnavailableReason(provider)));
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

  /** Checks this computer for OpenCode again, and opens the picker once it is there. */
  async function checkOpenCodeAgain() {
    checkingOpenCode.value = true;
    try {
      await nativeAccounts.refresh();
    } finally {
      checkingOpenCode.value = false;
    }
    if (!missingTool("opencode")) await openProviderPicker();
  }

  /** Opens the picker in place of Add a connection and reloads the catalogue once. */
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

  watch(addAiOpen, async (open) => {
    if (!open) return;
    try {
      await reloadRegistry();
    } catch {
      // The provider picker retains the registry error and retry action.
    }
  });

  return {
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
  };
}

export { useAiProviderPicker };
