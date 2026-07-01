<template>
  <div
    ref="diffBodyElement"
    class="studio-ai-session-diff-content"
    @click="handleDiffBodyClick"
  >
    <StudioErrorNotice
      v-if="diff.error"
      title="Diff could not load"
      :error="diff.error"
      compact
      class="mb-3"
    />

    <v-progress-linear
      v-if="diff.loading"
      color="primary"
      indeterminate
      class="mb-3"
    />

    <pre
      v-if="diff.payload?.gitStatus"
      class="studio-ai-session-diff-content__status"
    >{{ diff.payload.gitStatus }}</pre>

    <v-alert
      v-if="diffTruncated"
      class="studio-ai-session-diff-content__truncation"
      density="compact"
      type="warning"
      variant="tonal"
    >
      <div class="studio-ai-session-diff-content__truncation-body">
        <span>{{ diffTruncationText }}</span>
        <v-btn
          :disabled="diff.loading"
          :loading="diff.loading"
          size="small"
          type="button"
          variant="tonal"
          @click="loadFullDiff"
        >
          Load full diff
        </v-btn>
      </div>
    </v-alert>

    <div
      v-if="diffSections.length"
      class="studio-ai-session-diff-content__browser"
    >
      <aside class="studio-ai-session-diff-content__files">
        <div class="studio-ai-session-diff-content__files-header">
          <strong>{{ diffSummaryText }}</strong>
          <input
            v-model="diffFilter"
            aria-label="Filter diff files"
            class="studio-ai-session-diff-content__filter"
            placeholder="Filter files"
            type="search"
          >
        </div>

        <div
          v-if="visibleDiffSections.length"
          class="studio-ai-session-diff-content__file-list"
          role="listbox"
        >
          <button
            v-for="section in visibleDiffSections"
            :key="section.id"
            :aria-selected="section.id === selectedSection?.id"
            class="studio-ai-session-diff-content__file-button"
            :class="{ 'studio-ai-session-diff-content__file-button--selected': section.id === selectedSection?.id }"
            type="button"
            @click="selectDiffSection(section)"
          >
            <span class="studio-ai-session-diff-content__file-path">{{ section.path }}</span>
            <span class="studio-ai-session-diff-content__file-meta">
              <span>{{ section.stageLabel }}</span>
              <span>{{ diffSectionStatusLabel(section.status) }}</span>
              <span class="studio-ai-session-diff-content__file-counts">
                +{{ section.added }} -{{ section.removed }}
              </span>
            </span>
          </button>
        </div>

        <v-alert
          v-else
          density="compact"
          type="info"
          variant="tonal"
        >
          No matching files.
        </v-alert>
      </aside>

      <section
        v-if="selectedSection"
        class="studio-ai-session-diff-content__file"
      >
        <header class="studio-ai-session-diff-content__file-header">
          <div class="studio-ai-session-diff-content__file-title">
            <strong>{{ selectedSection.path }}</strong>
            <span>{{ selectedSection.stageLabel }} / {{ diffSectionStatusLabel(selectedSection.status) }}</span>
          </div>
          <div class="studio-ai-session-diff-content__file-stats">
            <span>+{{ selectedSection.added }}</span>
            <span>-{{ selectedSection.removed }}</span>
          </div>
        </header>

        <v-alert
          v-if="selectedSectionRenderBlocked"
          type="info"
          variant="tonal"
        >
          <div class="studio-ai-session-diff-content__large-file">
            <span>
              Large file diff paused: {{ selectedSection.lineCount }} lines.
            </span>
            <v-btn
              size="small"
              variant="tonal"
              @click="renderSelectedLargeDiff"
            >
              Render file diff
            </v-btn>
          </div>
        </v-alert>

        <!-- eslint-disable vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
        <div
          v-else-if="selectedRenderedDiff"
          class="studio-ai-session-diff-content__rendered"
          v-html="selectedRenderedDiff"
        />
        <!-- eslint-enable vue/no-v-html -->
      </section>
    </div>

    <v-alert
      v-else-if="!diff.loading && !diff.error"
      type="info"
      variant="tonal"
    >
      No diff is available for this session clone.
    </v-alert>
  </div>
</template>

<script setup>
import {
  computed,
  ref,
  watch
} from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  diffSectionStatusLabel,
  filterDiffSections,
  sessionDiffSections
} from "@/lib/vibe64SessionDiffView.js";

const props = defineProps({
  diff: {
    default: () => ({}),
    type: Object
  }
});

const diffBodyElement = ref(null);
const diffFilter = ref("");
const selectedSectionId = ref("");
const renderedLargeSectionIds = ref(new Set());

const diffSections = computed(() => sessionDiffSections(props.diff.payload || {}));
const diffTruncated = computed(() => props.diff.payload?.diffTruncated === true);
const diffTruncationText = computed(() => {
  const payload = props.diff.payload || {};
  const totalLines = Math.max(0, Number(payload.diffTotalLines || 0));
  const shownLines = Math.max(0, Number(payload.diffShownLines || 0));
  const fileCount = Array.isArray(payload.truncatedFiles) ? payload.truncatedFiles.length : 0;
  const fileText = fileCount === 1 ? "1 file" : `${fileCount} files`;
  if (totalLines > 0 && shownLines > 0) {
    return `Showing ${shownLines} of ${totalLines} diff lines. ${fileText} are truncated; loading the full diff may be slow.`;
  }
  return `This diff is truncated. ${fileText} are truncated; loading the full diff may be slow.`;
});
const visibleDiffSections = computed(() => filterDiffSections(diffSections.value, diffFilter.value));
const selectedSection = computed(() => {
  if (!visibleDiffSections.value.length) {
    return null;
  }
  return visibleDiffSections.value.find((section) => section.id === selectedSectionId.value) ||
    visibleDiffSections.value[0];
});
const diffSummaryText = computed(() => {
  const sectionCount = diffSections.value.length;
  const totals = diffSections.value.reduce((summary, section) => {
    summary.added += section.added;
    summary.removed += section.removed;
    return summary;
  }, {
    added: 0,
    removed: 0
  });
  return `${sectionCount} ${sectionCount === 1 ? "file" : "files"}, +${totals.added} -${totals.removed}`;
});
const selectedSectionRenderBlocked = computed(() => Boolean(
  selectedSection.value?.large &&
  !renderedLargeSectionIds.value.has(selectedSection.value.id)
));
const selectedRenderedDiff = computed(() => {
  const section = selectedSection.value;
  if (!section || selectedSectionRenderBlocked.value) {
    return "";
  }
  return renderDiffHtml(section.diff, {
    drawFileList: false,
    matching: section.large ? "none" : "lines",
    outputFormat: "side-by-side"
  });
});

function selectDiffSection(section = {}) {
  selectedSectionId.value = String(section.id || "");
}

function renderSelectedLargeDiff() {
  const sectionId = selectedSection.value?.id;
  if (!sectionId) {
    return;
  }
  renderedLargeSectionIds.value = new Set([
    ...renderedLargeSectionIds.value,
    sectionId
  ]);
}

async function loadFullDiff() {
  if (typeof props.diff.loadFull === "function") {
    await props.diff.loadFull();
  }
}

function handleDiffBodyClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const link = clickedElement?.closest("a");
  const diffBody = diffBodyElement.value?.$el || diffBodyElement.value;
  if (!link || !diffBody?.contains(link)) {
    return;
  }

  const href = String(link.getAttribute("href") || "");
  if (!href.startsWith("#")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = document.getElementById(href.slice(1));
  if (target && diffBody.contains(target)) {
    target.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }
}

watch(diffSections, (sections = []) => {
  const sectionIds = new Set(sections.map((section) => section.id));
  if (!sectionIds.has(selectedSectionId.value)) {
    selectedSectionId.value = sections[0]?.id || "";
  }
  renderedLargeSectionIds.value = new Set(
    [...renderedLargeSectionIds.value].filter((sectionId) => sectionIds.has(sectionId))
  );
}, {
  immediate: true
});
</script>

<style scoped>
.studio-ai-session-diff-content {
  contain: layout paint;
  min-width: 0;
  overflow-x: hidden;
}

.studio-ai-session-diff-content__status {
  background: rgba(var(--v-theme-surface-variant), 0.55);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.35;
  margin: 0 0 0.75rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-ai-session-diff-content__truncation {
  margin-block-end: 0.7rem;
}

.studio-ai-session-diff-content__truncation-body {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-ai-session-diff-content__browser {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(13rem, 0.32fr) minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}

.studio-ai-session-diff-content__files {
  border: 1px solid rgba(var(--v-border-color), 0.32);
  border-radius: 8px;
  display: grid;
  gap: 0.55rem;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: 68vh;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0.55rem;
}

.studio-ai-session-diff-content__files-header {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-session-diff-content__files-header strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.84rem;
  font-weight: 760;
  letter-spacing: 0;
}

.studio-ai-session-diff-content__filter {
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-border-color), 0.38);
  border-radius: 7px;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.2;
  min-width: 0;
  outline: none;
  padding: 0.48rem 0.55rem;
}

.studio-ai-session-diff-content__filter:focus {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.16);
}

.studio-ai-session-diff-content__file-list {
  align-content: start;
  display: grid;
  gap: 0.28rem;
  grid-auto-rows: max-content;
  min-height: 0;
  overflow: auto;
  padding-right: 0.12rem;
}

.studio-ai-session-diff-content__file-button {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.46rem 0.5rem;
  text-align: left;
}

.studio-ai-session-diff-content__file-button:hover,
.studio-ai-session-diff-content__file-button--selected {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.22);
}

.studio-ai-session-diff-content__file-button--selected {
  color: rgb(var(--v-theme-primary));
}

.studio-ai-session-diff-content__file-path {
  font-size: 0.82rem;
  font-weight: 720;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-ai-session-diff-content__file-meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.64);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.72rem;
  gap: 0.32rem;
  line-height: 1.2;
}

.studio-ai-session-diff-content__file-counts {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.studio-ai-session-diff-content__file {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
}

.studio-ai-session-diff-content__file-header {
  align-items: center;
  background: rgba(var(--v-theme-surface-variant), 0.42);
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 8px;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.58rem 0.7rem;
}

.studio-ai-session-diff-content__file-title {
  display: grid;
  gap: 0.16rem;
  min-width: 0;
}

.studio-ai-session-diff-content__file-title strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.9rem;
  font-weight: 760;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-ai-session-diff-content__file-title span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.76rem;
}

.studio-ai-session-diff-content__file-stats {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: flex;
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  gap: 0.5rem;
}

.studio-ai-session-diff-content__large-file {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  justify-content: space-between;
}

.studio-ai-session-diff-content__rendered {
  contain: layout paint;
  min-width: 0;
  overflow-x: hidden;
}

.studio-ai-session-diff-content__rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-ai-session-diff-content__rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-ai-session-diff-content__rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-ai-session-diff-content__rendered :deep(.d2h-files-diff),
.studio-ai-session-diff-content__rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-ai-session-diff-content__rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}

@media (max-width: 760px) {
  .studio-ai-session-diff-content__browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-ai-session-diff-content__files {
    max-height: 16rem;
  }
}
</style>
