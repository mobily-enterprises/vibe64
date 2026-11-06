<template>
  <section class="vibe64-repository-diff">
    <v-progress-linear v-if="loading" color="primary" indeterminate />
    <StudioErrorNotice
      v-if="error"
      compact
      :error="error"
      title="File changes could not load"
    />
    <v-alert
      v-else-if="truncated"
      density="compact"
      type="warning"
      variant="tonal"
    >
      This large file difference is shortened to {{ shownLines }} of {{ totalLines }} lines.
    </v-alert>
    <!-- eslint-disable vue/no-v-html -- Diff2Html escapes patch content before rendering. -->
    <div
      v-if="rendered"
      class="vibe64-repository-diff__rendered"
      v-html="rendered"
    />
    <!-- eslint-enable vue/no-v-html -->
    <v-alert
      v-else-if="!loading && !error"
      density="compact"
      type="info"
      variant="tonal"
    >
      Choose a changed file to see exactly what changed.
    </v-alert>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  error: { default: "", type: String },
  loading: { default: false, type: Boolean },
  payload: { default: null, type: Object }
});

const rendered = computed(() => {
  const diff = String(props.payload?.diff || "");
  return diff
    ? renderDiffHtml(diff, {
        drawFileList: false,
        matching: "lines",
        outputFormat: "side-by-side"
      })
    : "";
});
const shownLines = computed(() => Number(props.payload?.shownLines || 0));
const totalLines = computed(() => Number(props.payload?.totalLines || 0));
const truncated = computed(() => props.payload?.truncated === true);
</script>

<style scoped>
.vibe64-repository-diff {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
}

.vibe64-repository-diff__rendered {
  max-width: 100%;
  min-width: 0;
  overflow: auto;
  /* Keep Diff2Html's absolute line numbers inside this scroll owner. */
  position: relative;
}

.vibe64-repository-diff__rendered :deep(.d2h-wrapper) {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.76rem;
  text-align: start;
}

.vibe64-repository-diff__rendered :deep(.d2h-file-wrapper) {
  border-color: rgb(var(--v-theme-outline-variant));
  margin: 0;
}

.vibe64-repository-diff__rendered :deep(.d2h-file-header) {
  display: none;
}

@media (max-width: 720px) {
  .vibe64-repository-diff__rendered :deep(.d2h-file-side-diff) {
    display: block;
    overflow-x: auto;
    width: 100%;
  }
}
</style>
