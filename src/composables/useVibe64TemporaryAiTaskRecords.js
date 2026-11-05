import {
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  temporaryAiRequest,
  temporaryAiRequestError,
  temporaryAiTaskPresentation,
  temporaryAiTaskView
} from "@/lib/vibe64TemporaryAiTasks.js";

/**
 * Temporary AI's task records and their saving: each change updates a task
 * and queues a save of its presentation, settings and attachments, creating
 * the task's conversation first when it has none.
 */
function useVibe64TemporaryAiTaskRecords({
  tasks,
  activeTaskId,
  open,
  closingTaskIds,
  closedConversationIds,
  isDisposed
}) {
  const saveTimers = new Map();
  const pendingSaveFields = new Map();
  // Fields of queued saves that have not sent their PATCH yet; a flush on view
  // removal sends them, since those saves stop once the view is gone.
  const unsentSaveFields = new Map();
  const saveVersions = new Map();
  const creations = new Map();
  const saves = new Map();

  function canApplyTaskResponse(task) {
    return !isDisposed() && tasks.value.some((current) => current.id === task.id && current.binding === task.binding);
  }

  function updateTask(taskId = "", update = {}) {
    if (Object.hasOwn(update, "draft") && !Object.hasOwn(update, "status")) {
      update = { ...update, draftSaveState: "saving" };
    }
    tasks.value = tasks.value.map((task) => {
      if (task.id !== taskId) return task;
      if (Object.hasOwn(update, "draft")) task.draft = update.draft;
      if (Object.hasOwn(update, "attachments")) task.attachments = update.attachments;
      return temporaryAiTaskView({ ...task, ...update });
    });
    const task = tasks.value.find((task) => task.id === taskId) || null;
    const changed = ["draft", "agentSettings", "attachments"].filter(key => Object.hasOwn(update, key));
    if (task && !Object.hasOwn(update, "status") && changed.length) {
      saveVersions.set(taskId, {
        draft: (saveVersions.get(taskId)?.draft || 0) + (changed.includes("draft") ? 1 : 0)
      });
      const pending = pendingSaveFields.get(taskId) || new Set();
      for (const key of changed) pending.add(key);
      pendingSaveFields.set(taskId, pending);
      scheduleSave(taskId);
    }
    return task;
  }

  async function ensureConversation(task) {
    const current = tasks.value.find((candidate) => candidate.id === task.id);
    if (!current) throw temporaryAiRequestError({ code: "vibe64_conversation_closed" });
    if (current.conversationId) return current.conversationId;
    if (creations.has(task.id)) return creations.get(task.id);
    const creation = temporaryAiRequest(vibe64TemporaryConversationsPath(task.apiPath, task.sessionId), {
      method: "POST",
      body: {
        conversationId: task.id,
        ...(task.includeRecentChatContext ? { includeRecentChatContext: true } : {}),
        agentSettings: current.agentSettings,
        presentation: temporaryAiTaskPresentation(current)
      }
    }).then((created) => {
      if (canApplyTaskResponse(task)) updateTask(task.id, { conversationId: created.conversationId, number: created.number, assistantSelection: created.assistantSelection,
        routingMetadata: created.routingMetadata, recentChatContext: created.recentChatContext, purposes: created.purposes, goal: created.goal || null });
      return created.conversationId;
    });
    creations.set(task.id, creation);
    try {
      return await creation;
    } finally {
      creations.delete(task.id);
    }
  }

  function scheduleSave(taskId, delayMs = 250) {
    clearTimeout(saveTimers.get(taskId));
    saveTimers.set(taskId, setTimeout(() => {
      saveTimers.delete(taskId);
      void saveTask(taskId);
    }, delayMs));
  }

  // A flush is the last save of a view being removed or switched away: it reads
  // everything it sends now, before the bindings are released, and sends it
  // without the view-current checks. Responses are never applied to the view.
  async function saveTask(taskId, { flush = false } = {}) {
    const currentTask = tasks.value.find((candidate) => candidate.id === taskId);
    // Keep the original queued PATCH's invocation snapshot now that draft and
    // attachments are accessors over the retained binding.
    const task = currentTask && { ...currentTask };
    if (!task || (isDisposed() && !flush) || closingTaskIds.has(taskId) || task.state === "closing") return;
    const fields = new Set(pendingSaveFields.get(taskId) || []);
    if (flush) for (const queued of unsentSaveFields.get(taskId) || []) for (const key of queued) fields.add(key);
    if (!fields.size) return;
    const version = saveVersions.get(taskId);
    pendingSaveFields.delete(taskId);
    const unsent = unsentSaveFields.get(taskId) || new Set();
    unsent.add(fields);
    unsentSaveFields.set(taskId, unsent);
    const markSent = () => {
      unsent.delete(fields);
      if (!unsent.size && unsentSaveFields.get(taskId) === unsent) unsentSaveFields.delete(taskId);
    };
    const savedPresentation = temporaryAiTaskPresentation(task, fields);
    const savedSettings = fields.has("agentSettings") && task.settingsToSave;
    const attachmentIds = fields.has("attachments") ? task.attachments.map((attachment) => attachment.attachmentId) : null;
    const flushConversation = flush ? ensureConversation(task) : null;
    flushConversation?.catch(() => {});
    const previous = saves.get(taskId);
    const operation = (async () => {
      await previous;
      if (!flush && (!canApplyTaskResponse(task) || tasks.value.find(candidate => candidate.id === taskId)?.state === "closing")) return false;
      const conversationId = await (flushConversation || ensureConversation(task));
      if (!flush && !canApplyTaskResponse(task)) return;
      markSent();
      const saved = await temporaryAiRequest(vibe64TemporaryConversationPath(task.apiPath, task.sessionId, conversationId), {
        method: "PATCH",
        body: {
          ...(Object.keys(savedPresentation).length ? { presentation: savedPresentation } : {}),
          ...(savedSettings ? { agentSettings: savedSettings } : {}),
          ...(attachmentIds ? { attachmentIds } : {})
        }
      });
      if (saved?.routingMetadata && canApplyTaskResponse(task)) {
        updateTask(taskId, { routingMetadata: saved.routingMetadata, purposes: saved.purposes });
      }
      if (canApplyTaskResponse(task) && savedSettings) void task.binding.runtime.value.reload();
      const current = tasks.value.find((candidate) => candidate.id === taskId);
      if (canApplyTaskResponse(task) && savedSettings && current.settingsToSave === savedSettings) {
        updateTask(taskId, { settingsToSave: null });
      }
      if (canApplyTaskResponse(task) && fields.has("draft") && version?.draft === saveVersions.get(taskId)?.draft) {
        updateTask(taskId, { draftSaveState: "saved",
          ...(current?.error?.startsWith("Draft could not be saved:") ? { error: "" } : {}) });
      }
      if (canApplyTaskResponse(task) && version === saveVersions.get(taskId) && !pendingSaveFields.get(taskId)?.size &&
          current?.error?.startsWith("Conversation state could not be saved:")) {
        updateTask(taskId, { error: "" });
      }
      return true;
    })().catch((error) => {
      if (!canApplyTaskResponse(task)) return;
      const pending = pendingSaveFields.get(taskId) || new Set();
      for (const key of fields) pending.add(key);
      pendingSaveFields.set(taskId, pending);
      if (error.code === "vibe64_conversation_closed") {
        removeTask(taskId);
        return;
      }
      if (error.code === "vibe64_conversation_closing") {
        pendingSaveFields.delete(taskId);
        updateTask(taskId, { state: "closing", draftSaveState: "failed", error: "This conversation is closing; retry Close after cleanup." });
        return false;
      }
      if ((fields.has("draft") && version?.draft === saveVersions.get(taskId)?.draft) || version === saveVersions.get(taskId)) updateTask(taskId, {
        ...(fields.has("draft") ? { draftSaveState: "failed" } : {}),
        error: `${fields.has("draft") ? "Draft" : "Conversation state"} could not be saved: ${error.message}` });
      if (error.code === "vibe64_agent_write_mode_busy" && !closingTaskIds.has(taskId)) {
        scheduleSave(taskId, 1000);
      }
      return false;
    });
    saves.set(taskId, operation);
    try {
      return await operation;
    } finally {
      markSent();
      if (saves.get(taskId) === operation) saves.delete(taskId);
    }
  }

  // Saves still waiting for their timer or for an earlier save. A Send cancels
  // its draft's timer because the dispatched message carries that draft.
  function flushPendingSaves() {
    for (const taskId of new Set([...saveTimers.keys(), ...unsentSaveFields.keys()])) void saveTask(taskId, { flush: true });
  }

  /** Drops the task's queued save, as a Send or Close does. */
  function cancelScheduledSave(taskId) {
    clearTimeout(saveTimers.get(taskId));
    saveTimers.delete(taskId);
  }

  /** The task's save in flight, if any. */
  function saveInFlight(taskId) {
    return saves.get(taskId);
  }

  /** The task's conversation creation in flight, if any. */
  function creationInFlight(taskId) {
    return creations.get(taskId);
  }

  /** Forgets every queued save once the view's tasks are released. */
  function forgetQueuedSaves() {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    pendingSaveFields.clear();
    saveVersions.clear();
  }

  function removeTask(taskId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    closedConversationIds.add(task?.conversationId || taskId);
    clearTimeout(saveTimers.get(taskId));
    saveTimers.delete(taskId);
    pendingSaveFields.delete(taskId);
    saveVersions.delete(taskId);
    task?.releaseBinding();
    tasks.value = tasks.value.filter((candidate) => candidate.id !== taskId);
    if (activeTaskId.value === taskId) activeTaskId.value = tasks.value[0]?.id || "";
    if (!tasks.value.length) open.value = false;
  }

  return {
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
  };
}

export { useVibe64TemporaryAiTaskRecords };
