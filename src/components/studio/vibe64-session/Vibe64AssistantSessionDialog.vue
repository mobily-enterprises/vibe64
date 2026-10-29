<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="submitting"
    max-width="38rem"
    scrollable
    @update:model-value="!$event && close()"
  >
    <v-card class="vibe64-assistant-dialog" rounded="xl">
      <v-card-title class="vibe64-assistant-dialog__title">
        <span class="vibe64-assistant-dialog__title-copy">
          <strong class="text-title-large">Start an AI session</strong>
          <small class="text-body-small">Start with Senior. Choose Junior or Auto from chat.</small>
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
        <v-skeleton-loader v-if="routing.resource.isInitialLoading.value" type="list-item-two-line" />
        <v-alert v-else-if="routing.loadError.value" type="error" variant="tonal">
          {{ routing.loadError.value }}
          <v-btn variant="text" @click="routing.resource.reload()">Try again</v-btn>
        </v-alert>
        <p v-else-if="mainSelection" class="text-body-medium mb-0">
          Runs on your main AI: {{ vibe64AssistantSelectionLabel(mainSelection) }}
          <v-btn variant="text" size="small" @click="openConnectionSettings">Change</v-btn>
        </p>
        <div v-else class="d-flex flex-column ga-2">
          <strong>No AI is set up yet</strong>
          <span class="text-body-small">Set up your AI, then come back to start a session.</span>
          <v-btn color="primary" variant="flat" class="align-self-start" @click="setUpAi">Set up your AI</v-btn>
        </div>
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
              <p class="text-body-small">Deploying the app still uses the project branch.</p>
            </template>
          </div>
        </template>
      </v-card-text>

      <div v-if="submitting" class="vibe64-assistant-dialog__progress" role="status" aria-live="polite">
        <v-progress-linear indeterminate color="primary" rounded />
        <p class="text-body-small mb-0">
          Copying the project source for the new session. This can take a little while for a large project.
          Any connected projects and workspace setup then continue in the session, which shows their progress.
        </p>
      </div>

      <v-card-actions class="vibe64-assistant-dialog__actions">
        <v-btn :disabled="submitting" variant="text" @click="close">Cancel</v-btn>
        <v-btn
          ref="submitButton"
          :aria-busy="submitting ? 'true' : undefined"
          color="primary"
          :disabled="!mainSelection || submitting || !branchSelectionReady"
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
import { VIBE64_SESSIONS_API_SUFFIX, vibe64RepositoryApiPath } from "@/lib/vibe64SessionRequestConfig.js";
import { mdiClose } from "@mdi/js";
import { requestVibe64AiOnboarding, useModelRouting } from "@local/vibe64-accounts/client";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
const props = defineProps({ modelValue: Boolean, toolbar: { type: Object, default: () => ({}) } });
const emit = defineEmits(["created", "update:model-value"]);
// Main chat starts on the owner's Senior from AI setup.
const routing = useModelRouting({ enabled: computed(() => props.modelValue), view: "main" });
const mainSelection = routing.mainChatSelection;
const openConnectionSettings = () => requestVibe64AccountConnectionsDialog({ section: "ai" });
// The guided setup also explains installing an AI tool; it closes this dialog first.
function setUpAi() {
  close();
  requestVibe64AiOnboarding();
}
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
const branchPath = computed(() => scopedDevelopmentApiUrl(
  `${vibe64RepositoryApiPath(`/api${VIBE64_SESSIONS_API_SUFFIX}`)}/branches`, branchProject.value.slug));
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
  if (!mainSelection.value || submitting.value || !branchSelectionReady.value) return;
  let response;
  try {
    const options = {};
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
.vibe64-assistant-dialog__progress {
  display: grid;
  gap: 0.5rem;
  padding: 0 1.5rem 0.5rem;
}

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
