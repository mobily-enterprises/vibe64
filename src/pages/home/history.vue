<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-session-history d-flex flex-column ga-4">
    <header class="studio-session-history__header">
      <div>
        <p class="studio-session-history__eyebrow text-caption text-medium-emphasis mb-1">
          Session archive
        </p>
        <h1 class="studio-session-history__title">Session History</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Review completed and abandoned AI Studio sessions without crowding the active session workspace.
        </p>
      </div>
    </header>

    <ProjectTypeGate>
      <template #default>
        <SetupReadinessGate>
          <div class="studio-session-history__controls">
            <v-sheet class="studio-session-history__tabs" rounded="lg" border>
              <v-tabs
                v-model="selectedArchive"
                color="primary"
                density="comfortable"
                grow
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
              class="studio-session-history__refresh"
              :loading="archiveLoading"
              :prepend-icon="mdiRefresh"
              size="small"
              variant="tonal"
              @click="refreshArchive"
            >
              Refresh
            </v-btn>
          </div>

          <ArchivedAiStudioSessions
            ref="archiveSessions"
            :key="selectedArchive"
            :archive="selectedArchiveConfig.archive"
            :empty-text="selectedArchiveConfig.emptyText"
            :empty-title="selectedArchiveConfig.emptyTitle"
            :show-refresh="false"
            @loading-changed="archiveLoading = $event"
          />
        </SetupReadinessGate>
      </template>
    </ProjectTypeGate>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { mdiRefresh } from "@mdi/js";
import ArchivedAiStudioSessions from "@/components/studio/ArchivedAiStudioSessions.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import SetupReadinessGate from "@/components/studio/SetupReadinessGate.vue";

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
    emptyText: "Abandoned sessions will appear here after their worktrees are removed.",
    emptyTitle: "No abandoned sessions",
    label: "Abandoned",
    value: "abandoned"
  }
];

const route = useRoute();
const router = useRouter();
const archiveLoading = ref(false);
const archiveSessions = ref(null);

const archiveByValue = Object.fromEntries(archiveTabs.map((tab) => [tab.value, tab]));

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeArchive(value) {
  return value === "abandoned" ? "abandoned" : "completed";
}

function replaceTabQuery(archive) {
  void router.replace({
    path: "/home/history",
    query: {
      ...route.query,
      tab: archive
    }
  });
}

const selectedArchive = computed({
  get() {
    return normalizeArchive(firstQueryValue(route.query.tab));
  },
  set(value) {
    replaceTabQuery(normalizeArchive(value));
  }
});

const selectedArchiveConfig = computed(() => {
  return archiveByValue[selectedArchive.value] || archiveByValue.completed;
});

function refreshArchive() {
  archiveSessions.value?.refresh?.();
}

watch(
  () => route.query.tab,
  (tab) => {
    const rawTab = firstQueryValue(tab);
    const normalizedTab = normalizeArchive(rawTab);
    if (rawTab !== normalizedTab) {
      replaceTabQuery(normalizedTab);
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.3rem, 1.8vw, 1.65rem);
}

.studio-session-history {
  margin-inline: auto;
  max-width: min(82rem, calc(100vw - 2rem));
  width: 100%;
}

.studio-session-history__header {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.studio-session-history__eyebrow {
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.studio-session-history__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.05;
  margin: 0 0 0.2rem;
}

.studio-session-history__controls {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-session-history__tabs {
  flex: 1 1 26rem;
  max-width: 30rem;
  overflow: hidden;
  width: auto;
}

.studio-session-history__tabs :deep(.v-tab) {
  min-height: 48px;
}

.studio-session-history__refresh {
  flex: 0 0 auto;
  min-height: 48px;
}

@media (max-width: 640px) {
  .studio-session-history {
    max-width: 100%;
  }

  .studio-session-history__controls {
    align-items: stretch;
    flex-direction: column;
  }

  .studio-session-history__tabs {
    max-width: 100%;
    width: 100%;
  }

  .studio-session-history__refresh {
    align-self: flex-end;
  }
}
</style>
