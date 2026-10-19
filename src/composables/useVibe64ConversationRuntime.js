import { useQueryClient } from "@tanstack/vue-query";
import { computed, inject, onScopeDispose, proxyRefs, ref, toValue, watch } from "vue";
import { useTrainingLearnerGestures } from "@local/vibe64-training/client/learner-gestures";
import { useTrainingWorkspaceObservation } from "@local/vibe64-training/client/workspace-observation";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useTrainingMainPresentation } from "@local/vibe64-training/client/main-presentation";
import { useVibe64Voice } from "@local/vibe64-voice/client";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { mainConversationId, mainConversationTarget } from "@local/vibe64-sessions/shared/conversation";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { useVibe64MountedSessionData } from "./useVibe64MountedSessionData.js";
import { useVibe64ConversationLog } from "./useVibe64ConversationLog.js";
import { useVibe64AssistantAccess } from "./useVibe64AssistantAccess.js";
import { useVibe64AgentSettings } from "./useVibe64AgentSettings.js";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_COLLEAGUE_PREVIEW_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY, VIBE64_COLLEAGUE_BODY_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY, VIBE64_BROWSER_NAVIGATION_KEY } from "@/lib/vibe64AssistantHost.js";
import { agentTurnControlPayloadFromContext, VIBE64_SESSION_CHANGED_EVENT, vibe64SessionEventMatchesScope, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { isArchivedVibe64Session } from "@/lib/vibe64SessionViewModel.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";

function browserDraftStorage(identity) {
  try {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    return storage ? { storage, key: `vibe64:chat-composer:v1:${JSON.stringify([
      ...(identity.learningAttemptId === undefined ? [identity.actorKey, identity.projectSlug, identity.sessionId]
        : [identity.actorKey, "learning", identity.learnerId, identity.learningAttemptId, identity.sessionId])
    ])}` } : null;
  } catch { return null; }
}

// Only application policy and mounted product data live here. The supplied
// binding owns retention, draft/receipt recovery, transport and subscriptions.
function createConversationApplication(conversation, { identity, viewer, summarySession, shell }) {
  const { active, current } = conversation;
  const mounted = useVibe64MountedSessionData({ ...identity, active,
    summarySession: computed(() => toValue(summarySession)?.sessionId === identity.sessionId ? toValue(summarySession) : null) });
  const conversationLog = proxyRefs(useVibe64ConversationLog({ ...identity, active, session: mounted.session, conversation }));
  const access = useVibe64AssistantAccess({ ...identity, viewer, active });
  const agentSettings = useVibe64AgentSettings(identity);
  const turn = computed(() => mounted.session.value?.agentSession?.turn || {});
  const steerable = computed(() => conversation.steerable.value && turn.value.active === true && turn.value.status !== "observation_lost" &&
    Boolean(turn.value.id) && turn.value.state === "active" && mounted.agentConnectionStatus.value === "connected");
  const available = computed(() => current.value && !isArchivedVibe64Session(mounted.session.value || {}) &&
    !mounted.detailState.value?.error && !access.accessError.value);
  function projectTrainingQuestion(reference) {
    return Object.fromEntries(["attemptId", "questionId", "assessmentId", "issuedRevision", "topicHash", "lessonHash"]
      .map(key => [key, reference[key]]));
  }
  const trainingQuestion = computed(() => {
    const reference = conversation.snapshot.value?.trainingQuestion;
    if (!available.value || identity.learningAttemptId === undefined || reference?.attemptId !== identity.learningAttemptId) return null;
    return Object.freeze(projectTrainingQuestion(reference));
  });
  const presentation = identity.learningAttemptId !== undefined ? useTrainingMainPresentation({ identity,
    current, preview: shell.preview, voice: shell.voice, browserNavigation: shell.browserNavigation,
    retain: () => conversation.retain(),
    ready: computed(() => Boolean(conversation.snapshot.value)),
    enabled: computed(() => available.value &&
      (toValue(summarySession)?.noExercise !== false || identity.noExercise === false))
  }) : null;
  if (identity.learningAttemptId !== undefined && presentation) {
    const { channel, body, layout, view, feedback } = shell;
    const rawActor = computed(() => toValue(viewer)?.actorKey || "");
    const selected = () => current.value && active.value && available.value && rawActor.value === identity.viewerActorKey;
    const matchingView = computed(() => {
      const binding = view?.value?.learningBinding;
      return binding && ["actorKey", "viewerActorKey", "learnerId", "learningAttemptId", "sessionId", "sourceProjectSlug"]
        .every(key => binding[key] === identity[key]) ? view.value : null;
    });
    const focus = computed(() => ({ projectSlug: identity.sourceProjectSlug || "", sessionId: identity.sessionId,
      pane: matchingView.value?.pane || "", learningView: matchingView.value?.learningView || "learning" }));
    const workspace = identity.noExercise === false ? useTrainingWorkspaceObservation({ actor: rawActor,
      layout: layout || ref(null), view: matchingView, focus,
      selection: { projectSlug: ref(""), restoring: ref(false), error: computed(() => mounted.detailState.value?.error || "") } }) : null;
    const product = computed(() => ({ conversationId: mainConversationId(identity), trainingQuestion: trainingQuestion.value,
      loaded: Boolean(conversation.snapshot.value) }));
    const drawer = { owner: computed(() => body?.value?.actorKey === identity.viewerActorKey ? body.value : null),
      conversationId: computed(() => body?.value?.actorKey === identity.viewerActorKey ? body.value.conversationId : ""),
      bodyVisible: computed(() => body?.value?.actorKey === identity.viewerActorKey && body.value.visible === true),
      xs: computed(() => body?.value?.compact === true) };
    const gestures = useTrainingLearnerGestures({ scope: { actorKey: rawActor, product, clientId: presentation.clientId, current: selected, learningBinding: identity, preserveDrawer: true },
      workspace: { get focus() { return focus.value; }, settle: workspace }, drawer,
      observe: async options => {
        const { conversationId: _derivedByServer, ...requestBody } = options.body;
        const result = await getHttpWebClient().request(`${identity.sessionsApiPath}/${encodeURIComponent(identity.sessionId)}/training/observations`,
          { ...options, body: requestBody });
        if (result?.ok === false) throw new Error(result.error || "The practical observation was not confirmed.");
        return result;
      }, failure: error => feedback?.report({ source: "vibe64.training", intent: "action-feedback", severity: "error",
        message: error.message, dedupeKey: `vibe64.training:${error.message}`, dedupeWindowMs: 1000 }) });
    watch(() => selected(), valid => {
      if (valid && channel) channel.value = gestures;
      else { gestures.clear(); if (channel?.value === gestures) channel.value = null; }
    }, { immediate: true, flush: "sync" });
    onScopeDispose(() => { gestures.clear(); if (channel?.value === gestures) channel.value = null; });
  }
  // A goal can stay pinned to another native engine after a chat selection.
  // Product invalidations refresh the same binding; they own no goal cache.
  const refreshGoal = () => { if (!globalThis.document?.hidden) void conversation.refreshGoal(); };
  useRealtimeEvent({
    enabled: active, event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => vibe64SessionEventMatchesScope(payload, identity) &&
      (identity.learningAttemptId !== undefined || payload.projectSlug === identity.projectSlug) &&
      payload.sessionId === identity.sessionId && ["codex-goal", "claude-goal", "assistant-routing-changed"].includes(payload.reason),
    onEvent: refreshGoal
  });
  for (const event of [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT]) {
    useRealtimeEvent({ enabled: active, event, matches: () => true, onEvent: refreshGoal });
  }

  function prepareMessage(payload, { messageId, submissionKind = steerable.value ? "steer" : "send" } = {}) {
    if (!available.value) throw new Error("This conversation is no longer available.");
    if (!access.canUseChat.value) throw new Error(access.restrictionMessage.value || "AI access is not ready.");
    const queuedStartup = conversation.queueWhileSending.value && conversation.delivery.state.sending &&
      turn.value.state === "starting" && turn.value.status !== "observation_lost" && mounted.agentConnectionStatus.value === "connected";
    if (turn.value.active && conversation.steerable.value && !steerable.value && !queuedStartup) {
      throw new Error("Wait for this turn to finish or stop it before sending.");
    }
    const authored = conversation.delivery.find(messageId)?.payload || payload;
    if (authored.request) return authored;
    // Old browser drafts keep their original opaque payload. Only an explicit
    // send/retry maps that payload to the declared product data schema.
    const body = agentTurnControlPayloadFromContext(authored);
    const data = Object.fromEntries(["agentSettings", "displayMessage", "displayAttachments", "genesisTask",
      "planRevision", "reviewAction", "originId"].filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
    // A recording's explicit absence must not acquire a later question. The
    // local null marker never enters the original optional-object wire schema.
    const reference = Object.hasOwn(authored, "trainingQuestion") ? authored.trainingQuestion : trainingQuestion.value;
    if (identity.learningAttemptId !== undefined && reference?.attemptId === identity.learningAttemptId) {
      data.trainingQuestion = projectTrainingQuestion(reference);
    }
    if (presentation) data.clientId = Object.hasOwn(authored, "clientId") ? authored.clientId : presentation.clientId;
    return { ...authored, submissionKind, data, request: { text: String(authored.message || ""), data,
      ...(authored.attachmentIds?.length ? { attachmentIds: authored.attachmentIds } : {}),
      ...(submissionKind === "steer" ? { steer: true } : {}) } };
  }
  async function send(payload, options = {}) {
    const prepared = prepareMessage(payload, options);
    try {
      const result = await conversation.send(prepared, options);
      if (result?.ok === false) throw vibe64ApiError(result, "Message could not be sent.");
      return result;
    } finally { void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {}); }
  }
  async function continueWorkflow(request) {
    if (!available.value) throw new Error("This conversation is no longer available.");
    const messageId = String(request?.messageId || "").trim();
    const message = String(request?.input?.message || "");
    if (!messageId || !message.trim()) throw new Error("Refresh the session before continuing this workflow.");
    try {
      const result = await getHttpWebClient().request(vibe64SessionPath(identity.sessionsApiPath, identity.sessionId, "/agent-message"), {
        body: { messageId, message, reviewAction: "retry" }, method: "POST"
      });
      if (result?.ok === false) throw vibe64ApiError(result, "Workflow could not continue.");
      return result;
    } finally { void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {}); }
  }
  async function submitDraft(payload, options = {}) {
    const prepared = prepareMessage(payload, options);
    try {
      const result = await conversation.submitDraft(prepared, options);
      if (result?.ok === false) throw vibe64ApiError(result, "Message could not be sent.");
      return result;
    } finally { void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {}); }
  }
  async function interrupt(input = "user_interrupt") {
    if (!current.value) return false;
    const control = typeof input === "object" ? input : { reason: input };
    try {
      // Router cancellation is a product operation, including its reason and
      // pending HTTP abort. Ordinary native Stop uses the supplied conversation.
      const result = control.reason === "cancel-routing"
        ? await getHttpWebClient().request(vibe64SessionPath(identity.sessionsApiPath, identity.sessionId, "/agent-turn/interrupt"),
          { body: agentTurnControlPayloadFromContext(control), method: "POST" })
        : await conversation.cancel();
      if (result?.ok === false) throw vibe64ApiError(result, "Assistant turn could not be interrupted.");
      return result;
    } finally {
      presentation?.retire("The person stopped this Main explanation.");
      void mounted.refresh({ reason: "agent-turn-interrupted" }).catch(() => {});
    }
  }
  return { identity, mounted, conversationLog, access, agentSettings, available, steerable, trainingQuestion, presentation,
    phase: computed(() => conversation.snapshot.value?.phase || ""),
    ...(identity.learningAttemptId !== undefined ? { conversationReady: computed(() => Boolean(conversation.snapshot.value)) } : {}),
    ...(identity.learningAttemptId !== undefined ? { async prepareVoice() {
      if (!current.value || !available.value || !access.canUseChat.value) throw new Error("This lesson conversation is no longer available for voice.");
      // Prepare ONLY a newly opened voice session, before the original controller
      // releases its old owner or primes the new queue. Reconnect/page loads do
      // not re-run this gate or disable an already admitted microphone.
      if (!conversation.snapshot.value) await conversation.reload();
      if (!current.value || !available.value || !access.canUseChat.value || !conversation.snapshot.value || conversation.error.value) {
        throw new Error("Wait for this lesson’s chat updates to load, then open voice again.");
      }
    } } : {}),
    canSubmit: conversation.canSubmit, queueWhileSending: conversation.queueWhileSending,
    delivery: conversation.delivery, draft: conversation.draft, draftAttachments: conversation.draftAttachments,
    draftRetry: conversation.draftRetry, draftRetryMatches: conversation.draftRetryMatches,
    settleDraftRetry: conversation.settleDraftRetry, send, continueWorkflow, submitDraft, interrupt,
    goalState: conversation.goalState, goalView: conversation.goalView, goalLoadError: conversation.goalLoadError,
    changeGoal: conversation.changeGoal, refreshGoal: conversation.refreshGoal,
    sendAgentMessage: input => send(input, { messageId: input.messageId, submissionKind: input.submissionKind }),
    cancelMessage: conversation.cancelMessage, inspectDelivery: conversation.inspectDelivery,
    retain() {
      const retained = conversation.retain();
      return { runtime: retained.runtime.application, release: retained.release };
    } };
}

/** Main text and voice consume one supplied retained conversation. */
function useVibe64ConversationRuntime({ sessionId, projectSlug, sessionsApiPath, learningAttemptId, learnerId, noExercise, sourceProjectSlug, active = true, summarySession } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const queryClient = useQueryClient();
  // The retained factory runs outside this component's setup after selection.
  // Capture its existing shell facilities while ancestor providers are current.
  const channel = inject(VIBE64_TRAINING_LEARNER_GESTURE_KEY, null);
  const shell = {
    channel, body: inject(VIBE64_COLLEAGUE_BODY_KEY, null),
    browserNavigation: inject(VIBE64_BROWSER_NAVIGATION_KEY, null),
    layout: inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null), view: inject(VIBE64_COLLEAGUE_VIEW_KEY, null),
    preview: inject(VIBE64_COLLEAGUE_PREVIEW_KEY, null), voice: useVibe64Voice(),
    feedback: channel ? useShellWebErrorRuntime() : null
  };
  const identity = computed(() => {
    const target = { sessionId: String(toValue(sessionId) || ""), projectSlug: String(toValue(projectSlug) || ""),
      actorKey: toValue(viewer)?.actorKey || "",
      sessionsApiPath: scopedDevelopmentApiUrl(String(toValue(sessionsApiPath) || ""), String(toValue(projectSlug) || "")) };
    const attempt = toValue(learningAttemptId);
    if (attempt !== undefined) {
      target.viewerActorKey = target.actorKey;
      target.learningAttemptId = attempt;
      target.learnerId = typeof toValue(learnerId) === "string" ? toValue(learnerId) : "";
      if (toValue(noExercise) === false) {
        target.noExercise = false;
        target.sourceProjectSlug = String(toValue(sourceProjectSlug) || "");
      }
      // Only the host's actual API-returned own learner identity scopes this
      // Main binding. It neither changes the global viewer nor grants access.
      const sourceConfirmed = target.noExercise !== false ||
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(target.sourceProjectSlug);
      const ready = sourceConfirmed && !target.projectSlug && target.learnerId && target.actorKey &&
        target.sessionsApiPath === `/api/learning/${attempt}/vibe64/sessions`;
      target.actorKey = ready ? JSON.stringify(["learning", target.actorKey, target.learnerId, attempt]) : "";
    }
    return Object.freeze(target);
  });
  const api = createAssistantApi({ request: (url, options) => getHttpWebClient().request(url, options),
    resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app" });
  const binding = useAssistantConversation({
    conversationId: () => {
      const target = identity.value;
      if (!target.sessionId || !target.actorKey || (target.learningAttemptId === undefined && !target.projectSlug)) return "";
      try { return mainConversationId(target); } catch { return ""; }
    },
    actorKey: () => identity.value.actorKey, endpoint: "/api/assistant/app", surfaceId: "app", hostSurfaceId: "app",
    workspaceSlug: "", active, goal: true, deferWhileWorking: true,
    onEvent(event) {
      const application = binding.runtime.value?.application;
      const presentation = application?.presentation?.receiveEvent(event);
      const target = application?.identity;
      if (event.type === "settled" && target?.learningAttemptId !== undefined &&
          target.viewerActorKey === toValue(viewer)?.actorKey) {
        for (const resource of ["learning", "author-preview"]) {
          const queryKey = ["vibe64", "training", resource, target.viewerActorKey];
          const saved = queryClient.getQueryData(queryKey);
          if (saved?.reader === target.viewerActorKey && saved.value?.active?.attemptId === target.learningAttemptId) {
            void queryClient.invalidateQueries({ queryKey, exact: true });
          }
        }
      }
      return presentation;
    }, draftStorage: () => browserDraftStorage(identity.value),
    api: { ...api, sendConversationMessage(id, input, ...options) {
      // As for Colleague, a new request from this page lifts speech silence left
      // by an interrupted or failed reply; history refreshes are not invitations.
      const voice = shell.voice?.controller.state;
      if (voice?.binding?.conversationId === id) voice.session?.inviteSpeech(input.messageId);
      return api.sendConversationMessage(id, input, ...options);
    } },
    application(conversation) {
      const target = mainConversationTarget(conversation.identity.conversationId);
      return createConversationApplication(conversation, { viewer, summarySession, shell,
        identity: Object.freeze({ ...identity.value, ...target, actorKey: conversation.identity.actorKey }) });
    }
  });
  return computed(() => binding.runtime.value?.application || null);
}

export { useVibe64ConversationRuntime };
