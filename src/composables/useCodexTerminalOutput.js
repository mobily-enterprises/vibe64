import { ref, unref } from "vue";

import {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  stripStudioContextBlocksForDisplay,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import { createCodexPromptEchoFilters } from "@/lib/codexPromptEchoFilters.js";

const CODEX_ACTIVITY_QUIET_MS = 2200;
const CODEX_ACTIVITY_BUFFER_LENGTH = 8192;
const MAX_TERMINAL_OUTPUT_LENGTH = 4 * 1024 * 1024;
const TERMINAL_DISPLAY_UPDATE_INTERVAL_MS = 80;
const TERMINAL_OUTPUT_EMIT_INTERVAL_MS = 120;
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

function trimTerminalOutput(output) {
  const terminalOutput = String(output || "");
  if (terminalOutput.length <= MAX_TERMINAL_OUTPUT_LENGTH) {
    return terminalOutput;
  }
  return terminalOutput.slice(terminalOutput.length - MAX_TERMINAL_OUTPUT_LENGTH);
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
  emitOutput,
  onOutputChanged,
  sessionId,
  writeDisplay
} = {}) {
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const promptEchoFilters = createCodexPromptEchoFilters();

  let terminalDisplayTimer = null;
  let terminalOutputEmitTimer = null;
  let terminalOutputChangedTimer = null;
  let codexActivityBuffer = "";
  let codexIdleTimer = null;
  let codexBusyOutputVersion = 0;
  let terminalHasOutput = false;
  let terminalLatestOutput = "";
  let terminalLastOutputAt = 0;
  let terminalOutputVersion = 0;
  let pendingDisplayChunk = "";
  let pendingDisplayMode = "";

  function displayIsActive() {
    return Boolean(unref(displayActive));
  }

  function displayTerminalOutput(output = terminalLatestOutput) {
    return stripStudioContextBlocksForDisplay(promptEchoFilters.apply(output));
  }

  function clearCodexIdleTimer() {
    if (!codexIdleTimer) {
      return;
    }
    globalThis.clearTimeout(codexIdleTimer);
    codexIdleTimer = null;
  }

  function emitCodexActivityChanged() {
    emitBusyChanged?.({
      busy: codexBusy.value,
      sessionId: unref(sessionId),
      working: codexWorking.value
    });
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

    const visibleActivityText = stripTerminalControlSequences(codexActivityBuffer);
    const nextWorking = codexWorkingStateFromText(visibleActivityText);
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
    const chunk = String(outputChunk || "");
    return Boolean(
      chunk &&
      !promptEchoFilters.hasPending() &&
      !chunk.includes(STUDIO_CONTEXT_START_MARKER) &&
      !chunk.includes(STUDIO_CONTEXT_END_MARKER)
    );
  }

  function writeDisplayNow() {
    clearTerminalDisplayTimer();
    clearPendingDisplay();
    if (displayIsActive()) {
      writeDisplay?.(displayTerminalOutput(terminalLatestOutput));
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
    writeDisplay?.(displayTerminalOutput(terminalLatestOutput));
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

  function clearTerminalOutputEmit() {
    if (!terminalOutputEmitTimer) {
      return;
    }
    globalThis.clearTimeout(terminalOutputEmitTimer);
    terminalOutputEmitTimer = null;
  }

  function clearTerminalOutputChanged() {
    if (!terminalOutputChangedTimer) {
      return;
    }
    globalThis.clearTimeout(terminalOutputChangedTimer);
    terminalOutputChangedTimer = null;
  }

  function emitTerminalOutputNow(output = terminalLatestOutput) {
    clearTerminalOutputEmit();
    clearTerminalOutputChanged();
    emitOutput?.(output);
    onOutputChanged?.(output);
  }

  function flushTerminalOutputEmit() {
    if (!terminalOutputEmitTimer) {
      return;
    }
    clearTerminalOutputEmit();
    clearTerminalOutputChanged();
    emitOutput?.(terminalLatestOutput);
    onOutputChanged?.(terminalLatestOutput);
    writeDisplayNow();
  }

  function scheduleTerminalOutputEmit() {
    if (terminalOutputEmitTimer) {
      return;
    }
    terminalOutputEmitTimer = globalThis.setTimeout(() => {
      terminalOutputEmitTimer = null;
      emitOutput?.(terminalLatestOutput);
    }, TERMINAL_OUTPUT_EMIT_INTERVAL_MS);
  }

  function scheduleTerminalOutputChanged() {
    if (terminalOutputChangedTimer) {
      return;
    }
    terminalOutputChangedTimer = globalThis.setTimeout(() => {
      terminalOutputChangedTimer = null;
      onOutputChanged?.(terminalLatestOutput);
    }, TERMINAL_OUTPUT_EMIT_INTERVAL_MS);
  }

  function updateTerminalOutput(nextOutput, {
    emitImmediately = false,
    outputChunk = ""
  } = {}) {
    const previousOutput = terminalLatestOutput;
    terminalLatestOutput = trimTerminalOutput(nextOutput);
    if (emitImmediately) {
      emitTerminalOutputNow(terminalLatestOutput);
    }
    if (terminalLatestOutput !== previousOutput) {
      terminalOutputVersion += 1;
      terminalLastOutputAt = Date.now();
      terminalHasOutput = outputChunk
        ? terminalHasOutput || stripTerminalControlSequences(outputChunk).trim().length > 0
        : stripTerminalControlSequences(terminalLatestOutput).trim().length > 0;
      updateCodexWorkingFromOutput(outputChunk || terminalLatestOutput, {
        replace: !outputChunk
      });
    }
    if (!emitImmediately) {
      scheduleTerminalOutputChanged();
    }
    if (emitImmediately) {
      writeDisplayNow();
    } else if (displayChunkCanAppendRaw(outputChunk)) {
      scheduleTerminalDisplayAppend(outputChunk);
    } else {
      scheduleTerminalDisplayWrite();
    }
    scheduleCodexIdleWhenQuiet();
  }

  function writeTerminalOutput(output) {
    updateTerminalOutput(output, {
      emitImmediately: true
    });
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    markCodexBusy();
    updateTerminalOutput(`${terminalLatestOutput}${outputChunk}`, {
      outputChunk
    });
    scheduleTerminalOutputEmit();
  }

  function resetTerminalOutput({
    emit = false
  } = {}) {
    clearTerminalDisplayTimer();
    clearTerminalOutputEmit();
    clearTerminalOutputChanged();
    clearPendingDisplay();
    clearCodexBusy();
    clearCodexWorking();
    codexActivityBuffer = "";
    terminalHasOutput = false;
    terminalLatestOutput = "";
    terminalLastOutputAt = 0;
    terminalOutputVersion += 1;
    if (emit) {
      emitTerminalOutputNow("");
    }
    if (displayIsActive()) {
      writeDisplay?.("");
    }
  }

  return {
    addPromptEchoFilter: promptEchoFilters.add,
    appendTerminalOutput,
    clearCodexBusy,
    clearCodexWorking,
    clearPromptEchoFilters: promptEchoFilters.clear,
    codexBusy,
    codexWorking,
    flushTerminalOutputEmit,
    getTerminalOutput: () => terminalLatestOutput,
    hasTerminalOutput: () => terminalHasOutput,
    lastTerminalOutputAt: () => terminalLastOutputAt,
    markCodexBusy,
    removePromptEchoFilter: promptEchoFilters.remove,
    resetTerminalOutput,
    writeTerminalOutput
  };
}

export {
  useCodexTerminalOutput
};
