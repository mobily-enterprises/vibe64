import { computed, ref } from "vue";
import {
  abandonAiStudioSession,
  advanceAiStudioSession,
  createAiStudioSession,
  listAiStudioSessions,
  readAiStudioSession,
  runAiStudioSessionAction
} from "@/lib/studioApi.js";
import {
  isAbandonedIssueSession,
  isOpenIssueSession
} from "@/lib/issueSessionViewModel.js";

function errorMessage(error, fallback) {
  return String(error?.message || error || fallback);
}

const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "jskit-ai-studio:selected-issue-session-id";

function browserSessionStorage() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  return window.sessionStorage;
}

function readRememberedSessionId() {
  try {
    return String(browserSessionStorage()?.getItem(SELECTED_SESSION_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

function rememberSessionId(sessionId = "") {
  try {
    const storage = browserSessionStorage();
    if (!storage) {
      return;
    }
    const normalizedSessionId = String(sessionId || "").trim();
    if (normalizedSessionId) {
      storage.setItem(SELECTED_SESSION_STORAGE_KEY, normalizedSessionId);
    } else {
      storage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    }
  } catch {
    // Session selection persistence is a convenience; blocked storage must not break Studio.
  }
}

function newestSessionId(sessions = []) {
  return sessions.at(-1)?.sessionId || "";
}

function visibleIssueSessions(sessions = []) {
  return sessions.filter((session) => !isAbandonedIssueSession(session));
}

function sessionOrderKey(session = {}) {
  return String(session.createdAt || session.startedAt || session.sessionId || "");
}

function orderIssueSessions(sessions = []) {
  return [...sessions].sort((left, right) => {
    return sessionOrderKey(left).localeCompare(sessionOrderKey(right));
  });
}

function useIssueSessions() {
  const issueSessions = ref([]);
  const issueSessionsLoading = ref(false);
  const issueSessionBusy = ref(false);
  const issueSessionsError = ref("");
  const issueSessionLimits = ref({
    maxOpenSessions: DEFAULT_MAX_OPEN_SESSIONS,
    openSessionCount: 0
  });
  const issueSessionStepDefinitions = ref([]);
  const selectedSessionId = ref(readRememberedSessionId());
  const selectedSession = ref(null);
  const stepInputValues = ref({});

  const selectedStepAction = computed(() => {
    return selectedSession.value?.currentStepAction || null;
  });

  const selectedStepInput = computed(() => {
    return selectedStepAction.value?.input || { type: "none" };
  });

  const isChoiceStep = computed(() => selectedStepInput.value?.type === "choice");
  const isTextStep = computed(() => selectedStepInput.value?.type === "text");
  const stepDefinitions = computed(() => {
    return selectedSession.value?.stepDefinitions || issueSessionStepDefinitions.value || [];
  });
  const activeIssueSessionCount = computed(() => {
    return Number(issueSessionLimits.value.openSessionCount || issueSessions.value.filter(isOpenIssueSession).length);
  });
  const maxOpenIssueSessions = computed(() => {
    return Number(issueSessionLimits.value.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS);
  });
  const canCreateIssueSession = computed(() => {
    return activeIssueSessionCount.value < maxOpenIssueSessions.value;
  });

  function rememberContract(response = {}) {
    if (Array.isArray(response.stepDefinitions)) {
      issueSessionStepDefinitions.value = response.stepDefinitions;
    }
    if (response.limits && typeof response.limits === "object") {
      issueSessionLimits.value = {
        maxOpenSessions: Number(response.limits.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS),
        openSessionCount: Number(response.limits.openSessionCount || 0)
      };
    }
  }

  function resetStepInputValues(session = selectedSession.value) {
    const input = session?.currentStepAction?.input || {};
    if (!input.name || input.type === "none") {
      stepInputValues.value = {};
      return;
    }
    stepInputValues.value = {
      [input.name]: ""
    };
  }

  function applySessionList(sessions = []) {
    const displaySessions = orderIssueSessions(visibleIssueSessions(sessions));
    issueSessions.value = displaySessions;
    const selectedStillExists = displaySessions.some((session) => session.sessionId === selectedSessionId.value);
    if (selectedStillExists) {
      rememberSessionId(selectedSessionId.value);
      return;
    }
    const rememberedSessionId = readRememberedSessionId();
    const rememberedStillExists = displaySessions.some((session) => session.sessionId === rememberedSessionId);
    selectedSessionId.value = rememberedStillExists ? rememberedSessionId : newestSessionId(displaySessions);
    rememberSessionId(selectedSessionId.value);
    if (!selectedSessionId.value) {
      selectedSession.value = null;
    }
  }

  function patchIssueSession(patch = {}) {
    const sessionId = patch?.sessionId || selectedSessionId.value;
    if (!sessionId) {
      return null;
    }
    const mergeSession = (session = {}) => ({
      ...session,
      ...patch,
      sessionId
    });
    if (selectedSession.value?.sessionId === sessionId) {
      selectedSession.value = mergeSession(selectedSession.value);
      rememberContract(selectedSession.value);
    }
    issueSessions.value = issueSessions.value.map((session) => {
      return session.sessionId === sessionId ? mergeSession(session) : session;
    });
    return selectedSession.value?.sessionId === sessionId ? selectedSession.value : null;
  }

  async function loadIssueSessions() {
    issueSessionsLoading.value = true;
    issueSessionsError.value = "";
    try {
      const response = await listAiStudioSessions();
      rememberContract(response);
      applySessionList(response?.sessions || []);
      if (selectedSessionId.value) {
        await selectSession(selectedSessionId.value, { preserveList: true });
      }
    } catch (loadError) {
      issueSessionsError.value = errorMessage(loadError, "Issue sessions could not be loaded.");
    } finally {
      issueSessionsLoading.value = false;
    }
  }

  async function selectSession(sessionId, { preserveList = false } = {}) {
    selectedSessionId.value = sessionId;
    issueSessionsError.value = "";
    try {
      selectedSession.value = await readAiStudioSession(sessionId);
      rememberContract(selectedSession.value);
      rememberSessionId(selectedSession.value?.sessionId || sessionId);
      resetStepInputValues(selectedSession.value);
      if (!preserveList) {
        const response = await listAiStudioSessions();
        rememberContract(response);
        applySessionList(response?.sessions || []);
      }
      return selectedSession.value;
    } catch (loadError) {
      selectedSessionId.value = "";
      selectedSession.value = null;
      rememberSessionId("");
      issueSessionsError.value = errorMessage(loadError, "Issue session could not be loaded.");
      return null;
    }
  }

  async function createSession() {
    if (!canCreateIssueSession.value) {
      issueSessionsError.value = `Studio allows up to ${maxOpenIssueSessions.value} active sessions at once. Finish or abandon one before creating another.`;
      return;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await createAiStudioSession();
      if (response?.ok === false) {
        selectedSession.value = response;
        rememberContract(response);
        resetStepInputValues(response);
        issueSessionsError.value = response.errors?.[0]?.message || "Session creation failed.";
        return;
      }
      selectedSessionId.value = response.sessionId;
      rememberSessionId(response.sessionId);
      await loadIssueSessions();
    } catch (createError) {
      issueSessionsError.value = errorMessage(createError, "Session creation failed.");
    } finally {
      issueSessionBusy.value = false;
    }
  }

  function buildStepPayload(override = {}, {
    includeStepInput = true
  } = {}) {
    const input = selectedStepInput.value || {};
    if (!includeStepInput || !input.name || input.type === "none") {
      return override;
    }
    return {
      [input.name]: stepInputValues.value[input.name] || "",
      ...override
    };
  }

  async function refreshSessionList() {
    const response = await listAiStudioSessions();
    rememberContract(response);
    applySessionList(response?.sessions || []);
  }

  async function applySessionResponse(response, fallbackError) {
    selectedSession.value = response;
    rememberContract(response);
    if (response?.ok === false) {
      issueSessionsError.value = response.errors?.[0]?.message || fallbackError;
    } else {
      resetStepInputValues(response);
    }
    await refreshSessionList();
    return response;
  }

  async function runSelectedAction(actionId, input = {}) {
    if (!selectedSessionId.value || !actionId) {
      return null;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await runAiStudioSessionAction(selectedSessionId.value, actionId, input);
      return await applySessionResponse(response, "Session action failed.");
    } catch (stepError) {
      issueSessionsError.value = errorMessage(stepError, "Session action failed.");
      return null;
    } finally {
      issueSessionBusy.value = false;
    }
  }

  async function advanceSelectedSession() {
    if (!selectedSessionId.value) {
      return null;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await advanceAiStudioSession(selectedSessionId.value);
      return await applySessionResponse(response, "Session advance failed.");
    } catch (stepError) {
      issueSessionsError.value = errorMessage(stepError, "Session advance failed.");
      return null;
    } finally {
      issueSessionBusy.value = false;
    }
  }

  async function runSelectedStep(override = {}, options = {}) {
    if (!selectedSessionId.value) {
      return null;
    }
    if (override?.advance === true) {
      return advanceSelectedSession();
    }
    const actionId = String(override?.actionId || override?.actionCommand || override?.sessionAction || "").trim();
    if (!actionId) {
      issueSessionsError.value = "No AI Studio action was selected.";
      return null;
    }
    return runSelectedAction(actionId, buildStepPayload(override, options));
  }

  async function abandonSelectedSession() {
    if (!selectedSessionId.value) {
      return null;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const abandonedSession = await abandonAiStudioSession(selectedSessionId.value);
      selectedSession.value = abandonedSession;
      rememberContract(selectedSession.value);
      resetStepInputValues(selectedSession.value);
      await loadIssueSessions();
      return abandonedSession;
    } catch (abandonError) {
      issueSessionsError.value = errorMessage(abandonError, "Session abandon failed.");
      return null;
    } finally {
      issueSessionBusy.value = false;
    }
  }

  async function rewindSelectedSession(stepId) {
    if (!selectedSessionId.value) {
      return null;
    }
    void stepId;
    issueSessionsError.value = "AI Studio runtime rewind is not wired yet.";
    return {
      errors: [
        {
          code: "ai_studio_rewind_not_wired",
          message: issueSessionsError.value
        }
      ],
      ok: false
    };
  }

  return {
    abandonSelectedSession,
    advanceSelectedSession,
    activeIssueSessionCount,
    canCreateIssueSession,
    createSession,
    isChoiceStep,
    isTextStep,
    issueSessionBusy,
    issueSessions,
    issueSessionsError,
    issueSessionsLoading,
    maxOpenIssueSessions,
    loadIssueSessions,
    patchIssueSession,
    runSelectedAction,
    runSelectedStep,
    rewindSelectedSession,
    selectSession,
    selectedSession,
    selectedSessionId,
    selectedStepAction,
    selectedStepInput,
    stepDefinitions,
    stepInputValues
  };
}

export {
  useIssueSessions
};
