import { computed, inject, markRaw, onBeforeUnmount, ref, shallowRef, toValue, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useAssistantConversationFactory } from "@jskit-ai/assistant-runtime/client";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { normalizeVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { assistantRoutingRequestForDisplay, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { temporaryConversationId } from "@local/vibe64-sessions/shared/conversation";
import { useAiTaskConversationSaves } from "@/composables/useAiTaskConversationSaves.js";
import { aiTaskConversationView, aiTaskRequest, aiTaskTurnIsActive } from "@/lib/vibe64AiTaskConversation.js";
import { vibe64AssistantConversationOptions } from "@/lib/vibe64AssistantConversation.js";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { VIBE64_SESSION_CHANGED_EVENT, vibe64TemporaryConversationPath } from "@/lib/vibe64SessionRequestConfig.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";

/** The fields the server's conversation read reports, applied as it reports them. */
const OBSERVED_FIELDS = ["routingMetadata", "purposes", "canSteer", "assistantSelection", "goal"];
/** The conversation notices for the bound conversation, besides its creation. */
const CONVERSATION_NOTICES = ["temporary-conversation-closed", "temporary-conversation-renamed", "assistant-routing-changed"];

/**
 * The AI task's conversation record: binds the task's saved conversation for the session and viewer,
 * follows the server's reads and other views' changes to it, and releases it when the task, session or
 * viewer changes.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.taskId the task, whose conversation has the same id
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.assistantReady
 */
function useAiTaskConversationRecord({ taskId, sessionId, sessionsApiPath, projectSlug, assistantReady }) {
  /** @type {import("vue").MaybeRef<{ actorKey: string } | null>} */
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, LOCAL_ASSISTANT_VIEWER);
  const actorKey = computed(() => toValue(viewer)?.actorKey || "");
  const acquireConversation = useAssistantConversationFactory({
    ...vibe64AssistantConversationOptions(),
    actorKey: () => actorKey.value, queueWhileSending: true, clearDraftOn: "dispatch",
    presentation: { assistantLabel: "AI", variant: "task", visible: true, userMessageFormat: "plain", systemLabel: "System" }
  });
  const conversation = shallowRef(null);
  const closedConversationIds = new Set();
  const stoppingIds = new Set();
  const restoreError = ref("");
  const restorations = new Map();
  let disposed = false;
  let restoreGeneration = 0;
  let restoreRetryTimer;
  const isDisposed = () => disposed;
  const saves = useAiTaskConversationSaves({ conversation, closedConversationIds, isDisposed });
  const { flushPendingSaves, forgetQueuedSaves, releaseConversation, updateConversation } = saves;
  const currentSessionId = () => normalizeText(toValue(sessionId));
  const currentSessionsApiPath = () => normalizeText(toValue(sessionsApiPath));

  // What the server's read reports about the turn. A local Send never shows the assistant as working; a
  // pre-Send read cannot finish a newer request, and a stopped request stays stopped.
  function observe(current, { snapshot, error, sending }) {
    const observed = snapshot?.presentation;
    const canApplyProgress = !stoppingIds.has(current.id) && !(current.status === "interrupted" && !current.busy);
    const update = {};
    if (!observed) return error && canApplyProgress ? { error } : update;
    for (const field of OBSERVED_FIELDS) if (Object.hasOwn(observed, field)) update[field] = observed[field];
    if (!observed.readError) update.nativeWorking = aiTaskTurnIsActive(observed.status);
    const route = assistantRoutingRequestForDisplay(observed.routingMetadata);
    // A request the saved transcript has followed with a later one, from any view, is no longer current.
    const requests = (snapshot.conversationLog || []).map(turn => turn.user?.messageId).filter(Boolean);
    const superseded = requests.includes(current.messageId) && requests.at(-1) !== current.messageId;
    const sameRequest = !current.messageId || superseded || observed.messageId === current.messageId ||
      route?.messageId === current.messageId;
    if (canApplyProgress && !sending && (!current.busy || sameRequest)) {
      if (superseded && observed.messageId) update.messageId = observed.messageId;
      if (!observed.readError) {
        update.status = normalizeText(observed.status) || current.status;
        update.busy = aiTaskTurnIsActive(update.status);
        update.phase = update.busy ? normalizeText(snapshot.phase) : "";
        update.runId = observed.runId || current.runId;
        update.outcomeKind = normalizeText(observed.outcome?.kind);
      }
      if (!observed.deferredReconciliation) update.error = normalizeText(observed.error || error);
    }
    if (snapshot.pendingRequest && !current.pendingMessageId) update.pendingMessageId = snapshot.pendingRequest.messageId;
    return update;
  }

  function bind(record) {
    // Declared first: the binding asks whether it is active while it is still being acquired.
    let binding;
    binding = markRaw(acquireConversation({
      conversationId: temporaryConversationId({ projectSlug: toValue(projectSlug), sessionId: record.sessionId,
        conversationId: record.conversationId }),
      active: () => !disposed && conversation.value?.binding === binding
    }));
    const runtime = binding.runtime.value;
    runtime.draft.value = record.draft;
    runtime.draftAttachments.value = record.attachments;
    // A transcript change reads the reported progress again, as a new read does.
    const stop = watch([runtime.snapshot, runtime.turns, runtime.error, () => runtime.delivery.state.sending],
      ([snapshot, , error, sending]) => {
        const current = conversation.value;
        if (disposed || current?.binding !== binding) return;
        updateConversation(current.id, observe(current, { snapshot, error, sending }));
      }, { flush: "sync" });
    return aiTaskConversationView({ ...record, binding, releaseBinding: markRaw(() => { stop(); binding.release(); }) });
  }

  /** Releases the bound conversation, after sending what its queued saves hold. */
  function releaseAll() {
    restoreGeneration += 1;
    restoreError.value = "";
    flushPendingSaves();
    forgetQueuedSaves();
    conversation.value?.releaseBinding();
    conversation.value = null;
  }

  function applyRecord(record, { ownerSessionId, apiPath }) {
    const current = conversation.value;
    if (current && current.conversationId !== record?.conversationId) releaseConversation(current.id);
    if (!record || closedConversationIds.has(record.conversationId)) return;
    if (conversation.value) {
      updateConversation(current.id, { purposes: record.purposes, canSteer: record.canSteer, title: record.title || "" });
      return;
    }
    conversation.value = bind({
      ...record,
      id: record.conversationId,
      sessionId: ownerSessionId,
      apiPath,
      agentSettings: normalizeVibe64AgentSettings(record.agentSettings),
      attachments: record.attachments || [],
      pendingMessageId: "",
      draft: record.draft || "",
      draftSaveState: record.draft ? "saved" : "",
      busy: aiTaskTurnIsActive(record.status),
      nativeWorking: false
    });
  }

  /** Reads the task's saved conversation and binds it. The temporary chat list leaves AI tasks out. */
  async function restore() {
    clearTimeout(restoreRetryTimer);
    const generation = ++restoreGeneration;
    const ownerSessionId = currentSessionId();
    const apiPath = currentSessionsApiPath();
    const id = toValue(taskId);
    if (disposed || !actorKey.value || !toValue(assistantReady) || !id || !ownerSessionId || !apiPath) return;
    const key = JSON.stringify([apiPath, ownerSessionId, actorKey.value, id]);
    try {
      let restoring = restorations.get(key);
      if (restoring) {
        await restoring.catch(() => {});
        // The latest refresh reads again after the pending snapshot, which may
        // predate a configuration change. Earlier refreshes are superseded.
        if (!disposed && generation === restoreGeneration) return restore();
        return;
      }
      restoring = aiTaskRequest(vibe64TemporaryConversationPath(apiPath, ownerSessionId, id), { method: "GET" })
        .finally(() => restorations.delete(key));
      restorations.set(key, restoring);
      const record = await restoring;
      if (disposed || generation !== restoreGeneration) return;
      restoreError.value = "";
      applyRecord(record.task ? record : null, { ownerSessionId, apiPath });
    } catch (error) {
      if (disposed || generation !== restoreGeneration) return;
      // A closed task has no conversation left to bind.
      if (error.conversationExpired) {
        restoreError.value = "";
        applyRecord(null, { ownerSessionId, apiPath });
        return;
      }
      if (error.code === "vibe64_agent_write_mode_busy") {
        restoreError.value = "";
        restoreRetryTimer = setTimeout(() => void restore(), 1000);
        return;
      }
      restoreError.value = error.message;
    }
  }

  function matchesSession(payload) {
    return !disposed && payload.projectSlug === toValue(projectSlug) && payload.sessionId === currentSessionId() &&
      Boolean(payload.conversationId);
  }

  function followRoute(current, route) {
    // A request still being delivered or run becomes this view's current one;
    // any other notice only asks for the saved state. A Send this view is
    // still delivering keeps its own id.
    const working = route.status === "working" || assistantRoutingStatusIsPending(route);
    const sending = current.pendingMessageId && current.delivery.find(current.pendingMessageId)?.status === "pending";
    updateConversation(current.id, { routingMetadata: { ...current.routingMetadata, assistant_routing_request: JSON.stringify(route) },
      ...(working ? { busy: true, messageId: sending ? current.pendingMessageId : route.messageId || current.messageId } : {}) });
    void current.binding.runtime.value.reload();
  }

  for (const event of [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT]) {
    useRealtimeEvent({ event, onEvent: () => void restore() });
  }
  // A conversation created or closed while this view was disconnected sent its
  // notice to nobody; the saved list is the authority once the connection returns.
  useRealtimeEvent({ event: "connect", onEvent: () => void restore() });
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} }) => matchesSession(payload) && payload.reason === "temporary-conversation-created" &&
      payload.conversationId === toValue(taskId) && !closedConversationIds.has(payload.conversationId) && !conversation.value,
    onEvent: () => void restore()
  });
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} }) => matchesSession(payload) && CONVERSATION_NOTICES.includes(payload.reason),
    onEvent: ({ payload }) => {
      const current = conversation.value?.conversationId === payload.conversationId ? conversation.value : null;
      if (payload.reason === "temporary-conversation-closed") {
        if (current) releaseConversation(current.id);
        else closedConversationIds.add(payload.conversationId);
      } else if (payload.reason === "temporary-conversation-renamed") void restore();
      else if (current && payload.assistantRoutingRequest) followRoute(current, payload.assistantRoutingRequest);
    }
  });
  watch([currentSessionId, currentSessionsApiPath, actorKey], () => {
    releaseAll();
    closedConversationIds.clear();
  }, { flush: "sync" });
  // Another task: its own conversation is read and bound.
  watch(() => toValue(taskId), (id) => {
    if (conversation.value && conversation.value.id !== id) releaseAll();
  }, { flush: "sync" });
  // Read the current readiness as well as future changes; mounting after
  // initialization must work without waiting for another connection event.
  watch([currentSessionId, currentSessionsApiPath, actorKey, () => toValue(assistantReady), () => toValue(taskId)],
    () => void restore(), { immediate: true });
  onBeforeUnmount(() => {
    // Removing a view never closes a conversation or interrupts its work,
    // and it still sends the drafts and settings its pending saves hold.
    flushPendingSaves();
    disposed = true;
    clearTimeout(restoreRetryTimer);
    restoreGeneration += 1;
    forgetQueuedSaves();
    conversation.value?.releaseBinding();
  });

  return {
    conversation,
    isDisposed,
    restore,
    restoreError,
    saves,
    stoppingIds
  };
}

export { useAiTaskConversationRecord };
