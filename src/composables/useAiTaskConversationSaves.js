import { vibe64AiTaskConversationPath } from "@/lib/vibe64SessionRequestConfig.js";
import { aiTaskConversationView, aiTaskRequest } from "@/lib/vibe64AiTaskConversation.js";

/** The changes a save sends: the draft as presentation, the agent settings, and the draft's attachments. */
const SAVED_FIELDS = ["draft", "agentSettings", "attachments"];

/**
 * The AI task conversation's record and its saves: each change updates the conversation and queues a save of
 * its draft, settings and attachments.
 * @param {object} options
 * @param {import("vue").ShallowRef<object | null>} options.conversation the bound conversation, read through its view
 * @param {Set<string>} options.closedConversationIds conversations closed while this view knew them
 * @param {() => boolean} options.isDisposed
 */
function useAiTaskConversationSaves({ conversation, closedConversationIds, isDisposed }) {
  const saveTimers = new Map();
  const pendingSaveFields = new Map();
  // Fields of queued saves that have not sent their PATCH yet; a flush on view
  // removal sends them, since those saves stop once the view is gone.
  const unsentSaveFields = new Map();
  const saveVersions = new Map();
  const saves = new Map();

  /** Whether a response for this conversation still belongs to the one bound now. */
  function canApply(value) {
    return !isDisposed() && conversation.value?.id === value.id && conversation.value.binding === value.binding;
  }

  /**
   * @param {string} id the conversation the update is for; another conversation's update is dropped
   * @param {object} update
   */
  function updateConversation(id, update) {
    const current = conversation.value;
    if (current?.id !== id) return null;
    const saving = Object.hasOwn(update, "draft") && !Object.hasOwn(update, "status");
    const next = saving ? { ...update, draftSaveState: "saving" } : update;
    if (Object.hasOwn(next, "draft")) current.draft = next.draft;
    if (Object.hasOwn(next, "attachments")) current.attachments = next.attachments;
    conversation.value = aiTaskConversationView({ ...current, ...next });
    const changed = SAVED_FIELDS.filter(key => Object.hasOwn(next, key));
    if (!Object.hasOwn(next, "status") && changed.length) {
      saveVersions.set(id, { draft: (saveVersions.get(id)?.draft || 0) + (changed.includes("draft") ? 1 : 0) });
      const pending = pendingSaveFields.get(id) || new Set();
      for (const key of changed) pending.add(key);
      pendingSaveFields.set(id, pending);
      scheduleSave(id);
    }
    return conversation.value;
  }

  function scheduleSave(id, delayMs = 250) {
    clearTimeout(saveTimers.get(id));
    saveTimers.set(id, setTimeout(() => {
      saveTimers.delete(id);
      void saveConversation(id);
    }, delayMs));
  }

  function failSave(value, fields, version, error) {
    const { id } = value;
    const pending = pendingSaveFields.get(id) || new Set();
    for (const key of fields) pending.add(key);
    pendingSaveFields.set(id, pending);
    if (error.code === "vibe64_conversation_closed") {
      releaseConversation(id);
      return false;
    }
    if (error.code === "vibe64_conversation_closing") {
      pendingSaveFields.delete(id);
      updateConversation(id, { state: "closing", draftSaveState: "failed", error: "This conversation is closing." });
      return false;
    }
    if ((fields.has("draft") && version?.draft === saveVersions.get(id)?.draft) || version === saveVersions.get(id)) {
      updateConversation(id, {
        ...(fields.has("draft") ? { draftSaveState: "failed" } : {}),
        error: `${fields.has("draft") ? "Draft" : "Conversation state"} could not be saved: ${error.message}`
      });
    }
    if (error.code === "vibe64_agent_write_mode_busy") scheduleSave(id, 1000);
    return false;
  }

  function acceptSave(value, fields, version, { saved, savedSettings }) {
    const { id } = value;
    if (saved?.routingMetadata) updateConversation(id, { routingMetadata: saved.routingMetadata, purposes: saved.purposes });
    if (savedSettings) void value.binding.runtime.value.reload();
    const current = conversation.value;
    if (savedSettings && current.settingsToSave === savedSettings) updateConversation(id, { settingsToSave: null });
    if (fields.has("draft") && version?.draft === saveVersions.get(id)?.draft) {
      updateConversation(id, { draftSaveState: "saved",
        ...(current.error?.startsWith("Draft could not be saved:") ? { error: "" } : {}) });
    }
    if (version === saveVersions.get(id) && !pendingSaveFields.get(id)?.size &&
        current.error?.startsWith("Conversation state could not be saved:")) {
      updateConversation(id, { error: "" });
    }
  }

  /**
   * Saves the conversation's changed fields. A flush is the last save of a view being removed or switched
   * away: it reads everything it sends now, before the binding is released, and sends it without the
   * view-current checks. Its response is never applied to the view.
   */
  async function saveConversation(id, { flush = false } = {}) {
    // Keep the queued PATCH's invocation snapshot, since draft and attachments are read from the binding.
    const value = conversation.value?.id === id ? { ...conversation.value } : null;
    if (!value || (isDisposed() && !flush) || value.state === "closing") return;
    const fields = new Set(pendingSaveFields.get(id) || []);
    if (flush) for (const queued of unsentSaveFields.get(id) || []) for (const key of queued) fields.add(key);
    if (!fields.size) return;
    const version = saveVersions.get(id);
    pendingSaveFields.delete(id);
    const unsent = unsentSaveFields.get(id) || new Set();
    unsent.add(fields);
    unsentSaveFields.set(id, unsent);
    const markSent = () => {
      unsent.delete(fields);
      if (!unsent.size && unsentSaveFields.get(id) === unsent) unsentSaveFields.delete(id);
    };
    const savedSettings = fields.has("agentSettings") && value.settingsToSave;
    const body = {
      ...(fields.has("draft") ? { presentation: { draft: value.draft } } : {}),
      ...(savedSettings ? { agentSettings: savedSettings } : {}),
      ...(fields.has("attachments") ? { attachmentIds: value.attachments.map((attachment) => attachment.attachmentId) } : {})
    };
    const previous = saves.get(id);
    const operation = (async () => {
      await previous;
      if (!flush && (!canApply(value) || conversation.value.state === "closing")) return false;
      markSent();
      const saved = await aiTaskRequest(vibe64AiTaskConversationPath(value.apiPath, value.sessionId, value.conversationId), {
        method: "PATCH", body
      });
      if (canApply(value)) acceptSave(value, fields, version, { saved, savedSettings });
      return true;
    })().catch((error) => canApply(value) ? failSave(value, fields, version, error) : undefined);
    saves.set(id, operation);
    try {
      return await operation;
    } finally {
      markSent();
      if (saves.get(id) === operation) saves.delete(id);
    }
  }

  /** Sends the saves still waiting for their timer or for an earlier save. */
  function flushPendingSaves() {
    for (const id of new Set([...saveTimers.keys(), ...unsentSaveFields.keys()])) void saveConversation(id, { flush: true });
  }

  /** Drops the conversation's queued save, as a Send does: the message carries the draft. */
  function cancelScheduledSave(id) {
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
  }

  /** The conversation's save in flight, if any. */
  function saveInFlight(id) {
    return saves.get(id);
  }

  /** Forgets every queued save once the view's conversation is released. */
  function forgetQueuedSaves() {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    pendingSaveFields.clear();
    saveVersions.clear();
  }

  /** Releases the conversation the server closed, and ignores it from now on. */
  function releaseConversation(id) {
    const current = conversation.value;
    if (current?.id !== id) return;
    closedConversationIds.add(current.conversationId);
    cancelScheduledSave(id);
    pendingSaveFields.delete(id);
    saveVersions.delete(id);
    current.releaseBinding();
    conversation.value = null;
  }

  return {
    canApply,
    cancelScheduledSave,
    flushPendingSaves,
    forgetQueuedSaves,
    releaseConversation,
    saveInFlight,
    updateConversation
  };
}

export { useAiTaskConversationSaves };
