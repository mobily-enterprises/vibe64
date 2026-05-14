import { stripTerminalControlSequences } from "@/lib/codexOutput.js";

const DEFAULT_CODEX_IDLE_MS = 1000;

function lastMeaningfulTerminalLine(output = "") {
  return stripTerminalControlSequences(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || "";
}

function codexOutputEndsWithConversationInterrupted(output = "") {
  return /\bconversation interrupted\b/iu.test(lastMeaningfulTerminalLine(output));
}

function defaultSetTimeout(callback, delay) {
  return globalThis.setTimeout(callback, delay);
}

function defaultClearTimeout(timer) {
  globalThis.clearTimeout(timer);
}

function createCodexCompletionWatcher({
  clearTimeoutFn = defaultClearTimeout,
  idleMs = DEFAULT_CODEX_IDLE_MS,
  now = () => Date.now(),
  onChange = () => {},
  setTimeoutFn = defaultSetTimeout
} = {}) {
  let active = false;
  let key = "";
  let lastOutput = "";
  let lastOutputChangedAt = 0;
  let lastUserInputAt = 0;
  let status = "idle";
  let timer = null;

  function snapshot() {
    const lastActivityAt = Math.max(lastOutputChangedAt, lastUserInputAt);
    return {
      active,
      idleMs,
      interrupted: status === "interrupted",
      key,
      quietForMs: lastActivityAt ? Math.max(0, now() - lastActivityAt) : 0,
      status
    };
  }

  function emitChange() {
    onChange(snapshot());
  }

  function clearTimer() {
    if (!timer) {
      return;
    }
    clearTimeoutFn(timer);
    timer = null;
  }

  function finishIfIdle() {
    timer = null;
    if (!active || status !== "waiting") {
      return;
    }
    const lastActivityAt = Math.max(lastOutputChangedAt, lastUserInputAt);
    if (!lastActivityAt) {
      return;
    }
    const quietForMs = now() - lastActivityAt;
    if (quietForMs < idleMs) {
      scheduleCheck();
      return;
    }
    status = lastOutputChangedAt >= lastUserInputAt && codexOutputEndsWithConversationInterrupted(lastOutput)
      ? "interrupted"
      : "finished";
    emitChange();
  }

  function scheduleCheck() {
    clearTimer();
    const lastActivityAt = Math.max(lastOutputChangedAt, lastUserInputAt);
    if (!active || status !== "waiting" || !lastActivityAt) {
      return;
    }
    const quietForMs = now() - lastActivityAt;
    timer = setTimeoutFn(finishIfIdle, Math.max(0, idleMs - quietForMs));
  }

  function start({
    output = "",
    watchKey = ""
  } = {}) {
    clearTimer();
    active = true;
    key = String(watchKey || "");
    lastOutput = String(output || "");
    lastOutputChangedAt = 0;
    lastUserInputAt = now();
    status = "waiting";
    scheduleCheck();
    emitChange();
  }

  function observeOutput(output = "") {
    if (!active) {
      return snapshot();
    }
    const nextOutput = String(output || "");
    if (nextOutput === lastOutput) {
      return snapshot();
    }
    lastOutput = nextOutput;
    lastOutputChangedAt = now();
    status = "waiting";
    scheduleCheck();
    emitChange();
    return snapshot();
  }

  function recordUserInput() {
    if (!active) {
      return snapshot();
    }
    lastUserInputAt = now();
    status = "waiting";
    scheduleCheck();
    emitChange();
    return snapshot();
  }

  function reset() {
    clearTimer();
    active = false;
    key = "";
    lastOutput = "";
    lastOutputChangedAt = 0;
    lastUserInputAt = 0;
    status = "idle";
    emitChange();
  }

  function dispose() {
    clearTimer();
  }

  return {
    dispose,
    observeOutput,
    recordUserInput,
    reset,
    snapshot,
    start
  };
}

export {
  codexOutputEndsWithConversationInterrupted,
  createCodexCompletionWatcher,
  DEFAULT_CODEX_IDLE_MS
};
