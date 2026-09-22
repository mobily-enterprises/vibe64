<template>
  <!-- The shared control forwards these public VMenu props; it has no custom activator slot. -->
  <AssistantModelControl
    v-model="menuOpen"
    :target="target" :activator-props="{ class: 'd-none' }"
    :provider-rows="connectionRows" :model-rows="modelRows" :variant-rows="variantRows"
    :model-provider-id="connectionId" :model-id="modelId" :variant-id="variantId"
    :selection-summary="selectionSummary" :button-title="buttonTitle" :changes-disabled="changesDisabled"
    :saving="saving" :can-save="canSave" :catalog-loading="catalogLoading" :catalog-error="catalogError"
    @select-provider="selectConnection" @select-model="selectModel" @select-variant="selectVariant"
    @apply="save" @reload="reloadCatalog"
  >
    <template #before-choices>
      <p v-if="engineId !== assistantSelection?.engineId || modelProviderId !== assistantSelection?.modelProviderId" class="text-body-small" role="status">
        Your conversation and files stay here. This AI will receive the recent or missed messages with your next message.
      </p>
      <p v-if="savedProviderUnavailable" class="text-body-small" role="status">
        This session's saved AI connection is unavailable. Choose an available model and Apply to reconnect.
      </p>
    </template>
    <template #model-note>
      <small
        v-if="modelAccess.configurable && !modelAccess.managementOnly && !modelAccessUnlocked"
        class="vibe64-session-assistant-menu__locked-note"
      >
        <v-icon :icon="mdiLockOutline" size="14" />
        Additional paid models are hidden until they are enabled.
      </small>
    </template>
    <template #provider-controls>
      <section
        v-if="modelAccess.configurable && !modelAccess.managementOnly"
        aria-label="Provider model access"
        class="vibe64-session-assistant-menu__section"
      >
        <div class="vibe64-session-assistant-menu__label">Z.AI access</div>
        <v-sheet
          class="vibe64-session-assistant-menu__access"
          :class="{ 'vibe64-session-assistant-menu__access--paid': modelAccessUnlocked }"
          rounded="lg"
        >
          <div class="vibe64-session-assistant-menu__access-summary">
            <v-avatar :color="modelAccessUnlocked ? 'warning' : 'success'" size="36" variant="tonal">
              <v-icon :icon="modelAccessUnlocked ? mdiCreditCardOutline : mdiShieldCheckOutline" size="19" />
            </v-avatar>
            <span>
              <strong>{{ modelAccessUnlocked ? "Paid models unlocked" : "Free-only mode" }}</strong>
              <small>
                {{ modelAccessUnlocked
                  ? "Other Z.AI models can consume API credit."
                  : `${recommendedModel?.label || "The recommended model"} stays available without paid credit.` }}
              </small>
            </span>
          </div>
          <v-switch
            color="primary"
            :disabled="changesDisabled || !canConfigure || modelAccessUpdating || saving"
            hide-details
            inset
            :label="modelAccessUpdating ? modelAccessPendingLabel : modelAccess.label"
            :model-value="modelAccessUnlocked"
            @click.prevent="requestModelAccessChange(!modelAccessUnlocked)"
          />
          <v-btn
            v-if="canRestoreRecommendedModel"
            block
            color="primary"
            :disabled="changesDisabled || saving || modelAccessUpdating"
            size="small"
            type="button"
            variant="tonal"
            @click="restoreRecommendedModel"
          >
            {{ saving ? `Switching to ${recommendedModel.label}…` : `Use ${recommendedModel.label}` }}
          </v-btn>
        </v-sheet>
      </section>
    </template>
    <template #footer>
      <div class="vibe64-session-assistant-menu__footer">
        <slot name="access" />
        <div class="d-flex flex-wrap ga-1">
          <v-btn
            v-if="canConfigure"
            :disabled="changesDisabled"
            size="small"
            variant="text"
            @click="openConnectionSettings"
          >
            Configure more AIs
          </v-btn>
          <v-btn aria-label="Close AI controls" min-height="48" variant="text" @click="menuOpen = false">
            Close
          </v-btn>
        </div>
      </div>
    </template>
  </AssistantModelControl>
  <v-dialog v-model="unlockConfirmOpen" max-width="31rem" persistent>
    <v-card rounded="xl">
      <v-card-item class="vibe64-session-assistant-menu__confirm-header">
        <template #prepend>
          <v-avatar color="warning" size="44" variant="tonal">
            <v-icon :icon="mdiCreditCardOutline" size="23" />
          </v-avatar>
        </template>
        <v-card-title>{{ modelAccess.label || "Unlock provider models" }}?</v-card-title>
        <v-card-subtitle class="vibe64-session-assistant-menu__confirm-subtitle">
          GLM-4.7 Flash stays available either way.
        </v-card-subtitle>
      </v-card-item>
      <v-card-text class="text-body-medium">
        {{ modelAccess.warning || "These models may consume paid provider credit." }}
      </v-card-text>
      <v-card-actions class="vibe64-session-assistant-menu__confirm-actions">
        <v-btn :disabled="modelAccessUpdating" type="button" variant="text" @click="unlockConfirmOpen = false">
          Keep free only
        </v-btn>
        <v-btn
          color="warning"
          :disabled="modelAccessUpdating"
          type="button"
          variant="flat"
          @click="confirmUnlockModelAccess"
        >
          Unlock paid models
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { AssistantModelControl } from "@jskit-ai/assistant-core/client/conversation";
import {
  mdiCreditCardOutline,
  mdiLockOutline,
  mdiShieldCheckOutline
} from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AssistantModelAccessPath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  target: {
    default: null,
    type: Object
  },
  accessLoading: {
    default: false,
    type: Boolean
  },
  accessLabel: {
    default: "",
    type: String
  },
  canConfigure: {
    default: false,
    type: Boolean
  },
  changesDisabled: {
    default: false,
    type: Boolean
  },
  session: {
    default: null,
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: [Function, Object, String]
  }
});

const menuOpen = defineModel({ type: Boolean, default: false });
const saving = ref(false);
const modelAccessUpdating = ref(false);
const unlockConfirmOpen = ref(false);
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const emptyText = ref("");
const assistantSelection = computed(() => props.session?.assistantSelection || null);
const engineId = ref("");
const accessLabel = computed(() => String(props.accessLabel || "").trim());
const catalogActive = computed(() => Boolean(
  props.session?.sessionId && engineId.value
));
const catalog = useVibe64AssistantCatalog({
  active: catalogActive,
  engineId,
  modelProviderId,
  modelSearch: emptyText,
  providerConnectedOnly: true,
  providerCursor: emptyText,
  providerSearch: emptyText
});
const connections = useVibe64AssistantCatalog({ active: catalogActive, configuredOnly: true });
const connectionRows = computed(() => connections.engines.value
  .filter((engine) => engine.health?.status === "ready")
  .flatMap((engine) => (engine.modelProviders || [])
    .filter((provider) => provider.connected)
    .map((provider) => ({
      ...provider,
      id: `${engine.engineId}/${provider.id}`,
      engineId: engine.engineId,
      modelProviderId: provider.id,
      label: `${engine.label || engine.engineId} - ${provider.label || provider.id}`
    }))
  ));
const connectionId = computed(() => `${engineId.value}/${modelProviderId.value}`);
const overviewLoading = computed(() => connections.overview.isInitialLoading.value || catalog.overview.isInitialLoading.value);
const providerLoading = computed(() => engineId.value === "opencode" && (
  catalog.providerPage.isInitialLoading.value
));
const modelLoading = computed(() => Boolean(modelProviderId.value) && (
  catalog.modelPage.isInitialLoading.value
));
const catalogLoading = computed(() => overviewLoading.value || providerLoading.value || modelLoading.value);
const catalogError = computed(() => String(
  connections.overview.loadError.value ||
  catalog.overview.loadError.value ||
  catalog.providerPage.loadError.value ||
  catalog.modelPage.loadError.value ||
  ""
));
const selectedOverviewEngine = catalog.selectedOverviewEngine;
const providerRows = computed(() => (
  engineId.value === "opencode"
    ? catalog.providerEngine.value?.modelProviders || []
    : selectedOverviewEngine.value?.modelProviders || []
).filter((provider) => provider.connected === true));
const selectedProvider = computed(() => providerRows.value.find((provider) => (
  provider.id === modelProviderId.value
)) || null);
const savedProviderUnavailable = computed(() => Boolean(
  assistantSelection.value?.modelProviderId &&
  !connectionRows.value.some((provider) => provider.id === `${assistantSelection.value.engineId}/${assistantSelection.value.modelProviderId}`)
));
const currentModelEngine = computed(() => catalog.modelEngine.value?.engineId === engineId.value
  ? catalog.modelEngine.value : null);
const modelProvider = computed(() => (
  currentModelEngine.value?.modelProviders?.find((provider) => (
    provider.id === modelProviderId.value && provider.connected === true
  )) || null
));
const modelRows = computed(() => (
  (modelProvider.value?.models || []).filter((model) => model.status === "available")
));
const modelAccess = computed(() => (
  modelProvider.value?.modelAccess || selectedProvider.value?.modelAccess || {}
));
const modelAccessUnlocked = computed(() => modelAccess.value.mode === "all");
const recommendedModel = computed(() => modelRows.value.find((model) => (
  model.id === modelAccess.value.recommendedModelId && model.status === "available"
)) || null);
const canRestoreRecommendedModel = computed(() => Boolean(
  recommendedModel.value && modelId.value !== recommendedModel.value.id
));
const modelAccessPendingLabel = computed(() => modelAccessUnlocked.value
  ? `Returning to ${recommendedModel.value?.label || "the recommended model"}…`
  : "Unlocking paid models…"
);
const selectedModel = computed(() => modelRows.value.find((model) => (
  model.id === modelId.value
)) || null);
const compatibleAgents = computed(() => (
  (currentModelEngine.value?.agents || []).filter((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
    (!agent.modelId || agent.modelId === modelId.value)
  ))
));
const selectedAgent = computed(() => compatibleAgents.value.find((agent) => (
  agent.id === agentId.value
)) || null);
const variantRows = computed(() => [
  { id: "", label: "Automatic" },
  ...(selectedModel.value?.variants || [])
]);
const selectedVariant = computed(() => variantRows.value.find((variant) => (
  variant.id === variantId.value
)) || null);
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
const canSave = computed(() => Boolean(
  !props.changesDisabled &&
  selectionChanged.value &&
  selectedProvider.value &&
  selectedModel.value &&
  selectedAgent.value &&
  selectionRevision.value &&
  !catalogLoading.value &&
  !catalogError.value &&
  !modelAccessUpdating.value
));
const selectionSummary = computed(() => {
  const engineLabel = selectedOverviewEngine.value?.label || engineId.value;
  const choices = [
    ...(providerRows.value.length > 1
      ? [selectedProvider.value?.label || assistantSelection.value?.modelProviderId]
      : []),
    selectedModel.value?.label || assistantSelection.value?.modelId,
    selectedVariant.value?.label
  ].filter(Boolean).join(" / ");
  return [engineLabel, choices].filter(Boolean).join(" · ") || "Choose an available AI";
});
const buttonTitle = computed(() => (
  `Choose AI${selectionSummary.value ? `: ${selectionSummary.value}` : ""}${
    !props.accessLoading && accessLabel.value ? ` · ${accessLabel.value}` : ""
  }${props.changesDisabled ? " · Changes available after the current turn" : ""}`
));
const updateCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_model, { context }) => ({
    method: "PATCH",
    path: String(context?.path || "")
  }),
  buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({
    assistantSelection: context?.assistantSelection || {}
  }),
  fallbackRunError: "AI session choices could not be updated.",
  messages: {
    error: "AI session choices could not be updated.",
    success: "AI session choices updated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.sessions.assistant-selection.update",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PATCH"
});
const modelAccessCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  buildCommandOptions: (_model, { context }) => ({
    method: "PATCH",
    path: String(context?.path || "")
  }),
  buildRawPayload: (_model, { context }) => ({
    engineId: String(context?.engineId || ""),
    modelProviderId: String(context?.modelProviderId || ""),
    unlocked: context?.unlocked === true
  }),
  fallbackRunError: "Provider model access could not be changed.",
  messages: {
    error: "Provider model access could not be changed.",
    success: "Provider model access updated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.assistants.model-access.update",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PATCH"
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
  await Promise.all([connections.reload(), catalog.reload()]);
}

function selectConnection(value) {
  if (props.changesDisabled) return;
  const connection = connectionRows.value.find((row) => row.id === value);
  if (!connection) return;
  engineId.value = connection.engineId;
  selectProvider(connection.modelProviderId);
}

function selectProvider(value = "") {
  if (props.changesDisabled) return;
  modelProviderId.value = String(value || "");
  modelId.value = "";
  agentId.value = "";
  variantId.value = "";
}

function selectModel(value = "") {
  if (props.changesDisabled) return;
  const id = String(value || "");
  if (!modelRows.value.some((model) => model.id === id && model.status === "available")) return;
  modelId.value = id;
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
  const agents = (currentModelEngine.value?.agents || []).filter((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
    (!agent.modelId || agent.modelId === model.id)
  ));
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

function openConnectionSettings() {
  if (props.changesDisabled) return;
  menuOpen.value = false;
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

async function applySelection(selection, { closeMenu = true } = {}) {
  const sessionId = String(props.session?.sessionId || "").trim();
  const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
  if (props.changesDisabled || !selection || !sessionId || !sessionsPath || saving.value) {
    return null;
  }
  saving.value = true;
  try {
    const response = await updateCommand.run({
      assistantSelection: selection,
      path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
    });
    if (response?.ok !== false) {
      modelId.value = selection.modelId;
      agentId.value = selection.agentId;
      variantId.value = selection.variantId;
      if (closeMenu) menuOpen.value = false;
    }
    return response;
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (!canSave.value) return;
  await applySelection(draftSelection.value);
}

async function restoreRecommendedModel({ closeMenu = true } = {}) {
  const selection = selectionForModel(recommendedModel.value);
  return applySelection(selection, { closeMenu });
}

function requestModelAccessChange(unlocked) {
  if (props.changesDisabled || !props.canConfigure || modelAccessUpdating.value || saving.value) return;
  if (unlocked === true) {
    unlockConfirmOpen.value = true;
    return;
  }
  void updateModelAccess(false);
}

async function confirmUnlockModelAccess() {
  unlockConfirmOpen.value = false;
  await updateModelAccess(true);
}

async function updateModelAccess(unlocked) {
  const providerId = String(modelProviderId.value || "").trim();
  const path = vibe64AssistantModelAccessPath(catalog.apiPath.value);
  if (
    !props.canConfigure ||
    props.changesDisabled ||
    !providerId ||
    !path ||
    !modelAccess.value.configurable ||
    modelAccessUpdating.value
  ) {
    return null;
  }
  modelAccessUpdating.value = true;
  try {
    const current = assistantSelection.value || {};
    if (
      unlocked !== true &&
      current.modelProviderId === providerId &&
      recommendedModel.value &&
      current.modelId !== recommendedModel.value.id
    ) {
      const recovery = await restoreRecommendedModel({ closeMenu: false });
      if (recovery?.ok === false || !recovery) return recovery;
      await nextTick();
    }
    const response = await modelAccessCommand.run({
      engineId: engineId.value,
      modelProviderId: providerId,
      path,
      unlocked: unlocked === true
    });
    if (response?.ok !== false) {
      await catalog.reload();
    }
    return response;
  } finally {
    modelAccessUpdating.value = false;
  }
}

watch(assistantSelection, hydrateSelection, { immediate: true });

watch(menuOpen, (open) => {
  if (open) {
    hydrateSelection();
    void reloadCatalog().catch(() => null);
  } else {
    void nextTick(() => props.target?.focus());
  }
});

watch([menuOpen, connectionRows, connections.overview.isInitialLoading], ([open, rows, loading]) => {
  if (!open || loading || rows.some((row) => row.id === connectionId.value)) return;
  if (rows.length) selectConnection(rows[0].id);
});

watch([menuOpen, providerRows, overviewLoading, providerLoading], ([open, providers, loadingOverview, loadingProviders]) => {
  if (
    !open || loadingOverview || loadingProviders ||
    providers.some((provider) => provider.id === modelProviderId.value)
  ) return;
  const preferred = providers.find((provider) => provider.preferred === true);
  const defaultProvider = providers.find((provider) => (
    provider.id === selectedOverviewEngine.value?.defaults?.modelProviderId
  ));
  selectProvider(preferred?.id || defaultProvider?.id || providers[0]?.id || "");
}, { immediate: true });

watch([menuOpen, modelProvider, modelRows], ([open, provider, models]) => {
  if (!open || !provider) {
    return;
  }
  if (models.some((model) => model.id === modelId.value)) {
    return;
  }
  modelId.value = models.find((model) => (
    model.id === provider.defaultModelId
  ))?.id || models.find((model) => (
    model.id === selectedOverviewEngine.value?.defaults?.modelId
  ))?.id || models[0]?.id || "";
}, { immediate: true });

watch([compatibleAgents, modelId], ([agents]) => {
  if (!menuOpen.value) {
    return;
  }
  if (!agents.some((agent) => agent.id === agentId.value)) {
    agentId.value = agents.find((agent) => (
      agent.id === selectedOverviewEngine.value?.defaults?.agentId
    ))?.id || agents[0]?.id || "";
  }
}, { immediate: true });

watch([selectedModel, selectedAgent], ([model, agent]) => {
  if (!menuOpen.value || !model) {
    return;
  }
  const fixedVariant = String(agent?.variantId || "");
  if (fixedVariant) {
    variantId.value = fixedVariant;
  } else if (variantId.value && !model.variants.some((variant) => variant.id === variantId.value)) {
    variantId.value = "";
  }
}, { immediate: true });
</script>

<style scoped>
.vibe64-session-assistant-menu__footer {
  min-width: 0;
}

.vibe64-session-assistant-menu__section {
  display: grid;
  gap: 0.32rem;
}

.vibe64-session-assistant-menu__label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  padding-inline: 0.12rem;
  text-transform: uppercase;
}

.vibe64-session-assistant-menu__locked-note {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  padding: 0.35rem 0.12rem;
}

.vibe64-session-assistant-menu__locked-note {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  padding-block: 0.1rem;
}

.vibe64-session-assistant-menu__access {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.65rem;
  padding: 0.7rem;
}

.vibe64-session-assistant-menu__access--paid {
  background: rgba(var(--v-theme-warning), 0.1);
  border-color: rgba(var(--v-theme-warning), 0.2);
}

.vibe64-session-assistant-menu__access-summary {
  align-items: center;
  display: flex;
  gap: 0.65rem;
}

.vibe64-session-assistant-menu__access-summary > span:last-child {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.vibe64-session-assistant-menu__access-summary small {
  color: rgba(var(--v-theme-on-surface), 0.72);
  line-height: 1.35;
}

.vibe64-session-assistant-menu__confirm-header {
  padding: 1.25rem 1.25rem 0.5rem;
}

.vibe64-session-assistant-menu__confirm-actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem 1.25rem;
}

.vibe64-session-assistant-menu__confirm-subtitle {
  overflow: visible;
  text-overflow: initial;
  white-space: normal;
}

@media (max-width: 600px) {
  .vibe64-session-assistant-menu__confirm-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .vibe64-session-assistant-menu__confirm-actions .v-btn {
    width: 100%;
  }
}
</style>
