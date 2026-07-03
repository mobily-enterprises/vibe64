<template>
  <section class="vibe64-session-history-panel">
    <div class="vibe64-session-history-panel__controls">
      <v-sheet class="vibe64-session-history-panel__tabs" rounded="lg" border>
        <v-tabs
          :model-value="selectedArchive"
          color="primary"
          density="comfortable"
          grow
          @update:model-value="selectArchive"
        >
          <v-tab
            v-for="tab in archiveTabs"
            :key="tab.value"
            :value="tab.value"
          >
            {{ tab.label }}
          </v-tab>
        </v-tabs>
      </v-sheet>

      <v-btn
        class="vibe64-session-history-panel__refresh"
        :loading="archiveLoading"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="tonal"
        @click="refreshArchive"
      >
        Refresh
      </v-btn>
    </div>

    <ArchivedVibe64Sessions
      ref="archiveSessions"
      :key="selectedArchive"
      :archive="selectedArchiveConfig.archive"
      :empty-text="selectedArchiveConfig.emptyText"
      :empty-title="selectedArchiveConfig.emptyTitle"
      :show-refresh="false"
      @loading-changed="archiveLoading = $event"
    />
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { mdiRefresh } from "@mdi/js";
import ArchivedVibe64Sessions from "@/components/studio/ArchivedVibe64Sessions.vue";
import {
  normalizeVibe64SessionArchiveTab
} from "@/lib/vibe64SessionViewModel.js";

const archiveTabs = [
  {
    archive: "completed",
    emptyText: "Completed sessions will appear here after a session is finalized.",
    emptyTitle: "No completed sessions",
    label: "Completed",
    value: "completed"
  },
  {
    archive: "abandoned",
    emptyText: "Abandoned sessions will appear here after their sources are removed.",
    emptyTitle: "No abandoned sessions",
    label: "Abandoned",
    value: "abandoned"
  }
];

const archiveByValue = Object.fromEntries(archiveTabs.map((tab) => [tab.value, tab]));

const props = defineProps({
  modelValue: {
    default: "completed",
    type: String
  }
});

const emit = defineEmits(["update:modelValue"]);
const archiveLoading = ref(false);
const archiveSessions = ref(null);

const selectedArchive = computed(() => normalizeVibe64SessionArchiveTab(props.modelValue));
const selectedArchiveConfig = computed(() => archiveByValue[selectedArchive.value] || archiveByValue.completed);

function selectArchive(value) {
  emit("update:modelValue", normalizeVibe64SessionArchiveTab(value));
}

function refreshArchive() {
  archiveSessions.value?.refresh?.();
}
</script>

<style scoped>
.vibe64-session-history-panel {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.vibe64-session-history-panel__controls {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-session-history-panel__tabs {
  flex: 1 1 26rem;
  max-width: 30rem;
  overflow: hidden;
  width: auto;
}

.vibe64-session-history-panel__tabs :deep(.v-tab) {
  min-height: 48px;
}

.vibe64-session-history-panel__refresh {
  flex: 0 0 auto;
  height: 48px;
  min-height: 48px;
}

@media (max-width: 640px) {
  .vibe64-session-history-panel__controls {
    align-items: stretch;
    flex-direction: column;
  }

  .vibe64-session-history-panel__tabs {
    max-width: 100%;
    width: 100%;
  }

  .vibe64-session-history-panel__refresh {
    align-self: flex-end;
  }
}
</style>
