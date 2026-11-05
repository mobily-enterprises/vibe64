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
import { computed, useId, watch } from "vue";

import { useVibe64RenewalAssistantChoice } from "@/composables/useVibe64RenewalAssistantChoice.js";
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
const active = computed(() => props.active === true);
const {
  agentId, availableModels, compatibleAgents, detailsLoading, engineDetailsLoading, engineId, engineItems, engineRows,
  error, hydrateSelection, initialLoading, loading, modelId, modelItems, modelLoading, modelProviderId, modelRows,
  overviewLoading, providerItems, providerLoading, providerRows, reload, selectEngine, selectModel, selectProvider,
  selectVariant, selectedAgent, selectedEngine, selectedModel, selectedProvider, selection, selectionSummary, variantId,
  variantItems
} = useVibe64RenewalAssistantChoice({ active });

function openConnectionSettings() {
  if (!props.disabled) {
    requestVibe64AccountConnectionsDialog({ section: "ai" });
  }
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
  border: 1px solid var(--v64-outline-variant);
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
