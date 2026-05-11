import { computed, ref } from "vue";
import {
  abandonIssueSession,
  createIssueSession,
  listIssueSessions,
  readIssueSession,
  runIssueSessionStep
} from "@/lib/studioApi.js";

const USER_CHECK_STEPS = Object.freeze(["11_user_check_1", "14_user_check_2", "17_user_check_3"]);

function errorMessage(error, fallback) {
  return String(error?.message || error || fallback);
}

function firstSessionId(sessions = []) {
  return sessions[0]?.sessionId || "";
}

function useIssueSessions() {
  const issueSessions = ref([]);
  const issueSessionsLoading = ref(false);
  const issueSessionBusy = ref(false);
  const issueSessionsError = ref("");
  const selectedSessionId = ref("");
  const selectedSession = ref(null);
  const issuePromptInput = ref("");
  const issueTextInput = ref("");

  const isUserCheckStep = computed(() => {
    return USER_CHECK_STEPS.includes(selectedSession.value?.currentStep || "");
  });

  function applySessionList(sessions = []) {
    issueSessions.value = sessions;
    const selectedStillExists = sessions.some((session) => session.sessionId === selectedSessionId.value);
    if (selectedStillExists) {
      return;
    }
    selectedSessionId.value = firstSessionId(sessions);
    if (!selectedSessionId.value) {
      selectedSession.value = null;
    }
  }

  async function loadIssueSessions() {
    issueSessionsLoading.value = true;
    issueSessionsError.value = "";
    try {
      const response = await listIssueSessions();
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
      if (!preserveList) {
        const response = await listIssueSessions();
        applySessionList(response?.sessions || []);
      }
    } catch (loadError) {
      selectedSessionId.value = "";
      selectedSession.value = null;
      issueSessionsError.value = errorMessage(loadError, "Issue session could not be loaded.");
    }
  }

  async function createSession() {
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await createIssueSession();
      if (response?.ok === false) {
        selectedSession.value = response;
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

  function selectedStepInput(override = {}) {
    const currentStep = selectedSession.value?.currentStep || "";
    if (currentStep === "03_issue_prompt_rendered") {
      return {
        prompt: issuePromptInput.value,
        ...override
      };
    }
    if (currentStep === "04_issue_drafted") {
      return {
        issue: issueTextInput.value,
        ...override
      };
    }
    return override;
  }

  async function runSelectedStep(override = {}) {
    if (!selectedSessionId.value) {
      return;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      const response = await runIssueSessionStep(selectedSessionId.value, selectedStepInput(override));
      selectedSession.value = response;
      if (response?.ok === false) {
        issueSessionsError.value = response.errors?.[0]?.message || "Session step failed.";
      }
      if (response?.currentStep !== "03_issue_prompt_rendered") {
        issuePromptInput.value = "";
      }
      if (response?.currentStep !== "04_issue_drafted") {
        issueTextInput.value = "";
      }
      const listResponse = await listIssueSessions();
      applySessionList(listResponse?.sessions || []);
    } catch (stepError) {
      issueSessionsError.value = errorMessage(stepError, "Session step failed.");
    } finally {
      issueSessionBusy.value = false;
    }
  }

  async function abandonSelectedSession() {
    if (!selectedSessionId.value) {
      return;
    }
    issueSessionBusy.value = true;
    issueSessionsError.value = "";
    try {
      selectedSession.value = await abandonIssueSession(selectedSessionId.value);
      await loadIssueSessions();
    } catch (abandonError) {
      issueSessionsError.value = errorMessage(abandonError, "Session abandon failed.");
    } finally {
      issueSessionBusy.value = false;
    }
  }

  return {
    abandonSelectedSession,
    createSession,
    isUserCheckStep,
    issuePromptInput,
    issueSessionBusy,
    issueSessions,
    issueSessionsError,
    issueSessionsLoading,
    issueTextInput,
    loadIssueSessions,
    runSelectedStep,
    selectSession,
    selectedSession,
    selectedSessionId
  };
}

export {
  useIssueSessions
};
