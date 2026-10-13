<template>
  <v-alert v-if="actionable" variant="tonal" density="compact" :icon="false" :type="request.error ? 'warning' : 'info'" class="mb-2 pa-1" role="status">
    <details v-if="previousAttempt || request.error && request.error !== request.outcome?.explanation" :key="request.messageId">
      <summary class="text-body-small py-2">{{ label }} · <span class="text-decoration-underline">Details</span></summary>
      <p v-if="previousAttempt" class="text-body-small mb-2">Send a new message to continue with your selected assistant. Check delivery only checks the previous attempt.</p>
      <p v-if="request.error" class="text-body-small mb-2">{{ request.error }}</p>
    </details>
    <div v-else-if="!followupNeedsAction" class="text-body-small py-2">{{ label }}</div>
    <div v-if="followupNeedsAction" class="d-flex flex-wrap ga-1">
      <v-btn v-if="canImplement" variant="flat" color="primary" min-height="48" :disabled="retrying || busy" @click="$emit('implement')">
        Implement plan
      </v-btn>
      <v-btn v-if="canImplement" variant="text" min-height="48" @click="$emit('view-plan')">View plan</v-btn>
      <v-btn variant="text" min-height="48" :disabled="retrying || busy && request.delivery !== 'uncertain'" @click="$emit('retry')">
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
import { assistantRoutingRequestCanBeReplaced, assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

const props = defineProps({ request: { type: Object, default: null }, selection: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, retrying: Boolean, busy: Boolean });
defineEmits(["retry", "skip", "implement", "view-plan"]);
const feedback = useShellWebErrorRuntime();
const previousAttempt = computed(() => props.request?.stopped && props.request?.delivery === "uncertain" &&
  assistantRoutingRequestCanBeReplaced(props.request, props.selection));
const label = computed(() => previousAttempt.value ? "Previous assistant delivery unconfirmed" : assistantRoutingStatusLabel(props.request));
const followupNeedsAction = computed(() => Boolean(props.request?.status === "waiting" &&
  (props.request?.followup || props.request?.delivery === "accepted" && (props.request?.workflow || props.request?.stage === "planning"))) ||
  Boolean(props.request?.delivery === "uncertain" && (props.request?.followup || previousAttempt.value)));
const canImplement = computed(() => props.mode === "auto" && props.request?.stage === "planning" &&
  props.request.status === "waiting" && ["pending", "accepted"].includes(props.request.delivery) &&
  !props.request.helper && props.request.workPlan?.status === "active" && Boolean(props.request.workPlan.revision));
const retryLabel = computed(() => props.request?.delivery === "uncertain" ? "Check delivery" : ({
  planning: "Continue planning", implementation: "Continue implementation", review: "Continue review"
}[props.request?.stage] || "Continue request"));
const actionable = computed(() => {
  const request = props.request;
  if (!request || request.stopped && !request.followup && !request.attemptedMessageId && !request.helper && !followupNeedsAction.value) return false;
  // Original unsent-message delivery controls remain on their message bubble.
  if (!request.followup && !request.helper && !previousAttempt.value && ["failed", "uncertain"].includes(request.delivery)) return false;
  return Boolean(label.value && (request.error || followupNeedsAction.value));
});
watch(() => [props.request?.messageId, props.request?.status], ([id, status], [previousId, previousStatus]) => {
  if (!props.active || !id || id !== previousId || status !== "waiting" || previousStatus === "waiting" || !props.request.stopped) return;
  feedback.report({ source: "vibe64.chat.review", message: label.value, intent: "action-feedback",
    severity: "info", channel: "snackbar", dedupeKey: `vibe64.chat.review:${id}` });
});
</script>

<style scoped>
summary {
  min-height: 48px;
  align-content: center;
  cursor: pointer;
}
</style>
