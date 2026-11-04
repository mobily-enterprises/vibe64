import { computed, ref } from "vue";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";

/**
 * Custom AI's props, as the menu passes them on.
 * @typedef {object} Vibe64SessionAssistantMenuProps
 * @property {boolean} canConfigure
 * @property {string} catalogPath
 * @property {boolean} changesDisabled
 * @property {((selection: Record<string, any>) => unknown) | null} saveSelection
 * @property {Record<string, any> | null} selection
 * @property {Record<string, any> | null} session
 * @property {import("vue").MaybeRefOrGetter<string>} sessionsApiPath
 */

/**
 * Custom AI's catalogue reads and its draft choice: the connected engines, the
 * chosen engine's models, agents and thinking levels, and the selection Apply
 * would save.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.menuOpen
 * @param {Readonly<Vibe64SessionAssistantMenuProps>} options.props
 */
function useVibe64SessionAssistantChoice({ menuOpen, props }) {
  const routingMode = computed(() => assistantRoutingFromMetadata(props.session?.metadata)?.mode || "");
  const modelProviderId = ref("");
  const modelId = ref("");
  const agentId = ref("");
  const variantId = ref("");
  const assistantSelection = computed(() => props.selection || assistantRoutingFromMetadata(props.session?.metadata)?.override || props.session?.assistantSelection || null);
  const engineId = ref("");
  // A new session's or Colleague's caller keeps the choice itself; a session's
  // own choice is saved through the session.
  const savesThroughCaller = computed(() => props.saveSelection !== null);
  const catalogActive = computed(() => Boolean(menuOpen.value && (props.session?.sessionId || savesThroughCaller.value)));
  const connections = useVibe64AssistantCatalog({ active: catalogActive, configuredOnly: true, path: computed(() => props.catalogPath) });
  const engineRows = computed(() => connections.engines.value.filter((engine) => engine.health?.status === "ready" &&
    engine.modelProviders?.some((provider) => provider.connected)));
  // Warm only connected engines while this dialog is open. Switching orchestrators
  // then reuses the same query; it does not start discovery after the click.
  // Each engine's whole connected catalogue is its only model-list read.
  const catalogs = Object.fromEntries(VIBE64_AGENT_PROVIDERS.map(({ id }) => [id, useVibe64AssistantCatalog({
    active: computed(() => catalogActive.value && engineRows.value.some((engine) => engine.engineId === id)),
    path: computed(() => props.catalogPath),
    engineId: id, allConnectedModels: true, providerConnectedOnly: true
  })]));
  const catalog = computed(() => catalogs[engineId.value]);
  const catalogLoading = computed(() => connections.overview.isInitialLoading.value || catalog.value?.overview.isInitialLoading.value);
  const catalogError = computed(() => String(connections.overview.loadError.value || catalog.value?.overview.loadError.value || ""));
  const selectedOverviewEngine = computed(() => catalog.value?.selectedOverviewEngine.value || null);
  const currentModelEngine = selectedOverviewEngine;
  const providerRows = computed(() => (currentModelEngine.value?.modelProviders || []).filter((provider) => provider.connected));
  const selectedProvider = computed(() => providerRows.value.find((provider) => provider.id === modelProviderId.value));
  const savedProviderUnavailable = computed(() => !catalogLoading.value && assistantSelection.value?.engineId === engineId.value &&
    !providerRows.value.some((provider) => provider.id === assistantSelection.value.modelProviderId));
  const modelRows = computed(() => providerRows.value.flatMap((provider) => provider.models
    .filter((model) => model.status === "available").map((model) => ({ ...model, modelProviderId: provider.id,
      props: { subtitle: provider.label }, key: JSON.stringify([provider.id, model.id]) }))));
  const modelKey = computed(() => JSON.stringify([modelProviderId.value, modelId.value]));
  const modelAccess = computed(() => (
    selectedProvider.value?.modelAccess || {}
  ));
  const modelAccessUnlocked = computed(() => modelAccess.value.mode === "all");
  const recommendedModel = computed(() => modelRows.value.find((model) => (
    model.modelProviderId === modelProviderId.value && model.id === modelAccess.value.recommendedModelId && model.status === "available"
  )) || null);
  const canRestoreRecommendedModel = computed(() => Boolean(
    recommendedModel.value && modelId.value !== recommendedModel.value.id
  ));
  const modelAccessPendingLabel = computed(() => modelAccessUnlocked.value
    ? `Returning to ${recommendedModel.value?.label || "the recommended model"}…`
    : "Unlocking paid models…"
  );
  const selectedModel = computed(() => modelRows.value.find((model) => (
    model.key === modelKey.value
  )) || null);
  // Primary agents that can run the given model of the selected provider.
  function agentsForModel(targetModelId = "") {
    return (currentModelEngine.value?.agents || []).filter((agent) => (
      ["all", "primary"].includes(agent.mode) &&
      (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
      (!agent.modelId || agent.modelId === targetModelId)
    ));
  }
  const compatibleAgents = computed(() => agentsForModel(modelId.value));
  const selectedAgent = computed(() => compatibleAgents.value.find((agent) => (
    agent.id === agentId.value
  )) || null);
  const variantRows = computed(() => [
    { id: "", label: "Default" },
    ...(selectedModel.value?.variants || [])
  ]);
  // Apply carries the whole catalogue's revision, as Models setup does; the server
  // checks a choice against the whole catalogue when one provider's page differs.
  const selectionRevision = computed(() => String(currentModelEngine.value?.revision || ""));
  const draftSelection = computed(() => ({
    agentId: agentId.value,
    catalogRevision: selectionRevision.value,
    engineId: engineId.value,
    modelId: modelId.value,
    modelProviderId: modelProviderId.value,
    variantId: variantId.value
  }));
  const selectionChanged = computed(() => {
    const current = assistantSelection.value || {};
    return ["agentId", "engineId", "modelId", "modelProviderId", "variantId"].some((field) => (
      String(current[field] || "") !== String(draftSelection.value[field] || "")
    ));
  });

  function hydrateSelection() {
    const selection = assistantSelection.value || {};
    engineId.value = String(selection.engineId || "");
    modelProviderId.value = String(selection.modelProviderId || "");
    modelId.value = String(selection.modelId || "");
    agentId.value = String(selection.agentId || "");
    variantId.value = String(selection.variantId || "");
  }

  async function reloadCatalog() {
    await Promise.all([connections.reload(), catalog.value?.reload()]);
  }

  function selectEngine(value) {
    if (props.changesDisabled || value === engineId.value) return;
    engineId.value = value;
    modelProviderId.value = "";
    modelId.value = "";
    agentId.value = "";
    variantId.value = "";
  }

  function selectModel(key) {
    if (props.changesDisabled) return;
    const model = modelRows.value.find((row) => row.key === key);
    if (!model || model.key === modelKey.value) return;
    modelProviderId.value = model.modelProviderId;
    modelId.value = model.id;
    agentId.value = "";
    variantId.value = "";
  }

  function selectVariant(value = "") {
    if (props.changesDisabled) return;
    variantId.value = String(value || "");
  }

  function selectionForModel(model = null) {
    if (!model || model.status !== "available" || !selectionRevision.value) {
      return null;
    }
    const agents = agentsForModel(model.id);
    const agent = agents.find((candidate) => (
      candidate.id === selectedOverviewEngine.value?.defaults?.agentId
    )) || agents[0] || null;
    if (!agent) {
      return null;
    }
    const requestedVariantId = String(agent.variantId || "");
    const variants = Array.isArray(model.variants) ? model.variants : [];
    return {
      agentId: agent.id,
      catalogRevision: selectionRevision.value,
      engineId: engineId.value,
      modelId: model.id,
      modelProviderId: modelProviderId.value,
      variantId: variants.some((variant) => variant.id === requestedVariantId)
        ? requestedVariantId
        : ""
    };
  }

  return {
    agentId,
    assistantSelection,
    canRestoreRecommendedModel,
    catalog,
    catalogError,
    catalogLoading,
    compatibleAgents,
    connections,
    currentModelEngine,
    draftSelection,
    engineId,
    engineRows,
    hydrateSelection,
    modelAccess,
    modelAccessPendingLabel,
    modelAccessUnlocked,
    modelId,
    modelKey,
    modelProviderId,
    modelRows,
    recommendedModel,
    reloadCatalog,
    routingMode,
    savedProviderUnavailable,
    savesThroughCaller,
    selectEngine,
    selectModel,
    selectVariant,
    selectedAgent,
    selectedModel,
    selectedOverviewEngine,
    selectedProvider,
    selectionChanged,
    selectionForModel,
    selectionRevision,
    variantId,
    variantRows
  };
}

export { useVibe64SessionAssistantChoice };
