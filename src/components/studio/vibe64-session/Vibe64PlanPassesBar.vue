<template>
  <v-alert
    v-if="shown"
    class="vibe64-plan-passes mb-2 px-2 py-1"
    data-testid="vibe64-plan-passes"
    density="compact"
    :icon="false"
    role="status"
    type="info"
    variant="tonal"
  >
    <p class="text-body-small vibe64-plan-passes__text">{{ summary }}</p>
    <p v-if="passes.error.value" class="text-body-small vibe64-plan-passes__text" role="alert">{{ passes.error.value }}</p>
    <v-btn
      class="vibe64-plan-passes__continue"
      color="primary"
      density="compact"
      :disabled="Boolean(passes.starting.value)"
      :loading="passes.starting.value === 'plan:continue:'"
      size="small"
      variant="flat"
      @click="continuePasses"
    >
      {{ continueLabel }}
    </v-btn>
  </v-alert>
</template>

<script setup>
// The open plan's next step, above the composer, while its passes are not all done: how many are
// done and the Passes list's own Continue, naming the passes left. It sends the list's message
// through the same call; nothing here runs a pass by itself.
import { computed } from "vue";
import { chatRunsPlanPasses, planContinueLabel } from "@/composables/useVibe64Passes.js";

const props = defineProps({
  passes: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Passes>} */ (Object), required: true },
  // Main chat's session: only a chat whose plans run their passes shows them.
  session: { type: Object, default: null }
});
const progress = computed(() => props.passes.planProgress.value);
// The plan's passes run once Senior has reviewed it; until then its steps go on by themselves.
const shown = computed(() => chatRunsPlanPasses(props.session) && Boolean(props.passes.plan.value?.atPasses) && progress.value.left > 0);
const summary = computed(() => `This plan's passes: ${progress.value.done} of ${progress.value.total} done`);
const continueLabel = computed(() => planContinueLabel(progress.value.left));
const continuePasses = () => props.passes.planAction("continue");
</script>

<style scoped>
.vibe64-plan-passes :deep(.v-alert__content) {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.vibe64-plan-passes__text {
  flex: 1 1 14rem;
  margin: 0;
  min-width: 0;
}
</style>
