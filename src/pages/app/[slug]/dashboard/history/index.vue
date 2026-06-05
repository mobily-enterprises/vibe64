<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h2>Session History</h2>
      <p>Review completed and abandoned Vibe64 sessions.</p>
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
  min-width: 0;
}

.vibe64-dashboard-page__header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  padding-bottom: 0.65rem;
}

.vibe64-dashboard-page__header h2,
.vibe64-dashboard-page__header p {
  letter-spacing: 0;
  margin: 0;
}

.vibe64-dashboard-page__header h2 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.15;
}

.vibe64-dashboard-page__header p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
  margin-top: 0.18rem;
}
</style>
