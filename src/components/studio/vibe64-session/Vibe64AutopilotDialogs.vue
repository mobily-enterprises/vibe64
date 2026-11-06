<template>
  <v-dialog
    :model-value="Boolean(resolvedUpdateReview)" max-width="36rem"
    aria-label="Apply resolved Update" scrollable
    @update:model-value="!$event && (resolvedUpdateReview = null)"
  >
    <v-card v-if="resolvedUpdateReview">
      <v-card-title class="text-wrap">Apply resolved Update</v-card-title>
      <v-card-text>
        <p>Confirm that these files preserve the intended changes from both this session and the latest saved version.</p>
        <ul class="my-3 pl-5" style="overflow-wrap: anywhere">
          <li v-for="file in resolvedUpdateReview.conflictPaths" :key="file">{{ file }}</li>
        </ul>
        <p>Repairs may be made manually or in any coding chat. Vibe64 will check the repository state and apply Update. Nothing is pushed.</p>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn @click="resolvedUpdateReview = null">Cancel</v-btn>
        <v-btn
          color="primary" variant="flat"
          :disabled="updateWorkDisabled || sourceOperationsSuspended"
          @click="confirmResolvedUpdate"
        >
          Conflicts resolved — apply Update
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(contextFullFailure)" max-width="30rem" aria-label="Not enough room"
    @update:model-value="!$event && (contextFullFailure = null)"
  >
    <v-card v-if="contextFullFailure" rounded="xl">
      <v-card-title class="text-wrap">Not enough room</v-card-title>
      <v-card-text>
        <p>{{ contextFullFailure.message }}</p>
        <p class="text-body-small mt-3 mb-0">Your message was not sent and nothing was lost. Try again to summarise the assistant's memory and send it, or choose another assistant.</p>
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="contextFullFailure = null">Close</v-btn>
        <v-btn color="primary" variant="flat" @click="retryContextFull">Summarise and continue</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="saveWorkConfirmOpen" max-width="30rem" aria-label="Save changes" scrollable>
    <v-card rounded="xl">
      <v-card-title>Save changes</v-card-title>
      <v-card-text>
        <div class="d-flex align-center justify-space-between ga-2 mb-2">
          <span>{{ props.workState?.changedPaths?.length || 0 }} changed {{ props.workState?.changedPaths?.length === 1 ? 'file' : 'files' }}</span>
          <v-btn variant="text" @click="cancelSaveWork(); selectSessionTool('changes')">View diff</v-btn>
        </div>
        <v-sheet v-if="saveWorkReview" color="surface-light" rounded="lg" class="pa-3" style="overflow-wrap: anywhere">
          <div class="text-label-small on-surface-variant">{{ saveWorkReview.mode === 'github' ? 'GitHub' : saveWorkReview.mode === 'local_source' ? 'Local project' : 'Project version' }}</div>
          <Vibe64SessionSaveTarget v-if="saveWorkTarget" :target="saveWorkTarget" />
          <p v-if="sessionPullRequest" class="text-body-small mt-1 mb-0">PR #{{ sessionPullRequest.number }} · {{ sessionPullRequest.headBranch }} → {{ sessionPullRequest.baseBranch }}</p>
        </v-sheet>
        <p v-else-if="!saveWorkReview" role="status">Refresh repository status to review the destination.</p>
        <p class="text-body-small mt-3 mb-0">Save open file edits first.</p>
        <p v-if="saveWorkNeedsPullRequest" role="status" class="text-body-small mt-2">A pull request is required.</p>
        <p v-if="saveWorkDisabled" role="status" class="mt-3">{{ saveWorkTitle }}</p>
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2 px-6 pb-5">
        <v-spacer />
        <v-btn :disabled="saveWorkSending" type="button" variant="text" @click="cancelSaveWork">
          Cancel
        </v-btn>
        <v-btn
          v-if="githubProject && !sessionPullRequest?.number"
          color="primary"
          :variant="saveWorkNeedsPullRequest ? 'flat' : 'outlined'"
          :disabled="saveWorkDisabled || !saveWorkReview"
          @click="cancelSaveWork(); createPullRequestOpen = true"
        >
          Create draft PR
        </v-btn>
        <v-btn
          :aria-busy="saveWorkSending ? 'true' : undefined"
          color="primary"
          :disabled="saveWorkDisabled || !saveWorkReview || saveWorkNeedsPullRequest"
          type="button"
          :variant="saveWorkNeedsPullRequest ? 'outlined' : 'flat'"
          @click="confirmSaveWork"
        >
          <span class="text-wrap" style="overflow-wrap: anywhere">{{ saveWorkSending ? "Committing…" : publicationLabel }}</span>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, inject } from "vue";
import { VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";
import Vibe64SessionSaveTarget from "./Vibe64SessionSaveTarget.vue";
import { vibe64SessionSaveTarget } from "@/lib/vibe64SessionSaveTarget.js";

// The session's confirmations: applying a resolved Update, a message that
// does not fit the assistant's memory, and Save.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its
  // members are read once.
  view: { type: Object, required: true }
});
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  applyResolvedUpdate, cancelSaveWork, confirmSaveWork, contextFullFailure, createPullRequestOpen,
  githubProject, props, resolvedUpdateReview, retryContextFull, saveWorkConfirmOpen,
  saveWorkDisabled, saveWorkReview, saveWorkSending, saveWorkTitle,
  selectSessionTool, sessionPullRequest, sourceOperationsSuspended, updateWorkDisabled
} = view;
/** @type {import("@local/vibe64-ai-tasks/client/types").AiTaskHost} */
const aiTasks = inject(VIBE64_AI_TASKS_KEY);
// An open Update task runs its own check: the person's review just tells it which one.
function confirmResolvedUpdate() {
  if (!aiTasks.task || aiTasks.projection.ended) {
    void applyResolvedUpdate();
    return;
  }
  const { reviewId } = resolvedUpdateReview.value;
  resolvedUpdateReview.value = null;
  void aiTasks.check({ reviewedConflictId: reviewId });
}
// The reviewed destination, said as the session tab's info says it.
const saveWorkTarget = computed(() => vibe64SessionSaveTarget(saveWorkReview.value, props.projectContext));
const saveWorkNeedsPullRequest = computed(() => githubProject.value &&
  props.workState?.publicationRequiresPullRequest === true && !sessionPullRequest.value?.number);
const publicationLabel = computed(() => {
  const destination = saveWorkReview.value;
  if (destination?.mode === "github") return "Commit & push";
  return "Save";
});
</script>
