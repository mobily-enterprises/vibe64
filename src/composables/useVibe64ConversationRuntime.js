import { computed, effectScope, getCurrentInstance, inject, onScopeDispose, proxyRefs, ref, shallowReactive, shallowRef, toValue, watch } from "vue";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64MountedSessionData } from "./useVibe64MountedSessionData.js";
import { useVibe64ConversationLog } from "./useVibe64ConversationLog.js";
import { useVibe64AssistantAccess } from "./useVibe64AssistantAccess.js";
import { useVibe64AgentSettings } from "./useVibe64AgentSettings.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { agentTurnControlPayloadFromContext, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { isArchivedVibe64Session } from "@/lib/vibe64SessionViewModel.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";

function createVibe64ConversationDelivery({ current, available, access, turn, steerable, conversationLog, sendAgentMessage }) {
  const delivery = createAssistantMessageDelivery();
  async function send(payload, { messageId = crypto.randomUUID(), submissionKind = steerable.value ? "steer" : "send" } = {}) {
    if (!available.value) throw new Error("This conversation is no longer available.");
    if (!access.canUseChat.value) throw new Error(access.restrictionMessage.value || "AI access is not ready.");
    if (turn.value.active && !steerable.value) throw new Error("Wait for this turn to finish or stop it before sending.");
    const receipt = Promise.withResolvers();
    const stopReceipt = watch([current, () => conversationLog.turns], ([isCurrent, turns]) => {
      if (!isCurrent) receipt.resolve(false);
      else if (turns?.some(turn => turn.user?.messageId === messageId)) receipt.resolve({ ok: true });
    }, { immediate: true });
    try {
      return await delivery.send({ ...payload, submissionKind }, {
        messageId, queue: submissionKind === "steer", isCurrent: () => current.value,
        deliver: submission => Promise.race([sendAgentMessage(submission), receipt.promise])
      });
    } finally { stopReceipt(); }
  }

  watch(() => conversationLog.turns, turns => delivery.reconcile(turns));
  return { delivery, send };
}

const applicationConversations = new WeakMap();

function createConversationRuntime(identity, viewer, readers) {
  const disposed = ref(false);
  const current = computed(() => !disposed.value && (toValue(viewer)?.actorKey || "") === identity.actorKey);
  const active = computed(() => current.value && [...readers.values()].some(value => toValue(value.active) !== false));
  const summarySession = computed(() => [...readers.values()].map(value => toValue(value.summarySession))
    .find(session => session?.sessionId === identity.sessionId) || null);
  const mounted = useVibe64MountedSessionData({ ...identity, active, summarySession });
  const conversationLog = proxyRefs(useVibe64ConversationLog({ ...identity, active, session: mounted.session }));
  const access = useVibe64AssistantAccess({ ...identity, viewer, active });
  const agentSettings = useVibe64AgentSettings(identity);
  const pendingMessages = new Map();
  const turn = computed(() => mounted.session.value?.agentSession?.turn || {});
  const steerable = computed(() => turn.value.active === true && turn.value.status !== "observation_lost" &&
    Boolean(turn.value.id) && turn.value.state === "active" && mounted.agentConnectionStatus.value === "connected");
  const available = computed(() => current.value && !isArchivedVibe64Session(mounted.session.value || {}) &&
    !mounted.detailState.value?.error && !access.accessError.value);

  async function sendAgentMessage(input = {}) {
    if (!current.value) return false;
    const body = agentTurnControlPayloadFromContext(input);
    const messageId = String(body.messageId || "");
    const controller = new AbortController();
    if (messageId) pendingMessages.set(messageId, controller);
    try {
      const result = await getHttpWebClient().request(vibe64SessionPath(identity.sessionsApiPath, identity.sessionId, "/agent-message"),
        { body, method: "POST", signal: controller.signal });
      if (result?.ok === false) throw vibe64ApiError(result, "Message could not be sent.");
      void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {});
      return true;
    } catch (error) {
      void mounted.refresh().catch(() => {});
      if (controller.signal.aborted) return false;
      throw error;
    } finally {
      if (pendingMessages.get(messageId) === controller) pendingMessages.delete(messageId);
    }
  }

  async function interrupt(input = "user_interrupt") {
    if (!current.value) return false;
    const control = typeof input === "object" ? input : { reason: input };
    try {
      const result = await getHttpWebClient().request(vibe64SessionPath(identity.sessionsApiPath, identity.sessionId, "/agent-turn/interrupt"),
        { body: agentTurnControlPayloadFromContext(control), method: "POST" });
      if (result?.ok === false) throw vibe64ApiError(result, "Assistant turn could not be interrupted.");
      return true;
    } finally { void mounted.refresh({ reason: "agent-turn-interrupted" }).catch(() => {}); }
  }

  function cancelMessage(messageId) {
    const controller = pendingMessages.get(messageId);
    if (!controller) return false;
    controller.abort();
    pendingMessages.delete(messageId);
    return true;
  }

  const { delivery, send } = createVibe64ConversationDelivery({
    current, available, access, turn, steerable, conversationLog, sendAgentMessage
  });
  onScopeDispose(() => {
    disposed.value = true;
    for (const controller of pendingMessages.values()) controller.abort();
    pendingMessages.clear();
  });
  return { identity, mounted, conversationLog, access, agentSettings, delivery, available, steerable, send, sendAgentMessage, interrupt, cancelMessage };
}

/** The view and voice retain the same readers and delivery state for an exact target. */
function retainConversation(app, identity, viewer, active, summarySession) {
  let conversations = applicationConversations.get(app);
  if (!conversations) { conversations = new Map(); applicationConversations.set(app, conversations); }
  const key = JSON.stringify([identity.actorKey, identity.projectSlug, identity.sessionId]);
  let entry = conversations.get(key);
  if (!entry) {
    const scope = effectScope(true);
    const readers = shallowReactive(new Map());
    try {
      const runtime = app.runWithContext(() => scope.run(() => createConversationRuntime(identity, viewer, readers)));
      entry = { scope, readers, runtime };
      runtime.retain = () => retainConversation(app, identity, viewer, true);
      conversations.set(key, entry);
    } catch (error) { scope.stop(); throw error; }
  }
  const token = Symbol("conversation reader");
  entry.readers.set(token, { active, summarySession });
  return {
    runtime: entry.runtime,
    release() {
      if (!entry.readers.delete(token) || entry.readers.size) return;
      entry.scope.stop();
      conversations.delete(key);
    }
  };
}

function useVibe64ConversationRuntime({ sessionId, projectSlug, sessionsApiPath, active = true, summarySession } = {}) {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) throw new Error("Conversation runtime must be acquired from the application setup.");
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  const runtime = shallowRef(null);
  let retained;
  watch(() => [toValue(sessionId), toValue(projectSlug), toValue(viewer)?.actorKey || "", toValue(sessionsApiPath)],
    ([id, slug, actorKey, apiPath]) => {
      retained?.release();
      const identity = Object.freeze({ sessionId: String(id || ""), projectSlug: String(slug || ""), actorKey,
        sessionsApiPath: scopedDevelopmentApiUrl(String(apiPath || ""), String(slug || "")) });
      retained = retainConversation(app, identity, viewer, active, summarySession);
      runtime.value = retained.runtime;
    }, { immediate: true, flush: "sync" });
  onScopeDispose(() => retained?.release());
  return runtime;
}

export { createVibe64ConversationDelivery, useVibe64ConversationRuntime };
