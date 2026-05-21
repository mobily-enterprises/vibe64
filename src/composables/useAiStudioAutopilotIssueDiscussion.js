import { computed, nextTick, ref, watch } from "vue";
import {
  useAiStudioCodexQuestionExchange
} from "@/composables/useAiStudioCodexQuestionExchange.js";
import {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
} from "@/lib/aiStudioAutopilotIssuePrompt.js";
import {
  latestAiStudioActionResult
} from "@/lib/aiStudioActionResults.js";
import {
  clearAiStudioAutopilotArtifacts,
  clearAiStudioIssueArtifacts,
  saveAiStudioIssueArtifacts
} from "@/lib/aiStudioSessionApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const ISSUE_PROMPT_ACTION_ID = "send_issue_prompt";
const STORAGE_KEY_PREFIX = "ai-studio:autopilot:issue-discussion:";

const ISSUE_DISCUSSION_STATE = Object.freeze({
  INPUT: "input",
  QUESTIONS: "questions",
  REVIEW: "review",
  SAVING: "saving",
  WAITING: "waiting"
});

function browserLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function localStorageKey(sessionId = "") {
  return `${STORAGE_KEY_PREFIX}${String(sessionId || "").trim()}`;
}

function readStoredDiscussion(sessionId = "") {
  const storage = browserLocalStorage();
  if (!storage || !sessionId) {
    return {};
  }
  try {
    const value = JSON.parse(storage.getItem(localStorageKey(sessionId)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStoredDiscussion(sessionId = "", value = {}) {
  const storage = browserLocalStorage();
  if (!storage || !sessionId) {
    return;
  }
  storage.setItem(localStorageKey(sessionId), JSON.stringify({
    activeRequestId: String(value.activeRequestId || ""),
    ignoredRequestIds: Array.isArray(value.ignoredRequestIds) ? value.ignoredRequestIds : [],
    questionAnswers: Array.isArray(value.questionAnswers) ? value.questionAnswers : [],
    requestText: String(value.requestText || "")
  }));
}

function clearStoredDiscussion(sessionId = "") {
  browserLocalStorage()?.removeItem(localStorageKey(sessionId));
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function artifactIsReady(session = {}, artifactName = "") {
  return session?.artifactReadiness?.[artifactName]?.nonEmpty === true;
}

function issueArtifactsAreReady(session = {}) {
  return artifactIsReady(session, ISSUE_TITLE_ARTIFACT) && artifactIsReady(session, ISSUE_BODY_ARTIFACT);
}

function issueIsSelected(session = {}) {
  return Boolean(String(session?.metadata?.issue_url || "").trim());
}

function nextIsReady(next = {}) {
  return next?.visible === true && next.enabled === true;
}

function loadedDiscussionState(activeRequestId = "") {
  return String(activeRequestId || "").trim()
    ? ISSUE_DISCUSSION_STATE.WAITING
    : ISSUE_DISCUSSION_STATE.INPUT;
}

function storedIgnoredRequestIds(stored = {}) {
  if (Array.isArray(stored.ignoredRequestIds)) {
    return stored.ignoredRequestIds.map(String);
  }
  if (Array.isArray(stored.rejectedRequestIds)) {
    return stored.rejectedRequestIds.map(String);
  }
  return [];
}

function withQuestionAnswers(questions = [], answers = []) {
  return questions.map((question, index) => ({
    ...question,
    answer: String(answers[index] || question.answer || "")
  }));
}

function issueQuestionOwnerId(sessionId = "") {
  return `issue:${String(sessionId || "").trim()}`;
}

function issueRequestFromSession(session = {}) {
  return String(latestAiStudioActionResult(session, ISSUE_PROMPT_ACTION_ID)?.input?.issueRequest || "").trim();
}

function requestIsAllowed(requestId = "", {
  activeRequestId = "",
  ignoredRequestIds = new Set()
} = {}) {
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId || ignoredRequestIds.has(normalizedRequestId)) {
    return false;
  }
  return !activeRequestId || normalizedRequestId === activeRequestId;
}

function useAiStudioAutopilotIssueDiscussion({
  actions = {},
  autopilotArtifacts = null,
  clearAutopilotArtifacts = clearAiStudioAutopilotArtifacts,
  clearIssueArtifacts = clearAiStudioIssueArtifacts,
  codexTerminal = {},
  enabled = true,
  questionExchange = null,
  readyForIssue = () => false,
  refreshSessionData = async () => null,
  saveIssueArtifacts = saveAiStudioIssueArtifacts,
  session
} = {}) {
  const state = ref(ISSUE_DISCUSSION_STATE.INPUT);
  const requestText = ref("");
  const activeRequestId = ref("");
  const ignoredRequestIds = ref(new Set());
  const draftBody = ref("");
  const draftTitle = ref("");
  const failure = ref("");
  const saving = ref(false);
  const storedQuestionAnswers = ref([]);
  const codexQuestions = questionExchange || useAiStudioCodexQuestionExchange({
    codexTerminal
  });

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const artifactsRoot = computed(() => String(currentSession.value?.artifactsRoot || ""));
  const currentAutopilotArtifacts = computed(() => readRefOrGetterValue(autopilotArtifacts) || null);
  const codexBusy = computed(() => readRefOrGetterValue(codexTerminal.busy) === true);
  const promptInjectionError = computed(() => String(readRefOrGetterValue(codexTerminal.promptInjectionError) || ""));
  const discussionEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const ready = computed(() => Boolean(discussionEnabled.value && readRefOrGetterValue(readyForIssue)));
  const waiting = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.WAITING);
  const questionOwnerId = computed(() => issueQuestionOwnerId(sessionId.value));
  const issueQuestionActive = computed(() => ready.value &&
    state.value === ISSUE_DISCUSSION_STATE.QUESTIONS &&
    codexQuestions.isOwner(questionOwnerId.value));
  const reviewing = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.REVIEW);
  const inputVisible = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.INPUT);
  const questions = computed(() => issueQuestionActive.value ? codexQuestions.questions.value : []);
  const canSubmit = computed(() => {
    return ready.value &&
      inputVisible.value &&
      Boolean(requestText.value.trim()) &&
      !saving.value;
  });
  const canAccept = computed(() => {
    return ready.value &&
      reviewing.value &&
      Boolean(draftTitle.value.trim()) &&
      Boolean(draftBody.value.trim()) &&
      !saving.value;
  });
  const questionFailure = computed(() => issueQuestionActive.value ? codexQuestions.failure.value : "");
  const statusText = computed(() => {
    if (failure.value || questionFailure.value) {
      return failure.value || questionFailure.value;
    }
    if (saving.value || state.value === ISSUE_DISCUSSION_STATE.SAVING) {
      return "Saving issue file...";
    }
    if (waiting.value) {
      return "Asking Codex to define the issue...";
    }
    if (issueQuestionActive.value) {
      return "A few questions first";
    }
    if (reviewing.value) {
      return "Does this sound right?";
    }
    return "What would you like to do?";
  });

  async function submitInitialRequest() {
    const normalizedRequest = requestText.value.trim();
    if (!normalizedRequest || !ready.value) {
      failure.value = normalizedRequest ? "Issue discussion is not available yet." : "Describe what you would like to do.";
      return;
    }

    const requestId = createRequestId();
    requestText.value = normalizedRequest;
    activeRequestId.value = requestId;
    failure.value = "";
    persistDiscussion();
    await clearAutopilotArtifacts(sessionId.value);
    await injectIssuePrompt(buildInitialIssueDraftPrompt({
      artifactsRoot: artifactsRoot.value,
      requestId,
      requestText: normalizedRequest
    }), requestId);
  }

  async function rejectIssueDraft() {
    if (!reviewing.value) {
      return;
    }

    saving.value = true;
    failure.value = "";
    try {
      const response = await clearIssueArtifacts(sessionId.value);
      if (response?.ok === false) {
        throw new Error(response.error || response.errors?.[0]?.message || "Issue file could not be cleared.");
      }

      await returnToInputIgnoringCurrentCodexAnswer();
      await refreshSessionData();
    } catch (error) {
      failure.value = String(error?.message || error || "Issue file could not be cleared.");
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
    } finally {
      saving.value = false;
    }
  }

  async function cancelWaiting() {
    if (!waiting.value) {
      return;
    }

    failure.value = "";
    await returnToInputIgnoringCurrentCodexAnswer();
  }

  async function acceptIssueDraft() {
    if (!canAccept.value) {
      failure.value = "Issue title and body are required.";
      return;
    }

    saving.value = true;
    state.value = ISSUE_DISCUSSION_STATE.SAVING;
    failure.value = "";
    try {
      const response = await saveIssueArtifacts(sessionId.value, {
        body: draftBody.value,
        title: draftTitle.value
      });
      if (response?.ok === false) {
        throw new Error(response.error || response.errors?.[0]?.message || "Issue file could not be saved.");
      }

      await clearAutopilotArtifacts(sessionId.value);
      await refreshSessionData();
      await nextTick();
      if (!await advanceIfReady()) {
        throw new Error("Issue file was saved, but the next workflow step is not ready.");
      }
      clearStoredDiscussion(sessionId.value);
    } catch (error) {
      failure.value = String(error?.message || error || "Issue file could not be saved.");
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
    } finally {
      saving.value = false;
    }
  }

  async function injectIssuePrompt(prompt, requestId) {
    state.value = ISSUE_DISCUSSION_STATE.WAITING;
    if (typeof codexTerminal.injectPrompt !== "function") {
      resetActiveRequestAfterPromptFailure("Codex prompt injection is not available.");
      return;
    }

    const injected = await codexTerminal.injectPrompt(prompt, {
      requestId,
      sessionId: sessionId.value
    });
    if (injected === false) {
      resetActiveRequestAfterPromptFailure("Codex prompt could not be sent.");
    }
  }

  function resetActiveRequestAfterPromptFailure(message = "") {
    activeRequestId.value = "";
    failure.value = message;
    state.value = ISSUE_DISCUSSION_STATE.INPUT;
    persistDiscussion();
  }

  async function advanceIfReady() {
    await refreshSessionData();
    await nextTick();
    const next = readRefOrGetterValue(actions.currentNext);
    if (!nextIsReady(next)) {
      return false;
    }
    if (typeof actions.goNext !== "function") {
      return false;
    }
    await actions.goNext?.();
    await refreshSessionData();
    return true;
  }

  function persistDiscussion() {
    writeStoredDiscussion(sessionId.value, {
      activeRequestId: activeRequestId.value,
      ignoredRequestIds: [...ignoredRequestIds.value],
      questionAnswers: questions.value.map((question) => String(question.answer || "")),
      requestText: requestText.value
    });
  }

  async function returnToInputIgnoringCurrentCodexAnswer() {
    const requestIdToIgnore = activeRequestId.value;
    if (requestIdToIgnore) {
      ignoredRequestIds.value = new Set([
        ...ignoredRequestIds.value,
        requestIdToIgnore
      ]);
    }

    activeRequestId.value = "";
    draftBody.value = "";
    draftTitle.value = "";
    storedQuestionAnswers.value = [];
    codexQuestions.clearForOwner(questionOwnerId.value);
    await clearAutopilotArtifacts(sessionId.value);
    state.value = ISSUE_DISCUSSION_STATE.INPUT;
    persistDiscussion();
  }

  function loadDiscussion(nextSessionId = "") {
    const stored = readStoredDiscussion(nextSessionId);
    requestText.value = String(stored.requestText || "");
    activeRequestId.value = String(stored.activeRequestId || "");
    ignoredRequestIds.value = new Set(storedIgnoredRequestIds(stored));
    storedQuestionAnswers.value = Array.isArray(stored.questionAnswers)
      ? stored.questionAnswers.map(String)
      : [];
    draftBody.value = "";
    draftTitle.value = "";
    failure.value = "";
    state.value = loadedDiscussionState(activeRequestId.value);
    applyLatestIssueFile();
  }

  function applyLatestIssueFile(autopilotFiles = currentAutopilotArtifacts.value) {
    if (!ready.value || issueArtifactsAreReady(currentSession.value) || issueIsSelected(currentSession.value) || !sessionId.value) {
      return false;
    }
    if (!autopilotFiles || autopilotFiles.sessionId !== sessionId.value) {
      return false;
    }
    if (autopilotFiles.ok === false) {
      failure.value = autopilotFiles.error || "Autopilot issue files could not be read.";
      return false;
    }

    const issueDraft = autopilotFiles.issueDraft;
    if (requestIsAllowed(issueDraft?.requestId, {
      activeRequestId: activeRequestId.value,
      ignoredRequestIds: ignoredRequestIds.value
    })) {
      activeRequestId.value = issueDraft.requestId;
      draftBody.value = issueDraft.body;
      draftTitle.value = issueDraft.title;
      codexQuestions.clearForOwner(questionOwnerId.value);
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
      persistDiscussion();
      return true;
    }

    const questionFile = autopilotFiles.questions;
    if (requestIsAllowed(questionFile?.requestId, {
      activeRequestId: activeRequestId.value,
      ignoredRequestIds: ignoredRequestIds.value
    })) {
      activeRequestId.value = questionFile.requestId;
      draftBody.value = "";
      draftTitle.value = "";
      state.value = ISSUE_DISCUSSION_STATE.QUESTIONS;
      startQuestionExchange(questionFile);
      persistDiscussion();
      return true;
    }

    return false;
  }

  function startQuestionExchange(questionFile = {}) {
    codexQuestions.start({
      contextLabel: "Issue definition",
      onAnswerChange: (nextQuestions = []) => {
        storedQuestionAnswers.value = nextQuestions.map((question) => String(question.answer || ""));
        persistDiscussion();
      },
      onCancel: () => {
        failure.value = "";
        void returnToInputIgnoringCurrentCodexAnswer();
      },
      onSubmitted: ({ prepared = {} } = {}) => {
        if (prepared.answeredRequestId) {
          ignoredRequestIds.value = new Set([
            ...ignoredRequestIds.value,
            prepared.answeredRequestId
          ]);
        }
        activeRequestId.value = prepared.requestId;
        failure.value = "";
        storedQuestionAnswers.value = [];
        state.value = ISSUE_DISCUSSION_STATE.WAITING;
        persistDiscussion();
      },
      ownerId: questionOwnerId.value,
      prepareSubmit: async ({ questions: answeredQuestions = [] } = {}) => {
        const requestId = createRequestId();
        await clearAutopilotArtifacts(sessionId.value);
        return {
          answeredRequestId: activeRequestId.value,
          injectionContext: {
            requestId,
            sessionId: sessionId.value
          },
          prompt: buildAnsweredIssueDraftPrompt({
            artifactsRoot: artifactsRoot.value,
            requestId,
            requestText: requestText.value || issueRequestFromSession(currentSession.value),
            questions: answeredQuestions
          }),
          requestId
        };
      },
      questions: withQuestionAnswers(questionFile.questions || [], storedQuestionAnswers.value)
    });
  }

  watch(sessionId, loadDiscussion, {
    immediate: true
  });

  watch(currentAutopilotArtifacts, (nextArtifacts) => {
    applyLatestIssueFile(nextArtifacts);
  }, {
    flush: "post"
  });

  watch(codexBusy, (busy, wasBusy) => {
    if (!busy || wasBusy || !sessionId.value) {
      return;
    }
    if (issueQuestionActive.value || currentAutopilotArtifacts.value?.questions) {
      codexQuestions.clearForOwner(questionOwnerId.value);
      state.value = ISSUE_DISCUSSION_STATE.WAITING;
      void clearAutopilotArtifacts(sessionId.value).catch(() => null);
    }
  }, {
    flush: "post"
  });

  watch(promptInjectionError, (error) => {
    if (!discussionEnabled.value || !error || !waiting.value) {
      return;
    }
    resetActiveRequestAfterPromptFailure(error);
  });

  return {
    acceptIssueDraft,
    cancelWaiting,
    canAccept,
    canSubmit,
    draftBody,
    draftTitle,
    failure,
    inputVisible,
    requestText,
    reviewing,
    rejectIssueDraft,
    saving,
    state,
    statusText,
    submitInitialRequest,
    waiting
  };
}

export {
  ISSUE_DISCUSSION_STATE,
  useAiStudioAutopilotIssueDiscussion
};
