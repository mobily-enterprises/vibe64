import { nextTick, onBeforeUnmount, ref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { writeClipboardText } from "@/lib/clipboard.js";
import { studioHttpClient } from "@/lib/studioHttp.js";
import "@xterm/xterm/css/xterm.css";

function useDoctorTerminal({
  onTerminalSettled = null,
  terminalEndpoint = () => ""
} = {}) {
  const terminalDialogOpen = ref(false);
  const terminalError = ref("");
  const terminalHost = ref(null);
  const terminalSessionId = ref("");
  const terminalStatus = ref("");
  const terminalTitle = ref("Terminal");
  const terminalCommandPreview = ref("");
  const terminalSelectedText = ref("");
  const terminalCopyStatus = ref("");

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalResizeHandler = null;
  let terminalPollTimer = null;
  let terminalAutoCopyTimer = null;
  let terminalOutputOffset = 0;
  let terminalAutoCopiedText = "";

  const notifyTerminalSettled = typeof onTerminalSettled === "function"
    ? onTerminalSettled
    : () => null;

  function terminalUrl(path = "") {
    return `${terminalEndpoint()}${path}`;
  }

  async function copyTerminalText(value, label) {
    const text = String(value || "");
    if (!text) {
      return false;
    }

    try {
      await writeClipboardText(text);
      terminalCopyStatus.value = `${label} copied.`;
      return true;
    } catch (copyError) {
      terminalCopyStatus.value = String(copyError?.message || copyError || "Copy failed.");
      return false;
    }
  }

  function updateTerminalSelection() {
    terminalSelectedText.value = terminalInstance?.hasSelection?.()
      ? terminalInstance.getSelection()
      : "";
    return terminalSelectedText.value;
  }

  function scheduleAutoCopyTerminalSelection() {
    const selectedText = updateTerminalSelection();
    if (terminalAutoCopyTimer) {
      window.clearTimeout(terminalAutoCopyTimer);
      terminalAutoCopyTimer = null;
    }
    if (!selectedText || selectedText === terminalAutoCopiedText) {
      return;
    }

    terminalAutoCopyTimer = window.setTimeout(async () => {
      const nextSelectedText = updateTerminalSelection();
      if (!nextSelectedText || nextSelectedText === terminalAutoCopiedText) {
        return;
      }
      if (await copyTerminalText(nextSelectedText, "Selection")) {
        terminalAutoCopiedText = nextSelectedText;
      }
    }, 250);
  }

  async function copyTerminalSelection() {
    const selectedText = updateTerminalSelection();
    if (await copyTerminalText(selectedText, "Selection")) {
      terminalAutoCopiedText = selectedText;
    }
  }

  function disposeTerminalUi() {
    if (terminalPollTimer) {
      window.clearInterval(terminalPollTimer);
      terminalPollTimer = null;
    }
    if (terminalAutoCopyTimer) {
      window.clearTimeout(terminalAutoCopyTimer);
      terminalAutoCopyTimer = null;
    }
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    terminalSelectionDisposable?.dispose?.();
    terminalSelectionDisposable = null;
    if (terminalResizeHandler) {
      window.removeEventListener("resize", terminalResizeHandler);
      terminalResizeHandler = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSelectedText.value = "";
    terminalOutputOffset = 0;
    terminalAutoCopiedText = "";
  }

  async function setupTerminalUi() {
    await nextTick();
    disposeTerminalUi();
    if (!terminalHost.value) {
      throw new Error("Terminal view is not ready yet.");
    }

    terminalInstance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#111318",
        foreground: "#f4f6fb"
      }
    });
    terminalFitAddon = new FitAddon();
    terminalInstance.loadAddon(terminalFitAddon);
    terminalInstance.open(terminalHost.value);
    terminalFitAddon.fit();
    terminalDataDisposable = terminalInstance.onData((data) => {
      void sendTerminalData(data);
    });
    terminalSelectionDisposable = terminalInstance.onSelectionChange(() => {
      scheduleAutoCopyTerminalSelection();
    });
    terminalResizeHandler = () => {
      terminalFitAddon?.fit();
    };
    window.addEventListener("resize", terminalResizeHandler);
  }

  function writeTerminalOutput(output) {
    if (!terminalInstance) {
      return;
    }
    const nextOutput = String(output || "");
    if (nextOutput.length < terminalOutputOffset) {
      terminalOutputOffset = 0;
      terminalInstance.reset();
    }
    const chunk = nextOutput.slice(terminalOutputOffset);
    if (chunk) {
      terminalInstance.write(chunk);
      terminalOutputOffset = nextOutput.length;
    }
  }

  async function pollTerminal() {
    if (!terminalSessionId.value) {
      return;
    }

    try {
      const session = await studioHttpClient.get(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}`));
      terminalStatus.value = session.status || "";
      terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
      writeTerminalOutput(session.output);
      if (session.status === "exited" && terminalPollTimer) {
        window.clearInterval(terminalPollTimer);
        terminalPollTimer = null;
        notifyTerminalSettled();
      }
    } catch (pollError) {
      terminalError.value = String(pollError?.message || pollError || "Terminal polling failed.");
    }
  }

  async function sendTerminalData(data) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return;
    }

    try {
      await studioHttpClient.post(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}/input`), {
        data
      });
    } catch (sendError) {
      terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
    }
  }

  async function sendCtrlC() {
    await sendTerminalData("\u0003");
  }

  async function openTerminal({
    inputs = {},
    repair
  }) {
    terminalDialogOpen.value = true;
    terminalError.value = "";
    terminalCopyStatus.value = "";
    terminalSelectedText.value = "";
    terminalAutoCopiedText = "";
    terminalTitle.value = repair?.label || "Terminal";
    terminalCommandPreview.value = repair?.commandPreview || "";
    terminalSessionId.value = "";
    terminalStatus.value = "starting";

    try {
      await setupTerminalUi();
      const session = await studioHttpClient.post(terminalEndpoint(), {
        actionId: repair.actionId,
        inputs
      });
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
      writeTerminalOutput(session.output);
      terminalPollTimer = window.setInterval(() => {
        void pollTerminal();
      }, 750);
      await pollTerminal();
    } catch (openError) {
      terminalError.value = String(openError?.message || openError || "Terminal start failed.");
    }
  }

  async function closeTerminal() {
    const sessionId = terminalSessionId.value;
    terminalDialogOpen.value = false;
    terminalSessionId.value = "";
    terminalStatus.value = "";
    if (sessionId) {
      await studioHttpClient.delete(terminalUrl(`/${encodeURIComponent(sessionId)}`)).catch(() => null);
    }
    disposeTerminalUi();
    notifyTerminalSettled();
  }

  onBeforeUnmount(() => {
    disposeTerminalUi();
  });

  return {
    closeTerminal,
    copyTerminalSelection,
    openTerminal,
    sendCtrlC,
    terminalCommandPreview,
    terminalCopyStatus,
    terminalDialogOpen,
    terminalError,
    terminalHost,
    terminalSelectedText,
    terminalSessionId,
    terminalStatus,
    terminalTitle
  };
}

export {
  useDoctorTerminal
};
