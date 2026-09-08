<template>
  <div v-if="visible && !detailsOpen" class="vibe64-temporary-action-terminal">
    <v-sheet
      class="vibe64-temporary-action-terminal__summary"
      :class="{ 'vibe64-temporary-action-terminal__summary--error': Boolean(error) }"
      rounded="lg"
      color="surface-variant"
      :role="error ? 'alert' : 'status'"
    >
      <strong class="vibe64-temporary-action-terminal__title">{{ title }}</strong>
      <v-chip
        v-if="status"
        class="vibe64-temporary-action-terminal__status"
        size="x-small"
        variant="tonal"
      >
        {{ status }}
      </v-chip>
      <span class="vibe64-temporary-action-terminal__line">
        {{ summaryText }}
      </span>
      <div class="vibe64-temporary-action-terminal__actions">
        <slot v-if="error" name="error-actions" />
        <v-btn
          v-if="error && retryable"
          :aria-busy="starting ? 'true' : undefined"
          :aria-label="`Retry ${title}`"
          :disabled="starting"
          :icon="mdiRefresh"
          size="small"
          :title="`Retry ${title}`"
          variant="text"
          @click="$emit('retry')"
        />
        <v-btn
          :aria-label="`Show ${title} details`"
          :color="error ? 'error' : undefined"
          :icon="error ? mdiAlertCircleOutline : mdiConsoleLine"
          size="small"
          :title="`Show ${title} details`"
          variant="text"
          @click="openDetails"
        />
        <v-btn
          v-if="canDismiss"
          :aria-label="`Dismiss ${title}`"
          :icon="mdiClose"
          size="small"
          :title="`Dismiss ${title}`"
          variant="text"
          @click="dismiss"
        />
      </div>
    </v-sheet>
  </div>

  <Vibe64TerminalSurface
    v-else-if="visible"
    body-mode="log"
    close-label="Dismiss"
    collapsible
    :error="error"
    expanded
    :error-title="errorTitle"
    :height="height"
    mobile-takeover
    :open-error-details="Boolean(error)"
    :output="output"
    :retryable="retryable"
    :show-close="canDismiss"
    :show-copy="Boolean(output)"
    :show-interrupt="false"
    :stage="stage"
    :starting="starting"
    :status="status"
    :subtitle="subtitle"
    :title="title"
    @close="dismiss"
    @copy="$emit('copy')"
    @retry="$emit('retry')"
    @toggle-expanded="closeDetails"
  >
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64TerminalSurface>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiAlertCircleOutline, mdiClose, mdiConsoleLine, mdiRefresh } from "@mdi/js";
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
  "actions-before",
  "error-actions",
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

function openDetails() {
  detailsViewed.value = true;
  detailsOpen.value = true;
}

function closeDetails() {
  detailsOpen.value = false;
}

function dismiss() {
  closeDetails();
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
.vibe64-temporary-action-terminal {
  container-type: inline-size;
  min-width: 0;
}

.vibe64-temporary-action-terminal__summary {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-areas: "title status line actions";
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  min-height: 2.75rem;
  padding: 0.35rem 0.45rem 0.35rem 0.8rem;
}

.vibe64-temporary-action-terminal__summary--error {
  border-inline-start: 0.25rem solid rgb(var(--v-theme-error));
}

.vibe64-temporary-action-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  grid-area: actions;
  justify-content: flex-end;
}

.vibe64-temporary-action-terminal__title {
  grid-area: title;
}

.vibe64-temporary-action-terminal__status {
  grid-area: status;
}

.vibe64-temporary-action-terminal__summary--error .vibe64-temporary-action-terminal__line {
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
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  grid-area: line;
}

@container (max-width: 36rem) {
  .vibe64-temporary-action-terminal__summary {
    grid-template-areas:
      "title status"
      "line line"
      "actions actions";
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
