<template>
  <v-alert class="vibe64-pass-suggestion mb-2 px-2 py-1" density="compact" :icon="false" role="status" type="info" variant="tonal">
    <p class="text-body-small vibe64-pass-suggestion__text">
      {{ headline }} {{ detail }}
    </p>
    <p v-if="passes.error.value" class="text-body-small vibe64-pass-suggestion__text" role="alert">{{ passes.error.value }}</p>
    <div class="vibe64-pass-suggestion__actions">
      <v-btn
        v-for="passRun in runs"
        :key="passRun.id"
        :aria-label="`Run ${pass.title}: ${passRun.label}`"
        class="vibe64-pass-suggestion__run"
        color="primary"
        density="compact"
        :disabled="Boolean(passes.changing.value) || Boolean(passes.starting.value)"
        :loading="passes.starting.value === runKey(pass, passRun)"
        size="small"
        variant="flat"
        @click="passes.run(pass, passRun)"
      >
        {{ passRun.label }}
      </v-btn>
      <v-btn density="compact" :disabled="Boolean(passes.starting.value || passes.changing.value)" size="small" variant="text" @click="passes.snooze(pass)">
        Later
      </v-btn>
      <v-btn density="compact" :disabled="Boolean(passes.starting.value || passes.changing.value)" size="small" variant="text" @click="passes.dismiss(pass)">
        Dismiss
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup>
// The one pass suggested now, above the composer: each of its runs starts it, Later hides it for a
// week and Dismiss until it completes again. It only offers; the pass starts on a run alone. Its deep
// run stays in Passes, where its cost is shown beside it.
import { computed } from "vue";
import { runKey } from "@/composables/useVibe64Passes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const props = defineProps({
  passes: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Passes>} */ (Object), required: true },
  pass: { type: /** @type {import("vue").PropType<import("@/composables/useVibe64Passes.js").Vibe64Pass>} */ (Object), required: true }
});
const runs = computed(() => props.pass.runs.filter(({ id }) => id !== "deep"));
const commits = computed(() => `${props.pass.commitsSince} ${props.pass.commitsSince === 1 ? "commit" : "commits"}`);
const headline = computed(() => props.pass.lastRun
  ? `Your app has changed a lot since ${props.pass.title} was last completed. Run it again?`
  : `${props.pass.title} has never been completed on this app. Run it?`);
const detail = computed(() => {
  if (!props.pass.lastRun) return `${commits.value} so far.`;
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(props.pass.lastRun)) / DAY_MS));
  return `${commits.value} in ${days} ${days === 1 ? "day" : "days"}.`;
});
</script>

<style scoped>
.vibe64-pass-suggestion :deep(.v-alert__content) {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.vibe64-pass-suggestion__text {
  flex: 1 1 14rem;
  margin: 0;
  min-width: 0;
}

.vibe64-pass-suggestion__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* A run's label is Genesis's, so a long one wraps instead of widening the chat; compact buttons are 8px shorter. */
.vibe64-pass-suggestion__run {
  height: auto;
  max-width: 100%;
  min-height: calc(var(--v-btn-height) - 8px);
}

.vibe64-pass-suggestion__run :deep(.v-btn__content) {
  white-space: normal;
}
</style>
