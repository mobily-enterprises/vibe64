<template>
  <v-alert v-if="actionable" variant="tonal" density="compact" :icon="false" :type="request.error || actionError ? 'warning' : 'info'" class="vibe64-routing-notice mb-2 px-2 py-1" role="status">
    <details v-if="previousAttempt || request.error && request.error !== request.outcome?.explanation" :key="request.messageId">
      <summary class="text-body-small">{{ label }} · <span class="text-decoration-underline">Details</span></summary>
      <p v-if="previousAttempt" class="text-body-small mb-2">Send a new message to continue with your selected assistant. Check delivery only checks the previous attempt.</p>
      <p v-if="request.error" class="text-body-small mb-2">{{ request.error }}</p>
    </details>
    <div v-else-if="!followupNeedsAction" class="text-body-small">{{ label }}</div>
    <p v-if="actionError" class="text-body-small mb-1" role="alert">{{ actionError }}</p>
    <div v-if="followupNeedsAction" class="vibe64-routing-notice__actions d-flex flex-wrap ga-1">
      <v-btn v-if="canImplement" :variant="pendingAction === 'implement' ? 'text' : 'flat'" color="primary" size="small" density="compact" :disabled="Boolean(pendingAction) || busy" :aria-busy="pendingAction === 'implement'" @click="$emit('implement')">
        <span :class="{ 'action-label-pending': pendingAction === 'implement' }">Implement plan</span>
        <span v-if="pendingAction === 'implement'" class="position-absolute">Starting…</span>
      </v-btn>
      <v-btn v-if="canImplement && !pendingAction" variant="text" size="small" density="compact" @click="$emit('view-plan')">View plan</v-btn>
      <v-btn v-if="!canImplement" variant="text" size="small" density="compact" :disabled="Boolean(pendingAction) || busy && request.delivery !== 'uncertain'" :aria-busy="pendingAction === 'continue'" @click="$emit('retry')">
        <span :class="{ 'action-label-pending': pendingAction === 'continue' }">{{ retryLabel }}</span>
        <span v-if="pendingAction === 'continue'" class="position-absolute">{{ request.delivery === 'uncertain' ? 'Checking…' : 'Continuing…' }}</span>
      </v-btn>
      <v-btn v-if="request.delivery === 'pending' && !pendingAction" variant="text" size="small" density="compact" @click="$emit('skip')">
        Stop
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup>
import { computed, watch } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { assistantRoutingRequestCanBeReplaced, assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

const props = defineProps({ request: { type: Object, default: null }, selection: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, pendingAction: { type: String, default: "" }, actionError: { type: String, default: "" }, busy: Boolean });
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
.action-label-pending {
  visibility: hidden;
}

.vibe64-routing-notice :deep(.v-alert__content) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

details {
  flex: 1 1 13rem;
  min-width: 0;
}

details[open] {
  flex-basis: 100%;
}

.vibe64-routing-notice__actions {
  flex: 0 0 auto;
  max-width: 100%;
}

.vibe64-routing-notice__actions :deep(.v-btn) {
  min-height: 32px;
  padding-inline: 8px;
}

summary {
  min-height: 32px;
  align-content: center;
  cursor: pointer;
  overflow-wrap: anywhere;
}
@media (pointer: coarse) {
  summary,
  .vibe64-routing-notice__actions :deep(.v-btn) {
    min-height: 44px;
  }
}
</style>
