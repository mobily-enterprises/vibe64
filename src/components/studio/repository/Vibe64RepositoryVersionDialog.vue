<template>
  <v-dialog
    :model-value="open"
    class="vibe64-repository-version-dialog"
    fullscreen
    scrollable
    transition="dialog-bottom-transition"
    @update:model-value="!$event && emit('close')"
  >
    <v-card class="vibe64-repository-version-dialog__card">
      <v-card-title class="vibe64-repository-version-dialog__header">
        <span aria-hidden="true" class="vibe64-repository-version-dialog__icon">
          <v-icon
            :icon="selectedVersion?.isMerge ? '$merge' : '$commit'"
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
              <v-icon icon="$person" size="16" />
              {{ selectedVersion.author || "Unknown author" }}
            </span>
            <span>
              <v-icon icon="$schedule" size="16" />
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
          icon="$close"
          size="small"
          type="button"
          variant="text"
          @click="emit('close')"
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
              @click="emit('retry-files')"
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
          @load-more="emit('load-more')"
          @select="emit('select-file', $event)"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
// One saved version full screen: its author, time and commit, its files and the selected file's difference.
import { computed } from "vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64RepositoryFileBrowser from "@/components/studio/repository/Vibe64RepositoryFileBrowser.vue";
import { formatVersionDate } from "@/lib/vibe64RepositoryVersionLabels.js";

const props = defineProps({
  open: { default: false, type: Boolean },
  selectedVersion: { default: null, type: Object },
  selectedVersionPath: { default: "", type: String },
  versionDiff: { required: true, type: Object },
  versionFiles: { required: true, type: Object }
});
const emit = defineEmits(["close", "load-more", "retry-files", "select-file"]);

const versionFileCountLabel = computed(() => {
  const count = Number(props.versionFiles.payload?.totalCount || 0);
  return `${count} changed ${count === 1 ? "file" : "files"}`;
});
</script>

<style scoped>
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
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.11);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  flex: 0 0 auto;
  height: 2.6rem;
  justify-content: center;
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
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.35rem 0.85rem;
}

.vibe64-repository-version-dialog__meta > span {
  align-items: center;
  display: inline-flex;
  gap: 0.25rem;
  min-width: 0;
}

.vibe64-repository-version-dialog__meta code {
  background: rgba(var(--v-theme-surface-variant), 0.52);
  border-radius: 0.35rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.73rem;
  padding: 0.1rem 0.35rem;
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
</style>
