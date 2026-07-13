<template>
  <div v-if="launcherVisible" class="vibe64-terminal__launcher">
    <slot name="launcher" :launch="launch" :running="running">
      <v-btn
        color="primary"
        :disabled="launcherDisabled"
        :loading="starting"
        variant="flat"
        @click="launch"
      >
        {{ launcherLabel }}
      </v-btn>
    </slot>
  </div>

  <v-dialog
    v-if="dialogPresentation"
    :fullscreen="presentation === 'fullscreen'"
    :model-value="visible"
    :max-width="presentation === 'dialog' ? dialogMaxWidth : undefined"
    :persistent="persistent"
    @update:model-value="handleDialogVisibility"
  >
    <Vibe64TerminalSurface
      v-if="visible"
      v-bind="surfaceProps"
      :terminal-host-ref="setTerminalHost"
      @close="requestClose"
      @copy="copyTerminalText"
      @focus="focus"
      @interrupt="interrupt"
      @retry="$emit('retry')"
      @toggle-expanded="toggleExpanded"
    >
      <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps || {}" />
      </template>
    </Vibe64TerminalSurface>
  </v-dialog>

  <Teleport v-else-if="floatingPresentation" to="body">
    <div
      v-if="visible"
      class="vibe64-terminal__floating-layer"
      :class="{
        'vibe64-terminal__floating-layer--minimized': minimized
      }"
    >
      <div
        ref="floatingPanel"
        class="vibe64-terminal__floating-panel"
        :style="floatingWindowStyle"
      >
        <Vibe64TerminalSurface
          v-bind="surfaceProps"
          draggable
          fill
          :terminal-host-ref="setTerminalHost"
          @close="requestClose"
          @copy="copyTerminalText"
          @drag-start="floatingWindow.startDrag"
          @focus="focus"
          @interrupt="interrupt"
          @retry="$emit('retry')"
          @toggle-expanded="toggleExpanded"
        >
          <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
            <slot :name="slotName" v-bind="slotProps || {}" />
          </template>
        </Vibe64TerminalSurface>
      </div>
    </div>
  </Teleport>

  <Vibe64TerminalSurface
    v-else-if="visible && presentation !== 'headless'"
    v-bind="surfaceProps"
    :terminal-host-ref="setTerminalHost"
    @close="requestClose"
    @copy="copyTerminalText"
    @focus="focus"
    @interrupt="interrupt"
    @retry="$emit('retry')"
    @toggle-expanded="toggleExpanded"
  >
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64TerminalSurface>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, unref, watch } from "vue";
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import { useVibe64TerminalWindow } from "@/composables/useVibe64TerminalWindow.js";
import { writeClipboardText } from "@/lib/clipboard.js";

const props = defineProps({
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
  dialogMaxWidth: {
    default: 1080,
    type: [Number, String]
  },
  disconnectWhenHidden: {
    default: false,
    type: Boolean
  },
  disposeDisplayWhenCollapsed: {
    default: false,
    type: Boolean
  },
  disposeDisplayWhenHidden: {
    default: true,
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
  expanded: {
    default: undefined,
    type: null
  },
  fill: {
    default: false,
    type: Boolean
  },
  floatingStorageKey: {
    default: "",
    type: String
  },
  height: {
    default: "clamp(18rem, 48vh, 34rem)",
    type: String
  },
  launcherDisabled: {
    default: false,
    type: Boolean
  },
  launcherLabel: {
    default: "Open terminal",
    type: String
  },
  output: {
    default: undefined,
    type: null
  },
  persistent: {
    default: true,
    type: Boolean
  },
  presentation: {
    default: "inline",
    type: String,
    validator: (value) => [
      "dialog",
      "floating",
      "fullscreen",
      "headless",
      "inline",
      "minimized"
    ].includes(value)
  },
  retryable: {
    default: false,
    type: Boolean
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
  showLauncher: {
    default: false,
    type: Boolean
  },
  startInput: {
    default: () => ({}),
    type: Object
  },
  startOnLaunch: {
    default: false,
    type: Boolean
  },
  surfaceClass: {
    default: "",
    type: [String, Array, Object]
  },
  surfaceStyle: {
    default: null,
    type: [String, Array, Object]
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  terminal: {
    required: true,
    type: Object
  },
  title: {
    default: "Terminal",
    type: String
  },
  visible: {
    default: undefined,
    type: null
  }
});

const emit = defineEmits([
  "close",
  "copy",
  "interrupt",
  "launch",
  "retry",
  "update:expanded",
  "update:visible"
]);

const forwardedSlots = [
  "actions-after",
  "actions-before",
  "before-terminal",
  "error-actions",
  "footer",
  "heading",
  "overlay"
];

function terminalValue(name, fallback = null) {
  const value = props.terminal?.[name];
  const resolved = unref(value);
  return typeof resolved === "undefined" ? fallback : resolved;
}

const visible = computed(() => typeof props.visible === "undefined"
  ? Boolean(terminalValue("terminalVisible", true))
  : Boolean(props.visible));
const expanded = computed(() => typeof props.expanded === "undefined"
  ? Boolean(terminalValue("terminalExpanded", true))
  : Boolean(props.expanded));
const minimized = computed(() => props.presentation === "minimized");
const floatingPresentation = computed(() => ["floating", "minimized"].includes(props.presentation));
const dialogPresentation = computed(() => ["dialog", "fullscreen"].includes(props.presentation));
const launcherVisible = computed(() => props.showLauncher && !visible.value);
const running = computed(() => {
  const status = String(terminalValue("terminalStatus", props.status) || "");
  return Boolean(terminalValue("terminalSessionId", "")) && status !== "exited";
});
const starting = computed(() => Boolean(terminalValue("terminalStarting", false)));
const surfaceProps = computed(() => ({
  class: props.surfaceClass,
  style: props.surfaceStyle,
  closeLabel: props.closeLabel,
  collapsible: props.collapsible,
  commandPreview: props.commandPreview || String(terminalValue("terminalCommandPreview", "")),
  error: props.error || String(terminalValue("terminalError", "")),
  errorTitle: props.errorTitle,
  exited: Boolean(terminalValue("terminalExited", false)),
  expanded: expanded.value,
  fill: props.fill || floatingPresentation.value || dialogPresentation.value,
  focused: Boolean(terminalValue("terminalFocused", false)),
  height: props.height,
  output: typeof props.output === "undefined"
    ? String(terminalValue("terminalOutput", ""))
    : String(props.output || ""),
  retryable: props.retryable,
  selectedText: String(terminalValue("terminalSelectedText", "")),
  sessionId: String(terminalValue("terminalSessionId", "")),
  showClose: props.showClose,
  showCopy: props.showCopy,
  showInterrupt: props.showInterrupt,
  starting: starting.value,
  status: props.status || String(terminalValue("terminalStatus", "")),
  subtitle: props.subtitle,
  title: props.title
}));

const floatingWindow = useVibe64TerminalWindow({
  active: computed(() => visible.value && floatingPresentation.value),
  minimized,
  minimizedWidth: "min(28rem, calc(100vw - 1.5rem))",
  storageKey: computed(() => props.floatingStorageKey)
});
const floatingPanel = floatingWindow.panel;
const floatingWindowStyle = floatingWindow.style;

function setTerminalHost(element) {
  props.terminal?.setTerminalHost?.(element);
}

async function ensureDisplay() {
  if (!visible.value || !expanded.value || props.presentation === "headless") {
    return false;
  }
  await nextTick();
  if (!(await props.terminal?.setupTerminalUi?.())) {
    return false;
  }
  if (terminalValue("terminalSessionId", "")) {
    void props.terminal?.connectTerminalSocket?.();
  }
  return true;
}

async function launch() {
  props.terminal?.showTerminal?.({ manual: true });
  props.terminal?.expandTerminal?.({ manual: true });
  emit("update:visible", true);
  emit("update:expanded", true);
  emit("launch");
  if (props.startOnLaunch) {
    await props.terminal?.startTerminal?.(props.startInput);
  }
  await ensureDisplay();
}

function toggleExpanded() {
  const nextExpanded = !expanded.value;
  if (typeof props.expanded === "undefined") {
    if (nextExpanded) {
      props.terminal?.expandTerminal?.({ manual: true });
    } else {
      props.terminal?.collapseTerminal?.({ manual: true });
    }
  }
  emit("update:expanded", nextExpanded);
}

function requestClose() {
  if (typeof props.visible === "undefined") {
    props.terminal?.hideTerminal?.({ manual: true });
  }
  emit("update:visible", false);
  emit("close");
}

function handleDialogVisibility(nextVisible) {
  if (!nextVisible) {
    requestClose();
  }
}

async function interrupt() {
  await props.terminal?.sendCtrlC?.();
  emit("interrupt");
}

async function focus() {
  await props.terminal?.focusTerminal?.();
}

async function copyTerminalText() {
  const text = String(
    terminalValue("terminalSelectedText", "") ||
    terminalValue("terminalPlainOutput", "") ||
    terminalValue("terminalOutput", "")
  );
  if (!text) {
    return false;
  }
  await writeClipboardText(text);
  emit("copy", text);
  return true;
}

async function copySelection() {
  const text = String(terminalValue("terminalSelectedText", ""));
  if (!text) {
    return false;
  }
  await writeClipboardText(text);
  emit("copy", text);
  return true;
}

async function copyTranscript() {
  const text = String(
    terminalValue("terminalPlainOutput", "") ||
    terminalValue("terminalOutput", "")
  );
  if (!text) {
    return false;
  }
  await writeClipboardText(text);
  emit("copy", text);
  return true;
}

watch(
  () => [visible.value, expanded.value, props.presentation],
  async ([isVisible, isExpanded]) => {
    if (isVisible && isExpanded && props.presentation !== "headless") {
      await ensureDisplay();
      return;
    }
    if ((!isVisible && props.disposeDisplayWhenHidden) || (!isExpanded && props.disposeDisplayWhenCollapsed)) {
      props.terminal?.disposeTerminalDisplay?.();
    }
    if (!isVisible && props.disconnectWhenHidden) {
      props.terminal?.closeTerminalSocket?.();
    }
  },
  { immediate: true }
);

watch(
  () => props.output,
  (output) => {
    if (typeof output !== "undefined") {
      props.terminal?.setTerminalOutput?.(output);
    }
  },
  { immediate: true }
);

defineExpose({
  attach: (...args) => props.terminal?.attachTerminal?.(...args),
  close: (...args) => props.terminal?.closeTerminal?.(...args),
  collapse: (...args) => props.terminal?.collapseTerminal?.(...args),
  copySelection,
  copyTranscript,
  detach: (...args) => props.terminal?.detachTerminal?.(...args),
  expand: (...args) => props.terminal?.expandTerminal?.(...args),
  focus,
  hide: (...args) => props.terminal?.hideTerminal?.(...args),
  interrupt,
  minimize: (...args) => props.terminal?.minimizeTerminal?.(...args),
  restart: (...args) => props.terminal?.restartTerminal?.(...args),
  sendKey: (...args) => props.terminal?.sendTerminalKey?.(...args),
  show: (...args) => props.terminal?.showTerminal?.(...args),
  start: (...args) => props.terminal?.startTerminal?.(...args),
  waitForExit: (...args) => props.terminal?.waitForExit?.(...args),
  write: (...args) => props.terminal?.sendTerminalData?.(...args)
});

onBeforeUnmount(() => {
  setTerminalHost(null);
  props.terminal?.disposeTerminalDisplay?.();
});
</script>

<style scoped>
.vibe64-terminal__launcher {
  display: inline-flex;
}

.vibe64-terminal__floating-layer {
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 2400;
}

.vibe64-terminal__floating-panel {
  height: min(72vh, 44rem);
  max-height: calc(100vh - 1.5rem);
  max-width: calc(100vw - 1.5rem);
  min-height: 18rem;
  min-width: min(28rem, calc(100vw - 1.5rem));
  overflow: hidden;
  pointer-events: auto;
  position: fixed;
  resize: both;
  width: min(92vw, 72rem);
}

.vibe64-terminal__floating-layer--minimized .vibe64-terminal__floating-panel {
  bottom: 0.75rem;
  height: auto;
  min-height: 0;
  min-width: 0;
  resize: none;
  right: calc(0.75rem + var(--vibe64-terminal-minimized-right, 0px));
  width: var(--vibe64-terminal-minimized-width);
}

@media (max-width: 700px) {
  .vibe64-terminal__floating-panel {
    height: min(78vh, 42rem);
    width: calc(100vw - 1.5rem);
  }

  .vibe64-terminal__floating-layer--minimized .vibe64-terminal__floating-panel {
    left: 0.75rem;
    right: 0.75rem;
    width: auto;
  }
}
</style>
