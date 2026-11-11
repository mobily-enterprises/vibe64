<template>
  <div class="ai-task-outcome">
    <section>
      <h3>{{ WORDS.outcome.problem }}</h3>
      <p><LongTextInlineParts :text="task.problem.summary" /></p>
    </section>
    <section>
      <h3>{{ WORDS.outcome.whatHappened }}</h3>
      <p><LongTextInlineParts :text="projection.outcome.happened" /></p>
    </section>
    <section v-if="projection.outcome.report">
      <h3>{{ WORDS.outcome.whatTheAiDid }}</h3>
      <p><LongTextInlineParts :text="projection.outcome.report" /></p>
    </section>
    <section v-if="projection.outcome.next">
      <h3>{{ WORDS.outcome.whatsNext }}</h3>
      <p>{{ projection.outcome.next }}</p>
    </section>
    <v-btn
      class="ai-task-outcome__conversation"
      data-vibe64-ai-task-transcript
      variant="text"
      @click="emit('see-conversation')"
    >
      {{ WORDS.outcome.seeConversation }}
    </v-btn>
  </div>
</template>

<script setup>
import { LongTextInlineParts } from "@jskit-ai/assistant-core/client/conversation";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";

defineProps({
  task: {
    required: true,
    type: /** @type {import("vue").PropType<import("./types.js").AiTask>} */ (Object)
  },
  projection: {
    required: true,
    type: /** @type {import("vue").PropType<import("./types.js").AiTaskProjection>} */ (Object)
  }
});
const emit = defineEmits(["see-conversation"]);
</script>

<style scoped>
.ai-task-outcome {
  align-content: start;
  display: grid;
  gap: 1.25rem;
  height: 100%;
  justify-items: start;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1.25rem;
}

.ai-task-outcome section { min-width: 0; }

.ai-task-outcome h3 {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  margin: 0 0 0.25rem;
}

.ai-task-outcome p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.ai-task-outcome__conversation {
  margin-inline-start: -0.75rem;
  min-height: var(--ai-task-target, 2.5rem);
}
</style>
