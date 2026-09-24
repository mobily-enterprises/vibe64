<template>
  <section aria-label="Choose an AI workflow">
    <div
      v-if="loading"
      aria-label="Loading AI workflows"
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
        <v-btn size="small" variant="tonal" @click="resource.reload()">
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
      aria-label="AI workflow"
      class="vibe64-assistant-dialog__choices"
      hide-details
    >
      <label
        v-for="choice in choices"
        :key="choice.engineId"
        class="vibe64-assistant-dialog__choice"
        :class="{ 'vibe64-assistant-dialog__choice--selected': selectedChoiceId === choice.engineId }"
        :for="`vibe64-assistant-${choice.engineId}`"
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
          <small>Plan · {{ choice.planLabel }}</small>
          <small>Code · {{ choice.codeLabel }}</small>
          <small v-if="choice.backupUsed">Shared backup for your access</small>
          <small v-if="choice.error" class="text-error">{{ choice.error }}</small>
        </span>
        <v-radio
          :id="`vibe64-assistant-${choice.engineId}`"
          :aria-label="choice.label"
          :disabled="!choice.available || disabled"
          color="primary"
          :value="choice.engineId"
        />
      </label>
    </v-radio-group>
    <p v-if="choices.length" class="text-body-small mt-3 mb-0">Review after coding starts off. You can enable it from chat.</p>
    <v-btn v-if="canConfigure && choices.length" class="mt-2" variant="text" @click="routingOpen = true">
      Configure model routing
    </v-btn>
    <p v-else-if="choices.length && !selectedChoice?.available" class="text-body-small mt-3 mb-0">
      Ask the workspace owner to configure an available workflow.
    </p>
  </section>
  <v-dialog v-if="canConfigure" v-model="routingOpen" max-width="760" :persistent="routingSaving">
    <v-card rounded="lg">
      <ModelRoutingForm v-if="routingOpen" :engine-id="selectedChoiceId" @busy="routingSaving = $event" @close="routingOpen = false" @saved="routingSaving = false; routingOpen = false" />
    </v-card>
  </v-dialog>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import { mdiCodeBraces, mdiCreationOutline, mdiKeyOutline } from "@mdi/js";
import { ModelRoutingForm, useModelRouting } from "@local/vibe64-accounts/client";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
const props = defineProps({ active: Boolean, disabled: Boolean, initialEngineId: { type: String, default: "" } });
const emit = defineEmits(["update:workflow", "update:ready"]);
const selectedChoiceId = ref("");
const routingOpen = ref(false);
const routingSaving = ref(false);
const { resource, engines, loadError, scopeKey } = useModelRouting({ enabled: computed(() => props.active) });
const loading = computed(() => Boolean(resource.isInitialLoading.value));
const canConfigure = computed(() => resource.data.value?.canConfigure === true);

function modelLabel(decision) {
  const selection = decision?.effectiveSelection || decision?.configuredSelection;
  if (!selection) return "Unavailable";
  const engine = engines.value.find(({ engineId }) => engineId === selection.engineId);
  const choice = engine?.choices.find((row) => row.modelProviderId === selection.modelProviderId && row.modelId === selection.modelId);
  return `${engine?.label || selection.engineId} · ${choice?.label || selection.modelId}`;
}

const choices = computed(() => engines.value.filter((engine) =>
  engine.roles.plan.assignment || engine.roles.code.assignment || engine.roles.plan.recommendation || engine.roles.code.recommendation
).map((engine) => {
  const preview = engine.setupPreview;
  return { engineId: engine.engineId, label: engine.label,
    planLabel: modelLabel(preview?.plan), codeLabel: modelLabel(preview?.code),
    backupUsed: preview?.plan.backupUsed || preview?.code.backupUsed,
    available: preview?.plan.available === true && preview?.code.available === true,
    error: engine.error || (!preview?.plan.available ? preview?.plan.message : !preview?.code.available ? preview?.code.message : "") };
}));
const selectedChoice = computed(() => choices.value.find((choice) => choice.engineId === selectedChoiceId.value) || null);

function defaultChoiceId(available = choices.value) {
  return available.find((choice) => choice.engineId === props.initialEngineId && choice.available)?.engineId || available.find((choice) => choice.available)?.engineId || "";
}

function openConnectionSettings() {
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

watch(choices, (available) => {
  if (
    !available.some((choice) => choice.engineId === selectedChoiceId.value && choice.available) ||
    !props.active
  ) {
    selectedChoiceId.value = defaultChoiceId(available);
  }
}, { immediate: true });

watch(scopeKey, () => {
  selectedChoiceId.value = "";
  routingOpen.value = false;
}, { flush: "sync" });

watch(() => props.active, (open) => {
  if (!open) routingOpen.value = false;
});

watch([selectedChoice, () => props.active, () => props.disabled], ([choice, active, busy]) => {
  emit("update:workflow", active && choice?.available ? choice.engineId : "");
  emit("update:ready", Boolean(active && choice?.available && !busy));
}, { immediate: true });
</script>
<style scoped>
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
  grid-template-areas: "icon copy control";
}

.vibe64-assistant-dialog__choice:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}

.vibe64-assistant-dialog__choice--selected {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.6);
}

.vibe64-assistant-dialog__choice-icon {
  grid-area: icon;
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
  grid-area: copy;
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

@media (max-width: 600px) {
  .vibe64-assistant-dialog__choice {
    gap: 0.65rem;
    padding-inline: 0.65rem;
  }
}
</style>
