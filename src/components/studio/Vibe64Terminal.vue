<template>
  <div v-if="launcherVisible" class="vibe64-terminal__launcher">
    <slot name="launcher" :launch="launch" :running="running">
      <v-btn
        :aria-busy="starting ? 'true' : undefined"
        class="vibe64-terminal__launcher-action"
        color="primary"
        :disabled="launcherDisabled || starting"
        variant="flat"
        @click="launch"
      >
        {{ starting ? "Opening…" : launcherLabel }}
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
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import { useVibe64TerminalElement } from "@/composables/useVibe64TerminalElement.js";

const props = defineProps({
  closeLabel: { default: "Close", type: String },
  collapsible: { default: true, type: Boolean },
  commandPreview: { default: "", type: String },
  dialogMaxWidth: { default: 1080, type: [Number, String] },
  disconnectWhenHidden: { default: false, type: Boolean },
  disposeDisplayWhenCollapsed: { default: false, type: Boolean },
  disposeDisplayWhenHidden: { default: true, type: Boolean },
  error: { default: "", type: String },
  errorTitle: { default: "Terminal needs attention", type: String },
  expanded: { default: undefined, type: Boolean },
  fill: { default: false, type: Boolean },
  floatingStorageKey: { default: "", type: String },
  height: { default: "clamp(18rem, 48vh, 34rem)", type: String },
  launcherDisabled: { default: false, type: Boolean },
  launcherLabel: { default: "Open terminal", type: String },
  mobileTakeover: { default: true, type: Boolean },
  openErrorDetails: { default: false, type: Boolean },
  output: { default: undefined, type: String },
  persistent: { default: true, type: Boolean },
  presentation: {
    default: "inline",
    type: String,
    validator: (value) => ["dialog", "floating", "fullscreen", "headless", "inline"].includes(value)
  },
  retryable: { default: false, type: Boolean },
  showClose: { default: true, type: Boolean },
  showCopy: { default: false, type: Boolean },
  showInterrupt: { default: true, type: Boolean },
  showLauncher: { default: false, type: Boolean },
  startInput: { default: () => ({}), type: Object },
  startOnLaunch: { default: false, type: Boolean },
  stage: { default: "", type: String },
  surfaceClass: { default: "", type: [String, Array, Object] },
  surfaceStyle: { default: null, type: [String, Array, Object] },
  status: { default: "", type: String },
  subtitle: { default: "", type: String },
  terminal: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Terminal>} */ (Object)
  },
  title: { default: "Terminal", type: String },
  visible: { default: undefined, type: Boolean }
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

const {
  copySelection,
  copyTerminalText,
  copyTranscript,
  dialogPresentation,
  floatingPanel,
  floatingPresentation,
  floatingWindow,
  floatingWindowStyle,
  focus,
  handleDialogVisibility,
  interrupt,
  launch,
  launcherVisible,
  requestClose,
  running,
  setTerminalHost,
  starting,
  surfaceProps,
  toggleExpanded,
  visible
} = useVibe64TerminalElement({ props, emit });

defineExpose({
  attach: (...args) => props.terminal.attachTerminal(...args),
  close: (...args) => props.terminal.closeTerminal(...args),
  collapse: (...args) => props.terminal.collapseTerminal(...args),
  copySelection,
  copyTranscript,
  detach: (...args) => props.terminal.detachTerminal(...args),
  expand: (...args) => props.terminal.expandTerminal(...args),
  focus,
  hide: (...args) => props.terminal.hideTerminal(...args),
  interrupt,
  minimize: (...args) => props.terminal.minimizeTerminal(...args),
  restart: (...args) => props.terminal.restartTerminal(...args),
  sendKey: (...args) => props.terminal.sendTerminalKey(...args),
  show: (...args) => props.terminal.showTerminal(...args),
  start: (...args) => props.terminal.startTerminal(...args),
  waitForExit: (...args) => props.terminal.waitForExit(...args),
  write: (...args) => props.terminal.sendTerminalData(...args)
});
</script>

<style scoped>
.vibe64-terminal__launcher {
  display: inline-flex;
}

.vibe64-terminal__launcher-action {
  min-inline-size: 7rem;
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

@media (max-width: 700px) {
  .vibe64-terminal__floating-panel {
    height: min(78vh, 42rem);
    width: calc(100vw - 1.5rem);
  }
}
</style>
