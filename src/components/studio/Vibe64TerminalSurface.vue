<template>
  <Teleport :disabled="!mobileTakeoverActive" to="body">
    <v-sheet
      v-bind="$attrs"
      ref="takeoverRoot"
      :aria-busy="starting ? 'true' : undefined"
      :aria-label="title"
      :aria-modal="mobileTakeoverActive ? 'true' : undefined"
      rounded="lg"
      color="surface-light"
      class="vibe64-terminal-surface"
      :class="{
        'vibe64-terminal-surface--collapsed': !surfaceExpanded,
        'vibe64-terminal-surface--draggable': draggable,
        'vibe64-terminal-surface--fill': fill,
        'vibe64-terminal-surface--focused': focused,
        'vibe64-terminal-surface--mobile-takeover': mobileTakeover
      }"
      :role="mobileTakeoverActive ? 'dialog' : 'region'"
      :tabindex="mobileTakeoverActive ? -1 : undefined"
      @keydown="handleTakeoverKeydown"
    >
      <header
        class="vibe64-terminal-surface__header"
        @pointerdown="draggable && $emit('drag-start', $event)"
      >
        <div class="vibe64-terminal-surface__heading">
          <slot name="heading" :title="title" :subtitle="subtitle">
            <strong class="vibe64-terminal-surface__title">{{ title }}</strong>
            <span v-if="subtitle" class="vibe64-terminal-surface__subtitle">{{ subtitle }}</span>
          </slot>
        </div>

        <div class="vibe64-terminal-surface__actions" @pointerdown.stop>
          <v-chip
            v-if="status && (!surfaceExpanded || bodyMode === 'log')"
            aria-atomic="true"
            aria-live="polite"
            role="status"
            size="x-small"
            variant="tonal"
          >
            {{ status }}
          </v-chip>
          <v-btn
            v-if="error"
            :aria-controls="errorDetailsId"
            :aria-expanded="String(errorDetailsOpen)"
            :aria-label="errorDetailsToggleLabel"
            class="vibe64-terminal-surface__error-toggle"
            color="error"
            :icon="mdiAlertCircleOutline"
            size="small"
            :title="errorDetailsToggleLabel"
            variant="tonal"
            @click="toggleErrorDetails"
          />
          <slot name="actions-before" />
          <v-btn
            v-if="retryable"
            :aria-busy="starting ? 'true' : undefined"
            class="vibe64-terminal-surface__retry"
            color="primary"
            :disabled="starting"
            size="small"
            variant="flat"
            @click="retry"
          >
            {{ starting ? "Retrying…" : "Retry" }}
          </v-btn>
          <v-btn
            v-if="showCopy"
            :disabled="!selectedText && !output"
            size="small"
            variant="text"
            @click="$emit('copy')"
          >
            Copy
          </v-btn>
          <v-btn
            v-if="showInterrupt"
            :disabled="!sessionId || exited"
            size="small"
            variant="text"
            @click="$emit('interrupt')"
          >
            Ctrl-C
          </v-btn>
          <v-btn
            v-if="collapsible"
            ref="expansionToggle"
            :aria-controls="bodyId"
            :aria-expanded="String(surfaceExpanded)"
            :aria-label="surfaceExpanded ? undefined : `Show ${title} details`"
            size="small"
            variant="text"
            @click="toggleExpanded"
          >
            {{ surfaceExpanded ? "Collapse" : "Expand" }}
          </v-btn>
          <v-btn
            v-if="showClose"
            size="small"
            variant="text"
            @click="$emit('close')"
          >
            {{ closeLabel }}
          </v-btn>
          <slot name="actions-after" />
        </div>
      </header>

      <div v-if="$slots['before-terminal']" class="vibe64-terminal-surface__before-terminal">
        <slot name="before-terminal" />
      </div>

      <div
        v-if="showSummary && !surfaceExpanded"
        class="vibe64-terminal-surface__summary"
        aria-live="off"
      >
        <span v-if="stage" class="vibe64-terminal-surface__summary-stage">{{ stage }}</span>
        <span
          v-if="stage && collapsedSummaryLine"
          class="vibe64-terminal-surface__summary-separator"
          aria-hidden="true"
        >·</span>
        <span class="vibe64-terminal-surface__summary-line">
          {{ collapsedSummaryLine || "Waiting for output…" }}
        </span>
      </div>

      <span v-if="error" class="d-sr-only" role="alert">
        {{ errorTitle }}. {{ error }}
      </span>

      <div
        v-if="error"
        v-show="errorDetailsOpen"
        :id="errorDetailsId"
        class="vibe64-terminal-surface__error-details"
      >
        <StudioErrorNotice
          :title="errorTitle"
          :error="error"
          compact
        >
          <template v-if="$slots['error-actions']" #actions>
            <slot name="error-actions" />
          </template>
        </StudioErrorNotice>
      </div>

      <div :id="bodyId" v-show="surfaceExpanded" class="vibe64-terminal-surface__body">
        <div class="vibe64-terminal-surface__stage">
          <div class="vibe64-terminal-surface__overlay">
            <slot name="overlay" />
          </div>

          <div
            v-if="bodyMode === 'terminal'"
            class="vibe64-terminal-surface__host"
            :style="hostStyle"
            @click="$emit('focus')"
            @pointerdown.capture="$emit('focus')"
          >
            <div :ref="terminalHostRef" class="vibe64-terminal-surface__mount" />
          </div>
          <pre
            v-else
            class="vibe64-terminal-surface__log"
            :style="hostStyle"
            aria-atomic="false"
            :aria-label="`${title} output`"
            aria-live="off"
            role="log"
            tabindex="0"
          ><slot name="output" :output="output">{{ output || "Waiting for output…" }}</slot></pre>
        </div>

        <footer
          v-if="bodyMode === 'terminal' || $slots.footer"
          class="vibe64-terminal-surface__footer"
        >
          <slot name="footer" :command-preview="commandPreview" :status="status">
            <span class="vibe64-terminal-surface__command">
              {{ commandPreview || "No command running." }}
            </span>
            <v-chip v-if="status" size="x-small" variant="tonal">
              {{ status }}
            </v-chip>
          </slot>
        </footer>
      </div>
    </v-sheet>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { mdiAlertCircleOutline } from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { terminalLastMeaningfulLine } from "@/lib/codexOutput.js";

defineOptions({ inheritAttrs: false });

const props = defineProps({
  bodyMode: {
    default: "terminal",
    validator: (value) => ["log", "terminal"].includes(value),
    type: String
  },
  closeLabel: {
    default: "Close",
    type: String
  },
  collapsible: {
    default: true,
    type: Boolean
  },
  commandPreview: {
    default: "",
    type: String
  },
  draggable: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Terminal needs attention",
    type: String
  },
  exited: {
    default: false,
    type: Boolean
  },
  expanded: {
    default: false,
    type: Boolean
  },
  fill: {
    default: false,
    type: Boolean
  },
  focused: {
    default: false,
    type: Boolean
  },
  height: {
    default: "clamp(18rem, 48vh, 34rem)",
    type: String
  },
  mobileTakeover: {
    default: false,
    type: Boolean
  },
  openErrorDetails: {
    default: false,
    type: Boolean
  },
  output: {
    default: "",
    type: String
  },
  retryable: {
    default: false,
    type: Boolean
  },
  selectedText: {
    default: "",
    type: String
  },
  sessionId: {
    default: "",
    type: String
  },
  showClose: {
    default: true,
    type: Boolean
  },
  showCopy: {
    default: false,
    type: Boolean
  },
  showInterrupt: {
    default: true,
    type: Boolean
  },
  showSummary: {
    default: true,
    type: Boolean
  },
  starting: {
    default: false,
    type: Boolean
  },
  stage: {
    default: "",
    type: String
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  summaryLine: {
    default: "",
    type: String
  },
  terminalHostRef: {
    default: null,
    type: Function
  },
  title: {
    default: "Terminal",
    type: String
  }
});

const emit = defineEmits([
  "close",
  "copy",
  "drag-start",
  "focus",
  "interrupt",
  "retry",
  "toggle-expanded"
]);

const componentId = useId();
const expansionToggle = ref(null);
const takeoverRoot = ref(null);
const mobileTakeoverViewport = ref(false);
const errorDetailsOpen = ref(false);
const bodyId = `vibe64-terminal-body-${componentId}`;
const errorDetailsId = `vibe64-terminal-error-details-${componentId}`;
const collapsedSummaryLine = computed(() => (
  String(props.summaryLine || "").trim() || terminalLastMeaningfulLine(props.output)
));
const surfaceExpanded = computed(() => !props.collapsible || props.expanded);
const mobileTakeoverActive = computed(() => Boolean(
  props.mobileTakeover && surfaceExpanded.value && mobileTakeoverViewport.value
));
const errorDetailsToggleLabel = computed(() => (
  errorDetailsOpen.value ? "Hide terminal error details" : "Show terminal error details"
));
const hostStyle = computed(() => ({
  "--vibe64-terminal-host-height": props.height
}));

function toggleErrorDetails() {
  errorDetailsOpen.value = !errorDetailsOpen.value;
}

function retry() {
  errorDetailsOpen.value = false;
  emit("retry");
}

function toggleExpanded() {
  const collapsing = surfaceExpanded.value;
  if (
    !collapsing &&
    props.mobileTakeover &&
    mobileTakeoverViewport.value &&
    typeof document !== "undefined"
  ) {
    const toggle = expansionToggle.value?.$el || expansionToggle.value;
    takeoverPendingRestoreTarget = document.activeElement !== document.body
      ? document.activeElement
      : toggle;
  }
  emit("toggle-expanded");
  if (collapsing) {
    void nextTick(() => {
      const target = expansionToggle.value?.$el || expansionToggle.value;
      target?.focus?.({ preventScroll: true });
    });
  }
}

function handleTakeoverKeydown(event) {
  if (!mobileTakeoverActive.value) {
    return;
  }
  if (event.key === "Escape" && props.collapsible) {
    event.preventDefault();
    emit("toggle-expanded");
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const root = takeoverRoot.value?.$el || takeoverRoot.value;
  const focusable = Array.from(root?.querySelectorAll?.(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  ) || []).filter((element) => element.getAttribute("aria-hidden") !== "true");
  if (!focusable.length) {
    event.preventDefault();
    root?.focus?.({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

let mobileTakeoverMediaQuery = null;
let takeoverPendingRestoreTarget = null;
let takeoverRestoreTarget = null;
let takeoverBodyOverflow = "";
let takeoverInertRecords = [];
let takeoverApplied = false;

function updateMobileTakeoverViewport(event = mobileTakeoverMediaQuery) {
  mobileTakeoverViewport.value = Boolean(event?.matches);
}

async function applyMobileTakeover() {
  await nextTick();
  if (!mobileTakeoverActive.value || takeoverApplied || typeof document === "undefined") {
    return;
  }
  const root = takeoverRoot.value?.$el || takeoverRoot.value;
  if (!root) {
    return;
  }
  takeoverApplied = true;
  takeoverRestoreTarget = takeoverPendingRestoreTarget || document.activeElement;
  takeoverPendingRestoreTarget = null;
  takeoverBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  takeoverInertRecords = Array.from(document.body.children)
    .filter((element) => element !== root && !element.contains(root))
    .map((element) => ({
      element,
      inert: element.inert === true
    }));
  for (const record of takeoverInertRecords) {
    record.element.inert = true;
  }
  const target = expansionToggle.value?.$el || expansionToggle.value || root;
  target?.focus?.({ preventScroll: true });
}

function releaseMobileTakeover({ restoreFocus = true } = {}) {
  if (!takeoverApplied) {
    return;
  }
  takeoverApplied = false;
  for (const record of takeoverInertRecords) {
    if (record.element?.isConnected) {
      record.element.inert = record.inert;
    }
  }
  takeoverInertRecords = [];
  if (typeof document !== "undefined") {
    document.body.style.overflow = takeoverBodyOverflow;
  }
  const restoreTarget = takeoverRestoreTarget;
  takeoverRestoreTarget = null;
  takeoverPendingRestoreTarget = null;
  if (restoreFocus) {
    void nextTick(() => restoreTarget?.isConnected && restoreTarget.focus?.({ preventScroll: true }));
  }
}

watch(mobileTakeoverActive, (active) => {
  if (active) {
    void applyMobileTakeover();
  } else {
    releaseMobileTakeover();
  }
}, { flush: "post" });

onMounted(() => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  mobileTakeoverMediaQuery = window.matchMedia("(max-width: 720px)");
  updateMobileTakeoverViewport();
  if (typeof mobileTakeoverMediaQuery.addEventListener === "function") {
    mobileTakeoverMediaQuery.addEventListener("change", updateMobileTakeoverViewport);
  } else {
    mobileTakeoverMediaQuery.addListener?.(updateMobileTakeoverViewport);
  }
});

onBeforeUnmount(() => {
  releaseMobileTakeover({ restoreFocus: false });
  if (typeof mobileTakeoverMediaQuery?.removeEventListener === "function") {
    mobileTakeoverMediaQuery.removeEventListener("change", updateMobileTakeoverViewport);
  } else {
    mobileTakeoverMediaQuery?.removeListener?.(updateMobileTakeoverViewport);
  }
  mobileTakeoverMediaQuery = null;
});

watch([
  () => props.error,
  () => props.openErrorDetails
], ([error, openErrorDetails]) => {
  errorDetailsOpen.value = Boolean(error && openErrorDetails);
}, { immediate: true });

watch(() => props.starting, (starting) => {
  if (starting) {
    errorDetailsOpen.value = false;
  }
});
</script>

<style scoped>
.vibe64-terminal-surface {
  border: 1px solid rgba(var(--v-theme-outline), 0.32);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0.75rem;
  text-align: left;
}

.vibe64-terminal-surface--fill {
  height: 100%;
}

.vibe64-terminal-surface--focused {
  border-color: rgba(var(--v-theme-primary), 0.66);
}

.vibe64-terminal-surface__header,
.vibe64-terminal-surface__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-terminal-surface__header {
  margin-bottom: 0.55rem;
}

.vibe64-terminal-surface--collapsed .vibe64-terminal-surface__header {
  margin-bottom: 0;
}

.vibe64-terminal-surface--draggable .vibe64-terminal-surface__header {
  cursor: move;
  touch-action: none;
  user-select: none;
}

.vibe64-terminal-surface__heading {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
}

.vibe64-terminal-surface__title {
  font-size: 0.88rem;
}

.vibe64-terminal-surface__subtitle,
.vibe64-terminal-surface__footer {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
}

.vibe64-terminal-surface__actions {
  align-items: center;
  cursor: default;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  user-select: auto;
}

.vibe64-terminal-surface__retry {
  min-inline-size: 6.5rem;
}

.vibe64-terminal-surface__summary {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.045);
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 0.45rem;
  display: flex;
  gap: 0.4rem;
  min-height: 2rem;
  min-width: 0;
  padding: 0.3rem 0.5rem;
}

.vibe64-terminal-surface__summary-stage {
  color: rgba(var(--v-theme-on-surface), 0.72);
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 650;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-terminal-surface__summary-separator {
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex: 0 0 auto;
}

.vibe64-terminal-surface__summary-line {
  color: rgba(var(--v-theme-on-surface), 0.82);
  flex: 1 1 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.75rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-terminal-surface__before-terminal {
  margin-bottom: 0.5rem;
  min-width: 0;
}

.vibe64-terminal-surface__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.vibe64-terminal-surface__error-details {
  margin-bottom: 0.55rem;
  min-width: 0;
}

.vibe64-terminal-surface__stage {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.vibe64-terminal-surface__overlay:empty {
  display: none;
}

.vibe64-terminal-surface__overlay:not(:empty) {
  inset: 0;
  position: absolute;
  z-index: 1;
}

.vibe64-terminal-surface__host {
  background: #101216;
  border-radius: 0.45rem;
  height: var(--vibe64-terminal-host-height);
  min-height: 0;
  overflow: hidden;
}

.vibe64-terminal-surface__log {
  background: #101216;
  border-radius: 0.45rem;
  color: #f1f3f4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.75rem;
  height: var(--vibe64-terminal-host-height);
  line-height: 1.45;
  margin: 0;
  min-height: 0;
  overflow: auto;
  padding: 0.65rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.vibe64-terminal-surface--fill .vibe64-terminal-surface__host {
  height: 100%;
}

.vibe64-terminal-surface--fill .vibe64-terminal-surface__log {
  height: 100%;
}

.vibe64-terminal-surface__mount,
.vibe64-terminal-surface__mount :deep(.xterm) {
  height: 100%;
}

.vibe64-terminal-surface__command {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .vibe64-terminal-surface--mobile-takeover:not(.vibe64-terminal-surface--collapsed) {
    border-radius: 0 !important;
    box-sizing: border-box;
    height: 100dvh !important;
    inset: 0;
    margin: 0 !important;
    max-height: none !important;
    max-width: none !important;
    min-height: 0 !important;
    min-width: 0 !important;
    overflow: hidden;
    padding:
      max(0.75rem, env(safe-area-inset-top))
      max(0.75rem, env(safe-area-inset-right))
      max(0.75rem, env(safe-area-inset-bottom))
      max(0.75rem, env(safe-area-inset-left));
    position: fixed;
    width: 100vw !important;
    z-index: 2400;
  }

  .vibe64-terminal-surface--mobile-takeover:not(.vibe64-terminal-surface--collapsed) .vibe64-terminal-surface__stage {
    flex: 1 1 0;
  }

  .vibe64-terminal-surface--mobile-takeover:not(.vibe64-terminal-surface--collapsed) .vibe64-terminal-surface__host,
  .vibe64-terminal-surface--mobile-takeover:not(.vibe64-terminal-surface--collapsed) .vibe64-terminal-surface__log {
    height: 100%;
  }
}

@media (pointer: coarse) {
  .vibe64-terminal-surface__actions :deep(.v-btn) {
    min-height: 3rem;
    min-width: 3rem;
  }
}
</style>
