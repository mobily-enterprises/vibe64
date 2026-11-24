<template>
  <v-alert
    class="vibe64-turn-interruption my-2"
    type="error"
    variant="tonal"
    density="compact"
    role="note"
    :data-outcome="entry.outcome"
  >
    <p class="text-body-medium font-weight-medium">{{ lines[0] }}</p>
    <p class="text-body-medium">{{ lines[1] }}</p>
  </v-alert>
</template>

<script setup>
import { computed } from "vue";
import { turnInterruptionLines } from "@local/vibe64-terminals/shared/turnInterruptionText";

// A turn interruption's permanent red entry in a chat's history (turnInterruptions.js writes it): what ended the
// turn, then whether Vibe64 resumed it or why not, with times on the viewer's own clock.
const props = defineProps({ entry: { type: Object, required: true } });

const localClock = at => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const lines = computed(() => turnInterruptionLines(props.entry, localClock));
</script>

<style scoped>
.vibe64-turn-interruption p + p {
  margin-top: 2px;
}
</style>
