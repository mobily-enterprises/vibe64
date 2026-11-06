<template>
  <section
    class="vibe64-repository-workspace"
    :class="{ 'vibe64-repository-workspace--changes': view === 'changes' }"
  >
    <Vibe64DashboardPageHeader
      :description="pageDescription"
      :icon="view === 'history' ? '$book' : '$difference'"
      :title="pageTitle"
    >
      <template #actions>
        <div class="vibe64-repository-workspace__actions">
          <v-btn
            :disabled="repositoryOperationBusy"
            :loading="updates.checking"
            prepend-icon="$cloudSync"
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
            prepend-icon="$syncAlt"
            size="small"
            type="button"
            variant="tonal"
            @click="applyUpdates"
          >
            {{ updates.payload?.historyReview ? "Review and reconcile session" : sessionUpdateLabel }}
          </v-btn>
        </div>
      </template>
    </Vibe64DashboardPageHeader>
    <v-dialog :model-value="Boolean(historyReview)" max-width="620" @update:model-value="!$event && (historyReview = null)">
      <v-card v-if="historyReview">
        <v-card-title>Reconcile after rewritten project history</v-card-title>
        <v-card-text>
          <p>The project’s Git history changed outside this session. Apply this session’s retained changes to the current project version.</p>
          <p>Your conversation stays in this session. A checkpoint preserves the current files. Conflicts stop the update before it changes your working files.</p>
          <p>Previous baseline: <code>{{ historyReview.baseCommit.slice(0, 8) }}</code> · New baseline: <code>{{ historyReview.canonicalCommit.slice(0, 8) }}</code></p>
          <p class="mt-3">Session changes to reconcile (up to 100 files):</p>
          <ul class="pl-5"><li v-for="path in historyReview.changedPaths" :key="path" class="text-break">{{ path }}</li></ul>
          <p v-if="!historyReview.changedPaths?.length">No session file changes. The session will move to the new project version.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="historyReview = null">Cancel</v-btn>
          <v-btn @click="reconcileHistory">Reconcile session</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
              :icon="version.isMerge ? '$merge' : '$commit'"
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
            prepend-icon="$syncAlt"
            size="small"
            type="button"
            variant="tonal"
            @click="applyUpdates"
          >
            {{ updates.payload?.historyReview ? "Review and reconcile session" : sessionUpdateLabel }}
          </v-btn>
          <v-btn
            :color="changes.payload?.unsaved === true ? 'error' : undefined"
            :disabled="saveWorkBlocked"
            :loading="saving"
            prepend-icon="$commit"
            size="small"
            type="button"
            :title="saveWorkTitle"
            variant="tonal"
            @click="saveWork"
          >
            Review changes
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
          <Vibe64AiTaskButton
            v-if="canResolveUpdateWithAi"
            :allowed="dashboard.assistantFixAllowed !== false"
            :input="{}"
            kind="update"
            :title="dashboard.assistantFixAllowed === false
              ? dashboard.assistantFixRestrictionMessage
              : 'Fix this Update with the AI'"
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
          <Vibe64RepositoryHistoryList
            v-else-if="history.versions.length"
            :history="history"
            :selected-version="selectedVersion"
            :version-sheet-open="versionSheetOpen"
            @load-more="loadHistory({ append: true })"
            @open-version="openVersion"
          />
          <div v-else-if="!history.error" class="vibe64-repository-workspace__empty">
            <strong>No saved versions yet</strong>
            <span>Versions will appear here after work is saved.</span>
          </div>
        </section>
      </div>
    </section>

    <Vibe64RepositoryVersionDialog
      :open="versionSheetOpen"
      :selected-version="selectedVersion"
      :selected-version-path="selectedVersionPath"
      :version-diff="versionDiff"
      :version-files="versionFiles"
      @close="closeVersion"
      @load-more="loadMoreVersionFiles"
      @retry-files="selectVersion(selectedVersion)"
      @select-file="selectVersionFile"
    />
  </section>
</template>

<script setup>
// A session's current changes or the project's saved versions, with checking for, applying and saving updates.
import { computed, ref, watch } from "vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
import { Vibe64AiTaskButton } from "@local/vibe64-ai-tasks/client";
import Vibe64RepositoryFileBrowser from "@/components/studio/repository/Vibe64RepositoryFileBrowser.vue";
import Vibe64RepositoryHistoryList from "@/components/studio/repository/Vibe64RepositoryHistoryList.vue";
import Vibe64RepositoryVersionDialog from "@/components/studio/repository/Vibe64RepositoryVersionDialog.vue";
import { useVibe64RepositoryWorkspace } from "@/composables/useVibe64RepositoryWorkspace.js";
import {
  incomingVersions,
  summaryDetail,
  summaryTitle,
  updateDetail,
  updateTitle
} from "@/lib/vibe64RepositoryStatusText.js";

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
const historyReview = ref(null);
const versionSheetOpen = ref(false);
const {
  applyUpdates: applyReviewedUpdates,
  changes,
  checkForUpdates,
  currentDiff,
  history,
  loadHistory,
  loadChanges,
  loadMoreVersionFiles,
  saveWork,
  saveWorkBlocked,
  saveWorkBlockedReason,
  saving,
  selectCurrentFile,
  selectedCurrentPath,
  selectedVersion,
  selectedVersionPath,
  selectVersion,
  selectVersionFile,
  sessionId,
  sessionUpdateLabel,
  sourceOperationsSuspended,
  updates,
  versionDiff,
  versionFiles
} = useVibe64RepositoryWorkspace(dashboard, { view });
watch([sessionId, view, () => dashboard.value.active], () => {
  historyReview.value = null;
}, { flush: "sync" });

function applyUpdates() {
  if (updates.payload?.historyReview) {
    historyReview.value = JSON.parse(JSON.stringify(updates.payload.historyReview));
    return;
  }
  return applyReviewedUpdates();
}
async function reconcileHistory() {
  const review = historyReview.value;
  historyReview.value = null;
  return applyReviewedUpdates({ historyReview: review });
}

const pageTitle = computed(() => view.value === "history" ? "Git log" : "Current changes");
const pageDescription = computed(() => view.value === "history"
  ? "The project's saved versions and their file differences."
  : "Files this session changed since the project's saved version.");
const repositoryStatus = computed(() => updates.payload || changes.payload || null);
const repositoryOperationBusy = computed(() => Boolean(
  !sessionId.value ||
  sourceOperationsSuspended.value ||
  updates.checking ||
  updates.applying ||
  saving.value
));
const saveWorkTitle = computed(() => saveWorkBlockedReason.value || "Review changes and choose where to commit them");

// What the status texts read.
function statusState() {
  return {
    changes,
    history,
    repositoryStatus: repositoryStatus.value,
    sessionId: sessionId.value,
    sessionUpdateLabel: sessionUpdateLabel.value,
    updates
  };
}
const repositorySummaryTitle = computed(() => summaryTitle(statusState()));
const repositorySummaryDetail = computed(() => summaryDetail(statusState()));
const repositoryUpdateTitle = computed(() => updateTitle(statusState()));
const repositoryIncomingVersions = computed(() => incomingVersions(repositoryStatus.value));
const repositoryIncomingVersionsRemainder = computed(() => Math.max(
  0,
  Number(repositoryStatus.value?.behind || 0) - repositoryIncomingVersions.value.length
));
const repositoryUpdateDetail = computed(() => updateDetail(statusState()));
const canResolveUpdateWithAi = computed(() => [
  "vibe64_session_update_conflict",
  "vibe64_session_update_history_diverged"
].includes(String(updates.errorCode || "").trim()));

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

.vibe64-repository-workspace--changes {
  max-width: none;
}

.vibe64-repository-workspace__changes-area {
  display: grid;
  gap: 0.8rem;
  min-width: 0;
}

.vibe64-repository-workspace__summary,
.vibe64-repository-workspace__actions {
  align-items: center;
  display: flex;
}

.vibe64-repository-workspace__summary-copy span,
.vibe64-repository-workspace__empty span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
}

.vibe64-repository-workspace__summary {
  gap: 0.8rem;
  justify-content: space-between;
  padding: var(--v64-space-4, 16px);
}

.vibe64-repository-workspace__summary,
.vibe64-repository-workspace__update-status {
  background: var(--v64-surface-container-low) !important;
  border-color: var(--v64-outline-variant) !important;
  border-radius: var(--v64-shape-lg, 16px) !important;
}

.vibe64-repository-workspace__update-status {
  display: grid;
  gap: 0.18rem;
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
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

/* M3 empty state: a quiet dashed slot, centred, where content will appear. */
.vibe64-repository-workspace__empty {
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline, rgba(0, 0, 0, 0.24));
  border-radius: var(--v64-shape-lg, 16px);
  justify-items: center;
  padding: var(--v64-space-6, 32px) var(--v64-space-4, 16px);
  text-align: center;
}

.vibe64-repository-workspace__empty strong {
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
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
  .vibe64-repository-workspace__summary {
    align-items: stretch;
    flex-direction: column;
  }
}

</style>
