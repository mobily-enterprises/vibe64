<template>
  <v-menu
    v-if="resultsButtonVisible"
    :close-on-content-click="false"
    location="bottom end"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :aria-label="outputResultsLabel"
        :disabled="outputResults.length < 1 && !outputExecution.error"
        :icon="mdiDownloadOutline"
        size="small"
        :title="outputResultsLabel"
        variant="text"
      />
    </template>

    <v-card class="vibe64-launch-controls__results-card">
      <v-card-item
        :prepend-icon="mdiDownloadOutline"
        subtitle="Immutable snapshots from this session"
        title="Build results"
      />

      <v-alert
        v-if="outputExecution.error"
        class="vibe64-launch-controls__results-error"
        density="compact"
        type="error"
        variant="tonal"
      >
        {{ outputExecution.error.message }}
      </v-alert>

      <v-list v-if="outputResults.length" density="comfortable">
        <v-list-item
          v-for="result in outputResults"
          :key="result.id"
          :href="result.href"
          :prepend-icon="mdiDownloadOutline"
          :subtitle="outputResultSubtitle(result)"
          :title="result.name"
        />
      </v-list>
    </v-card>
  </v-menu>
</template>

<script setup>
// The output's downloadable build results and the error of a failed build.
import { computed } from "vue";
import {
  mdiDownloadOutline
} from "@mdi/js";

const props = defineProps({
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface>} */ (Object)
  }
});

/** @type {import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface} */
const {
  outputExecution,
  outputResults,
  outputTargets
} = props.surface;

const resultsButtonVisible = computed(() => Boolean(
  outputResults.value.length > 0 ||
  outputExecution.value.error ||
  outputTargets.value.some((target) => Array.isArray(target?.downloads) && target.downloads.length > 0)
));
const outputResultsLabel = computed(() => {
  const count = outputResults.value.length;
  if (count > 0) {
    return `${count} downloadable ${count === 1 ? "result" : "results"}`;
  }
  return outputExecution.value.error ? "Build results need attention" : "No build results yet";
});

function outputResultSubtitle(result = {}) {
  const bytes = Number(result.size || 0);
  const size = bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`;
  const digest = String(result.sha256 || "");
  return `${size} · SHA-256 ${digest.slice(0, 12)}…`;
}
</script>

<style scoped>
.vibe64-launch-controls__results-card {
  max-width: min(30rem, calc(100vw - 1.5rem));
  min-width: min(22rem, calc(100vw - 1.5rem));
}

.vibe64-launch-controls__results-error {
  margin: 0 0.75rem 0.5rem;
  overflow-wrap: anywhere;
}
</style>
