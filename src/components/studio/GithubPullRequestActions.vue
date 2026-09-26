<script setup>
import { computed, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiCheck, mdiSourceBranchSync, mdiSourceMerge } from "@mdi/js";

const props = defineProps({
  pullRequest: { type: Object, required: true },
  apiPath: { type: String, required: true },
  disabled: Boolean
});
const emit = defineEmits(["changed"]);
const feedback = useUiFeedback({ source: "vibe64.pullRequests.actions" });
const confirmation = ref(null);
const pending = ref(false);
const mergeMethod = ref("");
const notice = ref("");
const updatingHead = ref("");
const failed = ref(false);
const methodLabels = { merge: "Create a merge commit", squash: "Squash and merge", rebase: "Rebase and merge" };
const checksLabel = computed(() => ({
  SUCCESS: "Checks passed", FAILURE: "Some checks failed", ERROR: "Checks reported an error",
  PENDING: "Checks are running", EXPECTED: "Waiting for checks"
})[props.pullRequest.checksState] || "No checks reported");
const reviewLabel = computed(() => ({
  APPROVED: "Reviews approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Reviews required"
})[props.pullRequest.reviewDecision] || "");
const path = computed(() => confirmation.value?.path || props.apiPath);
const command = useEndpointResource({ path, enabled: false,
  queryKey: computed(() => ["vibe64.pullRequestAction", path.value]), mutationOptions: { retry: false } });
const actionDisabled = computed(() => props.disabled || pending.value || !props.pullRequest.review);

watch(() => props.apiPath, () => {
  confirmation.value = null;
  notice.value = "";
  updatingHead.value = "";
  failed.value = false;
});
watch(() => [props.pullRequest.headRefOid, props.pullRequest.state], ([head, state]) => {
  if (state !== "OPEN") {
    notice.value = "";
    updatingHead.value = "";
  } else if (updatingHead.value && head && head !== updatingHead.value) {
    notice.value = "New commits are available. Update your session to load them.";
    updatingHead.value = "";
  }
});

function open(operation) {
  const pr = props.pullRequest;
  if (actionDisabled.value || pr.actions?.[operation] !== "") return;
  mergeMethod.value = pr.mergeMethods[0] || "";
  const head = `${pr.review.headRepository}:${pr.review.headBranch}`;
  const base = `${pr.review.repository}:${pr.review.baseBranch}`;
  confirmation.value = {
    operation, path: `${props.apiPath}/${operation}`, apiPath: props.apiPath,
    review: { ...pr.review }, url: pr.url, methods: pr.mergeMethods,
    from: operation === "update-branch" ? base : head,
    to: operation === "update-branch" ? head : base,
    title: operation === "ready" ? "Ready for review?"
      : operation === "update-branch" ? `Update branch from ${pr.baseRefName}?` : `Merge into ${pr.baseRefName}?`
  };
  failed.value = false;
}

async function submit() {
  const reviewed = confirmation.value;
  if (!reviewed || pending.value || props.disabled) return;
  pending.value = true;
  failed.value = false;
  try {
    const result = await command.save({ review: reviewed.review,
      ...(reviewed.operation === "merge" ? { mergeMethod: mergeMethod.value } : {}) }, { method: "POST", path: reviewed.path });
    if (props.apiPath === reviewed.apiPath) {
      notice.value = result.pending ? result.message : "";
      updatingHead.value = result.pending ? reviewed.review.headCommit : "";
      confirmation.value = null;
    }
    feedback.success(`PR #${reviewed.review.number}: ${result.message}`);
    emit("changed", { apiPath: reviewed.apiPath, operation: reviewed.operation });
  } catch (error) {
    if (props.apiPath === reviewed.apiPath) failed.value = true;
    feedback.error(error, "The result could not be confirmed. Refresh this pull request before trying again.");
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <v-sheet rounded="xl" border class="pa-5 d-flex flex-column ga-3 pr-actions">
    <p v-if="notice" role="status" class="text-body-medium ma-0">{{ notice }}</p>
    <template v-if="pullRequest.state === 'OPEN'">
      <div class="d-flex flex-wrap ga-2 text-body-small">
        <v-chip size="small" :color="['FAILURE', 'ERROR'].includes(pullRequest.checksState) ? 'warning' : undefined">{{ checksLabel }}</v-chip>
        <v-chip v-if="reviewLabel" size="small">{{ reviewLabel }}</v-chip>
      </div>
      <p v-if="pullRequest.actions?.merge" class="text-body-medium ma-0">{{ pullRequest.actions.merge }}</p>
      <div class="d-flex flex-wrap ga-2">
        <v-btn
          v-if="pullRequest.isDraft" color="primary" variant="tonal" min-height="48" height="auto" max-width="100%" :prepend-icon="mdiCheck"
          :disabled="actionDisabled || Boolean(pullRequest.actions?.ready)" @click="open('ready')"
        >
          <span class="text-wrap">Ready for review</span>
        </v-btn>
        <v-btn
          v-if="pullRequest.actions?.['update-branch'] === ''" variant="tonal" min-height="48" height="auto" max-width="100%" :prepend-icon="mdiSourceBranchSync"
          :disabled="actionDisabled" @click="open('update-branch')"
        >
          <span class="text-wrap">Update branch from {{ pullRequest.baseRefName }}</span>
        </v-btn>
        <v-btn
          v-if="!pullRequest.isDraft" color="primary" variant="flat" min-height="48" height="auto" max-width="100%" :prepend-icon="mdiSourceMerge"
          :disabled="actionDisabled || Boolean(pullRequest.actions?.merge)" @click="open('merge')"
        >
          <span class="text-wrap">Merge into {{ pullRequest.baseRefName }}</span>
        </v-btn>
      </div>
      <p v-if="pullRequest.isDraft && pullRequest.actions?.ready" class="text-body-small ma-0">{{ pullRequest.actions.ready }}</p>
    </template>
    <p v-else-if="pullRequest.state === 'MERGED' && !notice" class="text-body-medium ma-0">
      Merged into {{ pullRequest.baseRefName }}. Archive your session when you have finished with it.
    </p>
    <p v-else-if="!notice" class="text-body-medium ma-0">This pull request is closed.</p>
  </v-sheet>
  <v-dialog :model-value="Boolean(confirmation)" max-width="36rem" scrollable :persistent="pending" @update:model-value="!$event && !pending && (confirmation = null)">
    <v-card v-if="confirmation" rounded="xl">
      <v-card-title class="text-wrap">{{ confirmation.title }}</v-card-title>
      <v-card-text class="d-flex flex-column ga-3 pr-confirmation">
        <p class="text-body-medium ma-0">
          {{ confirmation.from }} → {{ confirmation.to }}
        </p>
        <p v-if="confirmation.operation === 'ready'" class="text-body-medium ma-0">Mark this draft ready so reviewers can review it.</p>
        <p v-else-if="confirmation.operation === 'update-branch'" class="text-body-medium ma-0">
          Merge {{ confirmation.review.baseBranch }} into {{ confirmation.review.headBranch }} on GitHub.
          Then use Update session to load those changes into your session.
        </p>
        <template v-else>
          <p class="text-body-medium ma-0">Merge the commits already on GitHub. Save any session work you want included first.</p>
          <v-select
            v-if="confirmation.methods.length > 1" v-model="mergeMethod" label="Merge method" variant="outlined" hide-details
            :items="confirmation.methods.map(value => ({ title: methodLabels[value], value }))" :disabled="pending"
          />
          <p v-else class="text-body-small ma-0">{{ methodLabels[mergeMethod] }}</p>
        </template>
        <v-alert v-if="failed" type="warning" variant="tonal">
          This action was not confirmed. Close this dialog and refresh, or view the pull request on GitHub, before trying again.
          <a :href="confirmation.url" target="_blank" rel="noopener noreferrer">View on GitHub</a>
        </v-alert>
      </v-card-text>
      <v-card-actions class="pa-4 flex-wrap">
        <v-spacer />
        <v-btn :disabled="pending" height="48" @click="confirmation = null">Cancel</v-btn>
        <v-btn color="primary" variant="flat" height="48" :disabled="pending || disabled || failed" :aria-busy="pending" @click="submit">
          {{ pending ? 'Working…' : confirmation.operation === 'ready' ? 'Ready for review' : confirmation.operation === 'merge' ? 'Merge pull request' : 'Update branch' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pr-actions, .pr-confirmation { overflow-wrap: anywhere; }
</style>
