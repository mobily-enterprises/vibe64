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
          <small class="text-body-small">Start in Plan. Choose Code or Auto from chat.</small>
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
        <Vibe64WorkflowSelector :active="modelValue" :disabled="submitting" @update:workflow="workflowEngineId = $event" @update:ready="workflowReady = $event" />
      </v-card-text>

      <v-card-actions class="vibe64-assistant-dialog__actions">
        <v-btn :disabled="submitting" variant="text" @click="close">Cancel</v-btn>
        <v-btn
          ref="submitButton"
          color="primary"
          :disabled="!workflowReady || submitting"
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
import { mdiClose } from "@mdi/js";
import Vibe64WorkflowSelector from "./Vibe64WorkflowSelector.vue";
const props = defineProps({ modelValue: Boolean, toolbar: { type: Object, default: () => ({}) } });
const emit = defineEmits(["created", "update:model-value"]);
const workflowEngineId = ref("");
const workflowReady = ref(false);
const submitButton = ref(null);
const submitting = computed(() => props.toolbar.createSessionRunning === true);
function close() {
  if (!submitting.value) emit("update:model-value", false);
}
async function submit() {
  if (!workflowReady.value || !workflowEngineId.value || submitting.value) return;
  let response;
  try { response = await props.toolbar.createSession?.({}, { workflowEngineId: workflowEngineId.value }); }
  catch { return; }
  if (response?.ok !== false && response?.sessionId) {
    emit("created", response);
    emit("update:model-value", false);
  }
}
watch(submitting, async (running, wasRunning) => {
  if (running || !wasRunning || !props.modelValue) return;
  await nextTick();
  const target = submitButton.value?.$el || submitButton.value;
  if (target?.isConnected === true && typeof target.focus === "function") target.focus({ preventScroll: true });
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

}
</style>
