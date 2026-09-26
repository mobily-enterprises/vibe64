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
          <small class="text-body-small">Start with Senior. Choose Junior, Intern or Auto from chat.</small>
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
          <v-select
            v-model="branchMode"
            :items="branchChoices"
            label="Work on"
            :disabled="submitting"
            hide-details
            class="mt-4"
          />
          <div v-if="chooseBranch" class="d-flex flex-column ga-3 mt-3">
            <v-text-field
              v-if="createBranch"
              v-model="newBranchName"
              label="New branch name"
              placeholder="e.g. improve-booking"
              maxlength="255"
              :disabled="submitting"
              :error-messages="newBranchName.trim() && branchAlreadyExists ? 'That branch already exists. Choose an existing branch instead.' : []"
              hide-details="auto"
            />
            <v-skeleton-loader v-if="branches.isLoading.value" type="list-item-two-line, paragraph" />
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
                :label="createBranch ? 'Create from' : 'Branch'"
                :disabled="submitting"
                hide-details
              />
              <p v-if="selectedBranch" class="text-body-small" style="overflow-wrap: anywhere">
                {{ createBranch ? 'Creates the branch and opens a new session.' : 'Opens a new session on this branch.' }}
                Your changes will be saved to {{ branchRepository }}:{{ createBranch ? newBranchName.trim() || 'your new branch' : branchName }}.
              </p>
              <p class="text-body-small">App publishing still uses the project branch.</p>
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
const branchMode = ref("project");
const chooseBranch = computed(() => branchMode.value !== "project");
const createBranch = computed(() => branchMode.value === "new");
const branchName = ref("");
const newBranchName = ref("");
const branchProject = computed(() => props.toolbar.projectContext || {});
const branchSelectionAvailable = computed(() => !props.toolbar.repositoryBranchSelectionDisabled &&
  ["github", "managed_git"].includes(branchProject.value.repositoryMode || branchProject.value.repository?.mode));
const branchChoices = computed(() => [
  { title: `Project branch (${branchProject.value.repository?.defaultBranch || 'main'})`, value: "project" },
  { title: "Create a new branch", value: "new" },
  { title: "Use an existing branch", value: "existing" }
]);
const branchRepository = computed(() => branchProject.value.githubRepository?.fullName ||
  branchProject.value.repository?.github?.fullName || branchProject.value.slug);
const branchPath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/repository/branches", branchProject.value.slug));
const branches = useEndpointResource({
  path: branchPath,
  queryKey: computed(() => ["vibe64.branches", branchPath.value]),
  enabled: computed(() => props.modelValue && branchSelectionAvailable.value && chooseBranch.value),
  queryOptions: { retry: false },
  fallbackLoadError: "Repository branches could not load."
});
const selectedBranch = computed(() => branches.data.value?.branches?.find((item) => item.name === branchName.value));
const branchAlreadyExists = computed(() => branches.data.value?.branches?.some((item) => item.name === newBranchName.value.trim()));
const branchSelectionReady = computed(() => {
  if (!chooseBranch.value) return true;
  if (!selectedBranch.value || branches.isLoading.value || branches.loadError.value) return false;
  return !createBranch.value || (Boolean(newBranchName.value.trim()) && !branchAlreadyExists.value);
});
watch(() => branches.data.value, (value) => {
  if (!value?.branches?.some((item) => item.name === branchName.value)) {
    branchName.value = value?.defaultBranch || "";
  }
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
  branchMode.value = "project";
  branchName.value = branches.data.value?.defaultBranch || "";
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
  white-space: normal;
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
