<template>
  <v-alert v-if="actionable" variant="tonal" density="compact" :icon="false" :type="request.error || actionError ? 'warning' : 'info'" class="vibe64-routing-notice mb-2 px-2 py-1" role="status">
    <details v-if="previousAttempt || request.error && request.error !== request.outcome?.explanation" :key="request.messageId">
      <summary class="text-body-small">{{ label }} · <span class="text-decoration-underline">Details</span></summary>
      <p v-if="previousAttempt" class="text-body-small mb-2">Send a new message to continue with your selected assistant. Check delivery only checks the previous attempt.</p>
      <p v-if="request.error" class="text-body-small mb-2">{{ request.error }}</p>
    </details>
    <div v-else-if="!followupNeedsAction || asksChecks" class="text-body-small">{{ label }}</div>
    <p v-if="actionError" class="text-body-small mb-1" role="alert">{{ actionError }}</p>
    <div v-if="action" class="vibe64-routing-notice__actions d-flex flex-wrap align-center ga-1">
      <v-btn :variant="primaryAction && !action.progress ? 'flat' : 'text'" :color="primaryAction ? 'primary' : undefined" size="small" density="compact" :disabled="!action.enabled" :aria-busy="Boolean(action.progress)" :aria-describedby="action.waits ? waitsId : undefined" @click="pressAction">
        <span :class="{ 'action-label-pending': action.progress }">{{ action.label }}</span>
        <span v-if="action.progress" class="position-absolute">{{ action.progress }}</span>
      </v-btn>
      <v-btn v-if="action.kind === 'implement' && !pendingAction" variant="text" size="small" density="compact" @click="$emit('view-plan')">View plan</v-btn>
      <!-- The whole-project checks' No: nothing runs, and Vibe64 never asks again for this plan. -->
      <v-btn v-if="asksChecks" variant="text" size="small" density="compact" :disabled="!action.enabled" @click="$emit('checks', 'no')">No</v-btn>
      <v-btn v-if="notice.stop && !pendingAction" variant="text" size="small" density="compact" @click="$emit('skip')">
        Stop
      </v-btn>
      <!-- A held action says why it can't be pressed, in the words the plan's status line uses. -->
      <span v-if="action.waits" :id="waitsId" class="text-body-small vibe64-routing-notice__waits">{{ action.waits.charAt(0).toUpperCase() + action.waits.slice(1) }}.</span>
    </div>
    <!-- A request that failed can be reported from where it shows, with this chat. -->
    <v-btn v-if="request.error && problemReport.available" variant="text" size="small" density="compact" data-vibe64-report-problem @click="problemReport.open({ includeChat: true })">Report a problem</v-btn>
  </v-alert>
</template>

<script setup>
import { computed, useId, watch } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { assistantRoutingNotice } from "@local/vibe64-runtime/shared/assistantRoutingNotice";
import { useProblemReport } from "@/composables/useProblemReport.js";

const props = defineProps({ request: { type: Object, default: null }, selection: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, pendingAction: { type: String, default: "" }, actionError: { type: String, default: "" },
  // What holds the chat: "turn" (the assistant's turn), "message" (the person's message being sent) or "voice".
  busy: { type: String, default: "" } });
// checks: the answer to the whole-project checks question once a plan is finished, "yes" or "no".
const emit = defineEmits(["retry", "skip", "implement", "view-plan", "checks"]);
const feedback = useShellWebErrorRuntime();
const problemReport = useProblemReport();
const waitsId = `vibe64-routing-notice-waits-${useId()}`;
const notice = computed(() => assistantRoutingNotice(props.request, {
  mode: props.mode, selection: props.selection, busy: props.busy, pendingAction: props.pendingAction
}));
const previousAttempt = computed(() => notice.value.previousAttempt);
const label = computed(() => notice.value.label);
const followupNeedsAction = computed(() => notice.value.needsAction);
const actionable = computed(() => notice.value.shown);
const action = computed(() => notice.value.action);
const asksChecks = computed(() => action.value?.kind === "checks");
const primaryAction = computed(() => ["implement", "checks"].includes(action.value?.kind));
function pressAction() {
  if (action.value.kind === "implement") emit("implement");
  else if (asksChecks.value) emit("checks", "yes");
  else emit("retry");
}
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
  padding-inline: 8px;
}

.vibe64-routing-notice__waits {
  padding-inline: 4px;
}

summary {
  min-height: 32px;
  align-content: center;
  cursor: pointer;
  overflow-wrap: anywhere;
}
@media (pointer: coarse) {
  summary {
    min-height: 44px;
  }
}
</style>
