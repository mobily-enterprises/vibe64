<script setup>
import { computed, ref } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useModelRouting } from "@local/vibe64-accounts/client";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

// Offers the first other connected orchestrator when this chat's account is
// unavailable. It saves the same chat-mode routing as the Chat mode menu.
const props = defineProps({ session: { type: Object, default: null }, sessionsApiPath: { type: [String, Object, Function], default: "" }, disabled: Boolean });
const emit = defineEmits(["saved"]);
const preferences = computed(() => assistantRoutingFromMetadata(props.session?.metadata));
const currentEngineId = computed(() => preferences.value?.workflowEngineId || props.session?.assistantSelection?.engineId || "");
const { connectedWorkflows } = useModelRouting({ enabled: computed(() => Boolean(props.session)), workflowsOnly: true });
const target = computed(() => connectedWorkflows.value.find((choice) => choice.available && choice.engineId !== currentEngineId.value) || null);
const saving = ref(false);
const error = ref("");
const command = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.assistant-selection.update",
  buildCommandOptions: () => ({ method: "PATCH", path: vibe64SessionPath(readRefOrGetterValue(props.sessionsApiPath), props.session.sessionId, "/assistant-selection") }),
  buildRawPayload: () => vibe64RealtimeOriginPayload({ assistantRouting: {
    mode: ["senior", "junior", "auto"].includes(preferences.value?.mode) ? preferences.value.mode : "senior",
    review: false, workflowEngineId: target.value.engineId
  } }),
  onRunSuccess: (result) => { if (result?.ok === false) throw new Error(result.error || "The chat could not be switched."); },
  fallbackRunError: "The chat could not be switched.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});
async function switchWorkflow() {
  if (!target.value || saving.value || props.disabled) return;
  saving.value = true;
  error.value = "";
  try {
    await command.run();
    emit("saved");
  } catch (cause) {
    error.value = cause?.message || "The chat could not be switched.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-btn
    v-if="target" variant="tonal" min-height="32" size="small"
    :loading="saving" :disabled="disabled" :title="error || undefined" @click="switchWorkflow"
  >
    Switch to {{ target.label }}
  </v-btn>
  <span v-if="error" class="text-error text-body-small" role="alert">{{ error }}</span>
</template>
