<template>
  <section class="studio-ai-session-details-pane">
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
      class="studio-ai-session-details-pane__empty"
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
  context: {
    default: () => ({}),
    type: Object
  }
});

const facts = computed(() => Array.isArray(props.context?.facts) ? props.context.facts : []);
const statusColor = computed(() => String(props.context?.statusColor || "default"));
const statusLabel = computed(() => String(props.context?.statusLabel || ""));

function copyFact(value, label) {
  if (typeof props.context?.copyText === "function") {
    props.context.copyText(value, label);
  }
}
</script>

<style scoped>
.studio-ai-session-details-pane {
  align-content: start;
  display: grid;
  gap: 0.75rem;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding: 2rem 0.85rem 0.85rem;
  scrollbar-gutter: stable;
}

.studio-ai-session-details-pane__empty h3,
.studio-ai-session-details-pane__empty p {
  letter-spacing: 0;
  margin: 0;
}

.studio-ai-session-details-pane :deep(.studio-ai-session-facts) {
  align-self: start;
  width: 100%;
}

.studio-ai-session-details-pane__empty {
  display: grid;
  gap: 0.25rem;
  padding: 1rem;
}

.studio-ai-session-details-pane__empty h3 {
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.2;
}

.studio-ai-session-details-pane__empty p {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
}
</style>
