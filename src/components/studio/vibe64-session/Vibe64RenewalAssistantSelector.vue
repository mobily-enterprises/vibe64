<template>
  <section
    :aria-labelledby="headingId"
    class="studio-renewal-assistant"
  >
    <div class="studio-renewal-assistant__heading">
      <span>
        <strong :id="headingId" class="text-title-small">{{ heading }}</strong>
        <small class="text-body-small">
          {{ supportingText }}
        </small>
      </span>
      <v-btn
        :disabled="disabled || loading"
        size="small"
        type="button"
        variant="text"
        @click="openConnectionSettings"
      >
        {{ manageLabel }}
      </v-btn>
    </div>

    <v-skeleton-loader
      v-if="initialLoading"
      aria-label="Loading AI choices for the fresh session"
      type="list-item-two-line, list-item-two-line"
    />

    <v-alert
      v-else-if="error"
      density="compact"
      role="alert"
      type="warning"
      variant="tonal"
    >
      <span class="studio-renewal-assistant__error">
        <span>{{ error }}</span>
        <v-btn :disabled="loading" size="small" type="button" variant="text" @click="reload">
          {{ loading ? "Checking…" : "Try again" }}
        </v-btn>
      </span>
    </v-alert>

    <v-alert
      v-else-if="engineItems.length === 0"
      density="compact"
      role="status"
      type="info"
      variant="tonal"
    >
      {{ emptyMessage }}
    </v-alert>

    <div v-else class="studio-renewal-assistant__fields">
      <v-select
        v-if="engineItems.length > 1"
        :disabled="disabled"
        hide-details="auto"
        :items="engineItems"
        label="AI"
        :model-value="engineId"
        variant="outlined"
        @update:model-value="selectEngine"
      />
      <v-select
        v-if="providerItems.length > 1"
        :disabled="disabled || detailsLoading"
        hide-details="auto"
        :items="providerItems"
        label="Provider"
        :model-value="modelProviderId"
        variant="outlined"
        @update:model-value="selectProvider"
      />
      <v-select
        :disabled="disabled || detailsLoading || modelItems.length === 0"
        hide-details="auto"
        :items="modelItems"
        label="Model"
        :model-value="modelId"
        no-data-text="No available models"
        variant="outlined"
        @update:model-value="selectModel"
      />
      <v-select
        v-if="variantItems.length > 1"
        :disabled="disabled || detailsLoading"
        hide-details="auto"
        :items="variantItems"
        label="Thinking"
        :model-value="variantId"
        variant="outlined"
        @update:model-value="selectVariant"
      />
    </div>

    <p
      v-if="selectionSummary"
      class="studio-renewal-assistant__summary text-body-small"
      role="status"
    >
      {{ summaryPrefix }}{{ selectionSummary }}
    </p>
  </section>
</template>

<script setup>
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { computed, ref, useId, watch } from "vue";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  disabled: {
    default: false,
    type: Boolean
  },
  initialSelection: {
    default: null,
    type: Object
  },
  emptyMessage: {
    default: "Connect an AI account before creating the fresh session.",
    type: String
  },
  heading: {
    default: "AI for the fresh session",
    type: String
  },
  manageLabel: {
    default: "Manage AIs",
    type: String
  },
  summaryPrefix: {
    default: "Fresh session: ",
    type: String
  },
  supportingText: {
    default: "Keep the current AI, or continue the handover with another connected provider or model.",
    type: String
  }
});

const emit = defineEmits(["update:ready", "update:selection"]);
const headingId = `vibe64-renewal-assistant-${useId()}`;
const engineId = ref("");
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const emptyText = ref("");

const active = computed(() => props.active === true);
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

function openConnectionSettings() {
  if (!props.disabled) {
    requestVibe64AccountConnectionsDialog({ section: "ai" });
  }
}

async function reload() {
  await Promise.allSettled([
    overview.reload(),
    details.reload()
  ]);
}

watch(active, (isActive, wasActive) => {
  if (isActive && !wasActive) {
    hydrateSelection(props.initialSelection);
  }
  if (!isActive) {
    emit("update:ready", false);
    emit("update:selection", null);
  }
}, { immediate: true });

watch([engineRows, overviewLoading], ([engines, isLoading]) => {
  if (
    !active.value ||
    isLoading ||
    engines.some((engine) => engine.engineId === engineId.value)
  ) return;
  const preferred = engines.find((engine) => (
    engine.modelProviders?.some((provider) => provider.preferred === true)
  ));
  selectEngine(preferred?.engineId || engines[0]?.engineId || "");
}, { immediate: true });

watch(
  [providerRows, engineDetailsLoading, providerLoading],
  ([providers, engineLoading, providersLoading]) => {
    if (
      !active.value ||
      engineLoading ||
      providersLoading ||
      providers.some((provider) => provider.id === modelProviderId.value)
    ) return;
    const preferred = providers.find((provider) => provider.preferred === true);
    selectProvider(
      preferred?.id || selectedEngine.value?.defaults?.modelProviderId || providers[0]?.id || ""
    );
  },
  { immediate: true }
);

watch(
  [availableModels, modelRows, modelLoading],
  ([models, allModels, isLoading]) => {
    if (!active.value || isLoading || allModels.some((model) => (
      model.id === modelId.value && model.status === "available"
    ))) return;
    const defaultModelId = selectedProvider.value?.defaultModelId || selectedEngine.value?.defaults?.modelId;
    selectModel(models.find((model) => model.id === defaultModelId)?.id || models[0]?.id || "");
  },
  { immediate: true }
);

watch(
  [compatibleAgents, detailsLoading],
  ([agents, isLoading]) => {
    if (!active.value || isLoading || agents.some((agent) => agent.id === agentId.value)) return;
    agentId.value = agents.find((agent) => (
      agent.id === selectedEngine.value?.defaults?.agentId
    ))?.id || agents[0]?.id || "";
  },
  { immediate: true }
);

watch([selectedModel, selectedAgent], ([model, agent]) => {
  if (!active.value || !model) return;
  const fixedVariant = String(agent?.variantId || "");
  if (fixedVariant) {
    variantId.value = fixedVariant;
    return;
  }
  if (variantId.value && !(model.variants || []).some((variant) => variant.id === variantId.value)) {
    variantId.value = "";
  }
}, { immediate: true });

watch(selection, (current) => {
  emit("update:ready", Boolean(current) && !loading.value && !error.value);
  emit("update:selection", current);
}, { immediate: true });

watch([loading, error], () => {
  emit("update:ready", Boolean(selection.value) && !loading.value && !error.value);
});
</script>

<style scoped>
.studio-renewal-assistant {
  border: 1px solid rgba(var(--v-theme-outline), 0.22);
  border-radius: 0.75rem;
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
}

.studio-renewal-assistant__heading,
.studio-renewal-assistant__error {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-renewal-assistant__heading > span {
  display: grid;
  gap: 0.15rem;
}

.studio-renewal-assistant__heading small,
.studio-renewal-assistant__summary {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.studio-renewal-assistant__fields {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.studio-renewal-assistant__summary {
  margin: 0;
}

@media (max-width: 600px) {
  .studio-renewal-assistant__heading {
    align-items: flex-start;
  }

  .studio-renewal-assistant__fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
