import { computed, ref, watch } from "vue";
import {
  ISSUE_BODY_ARTIFACT,
  ISSUE_TITLE_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";
import {
  latestAiStudioActionResult
} from "@/lib/aiStudioActionResults.js";

const CREATE_ISSUE_FILE_ACTION_ID = "create_issue_file";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const SEND_ISSUE_PROMPT_ACTION_ID = "send_issue_prompt";

function actionById(session = {}, actionId = "") {
  const normalizedActionId = String(actionId || "");
  return Array.isArray(session?.actions)
    ? session.actions.find((action) => action.id === normalizedActionId) || null
    : null;
}

function artifactIsReady(session = {}, artifactName = "") {
  return session?.artifactReadiness?.[artifactName]?.nonEmpty === true;
}

function issueRequestFromSession(session = {}) {
  return String(latestAiStudioActionResult(session, SEND_ISSUE_PROMPT_ACTION_ID)?.input?.issueRequest || "").trim();
}

function issueFilesAreReady(session = {}) {
  return artifactIsReady(session, ISSUE_TITLE_ARTIFACT) && artifactIsReady(session, ISSUE_BODY_ARTIFACT);
}

function isIssueFileStep(session = {}) {
  return session?.currentStep === ISSUE_FILE_STEP_ID;
}

function useAiStudioIssueFileStep({
  activeActionId,
  clearCopyStatus = () => null,
  commandBusy,
  runActionCommand,
  selectedSession,
  selectedSessionId
} = {}) {
  const requestError = ref("");
  const requestText = ref("");

  const sendIssuePromptAction = computed(() => actionById(selectedSession.value, SEND_ISSUE_PROMPT_ACTION_ID));
  const sentIssueRequest = computed(() => issueRequestFromSession(selectedSession.value));
  const createIssueFilePromptRendered = computed(() => {
    return Boolean(latestAiStudioActionResult(selectedSession.value, CREATE_ISSUE_FILE_ACTION_ID));
  });
  const filesReady = computed(() => issueFilesAreReady(selectedSession.value));
  const formVisible = computed(() => {
    return isIssueFileStep(selectedSession.value) &&
      !filesReady.value &&
      !sentIssueRequest.value;
  });
  const waitingForFiles = computed(() => {
    return isIssueFileStep(selectedSession.value) &&
      createIssueFilePromptRendered.value &&
      !filesReady.value;
  });
  const canSubmit = computed(() => {
    return formVisible.value &&
      Boolean(requestText.value.trim()) &&
      sendIssuePromptAction.value?.enabled === true &&
      !commandBusy.value;
  });
  const submitting = computed(() => Boolean(
    runActionCommand?.isRunning && activeActionId.value === SEND_ISSUE_PROMPT_ACTION_ID
  ));
  const submitTitle = computed(() => {
    if (commandBusy.value) {
      return "Wait for the current Studio action to finish.";
    }
    return sendIssuePromptAction.value?.disabledReason || "Send prompt";
  });

  function inputForAction(action = {}) {
    if (action.id === CREATE_ISSUE_FILE_ACTION_ID && sentIssueRequest.value) {
      return {
        issueRequest: sentIssueRequest.value
      };
    }
    return {};
  }

  function visibleActions(actions = []) {
    if (!isIssueFileStep(selectedSession.value)) {
      return actions;
    }
    if (formVisible.value) {
      return [];
    }
    return actions.filter((action) => action.id !== SEND_ISSUE_PROMPT_ACTION_ID);
  }

  async function sendPrompt() {
    const issueRequest = requestText.value.trim();
    const action = sendIssuePromptAction.value;
    if (!selectedSessionId.value || commandBusy.value || !action || action.enabled !== true) {
      requestError.value = action?.disabledReason || "Issue prompt cannot be sent yet.";
      return;
    }
    if (!issueRequest) {
      requestError.value = "Enter the issue request first.";
      return;
    }

    requestError.value = "";
    clearCopyStatus();
    activeActionId.value = action.id;
    try {
      await runActionCommand.run({
        actionId: action.id,
        input: {
          issueRequest
        },
        sessionId: selectedSessionId.value
      });
    } finally {
      activeActionId.value = "";
    }
  }

  watch(selectedSessionId, () => {
    requestError.value = "";
    requestText.value = "";
  });

  watch(formVisible, (visible) => {
    if (!visible) {
      requestError.value = "";
    }
  });

  return {
    canSubmit,
    formVisible,
    inputForAction,
    requestError,
    requestText,
    sendPrompt,
    submitting,
    submitTitle,
    visibleActions,
    waitingForFiles
  };
}

export {
  useAiStudioIssueFileStep
};
