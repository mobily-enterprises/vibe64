<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  vibe64SessionToolIdFromRouteSegment
} from "@/lib/vibe64SessionToolDefinitions.js";

const route = useRoute();
const sessionToolId = computed(() => vibe64SessionToolIdFromRouteSegment(route.params.sessionTool));
</script>

<template>
  <section
    v-if="!sessionToolId"
    class="vibe64-session-tool-route"
  >
    <h2>Session tool unavailable</h2>
    <p>This dashboard route does not match an active session tool.</p>
  </section>
</template>

<style scoped>
.vibe64-session-tool-route {
  align-content: start;
  display: grid;
  gap: 0.4rem;
  padding: 0.85rem;
}

.vibe64-session-tool-route h2,
.vibe64-session-tool-route p {
  margin: 0;
}

.vibe64-session-tool-route h2 {
  font-size: 1rem;
  font-weight: 720;
  letter-spacing: 0;
}

.vibe64-session-tool-route p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
}
</style>
