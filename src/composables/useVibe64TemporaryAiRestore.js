import { onBeforeUnmount, ref, watch } from "vue";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { useRealtimeEvent, useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { normalizeVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  vibe64TemporaryConversationsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { temporaryAiRequest, temporaryAiTurnIsActive } from "@/lib/vibe64TemporaryAiTasks.js";

/** @typedef {ReturnType<typeof import("./useVibe64TemporaryAiTaskRecords.js").useVibe64TemporaryAiTaskRecords>} TemporaryAiTaskRecords */

/**
 * Temporary AI's saved task list: restores it for the current session and
 * viewer, follows other views' changes to it, and releases it when the session
 * or viewer changes.
 * @param {object} options
 * @param {TemporaryAiTaskRecords} options.records the task records this composable updates
 */
function useVibe64TemporaryAiRestore({
  tasks,
  activeTaskId,
  open,
  closedConversationIds,
  projectSlug,
  actorKey,
  assistantReady,
  currentSessionId,
  currentSessionsApiPath,
  isDisposed,
  bindTask,
  records
}) {
  const {
    flushPendingSaves,
    forgetQueuedSaves,
    removeTask,
    updateTask
  } = records;
  const restorations = new Map();
  const restoreError = ref("");
  let restoreGeneration = 0;
  let restoreRetryTimer;

  async function restoreTasks() {
    clearTimeout(restoreRetryTimer);
    const generation = ++restoreGeneration;
    if (isDisposed() || !actorKey.value || !readRefOrGetterValue(assistantReady)) return;
    const ownerSessionId = currentSessionId();
    const apiPath = currentSessionsApiPath();
    if (!ownerSessionId || !apiPath) return;
    const persistedTasks = tasks.value.filter((task) => task.conversationId);
    try {
      const key = JSON.stringify([apiPath, ownerSessionId, actorKey.value]);
      let restoring = restorations.get(key);
      if (restoring) {
        await restoring.catch(() => {});
        // The latest refresh reads again after the pending snapshot, which may
        // predate a configuration change. Earlier refreshes are superseded.
        if (!isDisposed() && generation === restoreGeneration) return restoreTasks();
        return;
      }
      restoring = temporaryAiRequest(vibe64TemporaryConversationsPath(apiPath, ownerSessionId), { method: "GET" })
        .finally(() => restorations.delete(key));
      restorations.set(key, restoring);
      const response = await restoring;
      if (isDisposed() || generation !== restoreGeneration) return;
      restoreError.value = "";
      const records = response.conversations || [];
      for (const task of persistedTasks) {
        if (!records.some((record) => record.conversationId === task.conversationId)) removeTask(task.id);
      }
      for (const record of records) {
        if (closedConversationIds.has(record.conversationId)) continue;
        const existing = tasks.value.find((task) => task.conversationId === record.conversationId || task.id === record.conversationId);
        if (existing) {
          updateTask(existing.id, { purposes: record.purposes, canSteer: record.canSteer, title: record.title || "", number: record.number });
          continue;
        }
        const task = bindTask({
          ...record,
          id: record.conversationId,
          sessionId: ownerSessionId,
          apiPath,
          agentSettings: normalizeVibe64AgentSettings(record.agentSettings),
          attachments: record.attachments || [],
          pendingMessageId: "",
          draft: record.draft || "",
          draftSaveState: record.draft ? "saved" : "",
          messages: record.messages || [],
          unread: false,
          busy: temporaryAiTurnIsActive(record.status),
          nativeWorking: false,
          recoveryRetryKeys: record.recoveryRetryKeys || [],
          recoveryOutcome: record.recoveryOutcome === "checking" ? "unconfirmed" : record.recoveryOutcome,
          recoveryOutcomeMessage: record.recoveryOutcome === "checking"
            ? "The Update request was interrupted. Vibe64 is checking its saved result; do not start a second Update yet."
            : record.recoveryOutcomeMessage
        });
        tasks.value.push(task);
        if (!activeTaskId.value) activeTaskId.value = task.id;
      }
    } catch (error) {
      if (isDisposed() || generation !== restoreGeneration) return;
      if (error.code === "vibe64_agent_write_mode_busy") {
        restoreError.value = "";
        restoreRetryTimer = setTimeout(() => void restoreTasks(), 1000);
        return;
      }
      restoreError.value = `Temporary chats could not be restored: ${error.message}`;
      open.value = true;
    }
  }

  /** Stops every restore in progress, as removing the view does. */
  function stopRestoring() {
    clearTimeout(restoreRetryTimer);
    restoreGeneration += 1;
  }

  for (const event of [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT]) {
    useRealtimeEvent({ event, onEvent: () => void restoreTasks() });
  }
  // Chats created or closed while this view was disconnected sent their notice
  // to nobody; the saved list is the authority once the connection returns.
  const realtimeSocket = useRealtimeSocket({ required: false });
  const restoreAfterReconnect = () => void restoreTasks();
  realtimeSocket?.on?.("connect", restoreAfterReconnect);
  onBeforeUnmount(() => realtimeSocket?.off?.("connect", restoreAfterReconnect));
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} }) => (
      !isDisposed() && payload.projectSlug === projectSlug.value &&
      payload.sessionId === currentSessionId() && payload.reason === "temporary-conversation-created" &&
      Boolean(payload.conversationId) && !closedConversationIds.has(payload.conversationId) &&
      !tasks.value.some((task) => task.conversationId === payload.conversationId || task.id === payload.conversationId)
    ),
    onEvent: () => void restoreTasks()
  });
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} }) => (
      !isDisposed() && payload.projectSlug === projectSlug.value &&
      payload.sessionId === currentSessionId() && ["temporary-conversation-closed", "temporary-conversation-renamed", "assistant-routing-changed"].includes(payload.reason) &&
      Boolean(payload.conversationId)
    ),
    onEvent: ({ payload }) => {
      const task = tasks.value.find((candidate) => (
        candidate.conversationId === payload.conversationId || candidate.id === payload.conversationId
      ));
      if (payload.reason === "temporary-conversation-closed") removeTask(task?.id || payload.conversationId);
      else if (payload.reason === "temporary-conversation-renamed") void restoreTasks();
      else if (task && payload.assistantRoutingRequest) {
        const route = payload.assistantRoutingRequest;
        // A request still being delivered or run becomes this view's current one;
        // any other notice only asks for the saved state. A Send this view is
        // still delivering keeps its own id.
        const current = route.status === "working" || assistantRoutingStatusIsPending(route);
        const sending = task.pendingMessageId && task.delivery?.find(task.pendingMessageId)?.status === "pending";
        updateTask(task.id, { routingMetadata: { ...task.routingMetadata, assistant_routing_request: JSON.stringify(route) },
          ...(current ? { busy: true, messageId: sending ? task.pendingMessageId : route.messageId || task.messageId } : {}) });
        void task.binding.runtime.value.reload();
      }
    }
  });
  // Read the current readiness as well as future changes; mounting after
  // initialization must work without waiting for another connection event.
  watch([currentSessionId, currentSessionsApiPath, actorKey], (
    [ownerSessionId, apiPath, actor], [previousSessionId, previousApiPath, previousActor]
  ) => {
    if (ownerSessionId !== previousSessionId || apiPath !== previousApiPath || actor !== previousActor) {
      restoreGeneration += 1;
      restoreError.value = "";
      flushPendingSaves();
      forgetQueuedSaves();
      closedConversationIds.clear();
      for (const task of tasks.value) task.releaseBinding();
      tasks.value = [];
      activeTaskId.value = "";
      open.value = false;
    }
  }, { flush: "sync" });
  watch([currentSessionId, currentSessionsApiPath, actorKey, () => readRefOrGetterValue(assistantReady)],
    () => void restoreTasks(), { immediate: true });

  return {
    restoreError,
    restoreTasks,
    stopRestoring
  };
}

export { useVibe64TemporaryAiRestore };
