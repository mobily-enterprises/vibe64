<template>
  <v-alert v-if="actionable" variant="tonal" density="compact" :type="request.error ? 'warning' : 'info'" class="mb-2" role="status">
    {{ label }}
    <p v-if="request.error" class="text-body-small mt-1">{{ request.error }}</p>
    <div v-if="followupNeedsAction" class="d-flex flex-wrap ga-1">
      <v-btn variant="text" min-height="48" :disabled="retrying" @click="$emit('retry')">
        {{ retryLabel }}
      </v-btn>
      <v-btn v-if="request.delivery === 'pending'" variant="text" min-height="48" @click="$emit('skip')">
        Stop
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup>
import { computed, watch } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

const props = defineProps({ request: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, retrying: Boolean, busy: Boolean });
defineEmits(["retry", "skip"]);
const feedback = useShellWebErrorRuntime();
const label = computed(() => assistantRoutingStatusLabel(props.request));
const followupNeedsAction = computed(() => Boolean(props.request?.status === "waiting" &&
  (props.request?.followup || props.request?.delivery === "accepted" && (props.request?.workflow || props.request?.stage === "planning"))) ||
  Boolean(props.request?.delivery === "uncertain" && props.request?.followup));
const retryLabel = computed(() => props.request?.delivery === "uncertain" ? "Check delivery" : "Resume workflow");
const actionable = computed(() => {
  const request = props.request;
  if (!request || request.stopped && !request.followup && !request.attemptedMessageId && !request.helper && !followupNeedsAction.value) return false;
  // Original unsent-message delivery controls remain on their message bubble.
  if (!request.followup && !request.helper && ["failed", "uncertain"].includes(request.delivery)) return false;
  return Boolean(label.value && (request.error || followupNeedsAction.value));
});
watch(() => [props.request?.messageId, props.request?.status], ([id, status], [previousId, previousStatus]) => {
  if (!props.active || !id || id !== previousId || status !== "waiting" || previousStatus === "waiting" || !props.request.stopped) return;
  feedback.report({ source: "vibe64.chat.review", message: label.value, intent: "action-feedback",
    severity: "info", channel: "snackbar", dedupeKey: `vibe64.chat.review:${id}` });
});
</script>
