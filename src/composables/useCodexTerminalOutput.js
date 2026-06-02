import { ref, unref } from "vue";

const CODEX_ACTIVITY_QUIET_MS = 2200;
const TERMINAL_STREAM_QUIET_MS = 2500;

function useCodexTerminalOutput({
  emitBusyChanged,
  sessionId
} = {}) {
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const terminalStreaming = ref(false);

  let codexIdleTimer = null;
  let terminalStreamingTimer = null;
  let codexBusyOutputVersion = 0;
  let terminalOutput = "";
  let terminalOutputVersion = 0;

  function clearCodexIdleTimer() {
    if (!codexIdleTimer) {
      return;
    }
    globalThis.clearTimeout(codexIdleTimer);
    codexIdleTimer = null;
  }

  function emitCodexActivityChanged() {
    const payload = {
      busy: codexBusy.value,
      sessionId: unref(sessionId),
      streaming: terminalStreaming.value,
      working: codexWorking.value
    };
    emitBusyChanged?.(payload);
  }

  function clearTerminalStreamingTimer() {
    if (!terminalStreamingTimer) {
      return;
    }
    globalThis.clearTimeout(terminalStreamingTimer);
    terminalStreamingTimer = null;
  }

  function setTerminalStreaming(nextStreaming) {
    const streaming = Boolean(nextStreaming);
    if (terminalStreaming.value === streaming) {
      return;
    }
    terminalStreaming.value = streaming;
    emitCodexActivityChanged();
  }

  function markTerminalStreaming() {
    setTerminalStreaming(true);
    clearTerminalStreamingTimer();
    terminalStreamingTimer = globalThis.setTimeout(() => {
      terminalStreamingTimer = null;
      setTerminalStreaming(false);
    }, TERMINAL_STREAM_QUIET_MS);
  }

  function setCodexBusy(nextBusy) {
    const busy = Boolean(nextBusy);
    if (codexBusy.value === busy) {
      return;
    }
    codexBusy.value = busy;
    emitCodexActivityChanged();
  }

  function setCodexWorking(nextWorking) {
    const working = Boolean(nextWorking);
    if (codexWorking.value === working) {
      return;
    }
    codexWorking.value = working;
    emitCodexActivityChanged();
  }

  function clearCodexWorking() {
    setCodexWorking(false);
  }

  function markCodexBusy() {
    clearCodexIdleTimer();
    codexBusyOutputVersion = terminalOutputVersion;
    setCodexBusy(true);
  }

  function clearCodexBusy() {
    clearCodexIdleTimer();
    codexBusyOutputVersion = terminalOutputVersion;
    setCodexBusy(false);
  }

  function scheduleCodexIdleWhenQuiet() {
    if (!codexBusy.value || terminalOutputVersion <= codexBusyOutputVersion) {
      return;
    }
    clearCodexIdleTimer();
    codexIdleTimer = globalThis.setTimeout(() => {
      codexIdleTimer = null;
      clearCodexBusy();
    }, CODEX_ACTIVITY_QUIET_MS);
  }

  function noteTerminalOutput() {
    terminalOutputVersion += 1;
    scheduleCodexIdleWhenQuiet();
  }

  function writeTerminalOutput(output) {
    const nextOutput = String(output || "");
    terminalOutput = nextOutput;
    noteTerminalOutput();
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    markTerminalStreaming();
    terminalOutput += outputChunk;
    noteTerminalOutput();
  }

  function resetTerminalOutput() {
    clearTerminalStreamingTimer();
    setTerminalStreaming(false);
    clearCodexBusy();
    clearCodexWorking();
    terminalOutput = "";
    terminalOutputVersion += 1;
  }

  return {
    appendTerminalOutput,
    clearCodexBusy,
    clearCodexWorking,
    codexBusy,
    codexWorking,
    getTerminalOutput: () => terminalOutput,
    markCodexBusy,
    resetTerminalOutput,
    terminalStreaming,
    writeTerminalOutput
  };
}

export {
  useCodexTerminalOutput
};
