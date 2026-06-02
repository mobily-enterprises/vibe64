<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-session-history d-flex flex-column ga-4">
    <header class="studio-session-history__header">
      <div>
        <p class="studio-session-history__eyebrow text-caption text-medium-emphasis mb-1">
          Session archive
        </p>
        <h1 class="studio-session-history__title">Session History</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Review completed and abandoned Vibe64 sessions without crowding the active session workspace.
        </p>
      </div>
    </header>

    <ProjectSelectionGate>
      <template #default="projectSelectionSlotProps">
        <ProjectTypeGate>
          <template #default>
            <SetupReadinessGate :cache-key="projectSelectionSlotProps?.projectSelection?.targetRoot || ''">
              <Vibe64SessionHistoryPanel
                :model-value="selectedArchive"
                @update:model-value="selectedArchive = $event"
              />
            </SetupReadinessGate>
          </template>
        </ProjectTypeGate>
      </template>
    </ProjectSelectionGate>
  </section>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import SetupReadinessGate from "@/components/studio/SetupReadinessGate.vue";
import Vibe64SessionHistoryPanel from "@/components/studio/Vibe64SessionHistoryPanel.vue";

const route = useRoute();
const router = useRouter();

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

@media (max-width: 640px) {
  .studio-session-history {
    max-width: 100%;
  }
}
</style>
