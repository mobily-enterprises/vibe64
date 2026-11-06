<template>
  <div class="vibe64-repository-workspace__history">
    <div class="vibe64-repository-workspace__history-intro">
      <div class="vibe64-repository-workspace__history-heading">
        <span aria-hidden="true" class="vibe64-repository-workspace__history-icon">
          <v-icon icon="$commit" size="18" />
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
            <v-icon :icon="version.isMerge ? '$merge' : '$commit'" size="15" />
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
                <v-icon icon="$person" size="15" />
                {{ version.author || "Unknown author" }}
              </span>
              <span>
                <v-icon icon="$schedule" size="15" />
                {{ formatVersionDate(version.committedAt) }}
              </span>
              <code>{{ version.shortCommit }}</code>
            </span>
          </span>
          <v-icon aria-hidden="true" icon="$chevronRight" size="20" />
        </button>
      </li>
      <li v-if="history.nextCursor" class="vibe64-repository-workspace__load-more">
        <v-btn
          :loading="history.loading"
          size="small"
          type="button"
          variant="text"
          @click="emit('load-more')"
        >
          Load older versions
        </v-btn>
      </li>
    </ol>
  </div>
</template>

<script setup>
// The project's saved versions as a Git log, newest first. Opening a version is left to the workspace.
import {
  formatVersionDate,
  versionButtonLabel
} from "@/lib/vibe64RepositoryVersionLabels.js";

defineProps({
  history: { required: true, type: Object },
  selectedVersion: { default: null, type: Object },
  versionSheetOpen: { default: false, type: Boolean }
});
const emit = defineEmits(["load-more", "open-version"]);

function openVersion(version) {
  emit("open-version", version);
}
</script>

<style scoped>
.vibe64-repository-workspace__history {
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
}

.vibe64-repository-workspace__history-intro {
  align-items: center;
  background: rgb(var(--v-theme-surface-container-low));
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
}

.vibe64-repository-workspace__history-intro span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
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

.vibe64-repository-workspace__history-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.11);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  flex: 0 0 auto;
  height: 2.1rem;
  justify-content: center;
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
  background: rgb(var(--v-theme-outline-variant));
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
  border: 2px solid rgb(var(--v-theme-outline));
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
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
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

.vibe64-repository-workspace__version-meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.56);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.35rem 0.85rem;
}

.vibe64-repository-workspace__version-meta > span {
  align-items: center;
  display: inline-flex;
  gap: 0.25rem;
  min-width: 0;
}

.vibe64-repository-workspace__version-meta code {
  background: rgba(var(--v-theme-surface-variant), 0.52);
  border-radius: 0.35rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.73rem;
  padding: 0.1rem 0.35rem;
}

.vibe64-repository-workspace__load-more {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  padding: 0.55rem 1rem 0.55rem 3.25rem;
}

@media (max-width: 780px) {
  .vibe64-repository-workspace__version {
    grid-template-columns: minmax(0, 1fr) 1.1rem;
  }

  .vibe64-repository-workspace__version code {
    display: none;
  }
}
</style>
