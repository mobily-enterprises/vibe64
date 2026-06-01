import { ref, unref } from "vue";

import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const CODEX_ACTIVITY_QUIET_MS = 2200;
const TERMINAL_STREAM_QUIET_MS = 650;
const CODEX_ACTIVITY_BUFFER_LENGTH = 8192;
const TERMINAL_OUTPUT_TAIL_LENGTH = 256 * 1024;
const TERMINAL_DISPLAY_UPDATE_INTERVAL_MS = 80;
const TERMINAL_OUTPUT_OBSERVER_INTERVAL_MS = 120;
const CODEX_WORKING_TEXT_MARKERS = Object.freeze([
  "Working (",
  "Waiting for background terminal",
  "background terminal running"
]);
const CODEX_IDLE_TEXT_MARKERS = Object.freeze([
  "tab to queue message"
]);
const CODEX_ACTIVITY_TEXT_MARKERS = Object.freeze([
  ...CODEX_WORKING_TEXT_MARKERS,
  ...CODEX_IDLE_TEXT_MARKERS
]);

function trimTerminalOutputTail(output) {
  const terminalOutput = String(output || "");
  if (terminalOutput.length <= TERMINAL_OUTPUT_TAIL_LENGTH) {
    return {
      output: terminalOutput,
      trimmedLength: 0
    };
  }
  const trimmedLength = terminalOutput.length - TERMINAL_OUTPUT_TAIL_LENGTH;
  return {
    output: terminalOutput.slice(trimmedLength),
    trimmedLength
  };
}

function textIncludesAny(value = "", markers = []) {
  const source = String(value || "");
  return markers.some((marker) => source.includes(marker));
}

function codexWorkingStateFromText(value = "") {
  const source = String(value || "");
  if (source.includes("background terminal running")) {
    return true;
  }
  const latestWorkingMarker = Math.max(
    ...CODEX_WORKING_TEXT_MARKERS.map((marker) => source.lastIndexOf(marker))
  );
  const latestIdleMarker = Math.max(
    ...CODEX_IDLE_TEXT_MARKERS.map((marker) => source.lastIndexOf(marker))
  );
  if (latestIdleMarker >= 0 && latestIdleMarker > latestWorkingMarker) {
    return false;
  }
  if (latestWorkingMarker >= 0) {
    return true;
  }
  return null;
}

function useCodexTerminalOutput({
  appendDisplay,
  displayActive = true,
  emitBusyChanged,
  onOutputChanged,
  shouldNotifyOutputChanged,
  sessionId,
  writeDisplay
} = {}) {
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const terminalStreaming = ref(false);

  let terminalDisplayTimer = null;
  let terminalOutputChangedTimer = null;
  let codexActivityBuffer = "";
  let codexIdleTimer = null;
  let terminalStreamingTimer = null;
  let codexBusyOutputVersion = 0;
  let terminalHasOutput = false;
  let terminalOutputTail = "";
  let terminalLastOutputAt = 0;
  let terminalOutputVersion = 0;
  let pendingDisplayChunk = "";
  let pendingDisplayMode = "";

  function displayIsActive() {
    return Boolean(unref(displayActive));
  }

  function outputObserverIsActive() {
    return typeof onOutputChanged === "function" &&
      (typeof shouldNotifyOutputChanged !== "function" || shouldNotifyOutputChanged() !== false);
  }

  function displayTerminalOutput(output = terminalOutputTail) {
    return String(output || "");
  }

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
    vibe64SessionDebugLog("client.codexTerminal.activity", payload);
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
    vibe64SessionDebugLog("client.codexTerminal.streaming", {
      sessionId: unref(sessionId),
      streaming
    });
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

  function updateCodexWorkingFromOutput(output = "", {
    replace = false
  } = {}) {
    const nextBuffer = replace
      ? String(output || "")
      : `${codexActivityBuffer}${String(output || "")}`;
    codexActivityBuffer = nextBuffer.slice(-CODEX_ACTIVITY_BUFFER_LENGTH);
    if (!textIncludesAny(codexActivityBuffer, CODEX_ACTIVITY_TEXT_MARKERS)) {
      return;
    }

    const nextWorking = codexWorkingStateFromText(codexActivityBuffer);
    if (nextWorking === null) {
      return;
    }
    setCodexWorking(nextWorking);
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

  function clearTerminalDisplayTimer() {
    if (!terminalDisplayTimer) {
      return;
    }
    globalThis.clearTimeout(terminalDisplayTimer);
    terminalDisplayTimer = null;
  }

  function clearPendingDisplay() {
    pendingDisplayChunk = "";
    pendingDisplayMode = "";
  }

  function displayChunkCanAppendRaw(outputChunk = "") {
    return Boolean(String(outputChunk || ""));
  }

  function writeDisplayNow() {
    clearTerminalDisplayTimer();
    clearPendingDisplay();
    if (displayIsActive()) {
      writeDisplay?.(displayTerminalOutput(terminalOutputTail));
    }
  }

  function flushTerminalDisplay() {
    terminalDisplayTimer = null;
    if (!displayIsActive()) {
      clearPendingDisplay();
      return;
    }
    if (pendingDisplayMode === "append" && appendDisplay) {
      appendDisplay(pendingDisplayChunk);
      clearPendingDisplay();
      return;
    }
    clearPendingDisplay();
    writeDisplay?.(displayTerminalOutput(terminalOutputTail));
  }

  function scheduleTerminalDisplayFlush() {
    if (terminalDisplayTimer) {
      return;
    }
    terminalDisplayTimer = globalThis.setTimeout(() => {
      flushTerminalDisplay();
    }, TERMINAL_DISPLAY_UPDATE_INTERVAL_MS);
  }

  function scheduleTerminalDisplayAppend(outputChunk) {
    if (!displayIsActive()) {
      return;
    }
    if (pendingDisplayMode === "replace") {
      scheduleTerminalDisplayFlush();
      return;
    }
    pendingDisplayMode = "append";
    pendingDisplayChunk += String(outputChunk || "");
    scheduleTerminalDisplayFlush();
  }

  function scheduleTerminalDisplayWrite() {
    if (!displayIsActive()) {
      return;
    }
    pendingDisplayMode = "replace";
    pendingDisplayChunk = "";
    scheduleTerminalDisplayFlush();
  }

  function clearTerminalOutputChanged() {
    if (!terminalOutputChangedTimer) {
      return;
    }
    globalThis.clearTimeout(terminalOutputChangedTimer);
    terminalOutputChangedTimer = null;
  }

  function notifyTerminalOutputChangedNow(output = terminalOutputTail) {
    clearTerminalOutputChanged();
    if (!outputObserverIsActive()) {
      return;
    }
    onOutputChanged(output);
  }

  function flushTerminalOutput() {
    const shouldNotifyObserver = Boolean(terminalOutputChangedTimer && outputObserverIsActive());
    clearTerminalOutputChanged();
    if (shouldNotifyObserver) {
      onOutputChanged(terminalOutputTail);
    }
    writeDisplayNow();
  }

  function scheduleTerminalOutputChanged() {
    if (!outputObserverIsActive() || terminalOutputChangedTimer) {
      return;
    }
    terminalOutputChangedTimer = globalThis.setTimeout(() => {
      terminalOutputChangedTimer = null;
      if (outputObserverIsActive()) {
        onOutputChanged(terminalOutputTail);
      }
    }, TERMINAL_OUTPUT_OBSERVER_INTERVAL_MS);
  }

  function noteTerminalTextOutput({
    outputText = ""
  } = {}) {
    terminalOutputVersion += 1;
    terminalLastOutputAt = Date.now();
    terminalHasOutput = terminalHasOutput || String(outputText || "").trim().length > 0;
    scheduleCodexIdleWhenQuiet();
  }

  function replaceTerminalOutputTail(nextOutput, {
    emitImmediately = false,
    outputText = ""
  } = {}) {
    const previousOutput = terminalOutputTail;
    const trimmedTail = trimTerminalOutputTail(nextOutput);
    terminalOutputTail = trimmedTail.output;
    if (terminalOutputTail !== previousOutput) {
      noteTerminalTextOutput({
        outputText
      });
      updateCodexWorkingFromOutput(terminalOutputTail, {
        replace: true
      });
    }
    if (emitImmediately) {
      notifyTerminalOutputChangedNow(terminalOutputTail);
      writeDisplayNow();
    } else {
      scheduleTerminalOutputChanged();
      scheduleTerminalDisplayWrite();
    }
  }

  function appendTerminalOutputTail(outputChunk, {
    outputText = ""
  } = {}) {
    const nextOutput = outputChunk.length >= TERMINAL_OUTPUT_TAIL_LENGTH
      ? outputChunk
      : `${terminalOutputTail}${outputChunk}`;
    const trimmedTail = trimTerminalOutputTail(nextOutput);
    terminalOutputTail = trimmedTail.output;
    noteTerminalTextOutput({
      outputText
    });
    updateCodexWorkingFromOutput(outputChunk);
    scheduleTerminalOutputChanged();
  }

  function writeTerminalOutput(output) {
    const terminalOutput = String(output || "");
    replaceTerminalOutputTail(terminalOutput, {
      emitImmediately: true,
      outputText: terminalOutput
    });
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    markTerminalStreaming();
    appendTerminalOutputTail(outputChunk, {
      outputText: outputChunk
    });
    if (displayChunkCanAppendRaw(outputChunk)) {
      scheduleTerminalDisplayAppend(outputChunk);
    } else {
      scheduleTerminalDisplayWrite();
    }
  }

  function resetTerminalOutput({
    emit = false
  } = {}) {
    clearTerminalDisplayTimer();
    clearTerminalOutputChanged();
    clearPendingDisplay();
    clearTerminalStreamingTimer();
    setTerminalStreaming(false);
    clearCodexBusy();
    clearCodexWorking();
    codexActivityBuffer = "";
    terminalHasOutput = false;
    terminalOutputTail = "";
    terminalLastOutputAt = 0;
    terminalOutputVersion += 1;
    if (emit) {
      notifyTerminalOutputChangedNow("");
    }
    if (displayIsActive()) {
      writeDisplay?.("");
    }
  }

  return {
    appendTerminalOutput,
    clearCodexBusy,
    clearCodexWorking,
    codexBusy,
    codexWorking,
    flushTerminalOutput,
    getTerminalOutput: () => terminalOutputTail,
    hasTerminalOutput: () => terminalHasOutput,
    lastTerminalOutputAt: () => terminalLastOutputAt,
    markCodexBusy,
    resetTerminalOutput,
    terminalStreaming,
    writeTerminalOutput
  };
}

export {
  useCodexTerminalOutput
};
