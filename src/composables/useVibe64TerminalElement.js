import { computed, nextTick, onBeforeUnmount, unref, watch } from "vue";
import { useVibe64TerminalWindow } from "@/composables/useVibe64TerminalWindow.js";
import { writeClipboardText } from "@/lib/clipboard.js";

/**
 * @typedef {{
 *   closeLabel: string,
 *   collapsible: boolean,
 *   commandPreview: string,
 *   disconnectWhenHidden: boolean,
 *   disposeDisplayWhenCollapsed: boolean,
 *   disposeDisplayWhenHidden: boolean,
 *   error: string,
 *   errorTitle: string,
 *   expanded: boolean | undefined,
 *   fill: boolean,
 *   floatingStorageKey: string,
 *   height: string,
 *   mobileTakeover: boolean,
 *   openErrorDetails: boolean,
 *   output: string | undefined,
 *   presentation: string,
 *   retryable: boolean,
 *   showClose: boolean,
 *   showCopy: boolean,
 *   showInterrupt: boolean,
 *   showLauncher: boolean,
 *   stage: string,
 *   startInput: object,
 *   startOnLaunch: boolean,
 *   status: string,
 *   subtitle: string,
 *   surfaceClass: unknown,
 *   surfaceStyle: unknown,
 *   terminal: import("@/types.js").Vibe64Terminal,
 *   title: string,
 *   visible: boolean | undefined
 * }} Vibe64TerminalElementProps
 */

/**
 * The terminal element's behaviour around one terminal runtime: which presentation shows, the surface's props, the
 * floating window, launching, closing, copying, and keeping the xterm display and socket in step with visibility.
 * The element's own `visible`, `expanded` and `output` props win over the runtime's values when they are given.
 * @param {{
 *   props: Vibe64TerminalElementProps,
 *   emit: (event: "close" | "copy" | "interrupt" | "launch" | "retry" | "update:expanded" | "update:visible", ...args: unknown[]) => void
 * }} options
 */
function useVibe64TerminalElement({ props, emit }) {
  function terminalValue(name, fallback = null) {
    const value = props.terminal[name];
    const resolved = unref(value);
    return typeof resolved === "undefined" ? fallback : resolved;
  }

  const visible = computed(() => typeof props.visible === "undefined"
    ? Boolean(terminalValue("terminalVisible", true))
    : Boolean(props.visible));
  const expanded = computed(() => {
    if (!props.collapsible) {
      return true;
    }
    return typeof props.expanded === "undefined"
      ? Boolean(terminalValue("terminalExpanded", false))
      : Boolean(props.expanded);
  });
  const floatingPresentation = computed(() => props.presentation === "floating");
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
    fill: expanded.value && (props.fill || floatingPresentation.value || dialogPresentation.value),
    focused: Boolean(terminalValue("terminalFocused", false)),
    height: props.height,
    mobileTakeover: props.mobileTakeover,
    openErrorDetails: props.openErrorDetails,
    output: typeof props.output === "undefined"
      ? String(terminalValue("terminalOutput", ""))
      : String(props.output || ""),
    retryable: props.retryable,
    selectedText: String(terminalValue("terminalSelectedText", "")),
    sessionId: String(terminalValue("terminalSessionId", "")),
    showClose: props.showClose,
    showCopy: props.showCopy,
    showInterrupt: props.showInterrupt,
    stage: props.stage,
    starting: starting.value,
    status: props.status || String(terminalValue("terminalStatus", "")),
    subtitle: props.subtitle,
    title: props.title
  }));

  const floatingWindow = useVibe64TerminalWindow({
    active: computed(() => visible.value && floatingPresentation.value),
    storageKey: computed(() => props.floatingStorageKey)
  });
  const floatingPanel = floatingWindow.panel;
  const floatingWindowStyle = floatingWindow.style;

  function setTerminalHost(element) {
    props.terminal.setTerminalHost(element);
  }

  async function ensureDisplay() {
    if (!visible.value || !expanded.value || props.presentation === "headless") {
      return false;
    }
    await nextTick();
    if (!(await props.terminal.setupTerminalUi())) {
      return false;
    }
    if (terminalValue("terminalSessionId", "")) {
      void props.terminal.connectTerminalSocket();
    }
    return true;
  }

  async function launch() {
    props.terminal.showTerminal({ manual: true });
    props.terminal.expandTerminal({ manual: true });
    emit("update:visible", true);
    emit("update:expanded", true);
    emit("launch");
    if (props.startOnLaunch) {
      await props.terminal.startTerminal(props.startInput);
    }
    await ensureDisplay();
  }

  function toggleExpanded() {
    const nextExpanded = !expanded.value;
    if (typeof props.expanded === "undefined") {
      if (nextExpanded) {
        props.terminal.expandTerminal({ manual: true });
      } else {
        props.terminal.collapseTerminal({ manual: true });
      }
    }
    emit("update:expanded", nextExpanded);
  }

  function requestClose() {
    if (typeof props.visible === "undefined") {
      props.terminal.hideTerminal({ manual: true });
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
    await props.terminal.sendCtrlC();
    emit("interrupt");
  }

  async function focus() {
    await props.terminal.focusTerminal();
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
        props.terminal.disposeTerminalDisplay();
      }
      if (!isVisible && props.disconnectWhenHidden) {
        props.terminal.closeTerminalSocket();
      }
    },
    { immediate: true }
  );

  watch(
    () => props.output,
    (output) => {
      if (typeof output !== "undefined") {
        props.terminal.setTerminalOutput(output);
      }
    },
    { immediate: true }
  );

  onBeforeUnmount(() => {
    setTerminalHost(null);
    props.terminal.disposeTerminalDisplay();
  });

  return {
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
  };
}

export {
  useVibe64TerminalElement
};
