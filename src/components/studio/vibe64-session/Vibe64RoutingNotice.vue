<template>
  <v-alert v-if="actionable" variant="tonal" density="compact" :type="request.error ? 'warning' : 'info'" class="mb-2" role="status">
    {{ label }}
    <p v-if="request.error" class="text-body-small mt-1">{{ request.error }}</p>
    <div v-if="followupNeedsAction" class="d-flex flex-wrap ga-1">
      <v-btn variant="text" min-height="48" :disabled="retrying" @click="$emit('retry')">
        {{ request.status.endsWith('_uncertain') ? 'Check delivery' : request.continuation === 'planning' ? 'Continue planning' : 'Retry review' }}
      </v-btn>
      <v-btn v-if="['review_pending', 'planning_pending'].includes(request.status)" variant="text" min-height="48" @click="$emit('skip')">
        {{ request.continuation === 'planning' ? 'Stop' : 'Skip review' }}
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
const followupNeedsAction = computed(() => ["review_pending", "review_uncertain", "planning_pending", "planning_uncertain"].includes(props.request?.status));
const actionable = computed(() => {
  const request = props.request;
  if (request?.status === "cancelled" && !request.helper && !request.attemptedMessageId) return false;
  // These delivery failures and retry controls already appear on the unsent bubble.
  if (["failed", "uncertain"].includes(request?.status)) return false;
  return Boolean(label.value && (request?.error || followupNeedsAction.value));
});

// Announce a newly finished review once. Restoring a conversation must not
// replay an old notification; its outcome remains on the message in history.
watch(() => [props.request?.messageId, props.request?.status], ([id, status], [previousId, previousStatus]) => {
  if (!props.active || !id || id !== previousId || status !== "done" || previousStatus === "done" ||
      props.request.error || props.request.resolvedMode !== "junior" ||
      !["incomplete", "skipped_incomplete", "skipped_unconfirmed", "cancelled", "skipped_question"].includes(props.request.reviewStatus)) return;
  feedback.report({ source: "vibe64.chat.review", message: label.value, intent: "action-feedback",
    severity: "info", channel: "snackbar", dedupeKey: `vibe64.chat.review:${id}` });
});
</script>
