<template>
  <v-dialog
    :model-value="modelValue"
    max-width="38rem"
    @update:model-value="emit('update:model-value', $event)"
  >
    <v-card class="vibe64-assistant-dialog" rounded="xl">
      <v-card-title class="vibe64-assistant-dialog__title">
        <span class="vibe64-assistant-dialog__title-copy">
          <strong class="text-title-large">Start an AI session</strong>
          <small class="text-body-small">Your preferred AI is selected automatically.</small>
        </span>
        <v-btn
          aria-label="Close AI session dialog"
          :disabled="submitting"
          :icon="mdiClose"
          title="Close"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-text class="vibe64-assistant-dialog__body">
        <div
          v-if="loading"
          aria-label="Loading connected AI choices"
          class="vibe64-assistant-dialog__choices"
        >
          <div
            v-for="index in 3"
            :key="index"
            class="vibe64-assistant-dialog__choice-skeleton"
          >
            <v-skeleton-loader type="avatar" />
            <v-skeleton-loader type="list-item-two-line" />
          </div>
        </div>

        <v-alert
          v-else-if="loadError && choices.length === 0"
          color="error"
          role="alert"
          variant="tonal"
        >
          <div class="vibe64-assistant-dialog__error">
            <span>{{ loadError }}</span>
            <v-btn size="small" variant="tonal" @click="catalog.overview.reload()">
              Try again
            </v-btn>
          </div>
        </v-alert>

        <div v-else-if="choices.length === 0" class="vibe64-assistant-dialog__empty">
          <v-icon :icon="mdiKeyOutline" color="primary" size="32" />
          <strong>No AI is connected</strong>
          <span>Connect an AI account, then come back to start a session.</span>
          <v-btn color="primary" variant="tonal" @click="openConnectionSettings">
            Manage AI accounts
          </v-btn>
        </div>

        <v-radio-group
          v-else
          v-model="selectedChoiceId"
          aria-label="Connected AI"
          class="vibe64-assistant-dialog__choices"
          hide-details
        >
          <label
            v-for="choice in choices"
            :key="choice.id"
            class="vibe64-assistant-dialog__choice"
            :class="{ 'vibe64-assistant-dialog__choice--selected': selectedChoiceId === choice.id }"
            :for="`vibe64-assistant-${choice.domId}`"
          >
            <span class="vibe64-assistant-dialog__choice-icon">
              <v-icon
                :icon="['codex', 'claude'].includes(choice.engineId) ? mdiCreationOutline : mdiCodeBraces"
                size="22"
              />
            </span>
            <span class="vibe64-assistant-dialog__choice-copy">
              <span class="vibe64-assistant-dialog__choice-heading">
                <strong>{{ choice.label }}</strong>
              </span>
              <small>{{ choice.description }}</small>
            </span>
            <v-radio
              :id="`vibe64-assistant-${choice.domId}`"
              :aria-label="choice.label"
              color="primary"
              :value="choice.id"
            />
          </label>
        </v-radio-group>
      </v-card-text>

      <v-card-actions class="vibe64-assistant-dialog__actions">
        <v-btn :disabled="submitting" variant="text" @click="close">Cancel</v-btn>
        <v-btn
          ref="submitButton"
          color="primary"
          :disabled="!selectedChoice || submitting"
          variant="flat"
          @click="submit"
        >
          {{ submitting ? "Creating session…" : "Create session" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  mdiClose,
  mdiCodeBraces,
  mdiCreationOutline,
  mdiKeyOutline
} from "@mdi/js";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({
  modelValue: {
    default: false,
    type: Boolean
  },
  toolbar: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["created", "update:model-value"]);
const selectedChoiceId = ref("");
const submitButton = ref(null);
let catalogReloadId = 0;

const catalog = useVibe64AssistantCatalog({
  active: true,
  configuredOnly: true
});
const loading = computed(() => Boolean(
  catalog.overview.isInitialLoading.value || catalog.overview.isLoading.value
));
const loadError = computed(() => String(catalog.overview.loadError.value || ""));
const submitting = computed(() => props.toolbar.createSessionRunning === true);

function availableModel(provider = {}) {
  const models = Array.isArray(provider.models) ? provider.models : [];
  return models.find((model) => (
    model.id === provider.defaultModelId && model.status === "available"
  )) || models.find((model) => model.status === "available") || null;
}

function compatibleAgent(engine = {}, provider = {}, model = {}) {
  const agents = Array.isArray(engine.agents) ? engine.agents : [];
  return agents.find((agent) => (
    agent.id === engine.defaults?.agentId &&
    (!agent.modelProviderId || agent.modelProviderId === provider.id) &&
    (!agent.modelId || agent.modelId === model.id)
  )) || agents.find((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === provider.id) &&
    (!agent.modelId || agent.modelId === model.id)
  )) || null;
}

function configuredChoice(engine = {}, provider = {}) {
  if (provider.connected !== true) {
    return null;
  }
  const model = availableModel(provider);
  const agent = model ? compatibleAgent(engine, provider, model) : null;
  if (!model || !agent || !engine.revision) {
    return null;
  }
  const requestedVariantId = String(agent.variantId || engine.defaults?.variantId || "");
  const variants = Array.isArray(model.variants) ? model.variants : [];
  const variantId = variants.some((variant) => variant.id === requestedVariantId)
    ? requestedVariantId
    : "";
  const id = `${engine.engineId}:${provider.id}`;
  return {
    description: engine.engineId === "codex"
      ? `OpenAI account · ${model.label}`
      : engine.engineId === "claude"
        ? `Claude account · ${model.label}`
        : [provider.label, provider.description].filter(Boolean).join(" · "),
    domId: id.replace(/[^a-z0-9_-]+/giu, "-"),
    engineId: engine.engineId,
    id,
    label: engine.engineId === "codex" ? "Codex" : engine.engineId === "claude" ? "Claude" : model.label,
    preferred: provider.preferred === true,
    selection: {
      agentId: agent.id,
      catalogRevision: engine.revision,
      engineId: engine.engineId,
      modelId: model.id,
      modelProviderId: provider.id,
      variantId
    }
  };
}

const choices = computed(() => catalog.engines.value.flatMap((engine) => (
  (Array.isArray(engine.modelProviders) ? engine.modelProviders : [])
    .map((provider) => configuredChoice(engine, provider))
    .filter(Boolean)
)).sort((left, right) => Number(right.preferred) - Number(left.preferred)));
const selectedChoice = computed(() => choices.value.find((choice) => (
  choice.id === selectedChoiceId.value
)) || null);

function defaultChoiceId(available = choices.value) {
  return available.find((choice) => choice.preferred)?.id || available[0]?.id || "";
}

function openConnectionSettings() {
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

function close() {
  if (!submitting.value) {
    emit("update:model-value", false);
  }
}

async function submit() {
  if (!selectedChoice.value || submitting.value) {
    return;
  }
  let response;
  try {
    response = await props.toolbar.createSession?.(selectedChoice.value.selection);
  } catch {
    return;
  }
  if (response?.ok !== false && response?.sessionId) {
    emit("created", response);
    emit("update:model-value", false);
  }
}

watch(choices, (available) => {
  if (
    !available.some((choice) => choice.id === selectedChoiceId.value) ||
    !props.modelValue
  ) {
    selectedChoiceId.value = defaultChoiceId(available);
  }
}, { immediate: true });

watch(() => props.modelValue, async (open) => {
  const reloadId = ++catalogReloadId;
  if (!open) return;
  selectedChoiceId.value = defaultChoiceId();
  try {
    await catalog.overview.reload();
  } catch {
    // The catalogue resource owns its visible retry state.
  }
  if (reloadId === catalogReloadId && props.modelValue) {
    selectedChoiceId.value = defaultChoiceId();
  }
}, { immediate: true });

watch(submitting, async (running, wasRunning) => {
  if (running || !wasRunning || !props.modelValue) {
    return;
  }
  await nextTick();
  const target = submitButton.value?.$el || submitButton.value;
  if (target?.isConnected === true && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
});
</script>

<style scoped>
.vibe64-assistant-dialog {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
}

.vibe64-assistant-dialog__title {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
}

.vibe64-assistant-dialog__title-copy {
  display: grid;
  gap: 0.15rem;
}

.vibe64-assistant-dialog__title-copy small {
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.vibe64-assistant-dialog__body {
  padding: 0.25rem 1.25rem 1rem !important;
}

.vibe64-assistant-dialog__choices {
  display: grid;
  gap: 0.65rem;
}

.vibe64-assistant-dialog__choice,
.vibe64-assistant-dialog__choice-skeleton {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-outline), 0.22);
  border-radius: 0.9rem;
  display: grid;
  gap: 0.8rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-height: 4.5rem;
  padding: 0.65rem 0.8rem;
}

.vibe64-assistant-dialog__choice {
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
}

.vibe64-assistant-dialog__choice:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}

.vibe64-assistant-dialog__choice--selected {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.6);
}

.vibe64-assistant-dialog__choice-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  height: 2.75rem;
  justify-content: center;
  width: 2.75rem;
}

.vibe64-assistant-dialog__choice-copy {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.vibe64-assistant-dialog__choice-heading {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.vibe64-assistant-dialog__choice-copy small,
.vibe64-assistant-dialog__empty span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  line-height: 1.35;
}

.vibe64-assistant-dialog__choice-skeleton {
  grid-template-columns: 3rem minmax(0, 1fr);
}

.vibe64-assistant-dialog__choice-skeleton :deep(.v-skeleton-loader) {
  background: transparent;
}

.vibe64-assistant-dialog__empty {
  align-items: center;
  display: grid;
  gap: 0.6rem;
  justify-items: center;
  padding: 1.5rem 1rem;
  text-align: center;
}

.vibe64-assistant-dialog__error {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.vibe64-assistant-dialog__actions {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.14);
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem;
}

@media (max-width: 600px) {
  .vibe64-assistant-dialog__body,
  .vibe64-assistant-dialog__actions,
  .vibe64-assistant-dialog__title {
    padding-inline: 1rem !important;
  }

  .vibe64-assistant-dialog__choice {
    gap: 0.65rem;
    padding-inline: 0.65rem;
  }
}
</style>
