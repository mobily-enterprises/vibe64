<template>
  <section class="studio-vibe64-dashboard-session-info">
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
      class="studio-vibe64-dashboard-session-info__empty"
      rounded="lg"
    >
      <h2>Session info</h2>
      <p>Session details will appear here once this session has data.</p>
    </v-sheet>
  </section>
</template>

<script setup>
import { computed } from "vue";
import Vibe64SessionFacts from "@/components/studio/vibe64-session/Vibe64SessionFacts.vue";
import {
  useVibe64SessionDashboardContext
} from "@/composables/useVibe64SessionDashboardContext.js";

const dashboardContext = useVibe64SessionDashboardContext();
const dashboard = computed(() => dashboardContext());
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
.studio-vibe64-dashboard-session-info {
  min-width: 0;
}

.studio-vibe64-dashboard-session-info :deep(.studio-ai-session-facts) {
  width: 100%;
}

.studio-vibe64-dashboard-session-info__empty {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
}

.studio-vibe64-dashboard-session-info__empty h2,
.studio-vibe64-dashboard-session-info__empty p {
  letter-spacing: 0;
  margin: 0;
}

.studio-vibe64-dashboard-session-info__empty h2 {
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.2;
}

.studio-vibe64-dashboard-session-info__empty p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
}
</style>
