<template>
  <v-dialog v-model="menuOpen" max-width="34rem" scrollable :persistent="saving" aria-label="Custom AI" @after-leave="target?.focus()">
    <v-card rounded="xl">
      <v-card-title class="pt-5 px-6">Custom AI</v-card-title>
      <v-card-text class="d-flex flex-column ga-4">
        <v-alert v-if="saveError" type="error" variant="tonal" density="compact">{{ saveError }}</v-alert>
        <p v-if="savedProviderUnavailable" class="text-body-small" role="status">
          This conversation's saved AI connection is unavailable. Choose an available model and Apply to reconnect.
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
            :model-value="selectedModel ? modelKey : null" :disabled="changesDisabled || saving" hide-details variant="outlined"
            no-data-text="No model is available yet" persistent-placeholder placeholder="None"
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
          <div class="vibe64-session-assistant-menu__label">{{ selectedProvider?.label || "Provider" }} access</div>
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
                    ? `Other ${selectedProvider?.label || "provider"} models can consume API credit.`
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
          {{ recommendedModel?.label || "The recommended model" }} stays available either way.
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
import { watch } from "vue";
import {
  mdiCreditCardOutline,
  mdiLockOutline,
  mdiShieldCheckOutline
} from "@mdi/js";

import { useVibe64SessionAssistantApply } from "@/composables/useVibe64SessionAssistantApply.js";
import { useVibe64SessionAssistantChoice } from "@/composables/useVibe64SessionAssistantChoice.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({
  selection: { type: Object, default: null },
  catalogPath: { type: String, default: "" },
  // The control that opened Custom AI takes the focus back when it closes.
  // readable-check: allow collaborator-prop - platform object: the opening control is a page element, absent until it mounts
  target: {
    default: null,
    type: /** @type {import("vue").PropType<HTMLElement | null>} */ (Object)
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
  // readable-check: allow collaborator-prop - optional operation: a session's main chat has no saver of its own and saves through the session
  saveSelection: {
    default: null,
    type: /** @type {import("vue").PropType<((selection: Record<string, any>) => unknown) | null>} */ (Function)
  },
  sessionsApiPath: {
    default: "",
    type: [Function, Object, String]
  }
});

const emit = defineEmits(["saved"]);
const menuOpen = defineModel({ type: Boolean, default: false });
const choice = useVibe64SessionAssistantChoice({ menuOpen, props });
const {
  agentId, assistantSelection, canRestoreRecommendedModel, catalogError, catalogLoading, compatibleAgents, connections,
  currentModelEngine, engineId, engineRows, hydrateSelection, modelAccess, modelAccessPendingLabel, modelAccessUnlocked,
  modelKey, modelRows, recommendedModel, reloadCatalog, savedProviderUnavailable, selectEngine, selectModel, selectVariant,
  selectedAgent, selectedModel, selectedOverviewEngine, selectedProvider, variantId, variantRows
} = choice;
const {
  canSave, confirmUnlockModelAccess, modelAccessUpdating, requestModelAccessChange, restoreRecommendedModel, save,
  saveError, saving, unlockConfirmOpen
} = useVibe64SessionAssistantApply({ choice, emit, menuOpen, props });

function openConnectionSettings() {
  if (props.changesDisabled) return;
  menuOpen.value = false;
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

watch(() => JSON.stringify(assistantSelection.value), hydrateSelection, { immediate: true });

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
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  font-size: 0.82rem;
  gap: 0.35rem;
  padding: 0.1rem 0.12rem;
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
