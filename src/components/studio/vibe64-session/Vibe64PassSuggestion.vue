<template>
  <v-alert class="vibe64-pass-suggestion mb-2 px-2 py-1" density="compact" :icon="false" role="status" type="info" variant="tonal">
    <p class="text-body-small vibe64-pass-suggestion__text">
      {{ headline }} {{ detail }}
    </p>
    <p v-if="passes.error.value" class="text-body-small vibe64-pass-suggestion__text" role="alert">{{ passes.error.value }}</p>
    <div class="vibe64-pass-suggestion__actions">
      <v-btn
        color="primary"
        density="compact"
        :disabled="Boolean(passes.changing.value)"
        :loading="passes.starting.value === pass.id"
        size="small"
        variant="flat"
        @click="passes.run(pass)"
      >
        Run
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
// The one pass suggested now, above the composer: Run starts it, Later hides it for a week and
// Dismiss until it runs again. It only offers; the pass starts on Run alone.
import { computed } from "vue";

const DAY_MS = 24 * 60 * 60 * 1000;

const props = defineProps({
  passes: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Passes>} */ (Object), required: true },
  pass: { type: /** @type {import("vue").PropType<import("@/composables/useVibe64Passes.js").Vibe64Pass>} */ (Object), required: true }
});
const commits = computed(() => `${props.pass.commitsSince} ${props.pass.commitsSince === 1 ? "commit" : "commits"}`);
const headline = computed(() => props.pass.lastRun
  ? `Your app has changed a lot since ${props.pass.title} last ran. Run it again?`
  : `${props.pass.title} has never run on this app. Run it?`);
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
</style>
