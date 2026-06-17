import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { isDynamicImportError } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  useShellAsyncModuleRecoveryRuntime
} from "@jskit-ai/shell-web/client/asyncModuleRecovery";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { writeClipboardText } from "@/lib/clipboard.js";
import { firstTerminalUrl } from "@/lib/terminalOutputUrl.js";
import { loadXtermModules } from "@/lib/xtermModuleLoader.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

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
  const terminalCommandDetails = ref("");
  const terminalCloseError = ref("");
  const terminalExitCode = ref(null);
  const terminalOutput = ref("");
  const terminalSelectedText = ref("");
  const terminalCopyStatus = ref("");
  const terminalReadPath = ref("");
  const terminalOutputUrl = computed(() => firstTerminalUrl(terminalOutput.value));

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalResizeHandler = null;
  let terminalPollTimer = null;
  let terminalAutoCopyTimer = null;
  let terminalOutputOffset = 0;
  let terminalAutoCopiedText = "";
  let terminalSettledNotified = false;

  const notifyTerminalSettled = typeof onTerminalSettled === "function"
    ? onTerminalSettled
    : () => null;
  const asyncModuleRecoveryRuntime = useShellAsyncModuleRecoveryRuntime();
  const terminalPollResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Terminal status could not load.",
    path: computed(() => terminalReadPath.value),
    queryKey: computed(() => [
      "vibe64",
      "doctor-terminal",
      terminalReadPath.value
    ]),
    requestRecoveryLabel: "Setup terminal"
  });
  const terminalInputResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "Terminal input failed.",
    path: computed(() => terminalEndpoint()),
    queryKey: ["vibe64", "doctor-terminal", "input"],
    requestRecovery: false
  });
  const startTerminalCommand = useCommand({
    access: "never",
    apiSuffix: "/studio",
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: String(context.path || "")
    }),
    buildRawPayload: (_model, { context }) => plainObject(context.payload),
    fallbackRunError: "Terminal start failed.",
    messages: {
      error: "Terminal start failed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.doctor-terminal.start",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const closeTerminalCommand = useCommand({
    access: "never",
    apiSuffix: "/studio",
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: String(context.path || "")
    }),
    fallbackRunError: "Terminal could not close.",
    messages: {
      error: "Terminal could not close."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.doctor-terminal.close",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  function terminalUrl(path = "") {
    return `${terminalEndpoint()}${path}`;
  }

  function notifyTerminalSettledOnce(session = null) {
    if (terminalSettledNotified) {
      return;
    }
    terminalSettledNotified = true;
    notifyTerminalSettled(session);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
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

  async function copyTerminalUrl() {
    await copyTerminalText(terminalOutputUrl.value, "URL");
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

    let terminalLibrary;
    try {
      terminalLibrary = await loadXtermModules();
    } catch (error) {
      terminalError.value = "Terminal module could not load. Check your connection and retry.";
      asyncModuleRecoveryRuntime?.notify?.(error, {
        label: "Terminal",
        stale: isDynamicImportError(error)
      });
      return false;
    }

    terminalInstance = new terminalLibrary.Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#111318",
        foreground: "#f4f6fb"
      }
    });
    terminalFitAddon = new terminalLibrary.FitAddon();
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
    return true;
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
      terminalReadPath.value = terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}`);
      await nextTick();
      const result = await terminalPollResource.reload();
      const session = result?.data || terminalPollResource.data.value || {};
      terminalCloseError.value = session.closeError || "";
      terminalExitCode.value = Number.isInteger(session.exitCode) ? session.exitCode : null;
      terminalOutput.value = session.output || "";
      terminalStatus.value = session.status || "";
      terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
      terminalCommandDetails.value = session.metadata?.commandDetails || terminalCommandDetails.value;
      writeTerminalOutput(session.output);
      if (session.status === "exited") {
        if (terminalPollTimer) {
          window.clearInterval(terminalPollTimer);
          terminalPollTimer = null;
        }
        notifyTerminalSettledOnce(session);
      }
      return session;
    } catch (pollError) {
      terminalError.value = String(pollError?.message || pollError || "Terminal polling failed.");
      return null;
    }
  }

  async function sendTerminalData(data) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return;
    }

    try {
      await terminalInputResource.save({
        data
      }, {
        method: "POST",
        path: terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}/input`)
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
    repair,
    visible = true,
    waitForExit = false
  }) {
    terminalDialogOpen.value = visible;
    terminalError.value = "";
    terminalCloseError.value = "";
    terminalCopyStatus.value = "";
    terminalExitCode.value = null;
    terminalOutput.value = "";
    terminalSelectedText.value = "";
    terminalAutoCopiedText = "";
    terminalSettledNotified = false;
    terminalTitle.value = repair?.label || "Terminal";
    terminalCommandPreview.value = repair?.commandPreview || "";
    terminalCommandDetails.value = "";
    terminalSessionId.value = "";
    terminalStatus.value = "starting";
    disposeTerminalUi();

    try {
      if (visible) {
        const terminalUiReady = await setupTerminalUi();
        if (!terminalUiReady) {
          throw new Error(terminalError.value || "Terminal module could not load.");
        }
      }
      const session = await startTerminalCommand.run({
        path: terminalEndpoint(),
        payload: {
          actionId: repair.actionId,
          inputs
        }
      });
      if (!session) {
        throw new Error("Terminal start failed.");
      }
      if (session.ok === false) {
        throw new Error(session.error || "Terminal start failed.");
      }
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
      terminalCommandDetails.value = session.metadata?.commandDetails || terminalCommandDetails.value;
      terminalCloseError.value = session.closeError || "";
      terminalExitCode.value = Number.isInteger(session.exitCode) ? session.exitCode : null;
      terminalOutput.value = session.output || "";
      writeTerminalOutput(session.output);
      if (waitForExit) {
        let currentSession = session;
        while (terminalSessionId.value && currentSession?.status !== "exited") {
          await wait(750);
          currentSession = await pollTerminal();
          if (!currentSession) {
            break;
          }
        }
        return currentSession || session;
      }
      terminalPollTimer = window.setInterval(() => {
        void pollTerminal();
      }, 750);
      await pollTerminal();
      return session;
    } catch (openError) {
      terminalError.value = String(openError?.message || openError || "Terminal start failed.");
      return {
        error: terminalError.value,
        ok: false
      };
    }
  }

  async function closeTerminal() {
    const sessionId = terminalSessionId.value;
    terminalDialogOpen.value = false;
    terminalSessionId.value = "";
    terminalStatus.value = "";
    if (sessionId) {
      await closeTerminalCommand.run({
        path: terminalUrl(`/${encodeURIComponent(sessionId)}`)
      }).catch(() => null);
    }
    disposeTerminalUi();
    notifyTerminalSettledOnce();
  }

  onBeforeUnmount(() => {
    disposeTerminalUi();
  });

  return {
    closeTerminal,
    copyTerminalSelection,
    copyTerminalUrl,
    openTerminal,
    sendCtrlC,
    terminalCloseError,
    terminalCommandDetails,
    terminalCommandPreview,
    terminalCopyStatus,
    terminalDialogOpen,
    terminalError,
    terminalExitCode,
    terminalHost,
    terminalOutput,
    terminalSelectedText,
    terminalSessionId,
    terminalStatus,
    terminalTitle,
    terminalUrl: terminalOutputUrl
  };
}

export {
  useDoctorTerminal
};
