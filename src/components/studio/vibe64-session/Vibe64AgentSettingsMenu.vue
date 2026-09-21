<script setup>
import { computed, ref, watch } from "vue";
import { AssistantModelControl } from "@jskit-ai/assistant-core/client/conversation";
import {
  VIBE64_AGENT_PROVIDERS,
  displayVibe64AgentSetting,
  normalizeVibe64AgentSettings,
  vibe64AgentSettingParameters
} from "@local/vibe64-runtime/shared";

const props = defineProps({
  agentSettings: { type: Object, default: () => ({}) },
  disabled: Boolean,
  location: { type: String, default: "top start" }
});
const emit = defineEmits(["update-setting"]);
const menuOpen = ref(false);
const currentSettings = computed(() => normalizeVibe64AgentSettings(props.agentSettings));
const draft = ref(currentSettings.value);
watch([currentSettings, menuOpen], () => { draft.value = { ...currentSettings.value }; });
const provider = computed(() => VIBE64_AGENT_PROVIDERS.find(candidate => candidate.id === currentSettings.value.providerId));
const parameters = computed(() => vibe64AgentSettingParameters(draft.value));
const rows = (id) => (parameters.value.find(parameter => parameter.id === id)?.options || [])
  .map(option => ({ id: option.value, label: option.label }));
const summary = computed(() => vibe64AgentSettingParameters(currentSettings.value)
  .map(parameter => displayVibe64AgentSetting(currentSettings.value.providerId, parameter.id, currentSettings.value[parameter.id]))
  .filter(Boolean).join(" / ") || "Automatic");
const canSave = computed(() => !props.disabled && ["model", "thinking"].some(key => draft.value[key] !== currentSettings.value[key]));
function select(key, value) {
  if (!props.disabled) draft.value = normalizeVibe64AgentSettings({ ...draft.value, [key]: value });
}
function apply() {
  if (!canSave.value) return;
  const selected = { ...draft.value };
  for (const key of ["model", "thinking"]) {
    if (selected[key] !== currentSettings.value[key]) emit("update-setting", key, selected[key]);
  }
  menuOpen.value = false;
}
</script>
<template>
  <AssistantModelControl
    v-model="menuOpen"
    :location="location"
    :provider-rows="provider ? [{ id: provider.id, label: provider.label }] : []"
    :model-provider-id="currentSettings.providerId"
    :model-rows="rows('model')"
    :model-id="draft.model"
    :variant-rows="rows('thinking')"
    :variant-id="draft.thinking"
    :selection-summary="summary"
    :button-title="`AI controls: ${summary}`"
    :changes-disabled="disabled"
    :can-save="canSave"
    @select-model="select('model', $event)"
    @select-variant="select('thinking', $event)"
    @apply="apply"
  >
    <template #footer>
      <v-btn aria-label="Close AI controls" min-height="48" variant="text" @click="menuOpen = false">
        Close
      </v-btn>
    </template>
  </AssistantModelControl>
</template>
