<script setup>
import { computed, ref, watch } from "vue";
import { mdiArrowLeft, mdiCheckCircleOutline, mdiClose, mdiEyeOutline, mdiEyeOffOutline, mdiOpenInNew } from "@mdi/js";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";
import ModelRoutingForm from "./ModelRoutingForm.vue";

const props = defineProps({
  actionsEnabled: { type: Boolean, default: true },
  adding: Boolean,
  engineId: { type: String, default: "codex" },
  selectProvider: { type: Boolean, default: true },
  showBack: Boolean,
  showClose: Boolean
});
const providerId = defineModel({ type: String, default: "openai" });
const emit = defineEmits(["changed", "close", "back", "busy"]);
const { connections, resource, busy, change, loadError } = useCodexProviderConnections({
  enabled: computed(() => props.actionsEnabled)
});
watch(busy, (value) => emit("busy", value), { immediate: true });
const provider = computed(() => curatedCodexProvider(providerId.value));
const connection = computed(() => connections.value.find(({ id }) => id === providerId.value));
const engineLabel = computed(() => props.engineId === "claude" ? "Claude Code" : "Codex");
const connected = computed(() => props.engineId === "claude" ? connection.value?.claudeReady : connection.value?.connected);
const useExistingKey = computed(() => props.adding && connection.value?.status === "connected");
const connectedEngines = computed(() => [
  ...(connection.value?.connected ? ["codex"] : []), ...(connection.value?.claudeReady ? ["claude"] : [])
]);
const choices = computed(() => [
  props.engineId === "claude" ? { id: "anthropic", label: "Claude Code - Claude · Claude subscription" }
    : { id: "openai", label: "Codex - GPT · ChatGPT or OpenAI API key" },
  ...CURATED_CODEX_PROVIDERS.map(({ id, label }) => {
    const row = connections.value.find((row) => row.id === id);
    const ready = props.engineId === "claude" ? row?.claudeReady : row?.connected;
    return { id, label: `${engineLabel.value} - ${label}${ready ? " · Connected" : ""}` };
  })
]);
const apiKey = ref("");
const visible = ref(false);
const confirmRemove = ref(false);
const routingProposal = ref(false);
const routingSetupError = ref("");
watch([providerId, () => props.engineId], () => {
  apiKey.value = "";
  visible.value = false;
  confirmRemove.value = false;
  routingProposal.value = false;
  routingSetupError.value = "";
}, { immediate: true });
async function save({ remove = false, useSavedKey = false } = {}) {
  try {
    const result = await change({ modelProviderId: providerId.value, engineId: props.engineId,
      apiKey: apiKey.value, remove, useSavedKey: useSavedKey || useExistingKey.value });
    if (result?.ok !== true) return;
    apiKey.value = "";
    visible.value = false;
    confirmRemove.value = false;
    emit("changed");
    if (!remove) {
      routingSetupError.value = result.routing?.ok === false ? result.routing.error : "";
      routingProposal.value = true;
    }
  } catch {
    // The shared command feedback owns errors; retain the form for retry.
  }
}
</script>

<template>
  <section :aria-label="`${engineLabel} providers`" class="native-providers">
    <ModelRoutingForm
      v-if="routingProposal" :engine-id="engineId" :connection-id="providerId" :connection-label="provider?.label || providerId" :connection-engines="connectedEngines" :setup-error="routingSetupError"
      @busy="emit('busy', $event)" @close="routingProposal = false; emit('close')"
      @saved="routingProposal = false; emit('changed'); emit('close')"
    />
    <template v-else>
      <div v-if="selectProvider" class="d-flex align-center ga-2 mb-3">
        <v-select
          v-model="providerId" :items="choices" item-title="label" item-value="id"
          :label="`Use ${engineLabel} with`" variant="outlined" hide-details :disabled="busy"
        />
      </div>
      <template v-if="provider">
        <div class="d-flex align-center flex-wrap ga-2 mb-2">
          <h2 class="text-title-large">{{ engineLabel }} - {{ provider.label }}</h2>
          <v-chip v-if="connected" color="success" size="small" :prepend-icon="mdiCheckCircleOutline">Connected</v-chip>
          <v-spacer />
          <v-btn v-if="showBack" :icon="mdiArrowLeft" aria-label="Back to providers" variant="text" :disabled="busy" @click="emit('back')" />
          <v-btn v-if="showClose" :icon="mdiClose" :aria-label="`Close ${engineLabel} setup`" variant="text" :disabled="busy" @click="emit('close')" />
        </div>
        <p class="text-body-medium mb-3">{{ provider.description }}.</p>
        <p v-if="provider.setupNote" class="text-body-small mb-3">{{ provider.setupNote }}</p>
        <p v-if="connection?.status === 'connected'" class="text-body-small mb-3">
          Ready for {{ connectedEngines.map(id => id === 'claude' ? 'Claude Code' : 'Codex').join(' and ') }}.
          <template v-if="!connected">Connect {{ engineLabel }} using the saved key.</template>
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
            v-if="!useExistingKey"
            v-model="apiKey" :label="connection?.status === 'connected' ? 'Replace API key' : 'API key'" :type="visible ? 'text' : 'password'"
            :append-inner-icon="visible ? mdiEyeOffOutline : mdiEyeOutline" autocomplete="off" spellcheck="false"
            variant="outlined" hint="Stored privately outside your projects. Existing keys are never shown." persistent-hint
            @click:append-inner="visible = !visible"
          />
          <p class="text-body-small my-3">Checks {{ engineLabel }} first, then the other orchestrator. These small requests use API credit or plan quota.</p>
          <div class="d-flex flex-wrap ga-2 align-center">
            <v-btn
              type="submit" color="primary" variant="flat"
              :disabled="!actionsEnabled || (!useExistingKey && !apiKey.trim()) || busy"
            >
              {{ busy ? 'Checking…' : useExistingKey || connection?.status !== 'connected' ? 'Check and connect' : 'Check and replace key' }}
            </v-btn>
            <v-btn v-if="!adding && connection?.status === 'connected'" variant="outlined" :disabled="busy || !actionsEnabled" @click="save({ useSavedKey: true })">Check saved key</v-btn>
            <v-btn :href="provider.keyUrl" target="_blank" rel="noopener noreferrer" variant="text" :append-icon="mdiOpenInNew">Get API key</v-btn>
            <v-btn
              v-if="!adding && connection?.status && connection.status !== 'not_connected'" variant="text"
              :disabled="!actionsEnabled || busy" @click="confirmRemove = true"
            >
              Disconnect
            </v-btn>
          </div>
        </v-form>
        <p v-if="provider.ownerOnly" class="text-body-small mt-3">This plan connection is available to the workspace owner.</p>
        <v-alert v-if="confirmRemove" variant="tonal" class="mt-3">
          Disconnect {{ provider.label }} from Codex and Claude Code? Work using this key will stop. Your conversations and files remain.
          <div class="d-flex ga-2 mt-2">
            <v-btn :disabled="busy" @click="confirmRemove = false">Keep connected</v-btn>
            <v-btn color="error" :disabled="busy" @click="save({ remove: true })">{{ busy ? "Disconnecting…" : "Disconnect" }}</v-btn>
          </div>
        </v-alert>
      </template>
    </template>
  </section>
</template>

<style scoped>
.native-providers { min-width: 0; }
</style>
