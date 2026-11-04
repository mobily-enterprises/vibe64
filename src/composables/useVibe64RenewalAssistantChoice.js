import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { computed, ref } from "vue";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";

/**
 * A fresh session's AI choice: the connected engines, the chosen engine's
 * providers, models, agents and thinking levels, and the complete selection
 * once each is known.
 * @param {object} options
 * @param {import("vue").ComputedRef<boolean>} options.active Whether the choice is shown, which starts its catalogue reads.
 */
function useVibe64RenewalAssistantChoice({ active }) {
  const engineId = ref("");
  const modelProviderId = ref("");
  const modelId = ref("");
  const agentId = ref("");
  const variantId = ref("");
  const emptyText = ref("");

  const overview = useVibe64AssistantCatalog({
    active,
    configuredOnly: true
  });
  const details = useVibe64AssistantCatalog({
    active: computed(() => active.value && Boolean(engineId.value)),
    engineId,
    modelProviderId,
    modelSearch: emptyText,
    providerConnectedOnly: true,
    providerCursor: emptyText,
    providerSearch: emptyText
  });

  const engineRows = computed(() => overview.engines.value.filter((engine) => (
    engine.health?.status === "ready" &&
    (engine.modelProviders || []).some((provider) => provider.connected === true)
  )));
  const engineItems = computed(() => engineRows.value.map((engine) => ({
    title: engine.label || engine.engineId,
    value: engine.engineId
  })));
  const selectedEngine = computed(() => [
    details.modelEngine.value,
    details.providerEngine.value,
    details.selectedOverviewEngine.value
  ].find((engine) => engine?.engineId === engineId.value) || null);
  const providerRows = computed(() => {
    const engine = engineId.value === "opencode"
      ? details.providerEngine.value
      : details.selectedOverviewEngine.value;
    return (engine?.modelProviders || []).filter((provider) => provider.connected === true);
  });
  const providerItems = computed(() => providerRows.value.map((provider) => ({
    title: provider.label || provider.id,
    value: provider.id
  })));
  const selectedProvider = computed(() => providerRows.value.find((provider) => (
    provider.id === modelProviderId.value
  )) || null);
  const modelProvider = computed(() => (
    details.modelEngine.value?.engineId === engineId.value
      ? details.modelEngine.value.modelProviders?.find((provider) => (
          provider.id === modelProviderId.value && provider.connected === true
        )) || null
      : null
  ));
  const modelRows = computed(() => modelProvider.value?.models || []);
  const availableModels = computed(() => modelRows.value.filter((model) => (
    model.status === "available"
  )));
  const modelItems = computed(() => availableModels.value.map((model) => ({
    title: model.label || model.id,
    value: model.id
  })));
  const selectedModel = computed(() => availableModels.value.find((model) => (
    model.id === modelId.value
  )) || null);
  const compatibleAgents = computed(() => {
    const providerId = modelProviderId.value;
    const selectedModelId = modelId.value;
    return (selectedEngine.value?.agents || []).filter((agent) => (
      ["all", "primary"].includes(agent.mode) &&
      (!agent.modelProviderId || agent.modelProviderId === providerId) &&
      (!agent.modelId || agent.modelId === selectedModelId)
    ));
  });
  const selectedAgent = computed(() => compatibleAgents.value.find((agent) => (
    agent.id === agentId.value
  )) || null);
  const variantItems = computed(() => [
    { title: "Automatic", value: "" },
    ...(selectedModel.value?.variants || []).map((variant) => ({
      title: variant.label || variant.id,
      value: variant.id
    }))
  ]);
  const selectionRevision = computed(() => String(selectedEngine.value?.revision || ""));
  const selection = computed(() => {
    if (
      !selectedProvider.value ||
      !selectedModel.value ||
      !selectedAgent.value ||
      !selectionRevision.value
    ) {
      return null;
    }
    return {
      agentId: selectedAgent.value.id,
      catalogRevision: selectionRevision.value,
      engineId: engineId.value,
      modelId: selectedModel.value.id,
      modelProviderId: selectedProvider.value.id,
      variantId: variantId.value
    };
  });
  const overviewLoading = computed(() => Boolean(
    overview.overview.isInitialLoading.value || overview.overview.isLoading.value
  ));
  const engineDetailsLoading = computed(() => Boolean(
    engineId.value && (
      details.overview.isInitialLoading.value || details.overview.isLoading.value
    )
  ));
  const providerLoading = computed(() => Boolean(
    engineId.value === "opencode" && (
      details.providerPage.isInitialLoading.value || details.providerPage.isLoading.value
    )
  ));
  const modelLoading = computed(() => Boolean(
    modelProviderId.value && (
      details.modelPage.isInitialLoading.value || details.modelPage.isLoading.value
    )
  ));
  const detailsLoading = computed(() => Boolean(
    engineDetailsLoading.value || providerLoading.value || modelLoading.value
  ));
  const loading = computed(() => overviewLoading.value || detailsLoading.value);
  const initialLoading = computed(() => overviewLoading.value && engineRows.value.length === 0);
  const error = computed(() => String(
    overview.overview.loadError.value ||
    (engineId.value ? details.overview.loadError.value : "") ||
    (engineId.value === "opencode" ? details.providerPage.loadError.value : "") ||
    (engineId.value && modelProviderId.value ? details.modelPage.loadError.value : "") ||
    ""
  ));
  const selectionSummary = computed(() => selection.value ? vibe64AssistantSelectionLabel(selection.value) : "");

  function hydrateSelection(value = null) {
    const current = value && typeof value === "object" ? value : {};
    engineId.value = String(current.engineId || "");
    modelProviderId.value = String(current.modelProviderId || "");
    modelId.value = String(current.modelId || "");
    agentId.value = String(current.agentId || "");
    variantId.value = String(current.variantId || "");
  }

  function selectEngine(value = "") {
    engineId.value = String(value || "");
    modelProviderId.value = "";
    modelId.value = "";
    agentId.value = "";
    variantId.value = "";
  }

  function selectProvider(value = "") {
    modelProviderId.value = String(value || "");
    modelId.value = "";
    agentId.value = "";
    variantId.value = "";
  }

  function selectModel(value = "") {
    modelId.value = String(value || "");
    agentId.value = "";
    variantId.value = "";
  }

  function selectVariant(value = "") {
    variantId.value = String(value || "");
  }

  async function reload() {
    await Promise.allSettled([
      overview.reload(),
      details.reload()
    ]);
  }

  return {
    agentId,
    availableModels,
    compatibleAgents,
    detailsLoading,
    engineDetailsLoading,
    engineId,
    engineItems,
    engineRows,
    error,
    hydrateSelection,
    initialLoading,
    loading,
    modelId,
    modelItems,
    modelLoading,
    modelProviderId,
    modelRows,
    overviewLoading,
    providerItems,
    providerLoading,
    providerRows,
    reload,
    selectEngine,
    selectModel,
    selectProvider,
    selectVariant,
    selectedAgent,
    selectedEngine,
    selectedModel,
    selectedProvider,
    selection,
    selectionSummary,
    variantId,
    variantItems
  };
}

export { useVibe64RenewalAssistantChoice };
