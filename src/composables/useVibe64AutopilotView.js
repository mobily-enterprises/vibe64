import { computed, inject, nextTick, ref, unref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VIBE64_DEFAULT_AGENT_PROVIDER_ID
} from "@local/vibe64-runtime/shared";
import {
  useVibe64AgentSettings
} from "@/composables/useVibe64AgentSettings.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  chatMessagePayload,
  createChatMessageId,
  unmatchedOptimisticMessages
} from "@/lib/vibe64ChatMessage.js";
import {
  numberedQuestionSubmissionText,
  parseNumberedQuestionPrompt
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  parseAnswerChoicePrompt
} from "@/lib/vibe64AnswerChoiceSugar.js";
import {
  latestAssistantMessageAwaitingUserReply
} from "@/lib/vibe64ConversationQuestions.js";
import {
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix,
  vibe64SessionToolIdFromRouteSegment
} from "@/lib/vibe64SessionToolDefinitions.js";
import {
  normalizeProjectRoutePath,
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  sessionGithubCommandActor
} from "@/lib/vibe64GitCommandActor.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  useVibe64Accounts
} from "@local/vibe64-accounts/client";
import {
  VIBE64_WELCOME_NAME_KEY
} from "@/lib/vibe64WelcomeName.js";

const DIRECT_SESSION_TOOL_IDS = new Set([
  "info",
  "changes",
  "repository",
  "editor",
  "database",
  "system",
  "ai-terminal"
]);
const STANDALONE_SESSION_TOOL_IDS = new Set([
  "editor",
  "database",
  "system"
]);
const EMPTY_CONVERSATION_WELCOME = "Hi! 👋 I’m excited to build something with you. Tell me what you have in mind—even a half-formed idea is perfect. We’ll shape it together.";
const EXISTING_PROJECT_CONVERSATION_WELCOME = "Hi! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together.";
const RENEWED_SESSION_CONVERSATION_WELCOME = "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next.";
const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";
const NUMBERED_QUESTION_UNSURE_CHOICE = Object.freeze({
  label: NUMBERED_QUESTION_UNSURE_VALUE,
  recommended: false,
  selectLabel: NUMBERED_QUESTION_UNSURE_VALUE,
  value: NUMBERED_QUESTION_UNSURE_VALUE
});
const EXECUTION_CAPACITY_ERROR_CODES = new Set([
  "vibe64_capacity_rejected"
]);
const EXECUTION_SAFETY_ERROR_CODES = new Set([
  "vibe64_codex_app_server_cleanup_required",
  "vibe64_codex_app_server_metadata_failed",
  "vibe64_codex_app_server_process_identity_unverified",
  "vibe64_codex_economy_runtime_cleanup_required",
  "vibe64_codex_economy_runtime_metadata_failed",
  "vibe64_execution_cleanup_required",
  "vibe64_execution_drain_failed",
  "vibe64_execution_ownership_unknown",
  "vibe64_managed_execution_provider_unavailable"
]);
const SHORT_ACTION_DISMISSALS_STORAGE_PREFIX = "vibe64:short-action-dismissals:v1";
const vibe64AutopilotViewEmits = [
  "busy-change",
  "chat-attention",
  "execution-attention",
  "project-attention"
];
const vibe64AutopilotViewProps = {
  active: {
    default: true,
    type: Boolean
  },
  agentConnectionStatus: {
    default: "connected",
    type: String
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  cancelAgentMessage: {
    default: async () => false,
    type: Function
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  interruptAgentTurn: {
    default: async () => false,
    type: Function
  },
  page: {
    default: () => ({}),
    type: Object
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  promptHintPolicy: {
    default: () => ({
      enabled: true,
      ready: false,
      revision: 0,
      version: 0
    }),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  projectPane: {
    default: "preview",
    type: String
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  refreshSessionWork: {
    default: async () => null,
    type: Function
  },
  retryWorkspaceSetup: {
    default: async () => false,
    type: Function
  },
  saveSessionWork: {
    default: async () => false,
    type: Function
  },
  updateSessionWork: {
    default: async () => false,
    type: Function
  },
  sendAgentMessage: {
    default: async () => false,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  sessionArchive: {
    default: () => ({}),
    type: Object
  },
  sessionRenewal: {
    default: () => ({}),
    type: Object
  },
  sessionSelectionArchived: {
    default: false,
    type: Boolean
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  workState: {
    default: () => ({}),
    type: Object
  }
};

function emptyConversationWelcomeText({
  existingProject = false,
  preferredName = "",
  renewedSession = false
} = {}) {
  const message = renewedSession
    ? RENEWED_SESSION_CONVERSATION_WELCOME
    : existingProject
      ? EXISTING_PROJECT_CONVERSATION_WELCOME
      : EMPTY_CONVERSATION_WELCOME;
  const name = normalizedAgentTurnText(preferredName);
  return name ? message.replace("Hi!", `Hi ${name}!`) : message;
}

function normalizedAgentTurnText(value = "") {
  return String(value || "").trim();
}

function composerDraftAfterAcceptedSubmission(currentDraft = "", submittedDraft = "") {
  const current = String(currentDraft || "");
  const submitted = String(submittedDraft || "");
  if (current === submitted) {
    return "";
  }
  return submitted && current.startsWith(submitted)
    ? current.slice(submitted.length)
    : current;
}

function agentConnectionThinkingLabel({
  active = false,
  status = "connected"
} = {}) {
  if (!active || status === "connected") {
    return "";
  }
  if (status === "disconnected") {
    return "Connection lost — assistant status unknown.";
  }
  return status === "reconciling"
    ? "Checking assistant status..."
    : "Assistant status could not be verified.";
}

function normalizeProjectPane(value = "") {
  return value === "dashboard" ? "dashboard" : "preview";
}

function sessionNavLabel(session = {}) {
  const name = normalizedAgentTurnText(
    session?.sessionName || session?.metadata?.issue_word
  );
  if (name) {
    return name;
  }
  const sessionId = normalizedAgentTurnText(session?.sessionId);
  return sessionId.includes("_")
    ? sessionId.split("_").slice(-2).join("_")
    : sessionId.slice(0, 12);
}

function workspaceSetupFixPrompt(workspaceSetup = {}) {
  const diagnostic = normalizedAgentTurnText(workspaceSetup?.diagnostic) ||
    "Workspace preparation did not complete.";
  const transcript = normalizedAgentTurnText(workspaceSetup?.transcript);
  const recentTranscript = transcript.length > 12_000
    ? `[Earlier preparation output omitted.]\n${transcript.slice(-12_000)}`
    : transcript;
  return [
    "Workspace preparation needs attention.",
    `Diagnostic:\n${diagnostic}`,
    recentTranscript ? `Recent preparation output:\n${recentTranscript}` : "",
    "Diagnose and repair the current workspace while preserving its existing work.",
    "When your turn finishes, Vibe64 will automatically rerun its deterministic workspace preparation. Do not merely tell the user to retry.",
    "If the repair needs information only the user can provide, ask for it in this temporary conversation."
  ].filter(Boolean).join("\n\n");
}

function previewIdentityFixPrompt({
  error = "",
  identity = {}
} = {}) {
  const name = normalizedAgentTurnText(identity?.name) || "configured identity";
  const type = normalizedAgentTurnText(identity?.type) || "selector";
  const value = normalizedAgentTurnText(identity?.value) || "unknown";
  const diagnostic = normalizedAgentTurnText(error) || "The application rejected the identity.";
  return [
    `The managed preview could not sign in as \`${name}\` (${type}: \`${value}\`):`,
    diagnostic,
    "Please diagnose and fix this in the current application. Ensure its app-owned, idempotent development seed creates this user profile and any workspace membership the app requires in every fresh database, then run the normal database preparation command and verify the identity exchange. Keep preview authentication material host-managed; do not add, reveal, or hardcode Vibe64 secrets."
  ].join("\n\n");
}

const REPOSITORY_TEMPORARY_AI_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files; Vibe64 owns applying and verifying the repository operation.",
  "Preserve the intended behavior of both the latest saved work and this session. Do not hand-edit generated Genesis maps; Vibe64 regenerates its derived artifacts. A clean index after rollback is not proof that the conflict is resolved."
].join("\n");

const UPDATE_REPAIR_MESSAGES = {
  completion: "File repairs prepared. Vibe64 must check Update before this repair is finished.",
  nextStep: "Vibe64 will check Update after the repair.",
  handoff: [
    "Your task is to prepare the file repair, not to run or complete the rebase yourself. Return kind=complete with a factual report as soon as the edits and focused checks are ready for Vibe64 to try Update. Vibe64 then runs Update automatically and returns remaining conflicts to this same conversation.",
    "Return kind=continue only when you need an actual user decision, and ask that specific question. Do not wait for the user to click Rebase or tell them to open another repair chat.",
    "Describe progress in terms of the user's features and remaining work. Keep HEAD/index/ref bookkeeping in the technical checks, not routine progress or the final reply. Passing application tests is not proof that Update succeeded."
  ].join("\n")
};

const TEMPORARY_AI_RECOVERY_NOTICE = "This is a separate temporary chat. Temporary AI can edit this session to make the repair. Follow progress here and reply below if it needs a decision.";

function repositoryTemporaryAiDedupeKey({
  code = "",
  diagnostic = "",
  sessionId = ""
} = {}) {
  return [
    "repository-recovery",
    normalizedAgentTurnText(sessionId),
    normalizedAgentTurnText(code),
    normalizedAgentTurnText(diagnostic)
  ].join("|");
}

function useVibe64AutopilotView(props, emit, {
  assistantAccessLoading = null,
  assistantCanRequestMessage = null,
  assistantCanUseAi = null,
  assistantRestrictionMessage = null,
  onAttachmentsAccepted = null,
  requestTemporaryAi = null,
  sendMainChatMessage = null
} = {}) {
  const route = useRoute();
  const router = useRouter();
  const projectSlug = useVibe64ProjectSlug();
  const Vibe64OutputControls = defineVibe64AsyncComponent({
    label: "Launch controls",
    loader: () => import("@/components/studio/Vibe64OutputControls.vue"),
    minHeight: "10rem"
  });
  const agentSettings = useVibe64AgentSettings();
  const preferredName = inject(VIBE64_WELCOME_NAME_KEY, () => {
    const accounts = useVibe64Accounts();
    return computed(() => accounts.status.value?.personalProfile?.preferredName);
  }, true);
  const currentAgentSettings = computed(() => agentSettings.settings.value);
  const requestAgentSettings = computed(() => {
    const settings = currentAgentSettings.value || {};
    return String(settings.providerId || "") !== VIBE64_DEFAULT_AGENT_PROVIDER_ID ||
      String(settings.model || "") ||
      String(settings.thinking || "")
      ? settings
      : null;
  });
  const sessionId = computed(() => normalizedAgentTurnText(props.session?.sessionId));
  const assistantAccessConfigured = assistantCanUseAi !== null;
  const assistantAccessPending = computed(() => (
    assistantAccessConfigured && unref(assistantAccessLoading) === true
  ));
  const currentAssistantRestrictionMessage = computed(() => normalizedAgentTurnText(
    unref(assistantRestrictionMessage)
  ) || "The selected AI connection is unavailable for this account.");
  const assistantDirectAllowed = computed(() => (
    !assistantAccessConfigured || unref(assistantCanUseAi) === true
  ));
  const assistantMainChatAllowed = computed(() => (
    !assistantAccessConfigured ||
    unref(assistantCanUseAi) === true ||
    unref(assistantCanRequestMessage) === true
  ));
  const sessionGithubActor = computed(() => sessionGithubCommandActor(props.session || {}));
  const sessionGithubActorHeaderVisible = computed(() => Boolean(
    props.active &&
    sessionGithubActor.value.available &&
    String(props.githubActorTeleportTarget || "").trim()
  ));
  const sessionSourceRoot = computed(() => vibe64SessionSourcePath(props.session || {}));
  const activeAgentTurn = computed(() => {
    const turn = props.session?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentActive = computed(() => activeAgentTurn.value.active === true);
  const agentSteerable = computed(() => Boolean(
    agentActive.value &&
    normalizedAgentTurnText(activeAgentTurn.value.id) &&
    normalizedAgentTurnText(activeAgentTurn.value.state) === "active" &&
    props.agentConnectionStatus === "connected"
  ));
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const sessionToolbarVisible = computed(() => Boolean(
    Array.isArray(props.sessionToolbar?.sessions) && props.sessionToolbar.sessions.length
  ));

  const composerDraft = ref("");
  const composerAttachments = ref([]);
  const composerRetrySubmission = ref(null);
  const composerSending = ref(false);
  const composerSubmissionKind = ref("");
  const conversationFollowLatestKey = ref(0);
  const interrupting = ref(false);
  const optimisticMessages = ref([]);
  const questionAnswers = ref({});
  const dismissedNumberedQuestionText = ref("");
  const submittedQuestionText = ref("");
  const saveWorkConfirmOpen = ref(false);
  const saveWorkError = ref("");
  const saveWorkFailure = ref(null);
  const saveWorkAttempt = ref(null);
  const saveWorkSending = ref(false);
  const savedCommitDeslop = ref("");
  const savedCommitDeslopSending = ref(false);
  const selectedAnswerChoice = ref("");
  const shortActionDismissals = ref({
    saveWork: "",
    workspaceSetup: ""
  });
  const workspaceSetupRetryError = ref("");
  const workspaceSetupRetrying = ref(false);
  const workspaceSetupFixSending = ref(false);
  const workspaceSetupFixTaskId = ref("");
  const repositoryRecoverySending = ref(false);
  const checkedUpdateRepairRuns = new Map();
  const previewAttachmentState = ref({
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });
  let messageSequence = 0;
  let repositoryRequestSequence = 0;

  const shortActionDismissalsStorageKey = computed(() => {
    const slug = normalizedAgentTurnText(projectSlug.value);
    const selectedSessionId = sessionId.value;
    return slug && selectedSessionId
      ? `${SHORT_ACTION_DISMISSALS_STORAGE_PREFIX}:${encodeURIComponent(slug)}:${encodeURIComponent(selectedSessionId)}`
      : "";
  });

  watch(shortActionDismissalsStorageKey, (storageKey) => {
    const stored = readLocalStorageJson(storageKey, {});
    shortActionDismissals.value = {
      saveWork: normalizedAgentTurnText(stored?.saveWork),
      workspaceSetup: normalizedAgentTurnText(stored?.workspaceSetup)
    };
  }, { flush: "sync", immediate: true });

  function dismissShortAction(name, activityKey = "") {
    const key = normalizedAgentTurnText(activityKey);
    const storageKey = shortActionDismissalsStorageKey.value;
    if (!key || !storageKey) {
      return false;
    }
    shortActionDismissals.value = {
      ...shortActionDismissals.value,
      [name]: key
    };
    writeLocalStorageJson(storageKey, shortActionDismissals.value);
    return true;
  }

  const latestAssistantQuestionText = computed(() => (
    latestAssistantMessageAwaitingUserReply(props.conversationLog)
  ));
  const numberedQuestionInput = computed(() => (
    parseNumberedQuestionPrompt(latestAssistantQuestionText.value)
  ));
  const numberedQuestions = computed(() => (
    [
      dismissedNumberedQuestionText.value,
      submittedQuestionText.value
    ].includes(latestAssistantQuestionText.value)
      ? []
      : numberedQuestionInput.value.questions || []
  ));
  const numberedQuestionSelectItems = computed(() => Object.fromEntries(
    numberedQuestions.value.map((question) => {
      const choices = Array.isArray(question.choices) ? question.choices : [];
      const includesUnsureChoice = choices.some((choice) => (
        String(choice?.value || "").trim().toLowerCase() === NUMBERED_QUESTION_UNSURE_VALUE.toLowerCase()
      ));
      return [
        question.name,
        includesUnsureChoice ? choices : [...choices, NUMBERED_QUESTION_UNSURE_CHOICE]
      ];
    })
  ));
  const answerChoices = computed(() => (
    numberedQuestions.value.length || submittedQuestionText.value === latestAssistantQuestionText.value
      ? []
      : parseAnswerChoicePrompt(latestAssistantQuestionText.value).choices || []
  ));
  const structuredQuestionActive = computed(() => Boolean(
    numberedQuestions.value.length || answerChoices.value.length
  ));

  const repositoryOperationActive = computed(() => [
    props.workState?.operation,
    props.workState?.updateOperation
  ].some((operation) => ["queued", "running", "starting"].includes(
    String(operation?.status || "").trim().toLowerCase()
  )));

  const sessionInteractionDisabled = computed(() => Boolean(
    !props.active ||
    !sessionId.value ||
    props.sessionSelectionArchived
  ));
  const composerDisabled = computed(() => Boolean(
    sessionInteractionDisabled.value ||
    !assistantMainChatAllowed.value
  ));
  const composerAttachmentsSupported = computed(() => true);
  const composerAttachmentsEnabled = computed(() => Boolean(
    composerAttachmentsSupported.value &&
    !composerDisabled.value &&
    !composerSending.value &&
    !interrupting.value &&
    !agentActive.value &&
    !repositoryOperationActive.value
  ));
  const composerRetryMatchesDraft = computed(() => {
    const retry = composerRetrySubmission.value;
    const draft = String(composerDraft.value || "");
    const submitted = String(retry?.draftSnapshot || "");
    return Boolean(retry && submitted && (
      draft === submitted || draft.startsWith(submitted)
    ));
  });
  const composerSubmitMode = computed(() => {
    if (agentActive.value && !agentSteerable.value) {
      return "waiting";
    }
    if (composerSending.value) {
      return composerSubmissionKind.value === "steer" ? "steering" : "sending";
    }
    if (agentActive.value) {
      return composerRetryMatchesDraft.value ? "retry" : "steer";
    }
    return composerRetryMatchesDraft.value ? "retry" : "send";
  });
  const composerSubmitLabel = computed(() => ({
    retry: "Retry",
    sending: "Sending…",
    steer: "Steer",
    steering: "Steering…",
    waiting: "Waiting…"
  })[composerSubmitMode.value] || "");
  const composerSubmitAriaLabel = computed(() => ({
    retry: "Retry guidance to assistant",
    sending: "Sending message",
    steer: "Steer assistant",
    steering: "Sending guidance to assistant",
    waiting: "Waiting for the assistant to accept guidance"
  })[composerSubmitMode.value] || "Send message");
  const composerSubmitTitle = computed(() => ({
    retry: "Retry the same guidance without duplicating it",
    sending: "Keep typing while this message is sent",
    steer: "Send this guidance to the active assistant turn",
    steering: "Keep typing while this guidance is sent",
    waiting: "Keep typing while the assistant becomes ready"
  })[composerSubmitMode.value] || "Send message");
  const composerCanSubmit = computed(() => Boolean(
    !composerDisabled.value &&
    !composerSending.value &&
    !interrupting.value &&
    !repositoryOperationActive.value &&
    (!agentActive.value || agentSteerable.value) &&
    (!agentActive.value || composerAttachments.value.length === 0) && (
      numberedQuestions.value.length
        ? numberedQuestions.value.every((question) => String(questionAnswers.value[question.name] || "").trim())
        : answerChoices.value.length
          ? selectedAnswerChoice.value || composerDraft.value.trim()
          : composerDraft.value.trim()
    )
  ));
  const agentStopVisible = computed(() => agentActive.value);
  const agentStopEnabled = computed(() => Boolean(
    agentStopVisible.value &&
    !interrupting.value &&
    !composerSending.value
  ));
  const assistantConnectionReady = computed(() => props.agentConnectionStatus === "connected");
  const thinkingVisible = computed(() => Boolean(
    agentActive.value || composerSending.value ||
    (!assistantConnectionReady.value && !sessionInteractionDisabled.value)
  ));
  const thinkingLabel = computed(() => (
    agentConnectionThinkingLabel({
      active: !sessionInteractionDisabled.value,
      status: props.agentConnectionStatus
    }) ||
    (agentActive.value ? "Assistant is working..." : "") ||
    (composerSending.value ? "Sending to assistant..." : "")
  ));
  const composerHint = computed(() => (
    structuredQuestionActive.value
      ? "Answer the assistant, then send one combined reply."
      : ""
  ));
  const composerPlaceholder = computed(() => (
    numberedQuestions.value.length
      ? "Optional additional context…"
      : answerChoices.value.length
        ? "Choose an answer above, or type another answer…"
        : ""
  ));
  const workspaceSetup = computed(() => {
    const value = props.session?.workspaceSetup;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  });
  const workspaceSetupStatus = computed(() => {
    const status = normalizedAgentTurnText(workspaceSetup.value?.status);
    return ["ambiguous", "failed", "required", "running", "succeeded"].includes(status)
      ? status
      : "unconfigured";
  });
  const workspaceSetupActivityKey = computed(() => {
    const operationKey = normalizedAgentTurnText(
      workspaceSetup.value?.startedAt || workspaceSetup.value?.updatedAt
    );
    return operationKey ? `workspace-setup:${operationKey}` : "";
  });
  const workspaceSetupDismissed = computed(() => Boolean(
    workspaceSetupActivityKey.value &&
    shortActionDismissals.value.workspaceSetup === workspaceSetupActivityKey.value
  ));
  const workspaceSetupRunning = computed(() => workspaceSetupStatus.value === "running");
  const workspaceSetupNeedsAttention = computed(() => (
    ["failed", "ambiguous", "required"].includes(workspaceSetupStatus.value)
  ));
  const workspaceSetupOutput = computed(() => (
    normalizedAgentTurnText(workspaceSetup.value?.transcript) || workspaceSetupDiagnostic.value
  ));
  const workspaceSetupTitle = computed(() => ({
    ambiguous: "Workspace setup needs a choice",
    failed: "Workspace preparation failed",
    required: "Workspace preparation required",
    running: "Preparing workspace…",
    succeeded: "Workspace prepared"
  })[workspaceSetupStatus.value] || "");
  const workspaceSetupCurrentLabel = computed(() => (
    workspaceSetupRunning.value
      ? normalizedAgentTurnText(workspaceSetup.value?.currentLabel)
      : ""
  ));
  const workspaceSetupDiagnostic = computed(() => (
    workspaceSetupRetryError.value || normalizedAgentTurnText(workspaceSetup.value?.diagnostic)
  ));
  const workspaceSetupRetryDisabled = computed(() => Boolean(
    workspaceSetupRunning.value ||
    workspaceSetupRetrying.value ||
    saveWorkSending.value ||
    saveWorkOperationActive.value ||
    agentActive.value ||
    !sessionId.value ||
    props.sessionSelectionArchived
  ));
  const workspaceSetupAskDisabled = computed(() => Boolean(
    !workspaceSetupNeedsAttention.value ||
    workspaceSetupFixSending.value ||
    !props.active ||
    !sessionId.value ||
    props.sessionSelectionArchived ||
    repositoryOperationActive.value ||
    !assistantDirectAllowed.value
  ));

  async function retryWorkspaceSetup() {
    if (workspaceSetupRetryDisabled.value) {
      return false;
    }
    workspaceSetupRetryError.value = "";
    workspaceSetupRetrying.value = true;
    try {
      return await props.retryWorkspaceSetup() !== false;
    } catch (error) {
      workspaceSetupRetryError.value = normalizedAgentTurnText(error?.message || error) ||
        "Workspace preparation could not be started.";
      return false;
    } finally {
      workspaceSetupRetrying.value = false;
    }
  }

  function dismissWorkspaceSetupActivity() {
    return dismissShortAction("workspaceSetup", workspaceSetupActivityKey.value);
  }

  async function askCodexToFixWorkspaceSetup() {
    if (workspaceSetupAskDisabled.value || typeof requestTemporaryAi !== "function") {
      return false;
    }
    const setup = {
      ...workspaceSetup.value,
      diagnostic: workspaceSetupDiagnostic.value
    };
    workspaceSetupFixSending.value = true;
    try {
      const result = await requestTemporaryAi({
        completionMessage: "AI repair finished. Vibe64 is verifying workspace preparation now.",
        dedupeKey: [
          "workspace-setup",
          sessionId.value,
          workspaceSetupStatus.value,
          normalizedAgentTurnText(setup.updatedAt),
          normalizedAgentTurnText(setup.diagnostic)
        ].join("|"),
        displayMessage: "Fix workspace preparation.",
        failureMessage: "Temporary AI stopped before confirming completion. Vibe64 is checking whether its edits repaired workspace preparation.",
        message: workspaceSetupFixPrompt(setup),
        nextStepMessage: "When the AI finishes, Vibe64 will automatically retry workspace preparation to verify the repair.",
        policy: "workspace_write",
        recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
        title: "Fix workspace preparation"
      });
      const accepted = result !== false && result?.ok !== false;
      const taskId = normalizedAgentTurnText(result?.taskId);
      if (accepted && taskId) {
        workspaceSetupFixTaskId.value = taskId;
      }
      return accepted;
    } finally {
      workspaceSetupFixSending.value = false;
    }
  }

  async function handleTemporaryAiTaskFinished(task = {}, reportRecovery = () => {}, { force = false } = {}) {
    const taskId = normalizedAgentTurnText(task?.id);
    const status = normalizedAgentTurnText(task?.status);
    if (task.recoveryOperation === "update") {
      const runId = normalizedAgentTurnText(task.runId);
      if (
        !taskId || !runId || task.sessionId !== sessionId.value ||
        task.busy || ["starting", "inProgress"].includes(status) ||
        saveWorkSending.value || saveWorkOperationActive.value ||
        (!force && (status !== "completed" || task.outcomeKind !== "complete" ||
          checkedUpdateRepairRuns.get(taskId) === runId))
      ) {
        return false;
      }
      checkedUpdateRepairRuns.set(taskId, runId);
      reportRecovery(taskId, { status: "checking", message: "Checking Update…" });
      const result = await updateBeforeSave();
      await nextTick();
      if (task.sessionId !== sessionId.value) {
        return false;
      }
      const succeeded = result?.ok === true;
      reportRecovery(taskId, {
        status: succeeded ? "succeeded" : "failed",
        message: succeeded
          ? "Session updated. Your changes were preserved. Nothing was published."
          : `Update still needs attention: ${saveWorkError.value || "The operation did not confirm success."}`,
        ...(!succeeded && saveWorkCanResolveWithTemporaryAi.value ? {
          retryKey: JSON.stringify([
            saveWorkFailure.value?.code,
            saveWorkFailure.value?.details?.conflictRecovery?.canonicalCommit || "",
            saveWorkFailure.value?.details?.conflictPaths || saveWorkError.value
          ]),
          retryMessage: [
            "Vibe64 ran Update after the prepared repair, but it did not succeed. The working-tree edits remain. Inspect the current state and repair only the remaining conflicts; do not start over or repeat completed work.",
            `Latest Update diagnostic:\n${saveWorkError.value}`,
            UPDATE_REPAIR_MESSAGES.handoff
          ].join("\n\n")
        } : {})
      });
      return "repository-update";
    }
    if (
      taskId !== workspaceSetupFixTaskId.value ||
      !["completed", "failed"].includes(status)
    ) {
      return false;
    }
    workspaceSetupFixTaskId.value = "";
    if (workspaceSetupNeedsAttention.value) {
      await retryWorkspaceSetup();
    }
    return "workspace-setup";
  }

  async function askCodexToFixPreviewIdentity(input = {}) {
    if (
      typeof requestTemporaryAi !== "function" ||
      !assistantDirectAllowed.value ||
      !props.active ||
      !sessionId.value ||
      props.sessionSelectionArchived ||
      repositoryOperationActive.value
    ) {
      return false;
    }
    const identity = input?.identity || {};
    const identityName = normalizedAgentTurnText(identity.name) || "the selected identity";
    const error = normalizedAgentTurnText(input?.error);
    const result = await requestTemporaryAi({
      completionMessage: "AI repair finished. Try the preview identity again from the sign-in menu.",
      dedupeKey: [
        "preview-identity",
        sessionId.value,
        normalizedAgentTurnText(identity.type),
        normalizedAgentTurnText(identity.value),
        error
      ].join("|"),
      displayMessage: `Fix preview sign-in for ${identityName}.`,
      failureMessage: "Temporary AI stopped before completing the preview identity repair. Review the error and progress below before trying again.",
      message: previewIdentityFixPrompt(input),
      nextStepMessage: "When the AI finishes, try this preview identity again from the sign-in menu.",
      policy: "workspace_write",
      recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
      title: "Fix preview identity"
    });
    return result !== false && result?.ok !== false;
  }

  function temporaryAiRecoveryUnavailable() {
    return Boolean(
      repositoryRecoverySending.value ||
      typeof requestTemporaryAi !== "function" ||
      !assistantDirectAllowed.value ||
      !props.active ||
      !sessionId.value ||
      props.sessionSelectionArchived ||
      repositoryOperationActive.value
    );
  }

  async function fixRepositoryActionError() {
    if (temporaryAiRecoveryUnavailable() || !saveWorkCanResolveWithTemporaryAi.value) {
      return false;
    }
    const action = saveWorkActivityIsUpdate.value ? "Update" : "Save";
    repositoryRecoverySending.value = true;
    try {
      const result = await requestTemporaryAi({
        completionMessage: action === "Update"
          ? UPDATE_REPAIR_MESSAGES.completion
          : `AI repair finished. Review its result, then retry ${action}.`,
        dedupeKey: repositoryTemporaryAiDedupeKey({
          code: saveWorkFailure.value?.code,
          diagnostic: saveWorkError.value,
          sessionId: sessionId.value
        }),
        displayMessage: `Fix this ${action} problem without losing work.`,
        failureMessage: `Temporary AI stopped before completing the ${action} repair. Review the error and progress below before retrying.`,
        message: [
          `Help resolve this Vibe64 ${action} problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:`,
          REPOSITORY_TEMPORARY_AI_GIT_BOUNDARY,
          action === "Update" ? UPDATE_REPAIR_MESSAGES.handoff : "",
          saveWorkError.value
        ].filter(Boolean).join("\n\n"),
        nextStepMessage: action === "Update" ? UPDATE_REPAIR_MESSAGES.nextStep : `Review the repair, then retry ${action}.`,
        policy: "workspace_write",
        recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
        recoveryOperation: action === "Update" ? "update" : "",
        title: `Resolve ${action}`
      });
      return result !== false && result?.ok !== false;
    } finally {
      repositoryRecoverySending.value = false;
    }
  }

  async function fixRepositoryError({
    code = "",
    error = "",
    title = "Resolve repository problem"
  } = {}) {
    const diagnostic = normalizedAgentTurnText(error);
    const isUpdate = ["vibe64_session_update_conflict", "vibe64_session_update_history_diverged"].includes(code);
    if (temporaryAiRecoveryUnavailable() || !diagnostic) {
      return false;
    }
    repositoryRecoverySending.value = true;
    try {
      const result = await requestTemporaryAi({
        completionMessage: isUpdate
          ? UPDATE_REPAIR_MESSAGES.completion
          : "AI repair finished. Review its result, then retry the repository operation.",
        dedupeKey: repositoryTemporaryAiDedupeKey({
          code,
          diagnostic,
          sessionId: sessionId.value
        }),
        displayMessage: "Fix this repository problem without losing work.",
        failureMessage: "Temporary AI stopped before completing the repository repair. Review the error and progress below before retrying.",
        message: [
          "Help resolve this Vibe64 repository problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:",
          REPOSITORY_TEMPORARY_AI_GIT_BOUNDARY,
          isUpdate ? UPDATE_REPAIR_MESSAGES.handoff : "",
          diagnostic
        ].join("\n\n"),
        nextStepMessage: isUpdate ? UPDATE_REPAIR_MESSAGES.nextStep : "Review the repair, then retry the repository operation.",
        policy: "workspace_write",
        recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE,
        recoveryOperation: isUpdate ? "update" : "",
        title
      });
      return result !== false && result?.ok !== false;
    } finally {
      repositoryRecoverySending.value = false;
    }
  }

  function updateComposerAttachments(attachments = []) {
    composerAttachments.value = Array.isArray(attachments) ? attachments : [];
  }

  function updatePreviewAttachmentState(state = {}) {
    previewAttachmentState.value = {
      attachDiagnostics: typeof state.attachDiagnostics === "function" ? state.attachDiagnostics : null,
      capture: typeof state.capture === "function" ? state.capture : null,
      captureAvailable: state.captureAvailable === true,
      captureBusy: state.captureBusy === true,
      diagnosticsAvailable: state.diagnosticsAvailable === true,
      diagnosticsBusy: state.diagnosticsBusy === true
    };
  }

  function captureVisiblePreview() {
    return previewAttachmentState.value.capture?.() ?? false;
  }

  function attachPreviewDiagnostics() {
    return previewAttachmentState.value.attachDiagnostics?.() ?? false;
  }

  function nextMessageId() {
    messageSequence += 1;
    return createChatMessageId({
      sequence: messageSequence
    });
  }

  function optimisticMessage(payload = {}, messageId = "") {
    const now = new Date();
    return {
      attachments: Array.isArray(payload?.displayAttachments)
        ? payload.displayAttachments
        : [],
      createdAt: now.toISOString(),
      createdAtMs: now.getTime(),
      error: "",
      id: messageId,
      payload,
      status: "pending",
      text: normalizedAgentTurnText(
        payload?.displayMessage || payload?.message
      )
    };
  }

  function updateOptimisticMessage(messageId = "", update = {}) {
    optimisticMessages.value = optimisticMessages.value.map((message) => (
      message.id === messageId
        ? { ...message, ...update }
        : message
    ));
  }

  function settleComposerRetry(retry = composerRetrySubmission.value) {
    if (!retry || retry.messageId !== composerRetrySubmission.value?.messageId) {
      return false;
    }
    composerDraft.value = composerDraftAfterAcceptedSubmission(
      composerDraft.value,
      retry.draftSnapshot
    );
    composerRetrySubmission.value = null;
    return true;
  }

  async function sendChatPayload(payload = {}, {
    messageId: existingMessageId = "",
    submissionKind = "send"
  } = {}) {
    if (composerSending.value || !normalizedAgentTurnText(payload?.message)) {
      return false;
    }
    const messageId = String(existingMessageId || "").trim() || nextMessageId();
    const sendingSessionId = sessionId.value;
    const sendingProjectSlug = projectSlug.value;
    const optimistic = optimisticMessage(payload, messageId);
    optimisticMessages.value = [
      ...optimisticMessages.value.filter((message) => message.id !== messageId),
      optimistic
    ];
    composerSubmissionKind.value = submissionKind === "steer" ? "steer" : "send";
    composerSending.value = true;
    let acknowledgeMessage;
    const receipt = new Promise((resolve) => { acknowledgeMessage = resolve; });
    const stopWatchingReceipt = watch(
      [sessionId, projectSlug, () => props.conversationLog?.turns],
      ([currentSessionId, currentProjectSlug, turns]) => {
        if (currentSessionId !== sendingSessionId || currentProjectSlug !== sendingProjectSlug) {
          acknowledgeMessage(false);
        } else if (Array.isArray(turns) && turns.some((turn) => turn?.user?.messageId === messageId)) {
          acknowledgeMessage({ ok: true });
        }
      },
      { immediate: true }
    );
    try {
      const sendMessage = typeof sendMainChatMessage === "function"
        ? sendMainChatMessage
        : props.sendAgentMessage;
      const response = await Promise.race([
        sendMessage({
          ...payload,
          ...(requestAgentSettings.value ? { agentSettings: requestAgentSettings.value } : {}),
          messageId
        }),
        receipt
      ]);
      if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug) {
        return false;
      }
      const accepted = response !== false && response?.ok !== false;
      const suggested = response?.suggested === true;
      if (!accepted) {
        updateOptimisticMessage(messageId, {
          error: "Message could not be sent.",
          status: "failed"
        });
      }
      if (accepted && suggested) {
        optimisticMessages.value = optimisticMessages.value.filter((message) => (
          message.id !== messageId
        ));
      } else if (accepted) {
        conversationFollowLatestKey.value += 1;
      }
      if (accepted && payload.attachmentIds?.length) {
        onAttachmentsAccepted?.(payload.attachmentIds);
      }
      return accepted;
    } catch (error) {
      if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug) {
        return false;
      }
      const message = normalizedAgentTurnText(error?.message || error) || "Message could not be sent.";
      updateOptimisticMessage(messageId, {
        error: message,
        status: "failed"
      });
      const attention = executionAttentionForError(error, message);
      if (attention) {
        emit("execution-attention", attention);
      }
      return false;
    } finally {
      stopWatchingReceipt();
      if (sessionId.value === sendingSessionId && projectSlug.value === sendingProjectSlug) {
        composerSending.value = false;
        composerSubmissionKind.value = "";
      }
    }
  }

  async function submitComposerMessage() {
    if (!composerCanSubmit.value) {
      return false;
    }
    const retry = composerRetryMatchesDraft.value
      ? composerRetrySubmission.value
      : null;
    if (!retry) {
      composerRetrySubmission.value = null;
    }
    const draftSnapshot = retry?.draftSnapshot || composerDraft.value;
    const additionalContext = draftSnapshot.trim();
    const message = numberedQuestions.value.length
      ? [
          numberedQuestionSubmissionText(numberedQuestions.value, questionAnswers.value),
          additionalContext
        ].filter(Boolean).join("\n\n")
      : selectedAnswerChoice.value || additionalContext;
    const payload = retry?.payload || chatMessagePayload(message, composerAttachments.value);
    if (!payload) {
      return false;
    }
    const submissionKind = retry?.submissionKind || (agentSteerable.value ? "steer" : "send");
    const questionTextSnapshot = retry?.questionTextSnapshot || (structuredQuestionActive.value
      ? latestAssistantQuestionText.value
      : "");
    const messageId = retry?.messageId || nextMessageId();
    if (!retry) {
      submittedQuestionText.value = questionTextSnapshot;
      composerDraft.value = "";
      questionAnswers.value = {};
      selectedAnswerChoice.value = "";
    }
    const sendingSessionId = sessionId.value;
    const sendingProjectSlug = projectSlug.value;
    const accepted = await sendChatPayload(payload, { messageId, submissionKind });
    if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug) {
      return false;
    }
    if (accepted && retry) {
      submittedQuestionText.value = questionTextSnapshot;
      if (!settleComposerRetry(retry)) {
        composerDraft.value = composerDraftAfterAcceptedSubmission(
          composerDraft.value,
          draftSnapshot
        );
      }
      questionAnswers.value = {};
      selectedAnswerChoice.value = "";
    } else if (!accepted && submissionKind === "steer" && (retry || !composerDraft.value)) {
      if (!retry) {
        composerDraft.value = draftSnapshot;
      }
      const optimistic = optimisticMessageById(messageId) || {
        createdAtMs: Date.now(),
        id: messageId,
        text: normalizedAgentTurnText(payload.displayMessage || payload.message)
      };
      composerRetrySubmission.value = {
        draftSnapshot,
        messageId,
        optimistic,
        payload,
        questionTextSnapshot,
        submissionKind
      };
      if (!unmatchedOptimisticMessages(
        props.conversationLog?.turns,
        [optimistic]
      ).length) {
        settleComposerRetry(composerRetrySubmission.value);
      }
    }
    return accepted;
  }

  function dismissNumberedQuestions() {
    if (!numberedQuestions.value.length) {
      return false;
    }
    dismissedNumberedQuestionText.value = latestAssistantQuestionText.value;
    questionAnswers.value = {};
    return true;
  }

  function optimisticMessageById(messageId = "") {
    return optimisticMessages.value.find((message) => message.id === messageId) || null;
  }

  async function cancelOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message) {
      return false;
    }
    if (message.status === "pending" && await props.cancelAgentMessage(messageId) === false) {
      return false;
    }
    if (composerRetrySubmission.value?.messageId === messageId) {
      settleComposerRetry(composerRetrySubmission.value);
    }
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    return true;
  }

  function editOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status !== "failed") {
      return false;
    }
    const currentDraft = String(composerDraft.value || "");
    composerDraft.value = !currentDraft
      ? message.text
      : currentDraft.startsWith(message.text)
        ? currentDraft
        : [message.text, currentDraft].filter(Boolean).join("\n\n");
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    return true;
  }

  async function resendOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status !== "failed") {
      return false;
    }
    const retry = composerRetrySubmission.value?.messageId === messageId
      ? composerRetrySubmission.value
      : null;
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    const accepted = await sendChatPayload(message.payload, {
      messageId,
      submissionKind: retry?.submissionKind || (agentSteerable.value ? "steer" : "send")
    });
    if (accepted) {
      settleComposerRetry(retry);
    }
    return accepted;
  }

  const toolbarRepositoryWorkState = computed(() => {
    const selectedId = String(props.session?.sessionId || "").trim();
    const sessions = Array.isArray(props.sessionToolbar?.sessions)
      ? props.sessionToolbar.sessions
      : [];
    return sessions.find((session) => String(session?.sessionId || "").trim() === selectedId)
      ?.repositoryWorkState || null;
  });
  const saveWorkRepositoryState = computed(() => {
    const inspected = props.workState && typeof props.workState === "object"
      ? props.workState
      : {};
    const monitored = toolbarRepositoryWorkState.value;
    const inspectedAt = Date.parse(String(inspected.checkedAt || "")) || 0;
    const monitoredAt = Date.parse(String(monitored?.checkedAt || "")) || 0;
    const monitoredState = String(monitored?.state || "");
    if (!monitored || (monitored.updateStatusPending !== true && monitoredAt < inspectedAt)) {
      return inspected;
    }
    const monitoredUnsaved = monitoredState === "unsaved"
      ? true
      : ["saved", "update_available"].includes(monitoredState)
        ? false
        : inspected.unsaved;
    return {
      ...inspected,
      checkedAt: monitored.checkedAt || inspected.checkedAt,
      error: monitoredState === "unavailable"
        ? inspected.error || "Repository status is unavailable."
        : inspected.error || "",
      loading: monitoredState === "checking",
      unsaved: monitoredUnsaved,
      updateAvailable: monitored.updateAvailable === true ||
        ["update_available", "updating"].includes(monitoredState),
      updateStatusPending: monitored.updateStatusPending === true || monitoredState === "updating"
    };
  });
  const saveWorkUnsaved = computed(() => saveWorkRepositoryState.value?.unsaved === true);
  const saveWorkRequiresUpdate = computed(() => Boolean(
    saveWorkRepositoryState.value?.updateAvailable === true ||
    saveWorkRepositoryState.value?.updateStatusPending === true
  ));
  const saveWorkRepositoryBusy = computed(() => ["saving", "updating"].includes(
    String(toolbarRepositoryWorkState.value?.state || "")
  ));
  const updateWorkDisabled = computed(() => Boolean(
    sessionInteractionDisabled.value ||
    !assistantConnectionReady.value ||
    agentActive.value ||
    composerSending.value ||
    saveWorkSending.value ||
    saveWorkRepositoryBusy.value ||
    saveWorkRepositoryState.value?.loading ||
    saveWorkRepositoryState.value?.error
  ));
  const saveWorkDisabled = computed(() => Boolean(
    updateWorkDisabled.value ||
    (!saveWorkRequiresUpdate.value && !assistantDirectAllowed.value) ||
    (!saveWorkRequiresUpdate.value && !saveWorkUnsaved.value)
  ));
  const saveWorkActionLabel = computed(() => (
    saveWorkRequiresUpdate.value ? "Update this session (rebase)" : "Save work"
  ));
  const saveWorkHeaderAriaLabel = computed(() => (
    saveWorkRequiresUpdate.value
      ? "Update selected session (rebase)"
      : "Save selected session work"
  ));
  const saveWorkHeaderVisible = computed(() => Boolean(
    props.active && sessionId.value
  ));
  const saveWorkTitle = computed(() => {
    if (!assistantConnectionReady.value) {
      return props.agentConnectionStatus === "reconciling"
        ? "Checking the assistant connection before saving or updating"
        : "Waiting for the assistant to reconnect before saving or updating";
    }
    if (repositoryOperationActive.value || saveWorkRepositoryBusy.value) {
      return "Wait for the current repository operation to finish";
    }
    if (agentActive.value || composerSending.value) {
      return "Wait for the assistant turn to finish before saving or updating";
    }
    if (saveWorkRepositoryState.value?.loading) {
      return "Checking whether this session has work to save";
    }
    if (saveWorkRepositoryState.value?.error) {
      return "Repository status is unavailable; check for updates before saving";
    }
    if (saveWorkRequiresUpdate.value) {
      return saveWorkUnsaved.value
        ? "Update this session (rebase) with the latest saved project version while preserving its unsaved work. Save will be available when the update finishes."
        : "Update this session (rebase) to the latest saved project version.";
    }
    if (!saveWorkUnsaved.value) {
      return "No work to save";
    }
    if (!assistantDirectAllowed.value) {
      return currentAssistantRestrictionMessage.value;
    }
    return "Save this session's work to the project repository";
  });
  watch(() => {
    const attempt = saveWorkAttempt.value;
    const activeOperation = props.workState?.activeOperation;
    return {
      attempt,
      kind: String(activeOperation?.kind || "").trim(),
      operationId: String(activeOperation?.operationId || "").trim()
    };
  }, ({ attempt, kind, operationId }) => {
    if (
      !attempt ||
      attempt.operationId ||
      !operationId ||
      kind !== attempt.kind
    ) {
      return;
    }
    saveWorkAttempt.value = {
      ...attempt,
      operationId
    };
  });
  const saveWorkOperation = computed(() => {
    const saveOperation = props.workState?.operation || null;
    const updateOperation = props.workState?.updateOperation || null;
    const attempt = saveWorkAttempt.value;
    if (attempt) {
      const operation = attempt.kind === "update" ? updateOperation : saveOperation;
      const operationId = String(operation?.operationId || "").trim();
      return attempt.operationId && operationId === attempt.operationId
        ? operation
        : null;
    }
    const activeOperation = props.workState?.activeOperation;
    const activeOperationId = String(activeOperation?.operationId || "").trim();
    if (activeOperationId) {
      const operation = activeOperation?.kind === "update" ? updateOperation : saveOperation;
      return String(operation?.operationId || "").trim() === activeOperationId
        ? operation
        : null;
    }
    const saveStatus = String(saveOperation?.status || "").trim().toLowerCase();
    const updateStatus = String(updateOperation?.status || "").trim().toLowerCase();
    const saveFailed = saveStatus === "failed";
    const updateFailed = updateStatus === "failed";
    if (saveFailed !== updateFailed) {
      return updateFailed ? updateOperation : saveOperation;
    }
    if (saveFailed && updateFailed) {
      return String(updateOperation?.updatedAt || "") > String(saveOperation?.updatedAt || "")
        ? updateOperation
        : saveOperation;
    }
    return null;
  });
  const saveWorkActivityIsUpdate = computed(() => {
    if (saveWorkAttempt.value) {
      return saveWorkAttempt.value.kind === "update";
    }
    return Boolean(
      (props.workState?.updateOperation && saveWorkOperation.value === props.workState.updateOperation) ||
      (!saveWorkOperation.value && saveWorkRequiresUpdate.value)
    );
  });
  const saveWorkActivityKey = computed(() => {
    const operationId = normalizedAgentTurnText(saveWorkOperation.value?.operationId);
    if (!operationId) {
      return "";
    }
    return `${saveWorkActivityIsUpdate.value ? "update-session" : "save-work"}:${operationId}`;
  });
  const saveWorkActivityDismissed = computed(() => Boolean(
    saveWorkActivityKey.value &&
    shortActionDismissals.value.saveWork === saveWorkActivityKey.value
  ));
  const saveWorkActivityLabel = computed(() => (
    saveWorkActivityIsUpdate.value ? "Update this session (rebase)" : "Save work"
  ));
  const saveWorkOperationActive = computed(() => ["queued", "running", "starting"].includes(
    String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  ));
  const saveWorkOutput = computed(() => (Array.isArray(saveWorkOperation.value?.events)
    ? saveWorkOperation.value.events
      .map((event) => [event.at, event.message].filter(Boolean).join("  "))
      .filter(Boolean)
      .join("\n")
    : ""));
  const saveWorkStatus = computed(() => String(
    saveWorkOperation.value?.status || (saveWorkSending.value ? "starting" : "")
  ));
  const saveWorkStage = computed(() => String(
    saveWorkOperation.value?.stage ||
    (saveWorkSending.value && !saveWorkOperation.value ? "Waiting for the session to be ready" : "")
  ));
  watch(() => ({
    code: String(saveWorkOperation.value?.code || ""),
    details: saveWorkOperation.value?.details || null,
    error: String(saveWorkOperation.value?.error || ""),
    operationId: String(saveWorkOperation.value?.operationId || ""),
    status: String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  }), (operation) => {
    if (operation.code === "vibe64_session_save_update_required") {
      if (saveWorkFailure.value?.code === operation.code) {
        saveWorkError.value = "";
        saveWorkFailure.value = null;
      }
      return;
    }
    if (operation.status !== "failed" || !operation.error) {
      return;
    }
    saveWorkError.value = operation.error;
    saveWorkFailure.value = {
      code: operation.code,
      details: operation.details,
      message: operation.error
    };
  }, { immediate: true });
  const saveWorkCanResolveWithTemporaryAi = computed(() => [
    "vibe64_session_save_history_diverged",
    "vibe64_session_update_conflict",
    "vibe64_session_update_history_diverged"
  ].includes(String(saveWorkFailure.value?.code || "")));
  const saveWorkRetryable = computed(() => Boolean(
    saveWorkError.value &&
    !saveWorkDisabled.value &&
    !saveWorkCanResolveWithTemporaryAi.value
  ));

  async function updateBeforeSave() {
    const requestSequence = ++repositoryRequestSequence;
    const updatingSessionId = sessionId.value;
    const updatingProjectSlug = projectSlug.value;
    const requestIsCurrent = () => (
      requestSequence === repositoryRequestSequence &&
      sessionId.value === updatingSessionId && projectSlug.value === updatingProjectSlug
    );
    saveWorkAttempt.value = {
      kind: "update",
      operationId: ""
    };
    saveWorkSending.value = true;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    try {
      const result = await props.updateSessionWork();
      if (!requestIsCurrent()) {
        return false;
      }
      saveWorkAttempt.value = null;
      return result;
    } catch (error) {
      if (!requestIsCurrent()) {
        return false;
      }
      saveWorkFailure.value = error && typeof error === "object"
        ? {
            code: String(error.code || error.response?.code || ""),
            details: error.details || error.response?.details || null,
            message: error instanceof Error ? error.message : String(error || "")
          }
        : null;
      saveWorkError.value = error instanceof Error
        ? error.message
        : String(error || "This session could not be updated.");
      return false;
    } finally {
      if (requestIsCurrent()) {
        saveWorkSending.value = false;
      }
    }
  }

  function requestSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    if (saveWorkRequiresUpdate.value) {
      return updateBeforeSave();
    }
    saveWorkConfirmOpen.value = true;
    return true;
  }

  function retrySaveWork() {
    return saveWorkRetryable.value ? requestSaveWork() : false;
  }

  function dismissSaveWorkActivity() {
    if (saveWorkSending.value || saveWorkOperationActive.value) {
      return false;
    }
    if (!saveWorkActivityKey.value && saveWorkError.value) {
      saveWorkError.value = "";
      saveWorkFailure.value = null;
      return true;
    }
    return dismissShortAction("saveWork", saveWorkActivityKey.value);
  }

  function cancelSaveWork() {
    saveWorkConfirmOpen.value = false;
  }

  async function confirmSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    const requestSequence = ++repositoryRequestSequence;
    const savingSessionId = sessionId.value;
    const savingProjectSlug = projectSlug.value;
    const requestIsCurrent = () => (
      requestSequence === repositoryRequestSequence &&
      sessionId.value === savingSessionId && projectSlug.value === savingProjectSlug
    );
    saveWorkAttempt.value = {
      kind: "save",
      operationId: ""
    };
    saveWorkSending.value = true;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    savedCommitDeslop.value = "";
    saveWorkConfirmOpen.value = false;
    try {
      const result = await props.saveSessionWork();
      if (!requestIsCurrent()) {
        return false;
      }
      const saveCommit = normalizedAgentTurnText(result?.saveCommit);
      if (result?.reconciled === true && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(saveCommit)) {
        savedCommitDeslop.value = saveCommit;
      }
      saveWorkAttempt.value = null;
      return result;
    } catch (error) {
      if (!requestIsCurrent()) {
        return false;
      }
      saveWorkFailure.value = error && typeof error === "object"
        ? {
            code: String(error.code || error.response?.code || ""),
            details: error.details || error.response?.details || null,
            message: error instanceof Error ? error.message : String(error || "")
          }
        : null;
      saveWorkError.value = error instanceof Error
        ? error.message
        : String(error || "Session work could not be saved.");
      return false;
    } finally {
      if (requestIsCurrent()) {
        saveWorkSending.value = false;
      }
    }
  }

  function dismissSavedCommitDeslop() {
    savedCommitDeslop.value = "";
  }

  async function startSavedCommitDeslop() {
    const saveCommit = savedCommitDeslop.value;
    if (
      !saveCommit ||
      savedCommitDeslopSending.value ||
      composerSending.value ||
      agentActive.value ||
      !assistantMainChatAllowed.value
    ) {
      return false;
    }
    const sendingSessionId = sessionId.value;
    const sendingProjectSlug = projectSlug.value;
    savedCommitDeslopSending.value = true;
    try {
      const accepted = await sendChatPayload({
        displayMessage: `Deslop saved commit ${saveCommit.slice(0, 12)}.`,
        genesisTask: "deslop",
        message: `Deslop commit ${saveCommit}.`
      });
      if (accepted) {
        savedCommitDeslop.value = "";
      }
      return accepted;
    } finally {
      if (sessionId.value === sendingSessionId && projectSlug.value === sendingProjectSlug) {
        savedCommitDeslopSending.value = false;
      }
    }
  }

  async function requestAgentInterrupt() {
    if (!agentStopEnabled.value) {
      return false;
    }
    const stoppingSessionId = sessionId.value;
    const stoppingProjectSlug = projectSlug.value;
    const stoppingTurnId = normalizedAgentTurnText(activeAgentTurn.value.id);
    interrupting.value = true;
    let acknowledgeStop;
    const receipt = new Promise((resolve) => { acknowledgeStop = resolve; });
    const stopWatchingReceipt = watch(
      [sessionId, projectSlug, () => activeAgentTurn.value.id, () => activeAgentTurn.value.active],
      ([currentSessionId, currentProjectSlug, turnId, active]) => {
        if (currentSessionId !== stoppingSessionId || currentProjectSlug !== stoppingProjectSlug) {
          acknowledgeStop(false);
        } else if (stoppingTurnId && normalizedAgentTurnText(turnId) === stoppingTurnId && active === false) {
          acknowledgeStop(true);
        }
      }
    );
    try {
      return await Promise.race([
        props.interruptAgentTurn({ reason: "user_interrupt" }),
        receipt
      ]) !== false;
    } finally {
      stopWatchingReceipt();
      if (sessionId.value === stoppingSessionId && projectSlug.value === stoppingProjectSlug) {
        interrupting.value = false;
      }
    }
  }

  const chatTurns = computed(() => {
    const turns = Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : [];
    if (!optimisticMessages.value.length) {
      return turns;
    }
    const optimistic = unmatchedOptimisticMessages(turns, optimisticMessages.value);
    return [
      ...turns,
      ...optimistic.map((message) => ({
        optimistic: {
          error: message.error,
          id: message.id,
          status: message.status
        },
        turnId: message.id,
        user: {
          attachments: message.attachments,
          at: message.createdAt,
          role: "user",
          text: message.text
        }
      }))
    ];
  });
  const emptyConversationWelcome = computed(() => (
    sessionId.value &&
    !props.conversationLog?.loading &&
    !props.conversationLog?.error &&
    !chatTurns.value.length
      ? emptyConversationWelcomeText({
          existingProject: workspaceSetupStatus.value !== "unconfigured",
          preferredName: preferredName.value,
          renewedSession: Boolean(normalizedAgentTurnText(
            props.session?.metadata?.renewed_from
          ))
        })
      : ""
  ));
  const conversationLogVisible = computed(() => Boolean(props.active));
  const conversationScrollKey = computed(() => sessionId.value);
  const chatReloading = ref(false);
  const chatReloadAvailable = computed(() => Boolean(
    props.active && props.session && (
      typeof props.refreshSessionData === "function" ||
      typeof props.conversationLog?.reload === "function"
    )
  ));

  async function reloadChatPane() {
    if (!chatReloadAvailable.value || chatReloading.value) {
      return false;
    }
    chatReloading.value = true;
    try {
      await Promise.allSettled([
        props.refreshSessionData?.(),
        props.conversationLog?.reload?.()
      ]);
      return true;
    } finally {
      chatReloading.value = false;
    }
  }

  async function loadMoreChatTurns(request = {}) {
    return typeof props.conversationLog?.loadMore === "function"
      ? props.conversationLog.loadMore(request)
      : false;
  }

  const rightPaneTab = ref("preview");
  const lastDashboardRoutePath = ref("");
  const sourceEditorOpenRequest = ref(null);
  const systemRestoreRequest = ref(null);
  const systemReturnContext = ref(null);
  let sourceEditorOpenSequence = 0;
  let systemRestoreSequence = 0;

  const projectPaneValue = computed(() => normalizeProjectPane(props.projectPane));
  const routeSessionToolId = computed(() => {
    const dashboardPrefix = `${normalizeProjectRoutePath(projectAppPath(projectSlug.value, "/dashboard"))}/`;
    const routePath = `${normalizeProjectRoutePath(route.path)}/`;
    if (!routePath.startsWith(dashboardPrefix)) {
      return "";
    }
    const segment = routePath.slice(dashboardPrefix.length).split("/")[0] || "";
    const toolId = vibe64SessionToolIdFromRouteSegment(segment);
    return DIRECT_SESSION_TOOL_IDS.has(toolId) ? toolId : "";
  });
  const sourceToolLoading = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    STANDALONE_SESSION_TOOL_IDS.has(routeSessionToolId.value) &&
    !sessionSourceRoot.value &&
    props.page?.launchBusy
  ));
  const dashboardShellVisible = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    !sourceToolLoading.value &&
    !STANDALONE_SESSION_TOOL_IDS.has(rightPaneTab.value)
  ));
  const dashboardRouteVisible = computed(() => [
    "dashboard",
    "info",
    "changes",
    "repository"
  ].includes(rightPaneTab.value));
  const sessionToolBackPath = computed(() => (
    lastDashboardRoutePath.value || projectAppPath(projectSlug.value, "/dashboard/env")
  ));

  function sessionToolRuntimeState(toolId = "") {
    if (
      toolId === "ai-terminal" &&
      !assistantAccessPending.value &&
      !assistantDirectAllowed.value
    ) {
      return {
        disabled: true,
        title: currentAssistantRestrictionMessage.value
      };
    }
    if (toolId === "editor") {
      return { disabled: !props.session, title: "Browse repository files, Drop Zone and session files" };
    }
    if (["database", "system"].includes(toolId)) {
      return {
        disabled: !sessionSourceRoot.value,
        title: sessionSourceRoot.value
          ? (
              toolId === "database"
                ? "Query and map the active session database"
                : "Explore the current project Cities"
            )
          : "Create the session source first"
      };
    }
    return {};
  }

  const sessionToolControls = computed(() => VIBE64_SESSION_TOOL_DEFINITIONS
    .filter((definition) => DIRECT_SESSION_TOOL_IDS.has(definition.id))
    .map((definition) => ({
      ...definition,
      ...sessionToolRuntimeState(definition.id)
    })));

  function sessionToolRoutePath(toolId = "") {
    const suffix = vibe64SessionToolDashboardSuffix(toolId);
    return suffix ? projectAppPath(projectSlug.value, suffix) : "";
  }

  function selectSessionTool(toolId = "", { navigate = true } = {}) {
    if (!DIRECT_SESSION_TOOL_IDS.has(toolId)) {
      return false;
    }
    const tool = sessionToolControls.value.find((item) => item.id === toolId);
    if (!tool || tool.disabled) {
      return false;
    }
    rightPaneTab.value = toolId;
    if (navigate) {
      const targetPath = sessionToolRoutePath(toolId);
      if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
        void router.push(targetPath);
      }
    }
    emit("project-attention");
    return true;
  }

  function backToDashboard() {
    const targetPath = sessionToolBackPath.value;
    if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
      void router.push(targetPath);
    }
  }

  function rightPaneTabMounted(tabId = "") {
    return rightPaneTab.value === String(tabId || "");
  }

  const activeSessionNav = computed(() => ({
    label: sessionNavLabel(props.session || {}),
    selectTool: selectSessionTool,
    sessionId: sessionId.value,
    status: String(props.session?.status || ""),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    tools: sessionToolControls.value.map((tool) => ({
      ...tool,
      active: rightPaneTab.value === tool.id,
      disabledReason: tool.disabled ? tool.title || "" : "",
      to: sessionToolRoutePath(tool.id)
    })),
    visible: Boolean(props.session)
  }));
  const dashboardSessionContext = computed(() => ({
    active: Boolean(props.active),
    activeSessionNav: activeSessionNav.value,
    copyText: typeof props.page?.copyText === "function" ? props.page.copyText : null,
    embeddedShell: true,
    projectContext: props.projectContext || {},
    refreshSessionWork: props.refreshSessionWork,
    requestSaveWork,
    session: props.session || null,
    sessionId: sessionId.value,
    sessionsApiPath: props.sessionsApiPath,
    statusColor: vibe64SessionStatusColor(props.session?.status),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    workState: props.workState || null
  }));

  const systemBackAvailable = computed(() => Boolean(
    systemReturnContext.value?.sessionId === sessionId.value
  ));

  function openSourceEditorFile(target = {}) {
    const path = normalizedAgentTurnText(target?.path);
    if (!path) {
      return false;
    }
    systemReturnContext.value = target.origin === "system"
      ? {
          ...(target.systemContext && typeof target.systemContext === "object" ? target.systemContext : {}),
          sessionId: sessionId.value
        }
      : null;
    sourceEditorOpenSequence += 1;
    sourceEditorOpenRequest.value = {
      column: Number(target.column || 0) || 0,
      line: Number(target.line || 0) || 0,
      path,
      sequence: sourceEditorOpenSequence
    };
    return selectSessionTool("editor");
  }

  function backToSystemFromEditor() {
    if (!systemBackAvailable.value) {
      return false;
    }
    systemRestoreSequence += 1;
    systemRestoreRequest.value = {
      ...systemReturnContext.value,
      sequence: systemRestoreSequence
    };
    return selectSessionTool("system");
  }

  const sourceEditorAskCodexAvailable = computed(() => Boolean(
    props.active &&
    sessionId.value &&
    !props.sessionSelectionArchived &&
    assistantDirectAllowed.value
  ));

  function prefillComposer(text = "") {
    const prompt = normalizedAgentTurnText(text);
    if (!prompt || !sourceEditorAskCodexAvailable.value) {
      return false;
    }
    composerDraft.value = prompt;
    emit("project-attention");
    return true;
  }

  function askCodexAboutSourceEditorFile(path = "") {
    const normalizedPath = normalizedAgentTurnText(path);
    return normalizedPath
      ? prefillComposer(`Please look at \`${normalizedPath}\` and help me with this file.`)
      : false;
  }

  function updateAgentSetting(parameterId = "", value = "") {
    agentSettings.update({
      [String(parameterId || "")]: String(value || "")
    });
  }

  watch(() => [
    props.active,
    projectPaneValue.value,
    route.path,
    routeSessionToolId.value,
    sessionSourceRoot.value,
    sourceToolLoading.value,
    assistantAccessPending.value,
    assistantDirectAllowed.value
  ].join("|"), () => {
    if (!props.active || projectPaneValue.value === "preview") {
      return;
    }
    if (sourceToolLoading.value) {
      emit("project-attention");
      return;
    }
    if (routeSessionToolId.value) {
      if (selectSessionTool(routeSessionToolId.value, { navigate: false })) {
        return;
      }
      const fallbackPath = projectAppPath(projectSlug.value, "/dashboard/env");
      lastDashboardRoutePath.value = fallbackPath;
      rightPaneTab.value = "dashboard";
      if (normalizeProjectRoutePath(fallbackPath) !== normalizeProjectRoutePath(route.path)) {
        void router.replace(fallbackPath);
      }
      return;
    }
    lastDashboardRoutePath.value = route.path;
    rightPaneTab.value = "dashboard";
  }, { immediate: true });

  watch([sessionId, projectSlug], () => {
    repositoryRequestSequence += 1;
    saveWorkConfirmOpen.value = false;
    saveWorkSending.value = false;
    saveWorkAttempt.value = null;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    composerSending.value = false;
    composerSubmissionKind.value = "";
    interrupting.value = false;
    composerDraft.value = "";
    composerAttachments.value = [];
    composerRetrySubmission.value = null;
    optimisticMessages.value = [];
    questionAnswers.value = {};
    dismissedNumberedQuestionText.value = "";
    submittedQuestionText.value = "";
    selectedAnswerChoice.value = "";
    savedCommitDeslop.value = "";
    savedCommitDeslopSending.value = false;
    workspaceSetupRetryError.value = "";
    workspaceSetupFixTaskId.value = "";
    checkedUpdateRepairRuns.clear();
    systemReturnContext.value = null;
    systemRestoreRequest.value = null;
  });

  watch(() => workspaceSetup.value?.updatedAt, () => {
    workspaceSetupRetryError.value = "";
  });

  watch(latestAssistantQuestionText, (questionText) => {
    questionAnswers.value = {};
    if (questionText !== dismissedNumberedQuestionText.value) {
      dismissedNumberedQuestionText.value = "";
    }
    if (questionText !== submittedQuestionText.value) {
      submittedQuestionText.value = "";
    }
    selectedAnswerChoice.value = "";
  });

  watch(() => props.conversationLog?.turns, (turns) => {
    if (!optimisticMessages.value.length) {
      return;
    }
    const remaining = unmatchedOptimisticMessages(turns, optimisticMessages.value);
    const retry = composerRetrySubmission.value;
    if (retry && !unmatchedOptimisticMessages(turns, [retry.optimistic]).length) {
      settleComposerRetry(retry);
    }
    if (remaining.length !== optimisticMessages.value.length) {
      optimisticMessages.value = remaining;
    }
  });

  watch(() => Boolean(
    agentActive.value ||
    composerSending.value ||
    interrupting.value ||
    saveWorkSending.value
  ), (busy) => {
    emit("busy-change", busy);
  }, { immediate: true });

  return {
    Vibe64OutputControls,
    assistantDirectAllowed,
    agentActive,
    agentStopEnabled,
    agentStopVisible,
    answerChoices,
    askCodexAboutSourceEditorFile,
    askCodexToFixPreviewIdentity,
    askCodexToFixWorkspaceSetup,
    attachPreviewDiagnostics,
    backToDashboard,
    backToSystemFromEditor,
    cancelOptimisticMessage,
    cancelSaveWork,
    captureVisiblePreview,
    chatCollapsed,
    chatReloadAvailable,
    chatReloading,
    chatTurns,
    composerAttachments,
    composerAttachmentsEnabled,
    composerAttachmentsSupported,
    composerCanSubmit,
    composerDisabled,
    composerDraft,
    composerHint,
    composerPlaceholder,
    composerSending,
    composerSubmitAriaLabel,
    composerSubmitLabel,
    composerSubmitMode,
    composerSubmitTitle,
    conversationLogVisible,
    conversationFollowLatestKey,
    conversationScrollKey,
    currentAgentSettings,
    dashboardSessionContext,
    dashboardRouteVisible,
    dashboardShellVisible,
    sourceToolLoading,
    dismissSaveWorkActivity,
    dismissNumberedQuestions,
    dismissSavedCommitDeslop,
    dismissWorkspaceSetupActivity,
    confirmSaveWork,
    editOptimisticMessage,
    emptyConversationWelcome,
    fixRepositoryActionError,
    fixRepositoryError,
    handleTemporaryAiTaskFinished,
    interrupting,
    loadMoreChatTurns,
    numberedQuestionSelectItems,
    numberedQuestions,
    openSourceEditorFile,
    previewAttachmentState,
    projectSlug,
    questionAnswers,
    reloadChatPane,
    repositoryRecoverySending,
    repositoryOperationActive,
    retrySaveWork,
    retryWorkspaceSetup,
    requestSaveWork,
    resendOptimisticMessage,
    requestAgentInterrupt,
    rightPaneTab,
    rightPaneTabMounted,
    saveWorkConfirmOpen,
    saveWorkDisabled,
    updateWorkDisabled,
    saveWorkActivityDismissed,
    saveWorkActivityKey,
    saveWorkActivityIsUpdate,
    saveWorkActivityLabel,
    saveWorkActionLabel,
    saveWorkError,
    saveWorkFailure,
    saveWorkHeaderAriaLabel,
    saveWorkHeaderVisible,
    saveWorkCanResolveWithTemporaryAi,
    saveWorkOperation,
    saveWorkOperationActive,
    saveWorkOutput,
    saveWorkRetryable,
    saveWorkSending,
    saveWorkStage,
    saveWorkStatus,
    saveWorkTitle,
    saveWorkRequiresUpdate,
    saveWorkUnsaved,
    savedCommitDeslop,
    savedCommitDeslopSending,
    selectSessionTool,
    sessionId,
    sessionGithubActor,
    sessionGithubActorHeaderVisible,
    sessionSourceRoot,
    sessionToolControls,
    sessionToolbarVisible,
    selectedAnswerChoice,
    sourceEditorAskCodexAvailable,
    sourceEditorOpenRequest,
    structuredQuestionActive,
    startSavedCommitDeslop,
    submitComposerMessage,
    systemBackAvailable,
    systemRestoreRequest,
    thinkingLabel,
    thinkingVisible,
    updateAgentSetting,
    updateComposerAttachments,
    updatePreviewAttachmentState,
    workspaceSetupAskDisabled,
    workspaceSetupActivityKey,
    workspaceSetupCurrentLabel,
    workspaceSetupDiagnostic,
    workspaceSetupDismissed,
    workspaceSetupFixSending,
    workspaceSetupNeedsAttention,
    workspaceSetupOutput,
    workspaceSetupRetryDisabled,
    workspaceSetupRetrying,
    workspaceSetupRunning,
    workspaceSetupStatus,
    workspaceSetupTitle
  };
}

function executionAttentionForError(error = null, message = "") {
  const code = normalizedAgentTurnText(error?.code);
  const category = EXECUTION_CAPACITY_ERROR_CODES.has(code)
    ? "capacity"
    : EXECUTION_SAFETY_ERROR_CODES.has(code)
      ? "ownership"
      : "";
  if (!category) {
    return null;
  }
  return Object.freeze({
    category,
    code,
    message: normalizedAgentTurnText(message) || "This work could not start safely."
  });
}

export {
  emptyConversationWelcomeText,
  agentConnectionThinkingLabel,
  previewIdentityFixPrompt,
  useVibe64AutopilotView,
  workspaceSetupFixPrompt,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
