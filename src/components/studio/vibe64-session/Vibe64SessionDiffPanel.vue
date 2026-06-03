<template>
  <section class="studio-ai-session-diff-panel">
    <header class="studio-ai-session-diff-panel__header">
      <div class="studio-ai-session-diff-panel__title-row">
        <h2>Diff</h2>
        <p>{{ review.diffTitle || "Review changes in the session worktree." }}</p>
      </div>

      <div class="studio-ai-session-diff-panel__actions">
        <v-chip
          v-if="diff.payload"
          :color="diff.payload.hasChanges ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ diff.payload.hasChanges ? "Changes found" : "No changes" }}
        </v-chip>
        <v-btn
          :disabled="review.diffDisabled"
          :loading="diff.loading"
          size="small"
          type="button"
          variant="tonal"
          @click="loadDiff"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <Vibe64SessionDiffContent
      class="studio-ai-session-diff-panel__content"
      :diff="diff"
    />
  </section>
</template>

<script setup>
import { watch } from "vue";
import Vibe64SessionDiffContent from "@/components/studio/vibe64-session/Vibe64SessionDiffContent.vue";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  }
});

async function loadDiff() {
  if (props.review.diffDisabled || props.diff.loading) {
    return false;
  }
  if (typeof props.diff.load === "function") {
    return await props.diff.load();
  }
  if (typeof props.diff.openDialog === "function") {
    return await props.diff.openDialog();
  }
  return false;
}

watch(() => props.active, (active) => {
  if (!active || props.diff.payload || props.diff.error || props.diff.loading) {
    return;
  }
  void loadDiff();
}, {
  immediate: true
});
</script>

<style scoped>
.studio-ai-session-diff-panel {
  display: grid;
  gap: 0.55rem;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: 0.85rem;
}

.studio-ai-session-diff-panel__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.52rem 0 0.28rem;
}

.studio-ai-session-diff-panel__title-row {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-session-diff-panel__header h2,
.studio-ai-session-diff-panel__header p {
  letter-spacing: 0;
  margin: 0;
}

.studio-ai-session-diff-panel__header h2 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.15;
}

.studio-ai-session-diff-panel__header p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
}

.studio-ai-session-diff-panel__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-end;
}

.studio-ai-session-diff-panel__content {
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 640px) {
  .studio-ai-session-diff-panel__header {
    align-items: stretch;
    flex-direction: column;
  }

  .studio-ai-session-diff-panel__title-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.12rem;
  }

  .studio-ai-session-diff-panel__actions {
    justify-content: flex-start;
  }
}
</style>
