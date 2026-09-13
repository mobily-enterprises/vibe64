<template>
  <section
    class="vibe64-repository-workspace"
    :class="{ 'vibe64-repository-workspace--changes': view === 'changes' }"
  >
    <header class="vibe64-repository-workspace__header">
      <div>
        <h1 class="text-headline-small font-weight-bold ma-0">{{ pageTitle }}</h1>
      </div>
      <div class="vibe64-repository-workspace__actions">
        <v-btn
          :disabled="repositoryOperationBusy"
          :loading="updates.checking"
          :prepend-icon="mdiCloudRefreshOutline"
          size="small"
          type="button"
          variant="tonal"
          @click="checkForUpdates"
        >
          Check for updates
        </v-btn>
        <v-btn
          v-if="view === 'history' && (repositoryStatus?.updateAvailable || updates.canonicalChangePending)"
          :disabled="repositoryOperationBusy"
          :loading="updates.applying"
          :prepend-icon="mdiSourcePull"
          size="small"
          type="button"
          variant="tonal"
          @click="applyUpdates"
        >
          Update this session (rebase)
        </v-btn>
      </div>
    </header>
    <section class="vibe64-repository-workspace__changes-area">
      <v-sheet
        v-if="view === 'history'"
        aria-live="polite"
        border
        class="vibe64-repository-workspace__update-status"
        role="status"
        rounded="lg"
      >
        <strong>{{ repositoryUpdateTitle }}</strong>
        <span>{{ repositoryUpdateDetail }}</span>
        <ol
          v-if="repositoryIncomingVersions.length"
          aria-label="Saved versions this session needs"
          class="vibe64-repository-workspace__incoming-versions"
        >
          <li v-for="version in repositoryIncomingVersions" :key="version.commit">
            <v-icon
              aria-hidden="true"
              :icon="version.isMerge ? mdiSourceMerge : mdiSourceCommit"
              size="15"
            />
            <span>{{ version.message || "Saved work" }}</span>
            <code>{{ version.shortCommit }}</code>
          </li>
        </ol>
        <span v-if="repositoryIncomingVersions.length && repositoryIncomingVersionsRemainder > 0">
          And {{ repositoryIncomingVersionsRemainder }} older
          {{ repositoryIncomingVersionsRemainder === 1 ? "update" : "updates" }}.
        </span>
      </v-sheet>

      <v-sheet
        v-if="view === 'changes'"
        border
        class="vibe64-repository-workspace__summary"
        rounded="lg"
      >
        <div class="vibe64-repository-workspace__summary-copy">
          <strong>{{ repositorySummaryTitle }}</strong>
          <span>{{ repositorySummaryDetail }}</span>
        </div>
        <div class="vibe64-repository-workspace__actions">
          <v-btn
            v-if="repositoryStatus?.updateAvailable || updates.canonicalChangePending"
            :disabled="repositoryOperationBusy"
            :loading="updates.applying"
            :prepend-icon="mdiSourcePull"
            size="small"
            type="button"
            variant="tonal"
            @click="applyUpdates"
          >
            Update this session (rebase)
          </v-btn>
          <v-btn
            :color="changes.payload?.unsaved === true ? 'error' : undefined"
            :disabled="saveWorkDisabled"
            :loading="saving"
            :prepend-icon="mdiContentSaveOutline"
            size="small"
            type="button"
            :title="saveWorkTitle"
            variant="tonal"
            @click="saveWork"
          >
            Save work
          </v-btn>
        </div>
      </v-sheet>

      <StudioErrorNotice
        v-if="updates.error"
        compact
        :error="updates.error"
        title="Project updates need attention"
      >
        <template #actions>
          <Vibe64TemporaryAiFixAction
            v-if="canResolveUpdateWithTemporaryAi && typeof dashboard.requestTemporaryAi === 'function'"
            :disabled="resolvingUpdateProblem || dashboard.assistantDirectAllowed === false"
            :pending="resolvingUpdateProblem"
            :title="dashboard.assistantDirectAllowed === false
              ? dashboard.assistantRestrictionMessage
              : 'Open temporary AI to resolve this repository update'"
            @click="resolveUpdateProblem"
          />
        </template>
      </StudioErrorNotice>

      <div class="vibe64-repository-workspace__window">
        <section v-if="view === 'changes'" class="vibe64-repository-workspace__changes">
          <div v-if="!sessionId" class="vibe64-repository-workspace__empty">
            <strong>No session selected</strong>
            <span>Create or select a session to see its current changes.</span>
          </div>
          <StudioErrorNotice
            v-else-if="changes.error"
            compact
            :error="changes.error"
            title="Current changes could not load"
          />
          <v-progress-linear v-else-if="changes.loading" color="primary" indeterminate />
          <Vibe64RepositoryFileBrowser
            v-else-if="changes.payload?.files?.length"
            aria-label="Changed files"
            empty-title="File changes"
            :error="currentDiff.error"
            :files="changes.payload.files"
            list-description="Compared with the project’s saved version"
            :list-title="`${changes.payload.totalCount} changed ${changes.payload.totalCount === 1 ? 'file' : 'files'}`"
            :loading="currentDiff.loading"
            :loading-more="changes.loadingMore"
            :payload="currentDiff.payload"
            :selected-path="selectedCurrentPath"
            :truncated="changes.payload.truncated"
            @load-more="loadChanges({ append: true })"
            @select="selectCurrentFile"
          />
          <div v-else class="vibe64-repository-workspace__empty">
            <strong>No unsaved file changes</strong>
            <span>This session has no file changes waiting to be saved.</span>
          </div>
        </section>

        <section v-else>
          <StudioErrorNotice
            v-if="history.error"
            compact
            :error="history.error"
            title="Version history could not load"
          >
            <template v-if="!history.payload" #actions>
              <v-btn
                :aria-busy="history.loading ? 'true' : undefined"
                :disabled="history.loading"
                size="small"
                type="button"
                variant="tonal"
                @click="loadHistory()"
              >
                {{ history.loading ? "Retrying…" : "Retry history" }}
              </v-btn>
            </template>
          </StudioErrorNotice>
          <v-progress-linear
            v-if="history.loading && !history.payload && !history.error"
            color="primary"
            indeterminate
          />
          <div v-else-if="history.versions.length" class="vibe64-repository-workspace__history">
            <div class="vibe64-repository-workspace__history-intro">
              <div class="vibe64-repository-workspace__history-heading">
                <span aria-hidden="true" class="vibe64-repository-workspace__history-icon">
                  <v-icon :icon="mdiSourceCommit" size="18" />
                </span>
                <div>
                  <strong>Saved versions</strong>
                  <span>Newest first. Open a version to review its files.</span>
                </div>
              </div>
              <v-chip label size="x-small" variant="tonal">
                {{ history.versions.length }} loaded
              </v-chip>
            </div>
            <ol class="vibe64-repository-workspace__versions" aria-label="Saved versions">
              <li
                v-for="(version, index) in history.versions"
                :key="version.commit"
                class="vibe64-repository-workspace__history-item"
              >
                <span
                  aria-hidden="true"
                  class="vibe64-repository-workspace__commit-marker"
                  :class="{
                    'vibe64-repository-workspace__commit-marker--first': index === 0,
                    'vibe64-repository-workspace__commit-marker--last': index === history.versions.length - 1
                  }"
                >
                  <span
                    class="vibe64-repository-workspace__commit-node"
                    :class="{ 'vibe64-repository-workspace__commit-node--latest': index === 0 }"
                  >
                    <v-icon :icon="version.isMerge ? mdiSourceMerge : mdiSourceCommit" size="15" />
                  </span>
                </span>
                <button
                  :aria-current="versionSheetOpen && selectedVersion?.commit === version.commit ? 'true' : undefined"
                  :aria-label="versionButtonLabel(version, index)"
                  class="vibe64-repository-workspace__version"
                  type="button"
                  @click="openVersion(version)"
                >
                  <span class="vibe64-repository-workspace__version-copy">
                    <span class="vibe64-repository-workspace__version-heading">
                      <strong>{{ version.message || "Saved work" }}</strong>
                      <v-chip v-if="index === 0" color="primary" label size="x-small" variant="tonal">
                        Latest
                      </v-chip>
                      <v-chip v-if="version.isMerge" label size="x-small" variant="outlined">
                        Merge
                      </v-chip>
                    </span>
                    <span class="vibe64-repository-workspace__version-meta">
                      <span>
                        <v-icon :icon="mdiAccountOutline" size="15" />
                        {{ version.author || "Unknown author" }}
                      </span>
                      <span>
                        <v-icon :icon="mdiClockOutline" size="15" />
                        {{ formatVersionDate(version.committedAt) }}
                      </span>
                      <code>{{ version.shortCommit }}</code>
                    </span>
                  </span>
                  <v-icon aria-hidden="true" :icon="mdiChevronRight" size="20" />
                </button>
              </li>
              <li v-if="history.nextCursor" class="vibe64-repository-workspace__load-more">
                <v-btn
                  :loading="history.loading"
                  size="small"
                  type="button"
                  variant="text"
                  @click="loadHistory({ append: true })"
                >
                  Load older versions
                </v-btn>
              </li>
            </ol>
          </div>
          <div v-else-if="!history.error" class="vibe64-repository-workspace__empty">
            <strong>No saved versions yet</strong>
            <span>Versions will appear here after work is saved.</span>
          </div>
        </section>
      </div>
    </section>

    <v-dialog
      :model-value="versionSheetOpen"
      class="vibe64-repository-version-dialog"
      fullscreen
      scrollable
      transition="dialog-bottom-transition"
      @update:model-value="!$event && closeVersion()"
    >
      <v-card class="vibe64-repository-version-dialog__card">
        <v-card-title class="vibe64-repository-version-dialog__header">
          <span aria-hidden="true" class="vibe64-repository-version-dialog__icon">
            <v-icon
              :icon="selectedVersion?.isMerge ? mdiSourceMerge : mdiSourceCommit"
              size="22"
            />
          </span>
          <div class="vibe64-repository-version-dialog__heading">
            <span class="vibe64-repository-version-dialog__eyebrow">
              {{ selectedVersion?.isMerge ? "Merge version" : "Saved version" }}
            </span>
            <h2>{{ selectedVersion?.message || "Saved version" }}</h2>
            <div v-if="selectedVersion" class="vibe64-repository-version-dialog__meta">
              <span>
                <v-icon :icon="mdiAccountOutline" size="16" />
                {{ selectedVersion.author || "Unknown author" }}
              </span>
              <span>
                <v-icon :icon="mdiClockOutline" size="16" />
                {{ formatVersionDate(selectedVersion.committedAt) }}
              </span>
              <code>{{ selectedVersion.shortCommit }}</code>
              <v-chip v-if="versionFiles.payload" label size="x-small" variant="tonal">
                {{ versionFileCountLabel }}
              </v-chip>
            </div>
          </div>
          <v-btn
            aria-label="Close version details"
            :icon="mdiClose"
            size="small"
            type="button"
            variant="text"
            @click="closeVersion"
          />
        </v-card-title>
        <v-divider />
        <v-card-text class="vibe64-repository-version-dialog__body">
          <StudioErrorNotice
            v-if="versionFiles.error"
            class="vibe64-repository-version-dialog__error"
            compact
            :error="versionFiles.error"
            title="Version details could not load"
          >
            <template v-if="!versionFiles.payload" #actions>
              <v-btn
                :aria-busy="versionFiles.loading ? 'true' : undefined"
                :disabled="versionFiles.loading"
                size="small"
                type="button"
                variant="tonal"
                @click="selectVersion(selectedVersion)"
              >
                {{ versionFiles.loading ? "Retrying…" : "Retry files" }}
              </v-btn>
            </template>
          </StudioErrorNotice>
          <v-progress-linear
            v-if="versionFiles.loading && !versionFiles.payload && !versionFiles.error"
            color="primary"
            indeterminate
          />
          <Vibe64RepositoryFileBrowser
            v-if="versionFiles.payload"
            aria-label="Files in this version"
            class="vibe64-repository-version-dialog__files"
            embedded
            :error="versionDiff.error"
            :files="versionFiles.payload?.files || []"
            :loading="versionDiff.loading"
            :loading-more="versionFiles.loadingMore"
            :payload="versionDiff.payload"
            :selected-path="selectedVersionPath"
            :truncated="versionFiles.payload?.truncated === true"
            @load-more="loadMoreVersionFiles"
            @select="selectVersionFile"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiAccountOutline,
  mdiChevronRight,
  mdiClockOutline,
  mdiClose,
  mdiCloudRefreshOutline,
  mdiContentSaveOutline,
  mdiSourceCommit,
  mdiSourceMerge,
  mdiSourcePull
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";
import Vibe64RepositoryFileBrowser from "@/components/studio/repository/Vibe64RepositoryFileBrowser.vue";
import { useVibe64RepositoryWorkspace } from "@/composables/useVibe64RepositoryWorkspace.js";
import { repositoryUpdateRelationship } from "@local/vibe64-core/shared";

const props = defineProps({
  dashboardContext: { default: () => ({}), type: Object },
  view: {
    default: "changes",
    type: String,
    validator: (value) => ["changes", "history"].includes(value)
  }
});
const dashboard = computed(() => props.dashboardContext || {});
const view = computed(() => props.view === "history" ? "history" : "changes");
const versionSheetOpen = ref(false);
const {
  applyUpdates,
  changes,
  checkForUpdates,
  currentDiff,
  history,
  loadHistory,
  loadChanges,
  loadMoreVersionFiles,
  saveWork,
  saving,
  selectCurrentFile,
  selectedCurrentPath,
  selectedVersion,
  selectedVersionPath,
  selectVersion,
  selectVersionFile,
  sessionId,
  sourceOperationsSuspended,
  updates,
  versionDiff,
  versionFiles
} = useVibe64RepositoryWorkspace(dashboard, { view });

const versionFileCountLabel = computed(() => {
  const count = Number(versionFiles.payload?.totalCount || 0);
  return `${count} changed ${count === 1 ? "file" : "files"}`;
});

const pageTitle = computed(() => view.value === "history" ? "Repository" : "Current changes");
const repositoryStatus = computed(() => updates.payload || changes.payload || null);
const repositoryOperationBusy = computed(() => Boolean(
  !sessionId.value ||
  sourceOperationsSuspended.value ||
  updates.checking ||
  updates.applying ||
  saving.value
));
const saveWorkDisabled = computed(() => Boolean(
  repositoryOperationBusy.value ||
  dashboard.value.assistantDirectAllowed === false ||
  updates.canonicalChangePending ||
  updates.error ||
  !updates.payload ||
  repositoryStatus.value?.updateAvailable === true ||
  changes.error ||
  changes.loading ||
  changes.payload?.unsaved !== true ||
  typeof dashboard.value.requestSaveWork !== "function"
));
const saveWorkTitle = computed(() => {
  if (dashboard.value.assistantDirectAllowed === false) {
    return dashboard.value.assistantRestrictionMessage;
  }
  if (sourceOperationsSuspended.value) {
    return "Session renewal is safely using this session’s source";
  }
  if (updates.applying || saving.value) {
    return "Wait for the current repository operation to finish";
  }
  if (updates.checking || updates.canonicalChangePending) {
    return "Checking the latest saved project version";
  }
  if (updates.error || !updates.payload || changes.error) {
    return "Repository status is unavailable; check for updates before saving";
  }
  if (repositoryStatus.value?.updateAvailable === true) {
    return "Update this session (rebase) before saving";
  }
  if (changes.loading) {
    return "Checking whether this session has work to save";
  }
  if (changes.payload?.unsaved !== true) {
    return "No work to save";
  }
  return "Save this session's work to the project repository";
});

const repositorySummaryTitle = computed(() => {
  if (!sessionId.value) {
    return "Project versions";
  }
  if (changes.loading) {
    return "Checking this session…";
  }
  if (updates.checking || updates.canonicalChangePending) {
    return "Checking the latest saved project version…";
  }
  if (updates.error || !updates.payload) {
    return "Saved project status unavailable";
  }
  if (changes.error || !changes.payload) {
    return "Save status unavailable";
  }
  return changes.payload?.unsaved ? "This session has unsaved work" : "This session is saved";
});
const repositorySummaryDetail = computed(() => {
  if (!sessionId.value) {
    return "Select a session to see its work. Saved project history remains available.";
  }
  if (changes.loading) {
    return "Comparing this session with the project’s saved version.";
  }
  if (updates.checking || updates.canonicalChangePending) {
    return "Save will be available after the latest project version has been checked.";
  }
  if (updates.error || !updates.payload) {
    return "Save is unavailable until Vibe64 can safely compare this session with the saved project.";
  }
  if (changes.error || !changes.payload) {
    return "Check for updates to compare this session with the project’s saved version.";
  }
  const count = Number(changes.payload?.totalCount || 0);
  const behind = Number(repositoryStatus.value?.behind || 0);
  if (behind > 0) {
    if (changes.payload?.unsaved === true) {
      return `${behind} newer saved ${behind === 1 ? "version is" : "versions are"} available. Update this session (rebase) will preserve its unsaved work.`;
    }
    return `${behind} newer saved ${behind === 1 ? "version is" : "versions are"} available. Update this session (rebase) to use ${behind === 1 ? "it" : "them"}.`;
  }
  if (count > 0) {
    return `${count} ${count === 1 ? "file differs" : "files differ"} from the project’s saved version.`;
  }
  return "No files differ from the project’s saved version.";
});
const repositoryUpdateTitle = computed(() => {
  if (!sessionId.value) {
    return "No session selected";
  }
  if (updates.checking) {
    return "Checking for updates…";
  }
  if (updates.error) {
    return "Update status unavailable";
  }
  if (history.loading && !history.payload) {
    return "Loading update status…";
  }
  if (!repositoryStatus.value) {
    return "Updates have not been checked";
  }
  const relationship = repositoryUpdateRelationship(
    repositoryStatus.value.ahead,
    repositoryStatus.value.behind
  );
  const ahead = Number(repositoryStatus.value.ahead || 0);
  const behind = Number(repositoryStatus.value.behind || 0);
  if (relationship === "diverged") {
    return "This session and the saved project have both changed";
  }
  if (behind > 0) {
    return `${behind} ${behind === 1 ? "update" : "updates"} available`;
  }
  if (relationship === "ahead" && ahead > 0) {
    return "This session has work not in the saved project";
  }
  return "This session is up to date";
});
const repositoryIncomingVersions = computed(() => {
  const relationship = repositoryUpdateRelationship(
    repositoryStatus.value?.ahead,
    repositoryStatus.value?.behind
  );
  return relationship === "behind" && Array.isArray(repositoryStatus.value?.incomingVersions)
    ? repositoryStatus.value.incomingVersions
    : [];
});
const repositoryIncomingVersionsRemainder = computed(() => Math.max(
  0,
  Number(repositoryStatus.value?.behind || 0) - repositoryIncomingVersions.value.length
));
const repositoryUpdateDetail = computed(() => {
  if (!sessionId.value) {
    return "Select a session to check it against the project’s saved version.";
  }
  if (updates.checking) {
    return "Reading the latest saved project version.";
  }
  if (updates.error) {
    return "Review the problem below, then try checking again.";
  }
  if (history.loading && !history.payload) {
    return "Reading the last successful update check for this session.";
  }
  if (!repositoryStatus.value) {
    return "Use Check for updates to compare this session with the latest saved project version.";
  }
  const relationship = repositoryUpdateRelationship(
    repositoryStatus.value.ahead,
    repositoryStatus.value.behind
  );
  const ahead = Number(repositoryStatus.value.ahead || 0);
  const behind = Number(repositoryStatus.value.behind || 0);
  const checked = repositoryStatus.value.checkedAt
    ? ` Last checked ${formatVersionDate(repositoryStatus.value.checkedAt)}.`
    : "";
  if (relationship === "diverged") {
    return `Someone saved new project work after this session started, and this session also has its own saved work. Vibe64 cannot simply move it forward. Update this session (rebase) will try to combine both without discarding either. If the same files conflict, nothing changes and Temporary AI can help.${checked}`;
  }
  if (behind > 0) {
    const updateEffect = changes.payload?.unsaved === true
      ? "will replay its unsaved work on the latest saved version before Save is allowed"
      : "will move it to the latest saved version";
    return `This session is ${behind} saved ${behind === 1 ? "version" : "versions"} behind. Update this session (rebase) ${updateEffect}.${checked}`;
  }
  if (relationship === "ahead" && ahead > 0) {
    return `There are no incoming updates. This session contains ${ahead} ${ahead === 1 ? "version" : "versions"} not yet in the saved project.${checked}`;
  }
  return `It already includes the latest saved project version.${checked}`;
});
const canResolveUpdateWithTemporaryAi = computed(() => [
  "vibe64_session_update_conflict",
  "vibe64_session_update_history_diverged"
].includes(String(updates.errorCode || "").trim()));
const resolvingUpdateProblem = ref(false);

function formatVersionDate(value = "") {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(parsed);
}

function versionButtonLabel(version = {}, index = -1) {
  const parts = [
    index === 0 ? "Latest saved version" : "Saved version",
    version.message || "Saved work",
    version.author || "Unknown author",
    formatVersionDate(version.committedAt),
    version.shortCommit
  ];
  if (version.isMerge) {
    parts.splice(1, 0, "merge");
  }
  return parts.filter(Boolean).join(", ");
}

async function resolveUpdateProblem() {
  if (
    resolvingUpdateProblem.value ||
    dashboard.value.assistantDirectAllowed === false ||
    typeof dashboard.value.requestTemporaryAi !== "function"
  ) {
    return false;
  }
  resolvingUpdateProblem.value = true;
  try {
    return await dashboard.value.requestTemporaryAi({
      code: updates.errorCode,
      error: updates.error,
      title: "Resolve repository update"
    });
  } finally {
    resolvingUpdateProblem.value = false;
  }
}

async function openVersion(version) {
  versionSheetOpen.value = true;
  await selectVersion(version);
}

function closeVersion() {
  versionSheetOpen.value = false;
  void selectVersion(null);
}
</script>

<style scoped>
.vibe64-repository-workspace {
  align-content: start;
  display: grid;
  gap: 0.8rem;
  margin-inline: auto;
  max-width: 90rem;
  min-width: 0;
  width: 100%;
}

.vibe64-repository-workspace__changes-area {
  display: grid;
  gap: 0.8rem;
  min-width: 0;
}

.vibe64-repository-workspace__header,
.vibe64-repository-workspace__summary,
.vibe64-repository-workspace__actions {
  align-items: center;
  display: flex;
}

.vibe64-repository-workspace__header {
  gap: 0.75rem;
  justify-content: space-between;
}

.vibe64-repository-workspace__header h1,
.vibe64-repository-workspace__header p {
  letter-spacing: 0;
  margin: 0;
}

.vibe64-repository-workspace__header p,
.vibe64-repository-workspace__summary-copy span,
.vibe64-repository-workspace__history-intro span,
.vibe64-repository-workspace__empty span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
}

.vibe64-repository-workspace__summary {
  gap: 0.8rem;
  justify-content: space-between;
  padding: 0.8rem;
}

.vibe64-repository-workspace__update-status {
  display: grid;
  gap: 0.18rem;
  padding: 0.7rem 0.8rem;
}

.vibe64-repository-workspace__update-status span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
}

.vibe64-repository-workspace__incoming-versions {
  display: grid;
  gap: 0.28rem;
  list-style: none;
  margin: 0.4rem 0 0;
  max-width: 52rem;
  padding: 0;
}

.vibe64-repository-workspace__incoming-versions li {
  align-items: center;
  display: grid;
  gap: 0.45rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
}

.vibe64-repository-workspace__incoming-versions li > span {
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-repository-workspace__incoming-versions code {
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 0.3rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.74rem;
  padding: 0.08rem 0.3rem;
}

.vibe64-repository-workspace__summary-copy,
.vibe64-repository-workspace__empty {
  display: grid;
  gap: 0.18rem;
}

.vibe64-repository-workspace__actions {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-repository-workspace__window {
  min-height: 22rem;
  overflow: visible;
}

.vibe64-repository-workspace__history {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 1rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
}

.vibe64-repository-workspace__history-intro {
  align-items: center;
  background: rgba(var(--v-theme-surface-variant), 0.22);
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.14);
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
}

.vibe64-repository-workspace__history-heading {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  min-width: 0;
}

.vibe64-repository-workspace__history-heading > div {
  display: grid;
  gap: 0.18rem;
  min-width: 0;
}

.vibe64-repository-workspace__history-icon,
.vibe64-repository-version-dialog__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.11);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
}

.vibe64-repository-workspace__history-icon {
  height: 2.1rem;
  width: 2.1rem;
}

.vibe64-repository-workspace__versions {
  list-style: none;
  margin: 0;
  min-width: 0;
  overflow: auto;
  padding: 0;
}

.vibe64-repository-workspace__history-item {
  display: grid;
  grid-template-columns: 3.25rem minmax(0, 1fr);
  min-width: 0;
}

.vibe64-repository-workspace__commit-marker {
  display: flex;
  justify-content: center;
  min-height: 5rem;
  position: relative;
}

.vibe64-repository-workspace__commit-marker::before {
  background: rgba(var(--v-theme-outline), 0.34);
  bottom: 0;
  content: "";
  left: calc(50% - 1px);
  position: absolute;
  top: 0;
  width: 2px;
}

.vibe64-repository-workspace__commit-marker--first::before {
  top: 1.55rem;
}

.vibe64-repository-workspace__commit-marker--last::before {
  bottom: calc(100% - 1.55rem);
}

.vibe64-repository-workspace__commit-node {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 2px solid rgba(var(--v-theme-outline), 0.56);
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex;
  height: 2rem;
  justify-content: center;
  margin-top: 0.55rem;
  position: relative;
  width: 2rem;
  z-index: 1;
}

.vibe64-repository-workspace__commit-node--latest {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 0 0 0.25rem rgba(var(--v-theme-primary), 0.1);
}

.vibe64-repository-workspace__version {
  align-items: center;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.1);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 5rem;
  padding: 0.65rem 1rem 0.65rem 0.15rem;
  text-align: start;
  transition: background-color 120ms ease;
  width: 100%;
}

.vibe64-repository-workspace__version:hover,
.vibe64-repository-workspace__version:focus-visible,
.vibe64-repository-workspace__version[aria-current="true"] {
  background: rgba(var(--v-theme-primary), 0.08);
  outline: none;
}

.vibe64-repository-workspace__version:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.vibe64-repository-workspace__version-copy {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.vibe64-repository-workspace__version-heading {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.vibe64-repository-workspace__version-heading strong {
  font-size: 0.94rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-repository-workspace__version-meta,
.vibe64-repository-version-dialog__meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.56);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.35rem 0.85rem;
}

.vibe64-repository-workspace__version-meta > span,
.vibe64-repository-version-dialog__meta > span {
  align-items: center;
  display: inline-flex;
  gap: 0.25rem;
  min-width: 0;
}

.vibe64-repository-workspace__version-meta code,
.vibe64-repository-version-dialog__meta code {
  background: rgba(var(--v-theme-surface-variant), 0.52);
  border-radius: 0.35rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.73rem;
  padding: 0.1rem 0.35rem;
}

.vibe64-repository-workspace__load-more {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.1);
  padding: 0.55rem 1rem 0.55rem 3.25rem;
}

.vibe64-repository-version-dialog__card {
  border-radius: 0;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
}

.vibe64-repository-version-dialog__header {
  align-items: flex-start;
  background: rgba(var(--v-theme-surface-variant), 0.18);
  display: flex;
  gap: 0.8rem;
  padding: 1rem 1.1rem;
}

.vibe64-repository-version-dialog__icon {
  height: 2.6rem;
  margin-top: 0.1rem;
  width: 2.6rem;
}

.vibe64-repository-version-dialog__heading {
  display: grid;
  flex: 1 1 auto;
  gap: 0.3rem;
  min-width: 0;
}

.vibe64-repository-version-dialog__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.vibe64-repository-version-dialog__heading h2 {
  font-size: 1.08rem;
  line-height: 1.35;
  margin: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.vibe64-repository-version-dialog__meta {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.vibe64-repository-version-dialog__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.vibe64-repository-version-dialog__error {
  flex: 0 0 auto;
  max-height: 50%;
  overflow: auto;
}

.vibe64-repository-version-dialog__body > .vibe64-repository-version-dialog__files {
  flex: 1 1 0;
  height: auto;
  min-height: 0;
}

:global(.vibe64-repository-version-dialog .v-overlay__content) {
  height: 100dvh;
  margin: 0;
  max-height: 100dvh;
  max-width: none;
  width: 100vw;
}

.vibe64-repository-workspace__empty {
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 0.75rem;
  padding: 1rem;
}

@media (min-width: 781px) {
  .vibe64-repository-workspace--changes {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }

  .vibe64-repository-workspace--changes .vibe64-repository-workspace__changes-area {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }

  .vibe64-repository-workspace--changes .vibe64-repository-workspace__changes-area > :not(.vibe64-repository-workspace__window) {
    flex: 0 0 auto;
  }

  .vibe64-repository-workspace--changes .vibe64-repository-workspace__window {
    display: grid;
    flex: 1 1 0;
    grid-template-rows: minmax(0, 1fr);
    /* Keep the review pane usable when notices fill a short browser window. */
    min-height: 12rem;
  }

  .vibe64-repository-workspace__changes {
    align-items: start;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    overflow: auto;
  }
}

@media (max-width: 780px) {
  .vibe64-repository-workspace__version {
    grid-template-columns: minmax(0, 1fr) 1.1rem;
  }

  .vibe64-repository-workspace__version code {
    display: none;
  }

  .vibe64-repository-workspace__summary {
    align-items: stretch;
    flex-direction: column;
  }
}

</style>
