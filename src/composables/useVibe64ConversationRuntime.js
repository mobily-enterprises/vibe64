import { computed, inject, proxyRefs, toValue } from "vue";
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
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { agentTurnControlPayloadFromContext, VIBE64_SESSION_CHANGED_EVENT, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { isArchivedVibe64Session } from "@/lib/vibe64SessionViewModel.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";

function browserDraftStorage(identity) {
  try {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    return storage ? { storage, key: `vibe64:chat-composer:v1:${JSON.stringify([
      identity.actorKey, identity.projectSlug, identity.sessionId
    ])}` } : null;
  } catch { return null; }
}

// Only application policy and mounted product data live here. The supplied
// binding owns retention, draft/receipt recovery, transport and subscriptions.
function createConversationApplication(conversation, { identity, viewer, summarySession }) {
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
  // A goal can stay pinned to another native engine after a chat selection.
  // Product invalidations refresh the same binding; they own no goal cache.
  const refreshGoal = () => { if (!globalThis.document?.hidden) void conversation.refreshGoal(); };
  useRealtimeEvent({
    enabled: active, event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.projectSlug === identity.projectSlug &&
      payload.sessionId === identity.sessionId && ["codex-goal", "claude-goal", "assistant-routing-changed"].includes(payload.reason),
    onEvent: refreshGoal
  });
  for (const event of [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT]) {
    useRealtimeEvent({ enabled: active, event, matches: () => true, onEvent: refreshGoal });
  }

  function prepareMessage(payload, { messageId, submissionKind = steerable.value ? "steer" : "send" } = {}) {
    if (!available.value) throw new Error("This conversation is no longer available.");
    if (!access.canUseChat.value) throw new Error(access.restrictionMessage.value || "AI access is not ready.");
    if (turn.value.active && conversation.steerable.value && !steerable.value) throw new Error("Wait for this turn to finish or stop it before sending.");
    const authored = conversation.delivery.find(messageId)?.payload || payload;
    if (authored.request) return authored;
    // Old browser drafts keep their original opaque payload. Only an explicit
    // send/retry maps that payload to the declared product data schema.
    const body = agentTurnControlPayloadFromContext(authored);
    const data = Object.fromEntries(["agentSettings", "displayMessage", "displayAttachments", "genesisTask",
      "planRevision", "reviewAction", "originId"].filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
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
    } finally { void mounted.refresh({ reason: "agent-turn-interrupted" }).catch(() => {}); }
  }
  return { identity, mounted, conversationLog, access, agentSettings, available, steerable,
    canSubmit: conversation.canSubmit, queueWhileSending: conversation.queueWhileSending,
    delivery: conversation.delivery, draft: conversation.draft, draftAttachments: conversation.draftAttachments,
    draftRetry: conversation.draftRetry, draftRetryMatches: conversation.draftRetryMatches,
    settleDraftRetry: conversation.settleDraftRetry, send, submitDraft, interrupt,
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
function useVibe64ConversationRuntime({ sessionId, projectSlug, sessionsApiPath, active = true, summarySession } = {}) {
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const identity = computed(() => Object.freeze({ sessionId: String(toValue(sessionId) || ""),
    projectSlug: String(toValue(projectSlug) || ""), actorKey: toValue(viewer)?.actorKey || "",
    sessionsApiPath: scopedDevelopmentApiUrl(String(toValue(sessionsApiPath) || ""), String(toValue(projectSlug) || "")) }));
  const binding = useAssistantConversation({
    conversationId: () => identity.value.sessionId && identity.value.projectSlug ? mainConversationId(identity.value) : "",
    actorKey: () => identity.value.actorKey, endpoint: "/api/assistant/app", surfaceId: "app", hostSurfaceId: "app",
    workspaceSlug: "", active, goal: true, deferWhileWorking: true, draftStorage: () => browserDraftStorage(identity.value),
    api: createAssistantApi({ request: (url, options) => getHttpWebClient().request(url, options),
      resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app" }),
    application(conversation) {
      const target = mainConversationTarget(conversation.identity.conversationId);
      return createConversationApplication(conversation, { viewer, summarySession,
        identity: Object.freeze({ ...identity.value, ...target, actorKey: conversation.identity.actorKey }) });
    }
  });
  return computed(() => binding.runtime.value?.application || null);
}

export { useVibe64ConversationRuntime };
