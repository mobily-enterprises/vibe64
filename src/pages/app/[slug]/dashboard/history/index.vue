<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h1>Session History</h1>
    </header>

    <Vibe64SessionHistoryPanel
      :model-value="selectedArchive"
      @update:model-value="selectedArchive = $event"
    />
  </section>
</template>

<script setup>
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
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
    path: route.path,
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
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-dashboard-page__header {
  min-width: 0;
}

.vibe64-dashboard-page__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, clamp(1.2rem, 1.7vw, 1.55rem));
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}
</style>
