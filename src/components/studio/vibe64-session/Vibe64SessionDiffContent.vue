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

    <!-- eslint-disable vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
    <div
      v-if="renderedDiff"
      class="studio-ai-session-diff-content__rendered"
      v-html="renderedDiff"
    />
    <!-- eslint-enable vue/no-v-html -->

    <v-alert
      v-else-if="!diff.loading && !diff.error"
      type="info"
      variant="tonal"
    >
      No diff is available for this session worktree.
    </v-alert>
  </div>
</template>

<script setup>
import {
  computed,
  ref
} from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  diff: {
    default: () => ({}),
    type: Object
  }
});

const diffBodyElement = ref(null);

const combinedDiff = computed(() => {
  const payload = props.diff.payload || {};
  return [payload.stagedDiff, payload.unstagedDiff, payload.untrackedDiff]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join("\n");
});

const renderedDiff = computed(() => {
  if (!combinedDiff.value) {
    return "";
  }
  return renderDiffHtml(combinedDiff.value, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "side-by-side"
  });
});

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
</style>
