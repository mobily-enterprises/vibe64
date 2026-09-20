<template>
  <div>
    <v-btn :disabled="disabled" variant="text" @click="open = true">Helper model</v-btn>
    <v-dialog v-model="open" max-width="520" :persistent="saving">
      <v-card>
        <v-card-title>Helper model · {{ accountLabel }}</v-card-title>
        <v-card-text>
          <p class="text-body-medium mb-4">Used for prompt suggestions, commit names, and other small background tasks. Your main chat model stays separate. Changes apply to new helper tasks across projects.</p>
          <v-skeleton-loader v-if="resource.isInitialLoading.value" type="list-item-two-line" />
          <v-alert v-else-if="loadError" type="error" variant="tonal">
            {{ loadError }}
            <v-btn variant="text" @click="resource.reload()">Retry</v-btn>
          </v-alert>
          <v-select
            v-else-if="resource.data.value?.ok"
            v-model="modelId"
            :items="items"
            :disabled="saving || resource.isLoading.value"
            item-title="label"
            item-value="id"
            label="Helper model"
            hint="Uses this account’s billing or plan allowance. A different model may cost more."
            persistent-hint
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn :disabled="saving" @click="open = false">Close</v-btn>
          <v-btn color="primary" variant="flat" :disabled="saving || resource.isLoading.value || !resource.data.value?.ok || modelId === resource.data.value.modelId" @click="save">
            {{ saving ? "Saving…" : "Save" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { ACCOUNTS_ENDPOINT, VIBE64_ACCOUNTS_CHANGED_EVENT } from "../lib/accountsGateApi.js";

const props = defineProps({
  providerId: { type: String, default: "codex" },
  accountLabel: { type: String, default: "Codex" },
  disabled: { type: Boolean, default: false },
  endpoint: { type: String, default: `${ACCOUNTS_ENDPOINT}/helper-model` },
  changedEvent: { type: String, default: VIBE64_ACCOUNTS_CHANGED_EVENT }
});
const open = ref(false);
const modelId = ref("");
const saving = ref(false);
const resource = useEndpointResource({
  enabled: computed(() => open.value && !props.disabled),
  path: computed(() => props.providerId === "claude" ? `${props.endpoint}?providerId=claude` : props.endpoint),
  queryKey: computed(() => ["vibe64", "helper-model", props.endpoint, props.providerId]),
  queryOptions: { refetchOnMount: "always", retry: false, staleTime: 0 },
  realtime: { event: props.changedEvent },
  fallbackLoadError: "Helper models could not be loaded.",
  requestRecoveryLabel: "Helper models"
});
watch(() => resource.data.value, (data, previous) => {
  if (data?.ok && (!open.value || !previous || modelId.value === previous.modelId)) {
    modelId.value = data.modelId;
  }
}, { immediate: true });
watch(open, (value) => {
  if (value) {
    modelId.value = resource.data.value?.modelId || "";
  }
});
const loadError = computed(() => resource.loadError.value || (resource.data.value?.ok === false
  ? resource.data.value.error || "Helper models could not be loaded." : ""));
const items = computed(() => {
  const data = resource.data.value || {};
  const models = data.models || [];
  const result = [{ id: "", label: `Recommended (${data.recommendedModelId || "unavailable"})` }, ...models];
  if (data.modelId && !models.some((model) => model.id === data.modelId)) {
    result.push({ id: data.modelId, label: `${data.modelId} (unavailable)` });
  }
  return result;
});
const command = useCommand({
  access: "never",
  apiSuffix: "/vibe64/accounts/helper-model",
  buildCommandOptions: () => ({ method: "PATCH", path: props.endpoint }),
  buildRawPayload: () => ({ modelId: modelId.value, ...(props.providerId === "claude" ? { providerId: "claude" } : {}) }),
  onRunSuccess(response) {
    if (response?.ok !== true) throw new Error(response?.error || "Helper model could not be saved.");
  },
  messages: { success: "Helper model saved. New helper tasks will use this choice.", error: "Helper model could not be saved." },
  fallbackRunError: "Helper model could not be saved.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.accounts.helper-model",
  surfaceId: "app",
  writeMethod: "PATCH"
});
async function save() {
  saving.value = true;
  try {
    const response = await command.run();
    if (response?.ok === true) await resource.reload();
  } catch {
    // The command owns error feedback; retain the choice for retry.
  } finally {
    saving.value = false;
  }
}
</script>
