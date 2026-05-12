import { computed, ref } from "vue";
import {
  abandonIssueSession,
  createIssueSession,
  listIssueSessions,
  readIssueSession,
  runIssueSessionStep
} from "@/lib/studioApi.js";

function errorMessage(error, fallback) {
  return String(error?.message || error || fallback);
}

function firstSessionId(sessions = []) {
  return sessions[0]?.sessionId || "";
}

const DEFAULT_MAX_OPEN_SESSIONS = 3;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);

function isOpenIssueSession(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session?.status || ""));
}

function visibleIssueSessions(sessions = []) {
  return sessions.filter((session) => String(session?.status || "") !== "abandoned");
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
  const selectedSessionId = ref("");
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
      return;
    }
    selectedSessionId.value = firstSessionId(displaySessions);
    if (!selectedSessionId.value) {
      selectedSession.value = null;
    }
  }

  async function loadIssueSessions() {
    issueSessionsLoading.value = true;
    issueSessionsError.value = "";
    try {
      const response = await listIssueSessions();
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
      selectedSession.value = await readIssueSession(sessionId);
      rememberContract(selectedSession.value);
      resetStepInputValues(selectedSession.value);
      if (!preserveList) {
        const response = await listIssueSessions();
        rememberContract(response);
        applySessionList(response?.sessions || []);
      }
      return selectedSession.value;
    } catch (loadError) {
      selectedSessionId.value = "";
      selectedSession.value = null;
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
      const response = await createIssueSession();
      if (response?.ok === false) {
        selectedSession.value = response;
        rememberContract(response);
        resetStepInputValues(response);
        issueSessionsError.value = response.errors?.[0]?.message || "Session creation failed.";
        return;
      }
      selectedSessionId.value = response.sessionId;
      await loadIssueSessions();
    } catch (createError) {
      issueSessionsError.value = errorMessage(createError, "Session creation failed.");
    } finally {
      issueSessionBusy.value = false;
    }
  }

  function buildStepPayload(override = {}) {
    const input = selectedStepInput.value || {};
    if (!input.name || input.type === "none") {
      return override;
    }
    return {
      [input.name]: stepInputValues.value[input.name] || "",
      ...override
    };
  }

  async function runSelectedStep(override = {}) {
    if (!selectedSessionId.value) {
      return null;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await runIssueSessionStep(selectedSessionId.value, buildStepPayload(override));
      selectedSession.value = response;
      rememberContract(response);
      if (response?.ok === false) {
        issueSessionsError.value = response.errors?.[0]?.message || "Session step failed.";
      } else {
        resetStepInputValues(response);
      }
      const listResponse = await listIssueSessions();
      rememberContract(listResponse);
      applySessionList(listResponse?.sessions || []);
      return response;
    } catch (stepError) {
      issueSessionsError.value = errorMessage(stepError, "Session step failed.");
      return null;
    } finally {
      issueSessionBusy.value = false;
    }
  }

  async function abandonSelectedSession() {
    if (!selectedSessionId.value) {
      return null;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const abandonedSession = await abandonIssueSession(selectedSessionId.value);
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

  return {
    abandonSelectedSession,
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
    runSelectedStep,
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
