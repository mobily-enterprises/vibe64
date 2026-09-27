<template>
  <v-dialog v-model="menuOpen" max-width="34rem" scrollable :persistent="saving" aria-label="Custom AI" @after-leave="target?.focus()">
    <v-card rounded="xl">
      <v-card-title class="pt-5 px-6">Custom AI</v-card-title>
      <v-card-text class="d-flex flex-column ga-4">
        <v-alert v-if="saveError" type="error" variant="tonal" density="compact">{{ saveError }}</v-alert>
        <p v-if="savedProviderUnavailable" class="text-body-small" role="status">
          This session's saved AI connection is unavailable. Choose an available model and Apply to reconnect.
        </p>
        <v-alert v-if="catalogError" type="error" variant="tonal" density="compact">
          {{ catalogError }} <v-btn variant="text" @click="reloadCatalog">Retry</v-btn>
        </v-alert>
        <v-select
          label="Orchestrator" :items="engineRows" item-title="label" item-value="engineId"
          :model-value="engineId" :disabled="changesDisabled || saving || connections.overview.isInitialLoading.value"
          hide-details variant="outlined" @update:model-value="selectEngine"
        />
        <v-skeleton-loader v-if="catalogLoading" type="list-item-two-line@2" />
        <template v-else>
          <v-autocomplete
            label="Model" :items="modelRows" item-title="label" item-value="key"
            :model-value="modelKey" :disabled="changesDisabled || saving" hide-details variant="outlined"
            @update:model-value="selectModel"
          />
          <v-select
            label="Thinking" :items="variantRows" item-title="label" item-value="id"
            :model-value="variantId" :disabled="changesDisabled || saving || Boolean(selectedAgent?.variantId)"
            hide-details variant="outlined" @update:model-value="selectVariant"
          />
        </template>
        <small
          v-if="modelAccess.configurable && !modelAccess.managementOnly && !modelAccessUnlocked"
          class="vibe64-session-assistant-menu__locked-note"
        >
          <v-icon :icon="mdiLockOutline" size="14" />
          Additional paid models are hidden until they are enabled.
        </small>

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
      </v-card-text>
      <v-card-actions class="px-6 pb-5 flex-wrap">
        <v-btn v-if="canConfigure" :disabled="changesDisabled || saving" variant="text" @click="openConnectionSettings">Configure more AIs</v-btn>
        <v-spacer />
        <v-btn :disabled="saving" variant="text" @click="menuOpen = false">Cancel</v-btn>
        <v-btn :disabled="!canSave || saving" :aria-busy="saving ? 'true' : undefined" color="primary" variant="flat" @click="save">{{ saving ? 'Applying…' : 'Apply' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
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
  saveSelection: { type: Function, default: null },
  sessionsApiPath: {
    default: "",
    type: [Function, Object, String]
  }
});

const emit = defineEmits(["saved"]);
const saveError = ref("");
const routingMode = computed(() => assistantRoutingFromMetadata(props.session?.metadata)?.mode || "");
const menuOpen = defineModel({ type: Boolean, default: false });
const saving = ref(false);
const modelAccessUpdating = ref(false);
const unlockConfirmOpen = ref(false);
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const assistantSelection = computed(() => assistantRoutingFromMetadata(props.session?.metadata)?.override || props.session?.assistantSelection || null);
const engineId = ref("");
const catalogActive = computed(() => Boolean(menuOpen.value && props.session?.sessionId));
const connections = useVibe64AssistantCatalog({ active: catalogActive, configuredOnly: true });
const engineRows = computed(() => connections.engines.value.filter((engine) => engine.health?.status === "ready" &&
  engine.modelProviders?.some((provider) => provider.connected)));
// Warm only connected engines while this dialog is open. Switching orchestrators
// then reuses the same query; it does not start discovery after the click.
const catalogs = Object.fromEntries(VIBE64_AGENT_PROVIDERS.map(({ id }) => [id, useVibe64AssistantCatalog({
  active: computed(() => catalogActive.value && engineRows.value.some((engine) => engine.engineId === id)),
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
  { id: "", label: "Default" },
  ...(selectedModel.value?.variants || [])
]);
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
  (selectionChanged.value || routingMode.value !== "custom") &&
  selectedProvider.value &&
  selectedModel.value &&
  selectedAgent.value &&
  selectionRevision.value &&
  !catalogLoading.value &&
  !catalogError.value &&
  !modelAccessUpdating.value
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
  suppressSuccessMessage: true,
  onRunSuccess(response) {
    if (response?.ok === false) throw new Error(response.error || "The custom model could not be saved.");
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
  if (props.changesDisabled || !selection || !sessionId || !props.saveSelection && !sessionsPath || saving.value) {
    return null;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const response = props.saveSelection ? await props.saveSelection(selection) : await updateCommand.run({
      assistantSelection: selection,
      path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
    });
    if (response?.ok === false) throw new Error(response.error || "The custom model could not be saved.");
    if (response?.ok !== false) {
      emit("saved");
      modelId.value = selection.modelId;
      agentId.value = selection.agentId;
      variantId.value = selection.variantId;
      if (closeMenu) menuOpen.value = false;
    }
    return response;
  } catch (error) {
    saveError.value = error.message || "The custom model could not be saved.";
    return { ok: false, error: saveError.value };
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
  const path = vibe64AssistantModelAccessPath(connections.apiPath.value);
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
      await catalog.value?.reload();
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
    saveError.value = "";
  }
});

watch([menuOpen, engineRows, connections.overview.isInitialLoading], ([open, rows, loading]) => {
  if (!open || loading || rows.some((row) => row.engineId === engineId.value)) return;
  if (rows.length) selectEngine(rows[0].engineId);
});

watch([menuOpen, modelRows, catalogLoading], ([open, models, loading]) => {
  if (!open || loading || models.some((model) => model.key === modelKey.value)) return;
  const defaults = currentModelEngine.value?.defaults;
  const preferred = models.find((model) => model.modelProviderId === defaults?.modelProviderId && model.id === defaults?.modelId);
  if (preferred || models[0]) selectModel((preferred || models[0]).key);
});

watch([compatibleAgents, modelKey], ([agents]) => {
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
