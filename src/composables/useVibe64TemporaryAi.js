import { computed, inject, markRaw, onBeforeUnmount, ref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import {
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import { useAssistantConversationFactory } from "@jskit-ai/assistant-runtime/client";
import { vibe64AssistantConversationOptions } from "@/lib/vibe64AssistantConversation.js";
import { temporaryConversationId } from "@local/vibe64-sessions/shared/conversation";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { vibe64TemporaryConversationPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  temporaryAiId,
  temporaryAiMessages,
  temporaryAiRequest,
  temporaryAiTaskView,
  temporaryAiTurnIsActive
} from "@/lib/vibe64TemporaryAiTasks.js";
import { useVibe64TemporaryAiMessages } from "@/composables/useVibe64TemporaryAiMessages.js";
import { useVibe64TemporaryAiRestore } from "@/composables/useVibe64TemporaryAiRestore.js";
import { useVibe64TemporaryAiTaskRecords } from "@/composables/useVibe64TemporaryAiTaskRecords.js";

/**
 * @typedef {object} TemporaryAiFinishedTask What a finished temporary chat reports to its view.
 * @property {string} error
 * @property {string} id
 * @property {string} outcomeKind
 * @property {string} runId
 * @property {string} sessionId
 * @property {string} status
 * @property {string} title
 */

/**
 * The person's temporary chats in one session: their tabs, drafts, settings and attachments, sending, Stop and
 * Close, restored from the saved list for the session and viewer.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.active] whether the workspace's view is the selected one
 * @param {import("vue").MaybeRefOrGetter<object>} [options.agentSettings] the agent settings a new chat starts with
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.assistantReady] whether the session's conversations can open
 * @param {(task: TemporaryAiFinishedTask) => void} options.onTaskFinished called once a busy chat's turn ends
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.operationBusy] whether repository work holds the session
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 */
function useVibe64TemporaryAi({
  active = () => true,
  agentSettings = () => defaultVibe64AgentSettings(),
  assistantReady = () => false,
  onTaskFinished,
  operationBusy = () => false,
  sessionId,
  sessionsApiPath
}) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  const closedConversationIds = new Set();
  const projectSlug = useVibe64ProjectSlug();
  /** @type {import("@/lib/vibe64AssistantHost.js").AssistantViewerSource} */
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, LOCAL_ASSISTANT_VIEWER);
  const actorKey = computed(() => readRefOrGetterValue(viewer)?.actorKey || "");
  const acquireConversation = useAssistantConversationFactory({
    ...vibe64AssistantConversationOptions(),
    actorKey: () => actorKey.value, queueWhileSending: true, clearDraftOn: "dispatch",
    presentation: { assistantLabel: "Temporary AI", variant: "task", visible: true, userMessageFormat: "plain", systemLabel: "System" }
  });
  const closingTaskIds = new Set();
  const stoppingTaskIds = new Set();
  let disposed = false;
  const isDisposed = () => disposed;
  const records = useVibe64TemporaryAiTaskRecords({
    tasks, activeTaskId, open, closingTaskIds, closedConversationIds, isDisposed
  });
  const {
    canApplyTaskResponse,
    cancelScheduledSave,
    creationInFlight,
    ensureConversation,
    flushPendingSaves,
    forgetQueuedSaves,
    removeTask,
    saveInFlight,
    saveTask,
    updateTask
  } = records;

  const activeTask = computed(() => (
    tasks.value.find((task) => task.id === activeTaskId.value) || tasks.value[0] || null
  ));
  const visibleTaskId = computed(() => (
    readRefOrGetterValue(active) && open.value ? activeTask.value?.id || "" : ""
  ));
  const hasUnreadMessages = computed(() => tasks.value.some((task) => task.unread));
  watch(visibleTaskId, (taskId) => {
    if (taskId) updateTask(taskId, { unread: false });
  }, { immediate: true });

  function currentSessionId() {
    return normalizeText(readRefOrGetterValue(sessionId));
  }

  function currentSessionsApiPath() {
    return normalizeText(readRefOrGetterValue(sessionsApiPath));
  }

  function bindTask(value) {
    const taskId = value.id;
    let binding;
    binding = markRaw(acquireConversation({
      conversationId: temporaryConversationId({ projectSlug: projectSlug.value, sessionId: value.sessionId, conversationId: taskId }),
      active: () => !disposed && Boolean(tasks.value.find(task => task.id === taskId && task.binding === binding)?.conversationId)
    }));
    const runtime = binding.runtime.value;
    runtime.draft.value = value.draft || "";
    runtime.draftAttachments.value = value.attachments || [];
    let observedSnapshot = false;
    const stop = watch([runtime.snapshot, runtime.turns, runtime.error, () => runtime.delivery.state.sending],
      ([snapshot, turns, error, sending], [, previousTurns = []] = []) => {
        const task = tasks.value.find(task => task.id === taskId && task.binding === binding);
        if (!task || disposed) return;
        // Restore's saved messages are its original unread baseline; any new
        // native reply in the first canonical read is still a new reply.
        const previous = observedSnapshot ? temporaryAiMessages(previousTurns) : value.messages || [];
        if (snapshot) observedSnapshot = true;
        const messages = temporaryAiMessages(turns);
        const newReply = messages.some(message => message.role === "assistant" && normalizeText(message.text) &&
          !previous.some(old => old.id === message.id && old.text === message.text));
        const observed = snapshot?.presentation;
        // Original reads cannot finish a stopped request or undo its cleared
        // error. A subsequent Send (or routing admission) marks the task busy.
        const canApplyProgress = !closingTaskIds.has(taskId) && !stoppingTaskIds.has(taskId) &&
          !(task.status === "interrupted" && !task.busy);
        const update = { unread: visibleTaskId.value !== taskId && (task.unread === true || newReply) };
        if (observed) {
          for (const field of ["routingMetadata", "purposes", "canSteer", "assistantSelection", "goal"]) {
            if (Object.hasOwn(observed, field)) update[field] = observed[field];
          }
          // Only the server's turn report can show the assistant as working;
          // local Send state and request fences never do. A deferred read
          // reports the saved record, so it counts as much as a reconciled one.
          if (!observed.readError) {
            update.nativeWorking = temporaryAiTurnIsActive(normalizeText(observed.status));
          }
          const route = assistantRoutingRequestForDisplay(observed.routingMetadata);
          // A pre-Send read cannot finish a newer request while preparation runs,
          // but a request the saved transcript has followed with a later one
          // (from any view) is no longer current.
          const requests = (snapshot.conversationLog || []).map(turn => turn.user?.messageId).filter(Boolean);
          const superseded = requests.includes(task.messageId) && requests.at(-1) !== task.messageId;
          const sameRequest = !task.messageId || superseded || observed.messageId === task.messageId || route?.messageId === task.messageId;
          if (canApplyProgress && !sending && (!task.busy || sameRequest)) {
            if (superseded && observed.messageId) update.messageId = observed.messageId;
            if (!observed.readError) {
              update.status = normalizeText(observed.status) || task.status;
              update.busy = temporaryAiTurnIsActive(update.status);
              update.phase = update.busy ? normalizeText(snapshot.phase) : "";
              update.runId = observed.runId || task.runId;
              update.outcomeKind = normalizeText(observed.outcome?.kind);
            }
            if (!observed.deferredReconciliation) update.error = normalizeText(observed.error || error);
          }
          if (snapshot.pendingRequest && !task.pendingMessageId) update.pendingMessageId = snapshot.pendingRequest.messageId;
        } else if (error && canApplyProgress) update.error = error;
        const finished = task.busy && update.busy === false && update.status !== "interrupted";
        updateTask(taskId, update);
        if (finished) reportTaskFinished(taskId);
      }, { flush: "sync" });
    return temporaryAiTaskView({ ...value, binding, releaseBinding: markRaw(() => { stop(); binding.release(); }) });
  }

  function reportTaskFinished(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    try {
      onTaskFinished(Object.freeze({
        error: normalizeText(task.error),
        id: task.id,
        outcomeKind: normalizeText(task.outcomeKind),
        runId: task.runId,
        sessionId: task.sessionId,
        status: normalizeText(task.status),
        title: task.label
      }));
    } catch {
      // Feedback must never interfere with the completed task state.
    }
  }

  function openTask({
    draft = "",
    includeRecentChatContext = false,
    title = ""
  } = {}) {
    const task = bindTask({
      includeRecentChatContext,
      agentSettings: normalizeVibe64AgentSettings(readRefOrGetterValue(agentSettings)),
      apiPath: currentSessionsApiPath(),
      attachments: [],
      busy: false,
      nativeWorking: false,
      conversationId: "",
      draft: normalizeText(draft),
      error: "",
      id: temporaryAiId("temporary-ai"),
      messages: [],
      unread: false,
      pendingMessageId: "",
      runId: "",
      sessionId: currentSessionId(),
      status: "ready",
      title: normalizeText(title),
      // Provisional until creation, when the server assigns the saved number.
      number: Math.max(0, ...tasks.value.map((candidate) => candidate.number || 0)) + 1
    });
    tasks.value = [...tasks.value, task];
    activeTaskId.value = task.id;
    open.value = true;
    if (task.draft) updateTask(task.id, { draft: task.draft });
    return task;
  }

  async function createTask(options = {}) {
    const task = tasks.value.find(value => value.id === options.taskId) || openTask(options);
    try {
      await ensureConversation(task);
      if (canApplyTaskResponse(task)) updateTask(task.id, { error: "" });
      return task;
    } catch (error) {
      if (canApplyTaskResponse(task)) updateTask(task.id, { error: error.message });
      error.taskId = task.id;
      throw error;
    }
  }

  function selectTask(taskId = "") {
    if (tasks.value.some((task) => task.id === taskId)) {
      activeTaskId.value = taskId;
      open.value = true;
    }
  }

  function showWorkspace() {
    if (tasks.value.length === 0) {
      return openTask();
    }
    if (!tasks.value.some((task) => task.id === activeTaskId.value)) {
      activeTaskId.value = tasks.value[0].id;
    }
    open.value = true;
    return activeTask.value;
  }

  async function renameTask(taskId = "", title = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const conversationId = await ensureConversation(task);
    const result = await temporaryAiRequest(vibe64TemporaryConversationPath(task.apiPath, task.sessionId, conversationId), {
      method: "PATCH", body: { presentation: { title } }
    });
    if (canApplyTaskResponse(task)) updateTask(taskId, { title: result.title });
  }

  function updateDraft(taskId = "", draft = "") {
    updateTask(taskId, { draft: String(draft || "") });
  }

  async function updateRouting(taskId, preferences) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const conversationId = await ensureConversation(task);
    const result = await temporaryAiRequest(vibe64TemporaryConversationPath(task.apiPath, task.sessionId, conversationId), {
      method: "PATCH", body: { assistantRouting: preferences }
    });
    if (canApplyTaskResponse(task)) {
      updateTask(taskId, { routingMetadata: result.routingMetadata, purposes: result.purposes });
      void task.binding.runtime.value.reload();
    }
    return result;
  }

  function updateAgentSetting(taskId = "", parameterId = "", value = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    const settings = normalizeVibe64AgentSettings({ ...task.agentSettings, [parameterId]: value });
    updateTask(taskId, { agentSettings: settings, settingsToSave: settings });
  }

  function updateAttachments(taskId = "", attachments = []) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    updateTask(taskId, {
      attachments: Array.isArray(attachments) ? attachments : []
    });
  }

  async function closeTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || stoppingTaskIds.has(taskId)) {
      return;
    }
    if (readRefOrGetterValue(operationBusy)) {
      throw new Error("Wait for the current repository work to finish before closing this chat.");
    }
    closingTaskIds.add(taskId);
    try {
      cancelScheduledSave(taskId);
      const save = saveInFlight(taskId);
      if (save) await save;
      const conversationId = task.conversationId || (creationInFlight(taskId) ? await creationInFlight(taskId) : "");
      if (conversationId) {
        await temporaryAiRequest(
          vibe64TemporaryConversationPath(
            task.apiPath,
            task.sessionId,
            conversationId
          ),
          { method: "DELETE" }
        );
      }
      if (disposed) return;
      removeTask(taskId);
    } catch (error) {
      if (!canApplyTaskResponse(task)) return;
      updateTask(taskId, { error: error.message });
      throw error;
    } finally {
      closingTaskIds.delete(taskId);
    }
  }

  function closeWorkspace() {
    open.value = false;
  }

  const { cancelMessage, editMessage, send, stopTask } = useVibe64TemporaryAiMessages({
    tasks, closingTaskIds, stoppingTaskIds, isDisposed, operationBusy, records, reportTaskFinished, updateDraft
  });
  const { restoreError, restoreTasks, stopRestoring } = useVibe64TemporaryAiRestore({
    tasks, activeTaskId, open, closedConversationIds, projectSlug, actorKey, assistantReady,
    currentSessionId, currentSessionsApiPath, isDisposed, bindTask, records
  });
  onBeforeUnmount(() => {
    // Removing a view never closes a conversation or interrupts native work,
    // and it still sends the drafts and settings its pending saves hold.
    flushPendingSaves();
    disposed = true;
    stopRestoring();
    forgetQueuedSaves();
    for (const task of tasks.value) task.releaseBinding();
  });

  return {
    activeTask,
    activeTaskId,
    closeTask,
    closeWorkspace,
    createTask,
    cancelMessage,
    editMessage,
    hasUnreadMessages,
    open,
    openTask,
    renameTask,
    saveTask,
    restoreError,
    restoreTasks,
    selectTask,
    send,
    showWorkspace,
    stopTask,
    tasks,
    updateAgentSetting,
    updateAttachments,
    updateDraft,
    updateRouting
  };
}

export {
  temporaryAiTurnIsActive,
  useVibe64TemporaryAi
};
