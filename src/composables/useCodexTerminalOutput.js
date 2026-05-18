import { ref, unref } from "vue";

import {
  stripStudioContextBlocksForDisplay,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import { createCodexPromptEchoFilters } from "@/lib/codexPromptEchoFilters.js";

const CODEX_ACTIVITY_QUIET_MS = 2200;
const MAX_TERMINAL_OUTPUT_LENGTH = 16 * 1024 * 1024;
const TERMINAL_OUTPUT_EMIT_INTERVAL_MS = 120;

function trimTerminalOutput(output) {
  const terminalOutput = String(output || "");
  if (terminalOutput.length <= MAX_TERMINAL_OUTPUT_LENGTH) {
    return terminalOutput;
  }
  return terminalOutput.slice(terminalOutput.length - MAX_TERMINAL_OUTPUT_LENGTH);
}

function useCodexTerminalOutput({
  emitBusyChanged,
  emitOutput,
  onOutputChanged,
  sessionId,
  writeDisplay
} = {}) {
  const codexBusy = ref(false);
  const promptEchoFilters = createCodexPromptEchoFilters();

  let terminalOutputEmitTimer = null;
  let codexIdleTimer = null;
  let codexBusyDisplayLength = 0;
  let terminalHasOutput = false;
  let terminalLatestOutput = "";
  let terminalLastOutputAt = 0;

  function displayTerminalOutput(output = terminalLatestOutput) {
    return stripStudioContextBlocksForDisplay(promptEchoFilters.apply(output));
  }

  function displayedTerminalOutputLength() {
    return displayTerminalOutput(terminalLatestOutput).length;
  }

  function clearCodexIdleTimer() {
    if (!codexIdleTimer) {
      return;
    }
    window.clearTimeout(codexIdleTimer);
    codexIdleTimer = null;
  }

  function setCodexBusy(nextBusy) {
    const busy = Boolean(nextBusy);
    if (codexBusy.value === busy) {
      return;
    }
    codexBusy.value = busy;
    emitBusyChanged?.({
      busy,
      sessionId: unref(sessionId)
    });
  }

  function markCodexBusy() {
    clearCodexIdleTimer();
    codexBusyDisplayLength = displayedTerminalOutputLength();
    setCodexBusy(true);
  }

  function clearCodexBusy() {
    clearCodexIdleTimer();
    codexBusyDisplayLength = displayedTerminalOutputLength();
    setCodexBusy(false);
  }

  function scheduleCodexIdleWhenQuiet() {
    if (!codexBusy.value || displayedTerminalOutputLength() <= codexBusyDisplayLength) {
      return;
    }
    clearCodexIdleTimer();
    codexIdleTimer = window.setTimeout(() => {
      codexIdleTimer = null;
      clearCodexBusy();
    }, CODEX_ACTIVITY_QUIET_MS);
  }

  function clearTerminalOutputEmit() {
    if (!terminalOutputEmitTimer) {
      return;
    }
    window.clearTimeout(terminalOutputEmitTimer);
    terminalOutputEmitTimer = null;
  }

  function emitTerminalOutputNow(output = terminalLatestOutput) {
    clearTerminalOutputEmit();
    emitOutput?.(output);
  }

  function flushTerminalOutputEmit() {
    if (!terminalOutputEmitTimer) {
      return;
    }
    clearTerminalOutputEmit();
    emitOutput?.(terminalLatestOutput);
  }

  function scheduleTerminalOutputEmit() {
    if (terminalOutputEmitTimer) {
      return;
    }
    terminalOutputEmitTimer = window.setTimeout(() => {
      terminalOutputEmitTimer = null;
      emitOutput?.(terminalLatestOutput);
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
      terminalLastOutputAt = Date.now();
      terminalHasOutput = outputChunk
        ? terminalHasOutput || stripTerminalControlSequences(outputChunk).trim().length > 0
        : stripTerminalControlSequences(terminalLatestOutput).trim().length > 0;
    }
    onOutputChanged?.(terminalLatestOutput);
    writeDisplay?.(displayTerminalOutput(terminalLatestOutput));
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
    updateTerminalOutput(`${terminalLatestOutput}${outputChunk}`, {
      outputChunk
    });
    scheduleTerminalOutputEmit();
  }

  function resetTerminalOutput({
    emit = false
  } = {}) {
    clearTerminalOutputEmit();
    clearCodexBusy();
    terminalHasOutput = false;
    terminalLatestOutput = "";
    terminalLastOutputAt = 0;
    if (emit) {
      emitTerminalOutputNow("");
    }
    writeDisplay?.("");
  }

  return {
    addPromptEchoFilter: promptEchoFilters.add,
    appendTerminalOutput,
    clearCodexBusy,
    clearPromptEchoFilters: promptEchoFilters.clear,
    codexBusy,
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
