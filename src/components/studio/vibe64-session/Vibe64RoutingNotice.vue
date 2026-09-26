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
    <span v-else class="text-body-small text-medium-emphasis">{{ planStage }}</span>
  </div>
  <v-dialog v-if="planVisible" v-model="planOpen" :activator="planActivator?.$el" max-width="880" scrollable aria-label="Working plan">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center">
        Working plan
        <v-spacer />
        <v-btn :icon="mdiClose" variant="text" aria-label="Close plan" @click="planOpen = false" />
      </v-card-title>
      <v-card-subtitle>Temporary session document · kept outside Git</v-card-subtitle>
      <v-card-text><GithubMarkdown :text="request?.workPlan?.text || ''" /></v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="planOpen = false">Close</v-btn>
        <v-spacer />
        <v-btn v-if="planReady" variant="tonal" color="primary" :disabled="busy || retrying" @click="implementPlan">
          {{ implementLabel }}
        </v-btn>
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

import GithubMarkdown from "../GithubMarkdown.vue";

const props = defineProps({ request: { type: Object, default: null }, mode: { type: String, default: "" }, active: Boolean, retrying: Boolean, busy: Boolean });
const emit = defineEmits(["retry", "skip", "implement"]);
const planOpen = ref(false);
const planActivator = ref(null);
const planVisible = computed(() => props.mode === "auto" && props.request?.mode === "auto" && Boolean(props.request.workPlan?.text));
const planReady = computed(() => planVisible.value && props.request?.status === "done" && !props.request.error && props.request.workPlan?.status === "ready");
const implementLabel = computed(() => `Implement with Junior${props.request?.assignments?.junior?.modelId ? ` · ${props.request.assignments.junior.modelId}` : ""}`);
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
watch(() => props.active, (active) => { if (!active) planOpen.value = false; });
watch(planVisible, (visible) => { if (!visible) planOpen.value = false; });
const feedback = useShellWebErrorRuntime();
const label = computed(() => assistantRoutingStatusLabel(props.request));
const followupNeedsAction = computed(() => ["review_pending", "review_uncertain", "planning_pending", "planning_uncertain"].includes(props.request?.status));
// The unsent bubble already explains why a mixed request needs separating.
const actionable = computed(() => Boolean(label.value && props.request?.reason !== "mixed_deslop_request" && (props.request?.error || followupNeedsAction.value)));

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
