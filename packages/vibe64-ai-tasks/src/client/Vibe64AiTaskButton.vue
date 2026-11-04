<template>
  <v-btn
    :aria-busy="label === WORDS.button.opening ? 'true' : undefined"
    class="vibe64-ai-task-button"
    data-vibe64-ai-task-button
    :disabled="disabled"
    :prepend-icon="mdiRobotOutline"
    size="small"
    :title="title"
    type="button"
    variant="tonal"
    @click="activate"
  >
    {{ label }}
    <template v-if="linked" #append><v-icon :icon="mdiArrowRight" size="16" aria-hidden="true" /></template>
  </v-btn>
</template>

<script setup>
import { computed, inject, watch } from "vue";
import { mdiArrowRight, mdiRobotOutline } from "@mdi/js";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";
import { VIBE64_AI_TASKS_KEY } from "./aiTaskKey.js";
import { AI_TASK_PHASES } from "../shared/aiTaskPhases.js";

const props = defineProps({
  kind: {
    required: true,
    type: String
  },
  // Whether this person may start one. An open task can always be looked at.
  allowed: {
    required: true,
    type: Boolean
  },
  title: {
    required: true,
    type: String
  },
  // What only this page knows about the problem; most kinds read it all on the server.
  input: {
    required: true,
    type: Object
  }
});

// A view reloads what its fix changed once the fix is proved Done.
const emit = defineEmits(["done"]);
const tasks = /** @type {import("./useAiTaskHost.js").AiTaskHost} */ (inject(VIBE64_AI_TASKS_KEY));
const own = computed(() => tasks.task?.kind === props.kind ? tasks.task : null);
const linked = computed(() => Boolean(own.value));
const label = computed(() => {
  if (tasks.starting) return WORDS.button.opening;
  if (!own.value) return WORDS.button.fix;
  return tasks.projection.ended ? WORDS.button.result : WORDS.button.busy;
});
const disabled = computed(() => !own.value && (!props.allowed || tasks.starting));

watch(() => own.value?.phase === AI_TASK_PHASES.DONE ? own.value.id : "", (doneId) => {
  if (doneId) emit("done");
});

/** @param {MouseEvent} event */
function activate(event) {
  const opener = /** @type {HTMLElement} */ (event.currentTarget);
  if (own.value) tasks.show(opener);
  else void tasks.start(props.kind, opener, props.input);
}
</script>

<style scoped>
.vibe64-ai-task-button {
  block-size: auto;
  max-inline-size: 100%;
  min-block-size: 1.75rem;
  min-inline-size: min(8.5rem, 100%);
  white-space: normal;
}

@media (pointer: coarse) {
  .vibe64-ai-task-button { min-block-size: 3rem; }
}
</style>
