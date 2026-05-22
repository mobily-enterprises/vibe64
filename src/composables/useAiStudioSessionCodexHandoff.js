import { ref, unref } from "vue";
import { useAiStudioCodexCommands } from "@/composables/useAiStudioCodexCommands.js";
import {
  aiStudioPromptHandoffFromSession
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";

const CODEX_ALREADY_WORKING_ERROR = "Codex is already working in this session. Wait for it to finish before sending another prompt.";

function useAiStudioSessionCodexHandoff({
  refreshSessionData,
  selectedSessionId,
  setCopyStatus = () => null,
  waitingForPromptedArtifact = () => false
} = {}) {
  const busy = ref(false);
  const promptInjectionError = ref("");
  const promptInjectionKey = ref("");
  const promptOverride = ref("");
  const readinessRefreshInFlight = ref(false);
  const working = ref(false);
  const codexCommands = useAiStudioCodexCommands();

  function codexCanAcceptPrompt() {
    return !busy.value && !working.value;
  }

  function rejectOverlappingPrompt() {
    promptInjectionError.value = CODEX_ALREADY_WORKING_ERROR;
    setCopyStatus(promptInjectionError.value);
    return false;
  }

  async function startFromActionResponse(response = {}, context = {}) {
    const promptHandoff = aiStudioPromptHandoffFromSession(response);
    if (!promptHandoff?.prompt) {
      return false;
    }
    if (!codexCanAcceptPrompt()) {
      return rejectOverlappingPrompt();
    }

    promptOverride.value = String(promptHandoff.terminalInput || promptHandoff.prompt || "").trim();
    busy.value = true;
    promptInjectionError.value = "";
    promptInjectionKey.value = `${context.sessionId}:${context.actionId}:${Date.now()}`;
    await refreshSessionData();
    return true;
  }

  async function injectPrompt(prompt, context = {}) {
    const requestId = String(context.requestId || "prompt");
    const sessionId = String(context.sessionId || "");
    const normalizedPrompt = String(prompt || "").trim();
    if (!normalizedPrompt) {
      return false;
    }
    if (!codexCanAcceptPrompt()) {
      return rejectOverlappingPrompt();
    }

    const targetSessionId = String(sessionId || unref(selectedSessionId) || "").trim();
    promptOverride.value = normalizedPrompt;
    busy.value = true;
    promptInjectionError.value = "";
    promptInjectionKey.value = `${targetSessionId || "session"}:${requestId}:${Date.now()}`;
    await refreshSessionData();
    return true;
  }

  function fixCommandFailure(request = {}) {
    const prompt = String(request.prompt || "").trim();
    if (!prompt) {
      return false;
    }
    return injectPrompt(prompt, {
      requestId: `fix-terminal:${request.terminalSessionId || request.actionId || request.terminalKind || "command"}`,
      sessionId: request.sessionId
    });
  }

  async function refreshPromptedArtifactReadiness() {
    if (!readRefOrGetterBoolean(waitingForPromptedArtifact) || readinessRefreshInFlight.value) {
      return;
    }

    readinessRefreshInFlight.value = true;
    try {
      await refreshSessionData();
    } finally {
      readinessRefreshInFlight.value = false;
    }
  }

  function clear() {
    busy.value = false;
    promptInjectionError.value = "";
    promptInjectionKey.value = "";
    promptOverride.value = "";
    readinessRefreshInFlight.value = false;
    working.value = false;
  }

  function clearPromptOverride() {
    promptOverride.value = "";
  }

  async function handlePromptInjected(event = {}) {
    const sessionId = String(event.sessionId || unref(selectedSessionId) || "");
    busy.value = true;
    if (sessionId) {
      await codexCommands.savePromptHandoff(sessionId, {
        outputStart: Number(event.outputStart || 0),
        signature: `${sessionId}:${Date.now()}`
      }).catch(() => null);
      await refreshSessionData();
    }
    setCopyStatus("Prompt sent to Codex.");
  }

  function handlePromptInjectionFailed(event = {}) {
    busy.value = false;
    promptInjectionError.value = String(event.error || "Prompt injection failed.");
    setCopyStatus(promptInjectionError.value);
  }

  async function handleBusyChanged(event = {}) {
    if (event.sessionId && event.sessionId !== unref(selectedSessionId)) {
      return;
    }

    const wasBusy = busy.value;
    const isBusy = event.busy === true;
    working.value = event.working === true;
    if (!wasBusy || isBusy || !readRefOrGetterBoolean(waitingForPromptedArtifact)) {
      busy.value = isBusy;
      return;
    }

    try {
      await refreshPromptedArtifactReadiness();
    } finally {
      busy.value = false;
    }
  }

  async function handleSessionUpdate(event = {}) {
    if (event.sessionId && event.sessionId !== unref(selectedSessionId)) {
      return;
    }
    if (event.codexTerminalStatus === "exited") {
      busy.value = false;
      working.value = false;
    }
    await refreshSessionData();
  }

  return {
    busy,
    busyChanged: handleBusyChanged,
    clear,
    clearPromptOverride,
    fixCommandFailure,
    injectPrompt,
    promptInjected: handlePromptInjected,
    promptInjectionError,
    promptInjectionFailed: handlePromptInjectionFailed,
    promptInjectionKey,
    promptOverride,
    sessionUpdate: handleSessionUpdate,
    startFromActionResponse,
    working
  };
}

export {
  useAiStudioSessionCodexHandoff
};
