<script setup>
import { computed, onMounted, ref } from "vue";
import { useAiConnections } from "../composables/useAiConnections.js";
import AiWaitStatus from "../studio/AiWaitStatus.vue";

// Connects one OpenCode provider key in onboarding through the AI Accounts
// connection route: the live catalogue supplies the provider revision and the
// server verifies the key before saving it.
const props = defineProps({
  modelProviderId: { type: String, required: true },
  label: { type: String, default: "" }
});
const emit = defineEmits(["busy", "connected"]);
const connections = useAiConnections({ catalogProviderId: computed(() => props.modelProviderId) });
const apiKey = ref("");
const error = ref("");
const saving = ref(false);
const revision = computed(() => connections.catalogProvider.value?.id === props.modelProviderId
  ? String(connections.catalogProvider.value.definitionRevision || "") : "");

onMounted(() => connections.reloadCatalog().catch(() => null));

async function save() {
  error.value = "";
  if (!apiKey.value.trim()) {
    error.value = "Paste your API key.";
    return;
  }
  if (!revision.value) {
    await connections.reloadCatalog().catch(() => null);
    if (!revision.value) {
      error.value = connections.catalogLoadError.value || "The provider details could not be loaded. Try again.";
      return;
    }
  }
  saving.value = true;
  emit("busy", true);
  try {
    const response = await connections.saveConnection({ apiKey: apiKey.value, label: props.label,
      providerId: props.modelProviderId, providerRevision: revision.value });
    if (response?.ok === false) {
      error.value = response.fieldErrors?.apiKey || response.error || "The key could not be saved.";
      return;
    }
    apiKey.value = "";
    emit("connected");
  } catch (cause) {
    error.value = cause?.fieldErrors?.apiKey || cause?.message || "The key could not be saved.";
  } finally {
    saving.value = false;
    emit("busy", false);
  }
}
</script>

<template>
  <form class="aio-key" @submit.prevent="save">
    <v-text-field
      v-model="apiKey" label="API key" type="password" autocomplete="off" variant="outlined"
      :error-messages="error ? [error] : []" :disabled="saving"
    />
    <v-btn type="submit" color="primary" variant="flat" size="large" :loading="saving">Connect</v-btn>
    <AiWaitStatus :active="saving" :label="`Checking the key with ${label || 'the provider'}. This can take up to a minute.`" />
  </form>
</template>

<style scoped>
.aio-key { display: grid; gap: var(--v64-space-2); max-width: 32rem; }
.aio-key .v-btn { justify-self: start; }
</style>
