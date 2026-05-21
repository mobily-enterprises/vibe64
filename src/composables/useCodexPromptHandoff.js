import { ref, unref } from "vue";

import {
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  wrapPromptWithStudioContext
} from "@/lib/codexOutput.js";

const DEFAULT_CODEX_THREAD_COMMAND = "echo $CODEX_THREAD_ID";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_KEY_PAUSE_MS = 180;
const PROMPT_INJECTION_RETRY_MS = 350;
const PROMPT_INJECTION_RETRY_TIMEOUT_MS = 15000;
const CODEX_THREAD_CAPTURE_WAITING_ERROR = "Waiting for Codex thread id before injecting prompt.";

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function useCodexPromptHandoff({
  addPromptEchoFilter,
  clearCodexBusy,
  clearPromptEchoFilters,
  codexPrompt,
  codexTerminalInput,
  componentMounted,
  copyStatus,
  emitPromptInjected,
  emitPromptInjectionFailed,
  emitSessionUpdate,
  ensureTerminalReady,
  expanded,
  getTerminalOutput,
  hasTerminalOutput,
  lastTerminalOutputAt,
  manualPromptInjectionRequestKey,
  markCodexBusy,
  removePromptEchoFilter,
  saveThread,
  sendTerminalData,
  sessionId,
  terminalError,
  terminalSessionId,
  terminalStatus,
  visibleTerminalText
} = {}) {
  const injectingPrompt = ref(false);
  const codexThreadId = ref("");
  const codexThreadCaptureRequired = ref(false);
  const codexThreadCaptureStarted = ref(false);

  let codexThreadCapturePromise = null;
  let codexThreadSavePromise = null;
  let handledPromptInjectionRequestKey = "";
  let promptInjectionRetryStartedAt = 0;
  let promptInjectionRetryTimer = null;
  let terminalStartedAt = 0;
  let codexTrustPromptAnsweredAt = 0;

  function clearThreadCaptureWaitingError() {
    if (
      terminalError &&
      typeof terminalError === "object" &&
      "value" in terminalError &&
      terminalError.value === CODEX_THREAD_CAPTURE_WAITING_ERROR
    ) {
      terminalError.value = "";
    }
  }

  function showThreadCaptureWaitingError() {
    if (terminalError && typeof terminalError === "object" && "value" in terminalError) {
      terminalError.value = CODEX_THREAD_CAPTURE_WAITING_ERROR;
    }
  }

  function applyCodexThreadState(session = {}) {
    if (session.codexThreadId) {
      codexThreadId.value = String(session.codexThreadId || "");
      codexThreadCaptureRequired.value = false;
      codexThreadCaptureStarted.value = false;
      clearThreadCaptureWaitingError();
      return;
    }
    if (session.needsThreadCapture === true) {
      codexThreadCaptureRequired.value = true;
    }
  }

  function applyTerminalSnapshot(session = {}) {
    applyCodexThreadState(session);
    const persistedOutputStart = Number(session.codexPromptHandoffOutputStart);
    if (
      Number.isSafeInteger(persistedOutputStart) &&
      persistedOutputStart >= 0 &&
      unref(codexPrompt)
    ) {
      addPromptEchoFilter?.({
        outputStart: persistedOutputStart,
        prompt: wrappedCodexPrompt()
      });
    }
  }

  function wrappedCodexPrompt() {
    const terminalInput = String(unref(codexTerminalInput) || "");
    if (terminalInput) {
      return terminalInput;
    }
    return wrapPromptWithStudioContext(
      unref(codexPrompt)
    );
  }

  function noteTerminalStarted() {
    terminalStartedAt = Date.now();
  }

  function noteTerminalInput(input) {
    if (String(input || "").includes("\r") && codexTrustPromptLooksActive(getTerminalOutput?.())) {
      codexTrustPromptAnsweredAt = Date.now();
      if (copyStatus && typeof copyStatus === "object" && "value" in copyStatus) {
        copyStatus.value = "";
      }
    }
  }

  async function sendCodexShellCommand(command) {
    const normalizedCommand = String(command || "").trim();
    if (!normalizedCommand) {
      return false;
    }

    const keySequence = [
      "\u001b",
      "\u0015",
      "! ",
      normalizedCommand,
      " ",
      "\u001b",
      "\r"
    ];
    for (const keyInput of keySequence) {
      if (!(await sendTerminalData?.(keyInput))) {
        return false;
      }
      await delay(CODEX_KEY_PAUSE_MS);
    }
    return true;
  }

  async function captureCodexThreadFromOutput(output) {
    if (!codexThreadCaptureRequired.value || codexThreadId.value || !unref(sessionId)) {
      return false;
    }
    if (codexThreadSavePromise) {
      return codexThreadSavePromise;
    }
    const threadId = extractCodexThreadId(output);
    if (!threadId) {
      return false;
    }

    codexThreadSavePromise = (async () => {
      const response = await saveThread?.(unref(sessionId), threadId);
      if (response?.ok === false) {
        throw new Error(response.error || response.errors?.[0]?.message || "Codex thread id could not be saved.");
      }
      codexThreadId.value = response?.codexThreadId || threadId;
      codexThreadCaptureRequired.value = false;
      clearThreadCaptureWaitingError();
      emitSessionUpdate?.({
        codexThreadId: codexThreadId.value,
        needsThreadCapture: false,
        sessionId: unref(sessionId)
      });
      if (copyStatus && typeof copyStatus === "object" && "value" in copyStatus) {
        copyStatus.value = "Codex session captured.";
      }
      return true;
    })();

    try {
      return await codexThreadSavePromise;
    } catch (saveError) {
      if (terminalError && typeof terminalError === "object" && "value" in terminalError) {
        terminalError.value = String(saveError?.message || saveError || "Codex thread id could not be saved.");
      }
      return false;
    } finally {
      codexThreadSavePromise = null;
    }
  }

  function waitForCodexThreadId() {
    if (codexThreadId.value || !codexThreadCaptureRequired.value) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (codexThreadId.value || !codexThreadCaptureRequired.value) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > 12000) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 250);
    });
  }

  function canCaptureCodexThread() {
    return Boolean(
      unref(terminalSessionId) &&
      unref(sessionId) &&
      codexThreadCaptureRequired.value &&
      !codexThreadId.value &&
      unref(terminalStatus) !== "exited"
    );
  }

  function needsCodexThreadCapture() {
    return Boolean(codexThreadCaptureRequired.value && !codexThreadId.value);
  }

  function codexTrustPromptIsBlocking() {
    const visibleText = visibleTerminalText?.() || "";
    const trustPromptVisible = visibleText
      ? codexTrustPromptLooksActive(visibleText)
      : codexTrustPromptLooksActive(getTerminalOutput?.());
    return trustPromptVisible &&
      (!codexTrustPromptAnsweredAt || lastTerminalOutputAt?.() <= codexTrustPromptAnsweredAt);
  }

  function codexBootLooksReady() {
    if (!terminalStartedAt || !hasTerminalOutput?.()) {
      return false;
    }
    if (codexTrustPromptIsBlocking()) {
      if (copyStatus && typeof copyStatus === "object" && "value" in copyStatus) {
        copyStatus.value = "Answer the Codex trust prompt in the terminal to continue.";
      }
      return false;
    }
    const now = Date.now();
    return now - terminalStartedAt >= CODEX_BOOT_MIN_AGE_MS &&
      now - lastTerminalOutputAt?.() >= CODEX_BOOT_QUIET_MS;
  }

  async function waitForCodexBootReady() {
    if (codexBootLooksReady()) {
      return true;
    }

    return new Promise((resolve) => {
      let startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (codexBootLooksReady()) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (codexTrustPromptIsBlocking()) {
          startedAt = Date.now();
          return;
        }
        if (Date.now() - startedAt > CODEX_BOOT_TIMEOUT_MS) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 250);
    });
  }

  async function ensureCodexThreadReady({
    forceRetry = false
  } = {}) {
    if (codexThreadId.value || !codexThreadCaptureRequired.value) {
      return true;
    }
    if (codexThreadCapturePromise) {
      return codexThreadCapturePromise;
    }

    codexThreadCapturePromise = (async () => {
      if (!canCaptureCodexThread()) {
        return false;
      }
      if (!codexThreadCaptureStarted.value || forceRetry) {
        await waitForCodexBootReady();
        codexThreadCaptureStarted.value = true;
        const sent = await sendCodexShellCommand(DEFAULT_CODEX_THREAD_COMMAND);
        if (!sent) {
          codexThreadCaptureStarted.value = false;
          return false;
        }
      }
      const ready = await waitForCodexThreadId();
      if (!ready) {
        showThreadCaptureWaitingError();
      }
      return ready;
    })();

    try {
      return await codexThreadCapturePromise;
    } finally {
      codexThreadCapturePromise = null;
    }
  }

  async function injectPrompt() {
    const prompt = String(unref(codexPrompt) || "");
    if (!prompt) {
      return false;
    }
    if (expanded && typeof expanded === "object" && "value" in expanded) {
      expanded.value = true;
    }
    injectingPrompt.value = true;
    try {
      if (await ensureTerminalReady?.() && await ensureCodexThreadReady({ forceRetry: true })) {
        const promptOutputSnapshot = getTerminalOutput?.() || "";
        const promptToSend = wrappedCodexPrompt();
        const promptEchoFilter = addPromptEchoFilter?.({
          outputStart: promptOutputSnapshot.length,
          prompt: promptToSend
        });
        markCodexBusy?.();
        const sent = await sendTerminalData?.(`\u001b[200~${promptToSend}\u001b[201~\r`);
        if (sent) {
          if (copyStatus && typeof copyStatus === "object" && "value" in copyStatus) {
            copyStatus.value = "Codex is working...";
          }
          emitPromptInjected?.({
            outputSnapshot: promptOutputSnapshot,
            outputStart: promptOutputSnapshot.length,
            prompt,
            sessionId: unref(sessionId)
          });
        }
        if (!sent) {
          removePromptEchoFilter?.(promptEchoFilter);
          clearCodexBusy?.();
        }
        return sent;
      }
      return false;
    } finally {
      injectingPrompt.value = false;
    }
  }

  async function injectPromptForRequest() {
    const requestKey = String(unref(manualPromptInjectionRequestKey) || "");
    if (!unref(componentMounted) || !requestKey || handledPromptInjectionRequestKey === requestKey) {
      return;
    }
    handledPromptInjectionRequestKey = requestKey;
    if (await injectPrompt()) {
      clearPromptInjectionRetry();
      return;
    }
    if (handledPromptInjectionRequestKey === requestKey) {
      handledPromptInjectionRequestKey = "";
      schedulePromptInjectionRetry(requestKey);
    }
  }

  function clearPromptInjectionRetry() {
    promptInjectionRetryStartedAt = 0;
    if (promptInjectionRetryTimer) {
      window.clearTimeout(promptInjectionRetryTimer);
      promptInjectionRetryTimer = null;
    }
  }

  function schedulePromptInjectionRetry(requestKey) {
    if (
      !unref(componentMounted) ||
      !requestKey ||
      String(unref(manualPromptInjectionRequestKey) || "") !== requestKey
    ) {
      clearPromptInjectionRetry();
      return;
    }
    if (!promptInjectionRetryStartedAt) {
      promptInjectionRetryStartedAt = Date.now();
    }
    if (Date.now() - promptInjectionRetryStartedAt > PROMPT_INJECTION_RETRY_TIMEOUT_MS) {
      clearCodexBusy?.();
      emitPromptInjectionFailed?.({
        error: "Prompt injection timed out before the Codex terminal accepted the request.",
        requestKey,
        sessionId: unref(sessionId)
      });
      clearPromptInjectionRetry();
      return;
    }
    if (promptInjectionRetryTimer) {
      return;
    }
    promptInjectionRetryTimer = window.setTimeout(() => {
      promptInjectionRetryTimer = null;
      void injectPromptForRequest();
    }, PROMPT_INJECTION_RETRY_MS);
  }

  function requestPromptInjection(nextRequestKey) {
    clearPromptInjectionRetry();
    if (!nextRequestKey) {
      return;
    }
    if (expanded && typeof expanded === "object" && "value" in expanded) {
      expanded.value = true;
    }
    void injectPromptForRequest();
  }

  function resetPromptRequestState() {
    handledPromptInjectionRequestKey = "";
  }

  function resetTerminalRecoveryState() {
    codexThreadCaptureStarted.value = false;
    clearPromptEchoFilters?.();
    terminalStartedAt = 0;
  }

  function detach() {
    codexThreadId.value = "";
    codexThreadCaptureRequired.value = false;
    codexThreadCaptureStarted.value = false;
    clearPromptInjectionRetry();
    clearPromptEchoFilters?.();
    terminalStartedAt = 0;
    codexTrustPromptAnsweredAt = 0;
  }

  return {
    applyCodexThreadState,
    applyTerminalSnapshot,
    captureCodexThreadFromOutput,
    clearPromptInjectionRetry,
    detach,
    ensureCodexThreadReady,
    injectPromptForRequest,
    injectingPrompt,
    needsCodexThreadCapture,
    noteTerminalInput,
    noteTerminalStarted,
    requestPromptInjection,
    resetPromptRequestState,
    resetTerminalRecoveryState
  };
}

export {
  useCodexPromptHandoff
};
