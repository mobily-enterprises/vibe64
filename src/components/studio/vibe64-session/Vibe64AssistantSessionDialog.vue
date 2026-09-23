<template>
  <v-dialog
    :model-value="modelValue"
    max-width="38rem"
    scrollable
    @update:model-value="emit('update:model-value', $event)"
  >
    <v-card class="vibe64-assistant-dialog" rounded="xl">
      <v-card-title class="vibe64-assistant-dialog__title">
        <span class="vibe64-assistant-dialog__title-copy">
          <strong class="text-title-large">Start an AI session</strong>
          <small class="text-body-small">Start in Plan. Choose Code or Auto from chat.</small>
        </span>
        <v-btn
          aria-label="Close AI session dialog"
          :disabled="submitting"
          :icon="mdiClose"
          title="Close"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-text class="vibe64-assistant-dialog__body">
        <Vibe64WorkflowSelector :active="modelValue" :disabled="submitting" @update:workflow="workflowEngineId = $event" @update:ready="workflowReady = $event" />
        <template v-if="branchSelectionAvailable">
          <v-switch v-model="chooseBranch" label="Choose a branch (advanced)" color="primary" :disabled="submitting" hide-details />
          <div v-if="chooseBranch" class="d-flex flex-column ga-3 mt-3">
            <v-skeleton-loader v-if="branches.isLoading.value" type="list-item-two-line, list-item" />
            <v-alert v-else-if="branches.loadError.value" type="error" variant="tonal">
              {{ branches.loadError.value }}
              <v-btn variant="text" @click="branches.reload()">Try again</v-btn>
            </v-alert>
            <template v-else>
              <v-select
                v-model="branchName"
                :items="branches.data.value?.branches || []"
                item-title="name"
                item-value="name"
                label="Start from branch"
                :disabled="submitting"
                hide-details
              />
              <v-switch v-model="createBranch" label="Create a new branch from this version" :disabled="submitting" hide-details />
              <v-text-field v-if="createBranch" v-model="newBranchName" label="New branch name" maxlength="255" :disabled="submitting" hide-details />
              <p v-if="selectedBranch" class="text-body-small" style="overflow-wrap: anywhere">
                {{ branchRepository }}:{{ createBranch ? newBranchName || 'new branch' : branchName }}
                · starts at {{ selectedBranch.commit?.slice(0, 12) }}.
                {{ createBranch ? 'Creates this repository branch now, then opens its own session.' : 'Opens this branch in its own session.' }}
                Reviewed commits and Updates use this destination.
              </p>
              <p class="text-body-small">The project's database policy still applies. Session databases belong to the session, not the branch. App publishing still uses the project branch.</p>
            </template>
          </div>
        </template>
      </v-card-text>

      <v-card-actions class="vibe64-assistant-dialog__actions">
        <v-btn :disabled="submitting" variant="text" @click="close">Cancel</v-btn>
        <v-btn
          ref="submitButton"
          :aria-busy="submitting ? 'true' : undefined"
          color="primary"
          :disabled="!workflowReady || submitting || !branchSelectionReady"
          variant="flat"
          @click="submit"
        >
          {{ submitting ? "Creating session…" : chooseBranch && createBranch ? "Create branch & session" : "Create session" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { mdiClose } from "@mdi/js";
import Vibe64WorkflowSelector from "./Vibe64WorkflowSelector.vue";
const props = defineProps({ modelValue: Boolean, toolbar: { type: Object, default: () => ({}) } });
const emit = defineEmits(["created", "update:model-value"]);
const workflowEngineId = ref("");
const workflowReady = ref(false);
const submitButton = ref(null);
const submitting = computed(() => props.toolbar.createSessionRunning === true);
const chooseBranch = ref(false);
const createBranch = ref(false);
const branchName = ref("");
const newBranchName = ref("");
const branchProject = computed(() => props.toolbar.projectContext || {});
const branchSelectionAvailable = computed(() => !props.toolbar.repositoryBranchSelectionDisabled &&
  ["github", "managed_git"].includes(branchProject.value.repositoryMode || branchProject.value.repository?.mode));
const branchRepository = computed(() => branchProject.value.githubRepository?.fullName ||
  branchProject.value.repository?.github?.fullName || branchProject.value.slug);
const branchPath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/repository/branches", branchProject.value.slug));
const branches = useEndpointResource({
  path: branchPath, queryKey: computed(() => ["vibe64.branches", branchPath.value]),
  enabled: computed(() => props.modelValue && branchSelectionAvailable.value && chooseBranch.value),
  queryOptions: { retry: false }, fallbackLoadError: "Repository branches could not load."
});
const selectedBranch = computed(() => branches.data.value?.branches?.find((item) => item.name === branchName.value));
const branchSelectionReady = computed(() => !chooseBranch.value || (selectedBranch.value &&
  !branches.isLoading.value && !branches.loadError.value && (!createBranch.value || newBranchName.value.trim())));
watch(() => branches.data.value, (value) => {
  if (!value?.branches?.some((item) => item.name === branchName.value)) branchName.value = value?.defaultBranch || "";
}, { immediate: true });

function close() {
  if (!submitting.value) emit("update:model-value", false);
}
async function submit() {
  if (!workflowReady.value || !workflowEngineId.value || submitting.value || !branchSelectionReady.value) return;
  let response;
  try {
    const options = { workflowEngineId: workflowEngineId.value };
    if (chooseBranch.value) {
      options.repositoryBranch = {
        name: createBranch.value ? newBranchName.value.trim() : branchName.value,
        ...(createBranch.value ? { fromBranch: branchName.value } : {}),
        expectedCommit: selectedBranch.value.commit
      };
    }
    response = await props.toolbar.createSession?.({}, options);
  } catch {
    return;
  }
  if (response?.ok !== false && response?.sessionId) {
    emit("created", response);
    emit("update:model-value", false);
  }
}
watch(() => props.modelValue, (open) => {
  if (!open) return;
  chooseBranch.value = false;
  createBranch.value = false;
  newBranchName.value = "";
}, { immediate: true });
watch(submitting, async (running, wasRunning) => {
  if (running || !wasRunning || !props.modelValue) return;
  await nextTick();
  const target = submitButton.value?.$el || submitButton.value;
  if (target?.isConnected === true && typeof target.focus === "function") target.focus({ preventScroll: true });
});
</script>

<style scoped>
.vibe64-assistant-dialog {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
}

.vibe64-assistant-dialog__title {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
}

.vibe64-assistant-dialog__title-copy {
  display: grid;
  gap: 0.15rem;
}

.vibe64-assistant-dialog__title-copy small {
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.vibe64-assistant-dialog__body {
  padding: 0.25rem 1.25rem 1rem !important;
}

.vibe64-assistant-dialog__actions {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.14);
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem;
}

@media (max-width: 600px) {
  .vibe64-assistant-dialog__body,
  .vibe64-assistant-dialog__actions,
  .vibe64-assistant-dialog__title {
    padding-inline: 1rem !important;
  }

}
</style>
