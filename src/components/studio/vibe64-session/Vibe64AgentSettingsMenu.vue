<script setup>
import { computed, ref, watch } from "vue";
import { AssistantModelControl } from "@jskit-ai/assistant-core/client/conversation";
import { normalizeVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";

const props = defineProps({
  agentSettings: { type: Object, default: () => ({}) },
  assistantSelection: { type: Object, default: () => ({}) },
  disabled: Boolean,
  location: { type: String, default: "top start" }
});
const emit = defineEmits(["update-setting"]);
const menuOpen = ref(false);
const currentSettings = computed(() => normalizeVibe64AgentSettings({
  ...props.agentSettings,
  providerId: props.assistantSelection.engineId
}));
const draft = ref(currentSettings.value);
watch([currentSettings, menuOpen], () => { draft.value = { ...currentSettings.value }; });
const engineId = computed(() => props.assistantSelection.engineId);
const modelProviderId = computed(() => props.assistantSelection.modelProviderId);
const catalog = useVibe64AssistantCatalog({
  active: computed(() => menuOpen.value && Boolean(engineId.value && modelProviderId.value)),
  engineId,
  modelProviderId,
  providerConnectedOnly: true
});
const provider = computed(() => engineId.value && catalog.modelEngine.value?.engineId === engineId.value
  ? catalog.modelEngine.value.modelProviders.find(row => row.id === modelProviderId.value && row.connected)
  : null);
const models = computed(() => (provider.value?.models || []).filter(model => model.status === "available"));
const modelRows = computed(() => [
  { id: "", label: "Use main chat model" },
  ...models.value
]);
const selectedModel = computed(() => models.value.find(model => (
  model.id === (draft.value.model || props.assistantSelection.modelId)
)));
const variantRows = computed(() => [
  { id: "", label: "Automatic" },
  ...(selectedModel.value?.variants || [])
]);
const catalogLoading = computed(() => catalog.modelPage.isInitialLoading.value);
const catalogError = computed(() => catalog.modelPage.loadError.value || "");
const summary = computed(() => {
  const modelId = currentSettings.value.model || props.assistantSelection.modelId;
  const model = models.value.find(row => row.id === modelId);
  const variant = model?.variants.find(row => row.id === currentSettings.value.thinking);
  return [
    model?.label || modelId || "Use main chat model",
    variant?.label || currentSettings.value.thinking || "Automatic"
  ].join(" / ");
});
const canSave = computed(() => !props.disabled && !catalogLoading.value && !catalogError.value &&
  Boolean(selectedModel.value) && variantRows.value.some(row => row.id === draft.value.thinking) &&
  ["model", "thinking"].some(key => draft.value[key] !== currentSettings.value[key]));
function select(key, value) {
  if (props.disabled) return;
  if (key === "model" && modelRows.value.some(row => row.id === value)) {
    draft.value = { ...draft.value, model: value };
    if (!variantRows.value.some(row => row.id === draft.value.thinking)) draft.value.thinking = "";
  } else if (key === "thinking" && variantRows.value.some(row => row.id === value)) {
    draft.value = { ...draft.value, thinking: value };
  }
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
    :model-provider-id="modelProviderId"
    :model-rows="modelRows"
    :model-id="draft.model"
    :variant-rows="variantRows"
    :variant-id="draft.thinking"
    :selection-summary="summary"
    :button-title="`AI controls: ${summary}`"
    :changes-disabled="disabled"
    :can-save="canSave"
    :catalog-loading="catalogLoading"
    :catalog-error="catalogError"
    @select-model="select('model', $event)"
    @select-variant="select('thinking', $event)"
    @apply="apply"
    @reload="catalog.reload"
  >
    <template #footer>
      <v-btn aria-label="Close AI controls" min-height="48" variant="text" @click="menuOpen = false">
        Close
      </v-btn>
    </template>
  </AssistantModelControl>
</template>
