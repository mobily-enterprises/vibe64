import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import { firstTerminalUrl } from "@/lib/terminalOutputUrl.js";
import { createPollingTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

const DOCTOR_TERMINAL_POLL_INTERVAL_MS = 750;
const TERMINAL_SELECTION_COPY_DELAY_MS = 250;

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function useDoctorTerminal({
  onTerminalSettled = null,
  terminalEndpoint = () => ""
} = {}) {
  const terminalTitle = ref("Terminal");
  const terminalInitialCommandDetails = ref("");
  const terminalCopyStatus = ref("");
  const terminalReadPath = ref("");
  let terminalAutoCopyTimer = null;
  let terminalAutoCopiedText = "";
  let terminalSettledNotified = false;

  const notifyTerminalSettled = typeof onTerminalSettled === "function"
    ? onTerminalSettled
    : () => null;
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

  function terminalPath(path = "") {
    return `${terminalEndpoint()}${path}`;
  }

  function terminalSessionPath(sessionId, suffix = "") {
    return terminalPath(`/${encodeURIComponent(String(sessionId || ""))}${suffix}`);
  }

  async function startDoctorSession({ actionId = "", inputs = {} } = {}) {
    const session = await startTerminalCommand.run({
      path: terminalEndpoint(),
      payload: {
        actionId,
        inputs: plainObject(inputs)
      }
    });
    if (!session) {
      throw new Error("Terminal start failed.");
    }
    if (session.ok === false) {
      throw new Error(session.error || "Terminal start failed.");
    }
    return session;
  }

  async function readDoctorSession(sessionId) {
    terminalReadPath.value = terminalSessionPath(sessionId);
    await nextTick();
    const result = await terminalPollResource.reload();
    return result?.data || terminalPollResource.data.value || {};
  }

  async function writeDoctorInput(sessionId, data) {
    await terminalInputResource.save({
      data
    }, {
      method: "POST",
      path: terminalSessionPath(sessionId, "/input")
    });
  }

  async function closeDoctorSession(sessionId) {
    await closeTerminalCommand.run({
      path: terminalSessionPath(sessionId)
    });
  }

  function notifyTerminalSettledOnce(session = null) {
    if (terminalSettledNotified) {
      return;
    }
    terminalSettledNotified = true;
    notifyTerminalSettled(session);
  }

  const driver = createPollingTerminalDriver({
    closeSession: closeDoctorSession,
    pollIntervalMs: DOCTOR_TERMINAL_POLL_INTERVAL_MS,
    readSession: readDoctorSession,
    startSession: startDoctorSession,
    writeInput: writeDoctorInput
  });
  const terminal = useVibe64Terminal({
    driver,
    fitOnResize: true,
    initiallyVisible: false,
    liveResize: false,
    onEvent(event) {
      if (event.type === "exit") {
        notifyTerminalSettledOnce({
          closeError: terminal.terminalCloseError.value,
          exitCode: terminal.terminalExitCode.value,
          id: terminal.terminalSessionId.value,
          output: terminal.terminalOutput.value,
          status: terminal.terminalStatus.value
        });
      }
    },
    presentation: "dialog"
  });
  const terminalCommandDetails = computed(() => (
    String(terminal.terminalMetadata.value?.commandDetails || terminalInitialCommandDetails.value || "")
  ));
  const terminalUrl = computed(() => firstTerminalUrl(terminal.terminalOutput.value));

  async function copyTerminalText(value, label) {
    const text = String(value || "");
    if (!text) {
      return false;
    }
    try {
      await writeClipboardText(text);
      terminalCopyStatus.value = `${label} copied.`;
      return true;
    } catch (error) {
      terminalCopyStatus.value = String(error?.message || error || "Copy failed.");
      return false;
    }
  }

  async function copyTerminalSelection() {
    const selectedText = String(terminal.terminalSelectedText.value || "");
    if (await copyTerminalText(selectedText, "Selection")) {
      terminalAutoCopiedText = selectedText;
    }
  }

  async function copyTerminalUrl() {
    await copyTerminalText(terminalUrl.value, "URL");
  }

  function terminalTextCopied() {
    terminalCopyStatus.value = "Terminal text copied.";
  }

  function resetTerminalCopyState() {
    if (terminalAutoCopyTimer) {
      globalThis.clearTimeout(terminalAutoCopyTimer);
      terminalAutoCopyTimer = null;
    }
    terminalAutoCopiedText = "";
    terminalCopyStatus.value = "";
  }

  async function openTerminal({
    inputs = {},
    repair,
    visible = true,
    waitForExit = false
  } = {}) {
    if (!repair?.actionId) {
      return {
        error: "Terminal action is required.",
        ok: false
      };
    }

    if (terminal.terminalSessionId.value) {
      const closed = await terminal.closeTerminal({
        deleteSession: terminal.terminalOwnership.value === "owned"
      });
      if (!closed) {
        return {
          error: terminal.terminalError.value || "Previous terminal could not close.",
          ok: false
        };
      }
    }

    terminal.closeTerminalSocket();
    terminal.resetTerminalSessionState();
    terminal.resetTerminalDisplay();
    terminal.hideTerminal();
    resetTerminalCopyState();
    terminalSettledNotified = false;
    terminalTitle.value = String(repair.label || "Terminal");
    terminalInitialCommandDetails.value = "";

    const session = await terminal.startTerminal({
      actionId: repair.actionId,
      inputs
    }, {
      show: visible
    });
    if (!session) {
      return {
        error: terminal.terminalError.value || "Terminal start failed.",
        ok: false
      };
    }

    if (!waitForExit) {
      return session;
    }
    return terminal.waitForSettlement(session.id);
  }

  async function closeTerminal() {
    terminal.hideTerminal({ manual: true });
    const closed = await terminal.closeTerminal({
      deleteSession: true,
      preserveOutput: true
    });
    terminal.disposeTerminalDisplay();
    notifyTerminalSettledOnce();
    return closed;
  }

  watch(terminal.terminalSelectedText, (selectedText) => {
    if (terminalAutoCopyTimer) {
      globalThis.clearTimeout(terminalAutoCopyTimer);
      terminalAutoCopyTimer = null;
    }
    const text = String(selectedText || "");
    if (!text || text === terminalAutoCopiedText) {
      return;
    }
    terminalAutoCopyTimer = globalThis.setTimeout(async () => {
      terminalAutoCopyTimer = null;
      const currentText = String(terminal.terminalSelectedText.value || "");
      if (!currentText || currentText === terminalAutoCopiedText) {
        return;
      }
      if (await copyTerminalText(currentText, "Selection")) {
        terminalAutoCopiedText = currentText;
      }
    }, TERMINAL_SELECTION_COPY_DELAY_MS);
  });

  onBeforeUnmount(() => {
    resetTerminalCopyState();
    terminal.disposeTerminalUi();
  });

  return {
    closeTerminal,
    copyTerminalSelection,
    copyTerminalUrl,
    openTerminal,
    sendCtrlC: terminal.sendCtrlC,
    terminal,
    terminalCloseError: terminal.terminalCloseError,
    terminalCommandDetails,
    terminalCommandPreview: terminal.terminalCommandPreview,
    terminalCopyStatus,
    terminalDialogOpen: terminal.terminalVisible,
    terminalError: terminal.terminalError,
    terminalExitCode: terminal.terminalExitCode,
    terminalOutput: terminal.terminalOutput,
    terminalSelectedText: terminal.terminalSelectedText,
    terminalSessionId: terminal.terminalSessionId,
    terminalStatus: terminal.terminalStatus,
    terminalTextCopied,
    terminalTitle,
    terminalUrl
  };
}

export {
  DOCTOR_TERMINAL_POLL_INTERVAL_MS,
  useDoctorTerminal
};
