<template>
  <div v-if="planVisible" class="d-flex align-center flex-wrap ga-1">
    <v-btn ref="planActivator" variant="text" min-height="48" :prepend-icon="mdiFileDocumentOutline">View plan</v-btn>
    <v-btn
      v-if="planReady"
      variant="tonal"
      color="primary"
      min-height="48"
      :disabled="busy || retrying"
      :aria-label="implementLabel"
      @click="$emit('implement', request.workPlan.revision)"
    >
      Implement
    </v-btn>
    <v-btn v-else-if="planRecoverable" variant="tonal" min-height="48" :disabled="busy || retrying" @click="recoverPlan">
      Recover plan
    </v-btn>
    <span v-else class="text-body-small text-medium-emphasis">{{ planStage }}</span>
  </div>
  <v-dialog v-if="planVisible" v-model="planOpen" :activator="planActivator?.$el" max-width="880" scrollable aria-label="Working plan">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center">
        Working plan
        <v-spacer />
        <v-btn :icon="mdiClose" variant="text" aria-label="Close plan" @click="planOpen = false" />
      </v-card-title>
      <v-card-text>
        <h2 class="text-title-medium mb-3">What this will do</h2>
        <LongTextPreviewBlocks v-if="planParts.overview.length" :blocks="planParts.overview" />
        <p v-else>A plain-language overview has not been added yet. The full plan is under Technical details.</p>
        <v-expansion-panels v-model="expandedPlanSection" variant="accordion" class="mt-6">
          <v-expansion-panel value="technical" title="Technical details">
            <v-expansion-panel-text><LongTextPreviewBlocks :blocks="planParts.technical" /></v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" min-height="48" @click="planOpen = false">Close</v-btn>
        <v-spacer />
        <v-btn v-if="planReady" variant="tonal" color="primary" min-height="48" :disabled="busy || retrying" :aria-label="implementLabel" :title="implementLabel" @click="implementPlan">
          Implement
        </v-btn>
        <v-btn v-else-if="planRecoverable" variant="tonal" min-height="48" :disabled="busy || retrying" @click="recoverPlan">Recover plan</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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
import { computed, ref, watch } from "vue";
import { mdiClose, mdiFileDocumentOutline } from "@mdi/js";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";

const props = defineProps({ request: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, retrying: Boolean, busy: Boolean });
const emit = defineEmits(["retry", "skip", "implement", "recover"]);
const planOpen = ref(false);
const expandedPlanSection = ref(null);
const planActivator = ref(null);
const planParts = computed(() => {
  const blocks = parseLongTextReviewBlocks(props.request?.workPlan?.text || "");
  const start = blocks.findIndex((block) => block.type === "heading" && block.level === 2 && block.text.trim().toLowerCase() === "outcome and scope");
  if (start < 0) return { overview: [], technical: blocks };
  const next = blocks.findIndex((block, index) => index > start && block.type === "heading" && block.level <= 2);
  const end = next < 0 ? blocks.length : next;
  return { overview: blocks.slice(start + 1, end), technical: [...blocks.slice(0, start), ...blocks.slice(end)] };
});
watch(planOpen, (open) => { if (open) expandedPlanSection.value = null; });
const planVisible = computed(() => props.mode === "auto" && props.request?.mode === "auto" && Boolean(props.request.workPlan?.text));
const planReady = computed(() => planVisible.value && props.request?.status === "done" && !props.request.error && props.request.workPlan?.status === "ready");
const planRecoverable = computed(() => planVisible.value && props.request?.status === "done" &&
  ["drafting", "paused", "blocked"].includes(props.request.workPlan?.status));
const implementLabel = computed(() => `Implement with Junior${props.request?.assignments?.junior
  ? ` · ${vibe64AssistantSelectionLabel(props.request.assignments.junior)}` : ""}`);
const planStage = computed(() => {
  const request = props.request;
  if (request?.task === "deslop") return request.status === "sent" ? "Deslopping" : "Plan needs updating";
  if (request?.status === "sent") return request.resolvedMode === "junior" ? "Coding" : "Planning";
  if (request?.status === "reviewing") return "Reviewing";
  if (request?.status === "planning") return "Back to planning";
  return ({
    drafting: "Planning", ready: "Plan ready", blocked: "Needs planning",
    implemented: "Implementation recorded", paused: "Paused"
  })[request?.workPlan?.status] || "Planning";
});
function implementPlan() {
  emit("implement", props.request.workPlan.revision);
  planOpen.value = false;
}
function recoverPlan() {
  emit("recover", props.request.workPlan.revision);
  planOpen.value = false;
}
watch(() => props.active, (active) => { if (!active) planOpen.value = false; });
watch(planVisible, (visible) => { if (!visible) planOpen.value = false; });
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
