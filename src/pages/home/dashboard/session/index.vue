<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h2>Session Details</h2>
      <p>Current session status, worktree, branch, and runtime facts.</p>
    </header>

    <Vibe64SessionFacts
      v-if="facts.length"
      :facts="facts"
      :status-color="statusColor"
      :status-label="statusLabel"
      @copy="copyFact"
    />

    <v-sheet
      v-else
      border
      class="vibe64-dashboard-page__empty"
      rounded="lg"
    >
      <h3>Session Details</h3>
      <p>Session details will appear here once this session has data.</p>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed } from "vue";
import Vibe64SessionFacts from "@/components/studio/vibe64-session/Vibe64SessionFacts.vue";

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});

const dashboard = computed(() => props.dashboardContext || {});
const facts = computed(() => Array.isArray(dashboard.value.facts) ? dashboard.value.facts : []);
const statusColor = computed(() => String(dashboard.value.statusColor || "default"));
const statusLabel = computed(() => String(dashboard.value.statusLabel || ""));

function copyFact(value, label) {
  if (typeof dashboard.value.copyText === "function") {
    dashboard.value.copyText(value, label);
  }
}
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
.vibe64-dashboard-page__header p,
.vibe64-dashboard-page__empty h3,
.vibe64-dashboard-page__empty p {
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

.vibe64-dashboard-page :deep(.studio-ai-session-facts) {
  width: 100%;
}

.vibe64-dashboard-page__empty {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
}

.vibe64-dashboard-page__empty h3 {
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.2;
}

.vibe64-dashboard-page__empty p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
}
</style>
