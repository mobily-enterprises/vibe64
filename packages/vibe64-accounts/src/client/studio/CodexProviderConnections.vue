<script setup>
import { computed, ref, watch } from "vue";
import { mdiCheckCircleOutline, mdiClose, mdiEyeOutline, mdiEyeOffOutline, mdiOpenInNew } from "@mdi/js";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";

const props = defineProps({
  actionsEnabled: { type: Boolean, default: true },
  showClose: Boolean
});
const providerId = defineModel({ type: String, default: "openai" });
const emit = defineEmits(["changed", "close", "busy"]);
const { connections, resource, busy, change, loadError } = useCodexProviderConnections({
  enabled: computed(() => props.actionsEnabled)
});
watch(busy, (value) => emit("busy", value), { immediate: true });
const provider = computed(() => curatedCodexProvider(providerId.value));
const connection = computed(() => connections.value.find(({ id }) => id === providerId.value));
const choices = computed(() => [
  { id: "openai", label: "Codex - GPT · ChatGPT or OpenAI API key" },
  ...CURATED_CODEX_PROVIDERS.map(({ id, label }) => {
    const connected = connections.value.find((row) => row.id === id)?.connected;
    return { id, label: `Codex - ${label}${connected ? " · Connected" : ""}` };
  })
]);
const apiKey = ref("");
const visible = ref(false);
const confirmRemove = ref(false);
watch(providerId, () => {
  apiKey.value = "";
  visible.value = false;
  confirmRemove.value = false;
}, { immediate: true });
async function save(remove = false) {
  try {
    const result = await change({ modelProviderId: providerId.value, apiKey: apiKey.value, remove });
    if (result?.ok !== true) return;
    apiKey.value = "";
    visible.value = false;
    confirmRemove.value = false;
    emit("changed");
  } catch {
    // The shared command feedback owns errors; retain the form for retry.
  }
}
</script>

<template>
  <section aria-label="Codex providers" class="codex-providers">
    <div class="d-flex align-center ga-2 mb-3">
      <v-select
        v-model="providerId" :items="choices" item-title="label" item-value="id"
        label="Use Codex with" variant="outlined" hide-details :disabled="busy"
      />
      <v-btn
        v-if="showClose && provider" :icon="mdiClose" aria-label="Close Codex setup" variant="text"
        :disabled="busy" @click="emit('close')"
      />
    </div>
    <template v-if="provider">
      <div class="d-flex align-center flex-wrap ga-2 mb-2">
        <h2 class="text-title-large">Codex - {{ provider.label }}</h2>
        <v-chip v-if="connection?.connected" color="success" size="small" :prepend-icon="mdiCheckCircleOutline">Connected</v-chip>
      </div>
      <p class="text-body-medium mb-3">{{ provider.description }}.</p>
      <p v-if="provider.id === 'zai-coding-plan'" class="text-body-small mb-3">
        For a regular Z.AI API account, choose GLM through OpenCode in Add AI.
        Codex support is verified for the Coding Plan.
      </p>
      <div class="d-flex flex-wrap ga-1 mb-4" aria-label="Available models">
        <v-chip v-for="model in provider.models" :key="model.id" size="small" variant="tonal">{{ model.label }}</v-chip>
      </div>
      <v-alert v-if="loadError" type="error" variant="tonal" class="mb-3">
        {{ loadError }} <v-btn variant="text" @click="resource.reload()">Retry</v-btn>
      </v-alert>
      <v-skeleton-loader v-if="resource.isInitialLoading.value" type="article, actions" />
      <v-form v-else :disabled="!actionsEnabled || busy" @submit.prevent="save()">
        <v-text-field
          v-model="apiKey" :label="connection?.connected ? 'Replace API key' : 'API key'" :type="visible ? 'text' : 'password'"
          :append-inner-icon="visible ? mdiEyeOffOutline : mdiEyeOutline" autocomplete="off" spellcheck="false"
          variant="outlined" hint="Stored privately outside your projects. Existing keys are never shown." persistent-hint
          @click:append-inner="visible = !visible"
        />
        <p class="text-body-small my-3">Connecting sends one small test request to {{ provider.label }} and may use API credit or plan quota.</p>
        <div class="d-flex flex-wrap ga-2 align-center">
          <v-btn
            type="submit" color="primary" variant="flat"
            :disabled="!actionsEnabled || !apiKey.trim() || busy"
          >
            {{ busy ? 'Checking…' : connection?.connected ? 'Check and replace key' : 'Check and connect' }}
          </v-btn>
          <v-btn :href="provider.keyUrl" target="_blank" rel="noopener noreferrer" variant="text" :append-icon="mdiOpenInNew">Get API key</v-btn>
          <v-btn
            v-if="connection?.status && connection.status !== 'not_connected'" variant="text"
            :disabled="!actionsEnabled || busy" @click="confirmRemove = true"
          >
            Disconnect
          </v-btn>
        </div>
      </v-form>
      <p v-if="provider.ownerOnly" class="text-body-small mt-3">This plan connection is available to the workspace owner.</p>
      <p class="text-body-small mt-3">GPT and your other Codex connections stay connected. Switch between them from the chat cog between turns.</p>
      <v-alert v-if="confirmRemove" variant="tonal" class="mt-3">
        Disconnect Codex - {{ provider.label }}? Work using this connection will stop. Your conversations and files remain.
        <div class="d-flex ga-2 mt-2">
          <v-btn :disabled="busy" @click="confirmRemove = false">Keep connected</v-btn>
          <v-btn color="error" :disabled="busy" @click="save(true)">{{ busy ? "Disconnecting…" : "Disconnect" }}</v-btn>
        </div>
      </v-alert>
    </template>
  </section>
</template>

<style scoped>
.codex-providers { min-width: 0; }
</style>
