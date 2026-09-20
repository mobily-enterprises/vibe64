<template>
  <Vibe64TerminalSurface
    v-if="visible"
    class="vibe64-temporary-action-terminal"
    :class="{ 'vibe64-temporary-action-terminal--error': Boolean(error) }"
    body-mode="log"
    close-label="Dismiss"
    collapsible
    :error="error"
    :expanded="detailsOpen"
    :error-title="errorTitle"
    :height="height"
    mobile-takeover
    :open-error-details="detailsOpen && Boolean(error)"
    :output="output"
    :retryable="Boolean(error) && retryable"
    :show-close="canDismiss"
    :show-copy="detailsOpen && Boolean(output)"
    :show-interrupt="false"
    :show-summary="false"
    :starting="starting"
    :title="title"
    @close="dismiss"
    @copy="$emit('copy')"
    @retry="$emit('retry')"
    @toggle-expanded="toggleDetails"
  >
    <template #heading>
      <div class="vibe64-temporary-action-terminal__summary">
        <strong class="vibe64-temporary-action-terminal__title">{{ title }}</strong>
        <v-chip
          v-if="status"
          class="vibe64-temporary-action-terminal__status"
          size="x-small"
          variant="tonal"
        >
          {{ status }}
        </v-chip>
      </div>
    </template>
    <template #actions-before>
      <span
        class="vibe64-temporary-action-terminal__line"
        :role="error ? 'alert' : 'status'"
        :title="subtitle"
      >
        {{ summaryText }}
      </span>
      <slot name="actions-before" />
      <slot v-if="error" name="error-actions" />
    </template>
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64TerminalSurface>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import { terminalLastMeaningfulLine } from "@/lib/codexOutput.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  dismissed: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Action needs attention",
    type: String
  },
  height: {
    default: "clamp(8rem, 22vh, 14rem)",
    type: String
  },
  operationKey: {
    default: "",
    type: String
  },
  output: {
    default: "",
    type: String
  },
  retryable: {
    default: false,
    type: Boolean
  },
  stage: {
    default: "",
    type: String
  },
  starting: {
    default: false,
    type: Boolean
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  title: {
    default: "Action",
    type: String
  }
});

const emit = defineEmits(["copy", "dismiss", "retry"]);

const detailsOpen = ref(false);
const detailsViewed = ref(false);
const canDismiss = computed(() => !props.active);
const forwardedSlots = [
  "actions-after",
  "output",
  "overlay"
];
const visible = computed(() => !props.dismissed && Boolean(
  props.active || props.error || detailsViewed.value
));
const summaryText = computed(() => {
  const outputLine = terminalLastMeaningfulLine(props.output);
  if (props.error) {
    return props.error;
  }
  if (props.stage && outputLine && props.stage !== outputLine) {
    return `${props.stage} · ${outputLine}`;
  }
  return props.stage || outputLine || "Working…";
});

function toggleDetails() {
  detailsViewed.value = true;
  detailsOpen.value = !detailsOpen.value;
}

function dismiss() {
  detailsOpen.value = false;
  detailsViewed.value = false;
  emit("dismiss");
}

watch(() => props.operationKey, () => {
  detailsOpen.value = false;
  detailsViewed.value = false;
}, { immediate: true });

watch(() => props.active, (active, previousActive) => {
  if (active && !previousActive) {
    detailsOpen.value = false;
    detailsViewed.value = false;
  }
}, { immediate: true });
</script>

<style scoped>
:global(.vibe64-temporary-action-terminal--error) {
  border-inline-start: 0.25rem solid rgb(var(--v-theme-error));
}

:global(.vibe64-temporary-action-terminal .vibe64-terminal-surface__header) {
  align-items: stretch;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0;
}

:global(.vibe64-temporary-action-terminal .vibe64-terminal-surface__body) {
  margin-top: 0.5rem;
}

.vibe64-temporary-action-terminal__summary {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-areas: "title status";
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.vibe64-temporary-action-terminal__title {
  font-size: 0.88rem;
  grid-area: title;
}

.vibe64-temporary-action-terminal__status {
  grid-area: status;
}

.vibe64-temporary-action-terminal--error .vibe64-temporary-action-terminal__line {
  flex-basis: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}

.vibe64-temporary-action-terminal__title,
.vibe64-temporary-action-terminal__line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-temporary-action-terminal__line {
  color: rgba(var(--v-theme-on-surface), 0.72);
  flex: 1 1 0;
  font-size: 0.82rem;
  min-width: 0;
  order: -1;
}
</style>
