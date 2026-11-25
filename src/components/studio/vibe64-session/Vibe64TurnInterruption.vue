<template>
  <v-alert
    class="vibe64-turn-interruption my-2"
    :type="carriedOn ? 'success' : 'error'"
    variant="tonal"
    density="compact"
    role="note"
    :data-outcome="entry.outcome"
  >
    <p
      v-for="(line, index) in lines"
      :key="index"
      class="text-body-medium"
      :class="{ 'font-weight-medium': index === 0 && lines.length > 1 }"
    >
      {{ line }}
    </p>
    <v-btn
      v-if="problemReport.available && !carriedOn"
      class="mt-1"
      density="compact"
      size="small"
      variant="text"
      data-vibe64-report-problem
      @click="problemReport.open({ includeChat: true })"
    >
      Report a problem
    </v-btn>
  </v-alert>
</template>

<script setup>
import { computed } from "vue";
import { turnInterruptionCarriedOn, turnInterruptionLines } from "@local/vibe64-terminals/shared/turnInterruptionText";
import { useProblemReport } from "@/composables/useProblemReport.js";

// A turn interruption's permanent entry in a chat's history (turnInterruptions.js writes it), with times on the
// viewer's own clock: in red, what ended the turn, then whether Vibe64 resumed it or why not; in green, one line for a
// planned stop (a release, a restart) that the work carried on through, since nothing went wrong.
const props = defineProps({ entry: { type: Object, required: true } });
const problemReport = useProblemReport();

const localClock = at => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const carriedOn = computed(() => turnInterruptionCarriedOn(props.entry));
const lines = computed(() => turnInterruptionLines(props.entry, localClock));
</script>

<style scoped>
.vibe64-turn-interruption p + p {
  margin-top: 2px;
}
</style>
