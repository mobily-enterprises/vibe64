import { assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";
import { computed, hasInjectionContext, inject, onBeforeUnmount, ref, watch } from "vue";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings,
  VIBE64_AGENT_TASK_RESULT_SCHEMA
} from "@local/vibe64-runtime/shared";

import { chatMessagePayload } from "@/lib/vibe64ChatMessage.js";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath,
  vibe64TemporaryConversationStopPath,
  vibe64TemporaryConversationTurnsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const TEMPORARY_AI_POLL_INTERVAL_MS = 650;

function temporaryAiId(prefix = "temporary") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function temporaryAiText(value = "") {
  return String(value || "").trim();
}

function temporaryAiRequestError(response = {}, fallback = "Temporary AI request failed.") {
  return Object.assign(new Error(vibe64ApiResponseError(response, fallback)), {
    code: temporaryAiText(response.code),
    conversationExpired: response.conversationExpired === true || response.code === "vibe64_conversation_closed",
    status: temporaryAiText(response.status)
  });
}

function temporaryAiTurnIsActive(status = "") {
  const normalizedStatus = temporaryAiText(status);
  return ["starting", "inProgress"].includes(normalizedStatus) || assistantRoutingStatusIsPending(normalizedStatus);
}

function temporaryAiProgressUpdates(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((update = {}, index) => ({
    id: temporaryAiText(update.id) || `progress:${index + 1}`,
    text: temporaryAiText(update.text)
  })).filter((update) => update.text);
}

function temporaryAiTurnMessages(messages = [], runId = "", update = {}) {
  return messages.map((message) => (
    message.runId === runId && message.role === "assistant"
      ? { ...message, ...update }
      : message
  ));
}

function useVibe64TemporaryAi({
  active = () => true,
  agentSettings = () => defaultVibe64AgentSettings(),
  assistantReady = () => false,
  onTaskFinished = null,
  operationBusy = () => false,
  sessionId,
  sessionsApiPath
} = {}) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  const pollTimers = new Map();
  const pendingPolls = new Set();
  const restorations = new Map();
  const saveTimers = new Map();
  const creations = new Map();
  const saves = new Map();
  const closedConversationIds = new Set();
  const projectSlug = useVibe64ProjectSlug();
  const viewer = hasInjectionContext() ? inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" }) : { actorKey: "local" };
  const actorKey = computed(() => readRefOrGetterValue(viewer)?.actorKey || "");
  const restoreError = ref("");
  let restoreGeneration = 0;
  let restoreRetryTimer;
  const closingTaskIds = new Set();
  const stoppingTaskIds = new Set();
  let disposed = false;
  let nextTaskNumber = 1;

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
  const updateRepairTask = computed(() => [...tasks.value].reverse().find((task) => (
    task.sessionId === currentSessionId() && task.recoveryOperation === "update" &&
    task.recoveryOutcome !== "succeeded"
  )) || null);

  function currentSessionId() {
    return temporaryAiText(readRefOrGetterValue(sessionId));
  }

  function currentSessionsApiPath() {
    return temporaryAiText(readRefOrGetterValue(sessionsApiPath));
  }

  function canApplyTaskResponse(task) {
    return !disposed && tasks.value.some((current) => current.id === task.id && current.delivery === task.delivery);
  }

  function updateTask(taskId = "", update = {}) {
    tasks.value = tasks.value.map((task) => {
      if (task.id !== taskId) return task;
      const updated = { ...task, ...update };
      if (update.messages) {
        const newReply = update.messages.some((message) => (
          message.role === "assistant" && temporaryAiText(message.text) &&
          !task.messages.some((old) => old.id === message.id && old.text === message.text)
        ));
        updated.unread = visibleTaskId.value !== taskId && (task.unread === true || newReply);
      }
      return updated;
    });
    const task = tasks.value.find((task) => task.id === taskId) || null;
    const draftChanged = ["draft", "agentSettings", "attachments", "recoveryOutcome", "recoveryRetryKeys"]
      .some((key) => Object.hasOwn(update, key));
    if (task && !Object.hasOwn(update, "status") && draftChanged) {
      scheduleSave(taskId);
    }
    return task;
  }

  function taskPresentation(task) {
    const fields = ["title", "draft", "displayMessage", "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage",
      "recoveryNotice", "recoveryOperation", "recoveryConflictId", "recoveryContext", "recoveryOutcome",
      "recoveryOutcomeMessage", "recoveryAutoPaused", "recoveryRetryKeys", "runConflictId"];
    return Object.fromEntries(fields.map((key) => [key, task[key]]));
  }

  async function ensureConversation(task) {
    const current = tasks.value.find((candidate) => candidate.id === task.id);
    if (!current) throw temporaryAiRequestError({ code: "vibe64_conversation_closed" });
    if (current.conversationId) return current.conversationId;
    if (creations.has(task.id)) return creations.get(task.id);
    const creation = request(vibe64TemporaryConversationsPath(task.apiPath, task.sessionId), {
      method: "POST",
      body: {
        conversationId: task.id,
        ...(task.initialRouting ? { assistantRouting: task.initialRouting } : {}),
        agentSettings: task.agentSettings,
        presentation: taskPresentation(task)
      }
    }).then((created) => {
      if (canApplyTaskResponse(task)) updateTask(task.id, { conversationId: created.conversationId, assistantSelection: created.assistantSelection,
        routingMetadata: created.routingMetadata, purposes: created.purposes, goal: created.goal || null });
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

  async function saveTask(taskId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task || disposed || closingTaskIds.has(taskId)) return;
    const previous = saves.get(taskId);
    const operation = (async () => {
      await previous;
      if (!canApplyTaskResponse(task)) return;
      const conversationId = await ensureConversation(task);
      if (!canApplyTaskResponse(task)) return;
      const saved = await request(vibe64TemporaryConversationPath(task.apiPath, task.sessionId, conversationId), {
        method: "PATCH",
        body: {
          presentation: taskPresentation(task),
          ...(task.settingsToSave ? { agentSettings: task.settingsToSave } : {}),
          attachmentIds: task.attachments.map((attachment) => attachment.attachmentId)
        }
      });
      if (saved?.routingMetadata && canApplyTaskResponse(task)) {
        updateTask(taskId, { routingMetadata: saved.routingMetadata, purposes: saved.purposes });
      }
      const current = tasks.value.find((candidate) => candidate.id === taskId);
      if (canApplyTaskResponse(task) && current.settingsToSave === task.settingsToSave) {
        updateTask(taskId, { settingsToSave: null });
      }
      if (!disposed && current?.error?.startsWith("Draft could not be saved:")) {
        updateTask(taskId, { error: "" });
      }
    })().catch((error) => {
      if (!canApplyTaskResponse(task)) return;
      if (error.code === "vibe64_conversation_closed") {
        removeTask(taskId);
        return;
      }
      updateTask(taskId, { error: `Draft could not be saved: ${error.message}` });
      if (error.code === "vibe64_agent_write_mode_busy" && !closingTaskIds.has(taskId)) {
        scheduleSave(taskId, 1000);
      }
    });
    saves.set(taskId, operation);
    try {
      await operation;
    } finally {
      if (saves.get(taskId) === operation) saves.delete(taskId);
    }
  }

  async function restoreTasks() {
    clearTimeout(restoreRetryTimer);
    const generation = ++restoreGeneration;
    if (disposed || !actorKey.value || !readRefOrGetterValue(assistantReady)) return;
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
        if (!disposed && generation === restoreGeneration) return restoreTasks();
        return;
      }
      restoring = request(vibe64TemporaryConversationsPath(apiPath, ownerSessionId), { method: "GET" })
        .finally(() => restorations.delete(key));
      restorations.set(key, restoring);
      const response = await restoring;
      if (disposed || generation !== restoreGeneration) return;
      restoreError.value = "";
      const records = response.conversations || [];
      for (const task of persistedTasks) {
        if (!records.some((record) => record.conversationId === task.conversationId)) removeTask(task.id);
      }
      for (const record of records) {
        if (closedConversationIds.has(record.conversationId)) continue;
        const existing = tasks.value.find((task) => task.conversationId === record.conversationId || task.id === record.conversationId);
        if (existing) {
          updateTask(existing.id, { purposes: record.purposes, canSteer: record.canSteer });
          continue;
        }
        const task = {
          ...record,
          id: record.conversationId,
          sessionId: ownerSessionId,
          apiPath,
          agentSettings: normalizeVibe64AgentSettings(record.agentSettings),
          attachments: record.attachments || [],
          restoredAttachments: record.attachments || [],
          pendingMessageId: "",
          delivery: createAssistantMessageDelivery(),
          draft: record.draft || "",
          messages: record.messages || [],
          unread: false,
          busy: temporaryAiTurnIsActive(record.status),
          recoveryRetryKeys: record.recoveryRetryKeys || [],
          // A client-side verification callback interrupted by navigation is not running now.
          recoveryOutcome: record.recoveryOutcome === "checking" ? "failed" : record.recoveryOutcome,
          recoveryOutcomeMessage: record.recoveryOutcome === "checking"
            ? "Check Update again to verify this repair."
            : record.recoveryOutcomeMessage
        };
        tasks.value.push(task);
        if (!activeTaskId.value) activeTaskId.value = task.id;
        if (task.busy) void pollTask(task.id);
      }
      if (tasks.value.length) open.value = true;
    } catch (error) {
      if (disposed || generation !== restoreGeneration) return;
      if (error.code === "vibe64_agent_write_mode_busy") {
        restoreError.value = "";
        restoreRetryTimer = setTimeout(() => void restoreTasks(), 1000);
        return;
      }
      restoreError.value = `Temporary chats could not be restored: ${error.message}`;
      open.value = true;
    }
  }

  function reportTaskFinished(taskId = "") {
    if (typeof onTaskFinished !== "function") {
      return;
    }
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    try {
      onTaskFinished(Object.freeze({
        completionMessage: temporaryAiText(task.completionMessage),
        dedupeKey: temporaryAiText(task.dedupeKey),
        error: temporaryAiText(task.error),
        failureMessage: temporaryAiText(task.failureMessage),
        id: task.id,
        outcomeKind: temporaryAiText(task.outcomeKind),
        recoveryOperation: temporaryAiText(task.recoveryOperation),
        runConflictId: temporaryAiText(task.runConflictId),
        runId: task.runId,
        sessionId: task.sessionId,
        status: temporaryAiText(task.status),
        title: temporaryAiText(task.title) || "Temporary AI"
      }));
    } catch {
      // Feedback must never interfere with the completed task state.
    }
  }

  function openTask({
    completionMessage = "",
    dedupeKey = "",
    displayMessage = "",
    draft = "",
    failureMessage = "",
    nextStepMessage = "",
    recoveryNotice = "",
    recoveryOperation = "",
    recoveryConflictId = "",
    initialRouting = null,
    title = ""
  } = {}) {
    const number = nextTaskNumber;
    nextTaskNumber += 1;
    const task = {
      initialRouting,
      agentSettings: normalizeVibe64AgentSettings(readRefOrGetterValue(agentSettings)),
      apiPath: currentSessionsApiPath(),
      attachments: [],
      restoredAttachments: [],
      busy: false,
      completionMessage: temporaryAiText(completionMessage),
      conversationId: "",
      dedupeKey: temporaryAiText(dedupeKey),
      displayMessage: temporaryAiText(displayMessage),
      draft: temporaryAiText(draft),
      error: "",
      failureMessage: temporaryAiText(failureMessage),
      id: temporaryAiId("temporary-ai"),
      messages: [],
      unread: false,
      delivery: createAssistantMessageDelivery(),
      nextStepMessage: temporaryAiText(nextStepMessage),
      pendingMessageId: "",
      recoveryOutcome: "",
      recoveryOutcomeMessage: "",
      recoveryNotice: temporaryAiText(recoveryNotice),
      recoveryOperation: recoveryOperation === "update" ? "update" : "",
      recoveryConflictId: temporaryAiText(recoveryConflictId),
      recoveryContext: "",
      recoveryRetryKeys: [],
      recoveryAutoPaused: false,
      runId: "",
      runConflictId: "",
      sessionId: currentSessionId(),
      status: "ready",
      title: temporaryAiText(title) || `Temporary ${number}`
    };
    tasks.value = [...tasks.value, task];
    activeTaskId.value = task.id;
    open.value = true;
    scheduleSave(task.id);
    return task;
  }

  async function startTask(options = {}) {
    const input = options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
    const message = temporaryAiText(input.message || input.draft);
    if (!message || !currentSessionId() || !currentSessionsApiPath()) {
      return Object.freeze({
        ok: false,
        reused: false,
        started: false,
        taskId: ""
      });
    }
    const dedupeKey = temporaryAiText(input.dedupeKey);
    const repair = input.recoveryOperation === "update" ? updateRepairTask.value : null;
    if (repair) {
      selectTask(repair.id);
      if (repair.busy || repair.recoveryOutcome === "checking" || closingTaskIds.has(repair.id)) {
        return { ok: true, reused: true, started: false, taskId: repair.id };
      }
      // A deliberate retry may use fresh diagnostics, but never replace an unsent reply.
      if ((repair.draft.trim() || repair.attachments.length) && !repair.pendingMessageId) {
        return { ok: true, reused: true, started: false, taskId: repair.id };
      }
      if (!repair.pendingMessageId) {
        updateTask(repair.id, {
          draft: message,
          displayMessage: "Continue repairing this Update.",
          recoveryConflictId: temporaryAiText(input.recoveryConflictId),
          recoveryRetryKeys: []
        });
      }
      const started = await send(repair.id);
      return { ok: started, reused: true, started, taskId: repair.id };
    }
    const existingTask = dedupeKey
      ? [...tasks.value].reverse().find((task) => (
          task.dedupeKey === dedupeKey && (
            task.busy || (
              task.status === "failed" &&
              temporaryAiText(task.draft) &&
              temporaryAiText(task.pendingMessageId)
            )
          )
        ))
      : null;
    if (existingTask) {
      selectTask(existingTask.id);
      const started = existingTask.busy ? false : await send(existingTask.id);
      return Object.freeze({
        ok: existingTask.busy || started,
        reused: true,
        started,
        taskId: existingTask.id
      });
    }
    const task = openTask({
      ...input,
      initialRouting: { mode: "code", review: false },
      dedupeKey,
      draft: message
    });
    const started = await send(task.id);
    return Object.freeze({
      ok: started,
      reused: false,
      started,
      taskId: task.id
    });
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

  function updateDraft(taskId = "", draft = "") {
    updateTask(taskId, {
      displayMessage: "",
      draft: String(draft || ""),
      pendingMessageId: ""
    });
  }

  async function updateRouting(taskId, preferences) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const conversationId = await ensureConversation(task);
    const result = await request(vibe64TemporaryConversationPath(task.apiPath, task.sessionId, conversationId), {
      method: "PATCH", body: { assistantRouting: preferences }
    });
    if (canApplyTaskResponse(task)) updateTask(taskId, { routingMetadata: result.routingMetadata, purposes: result.purposes });
    return result;
  }

  async function retryReview(taskId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const route = JSON.parse(task?.routingMetadata?.assistant_routing_request || "null");
    if (!route) return;
    try {
      await request(vibe64TemporaryConversationTurnsPath(task.apiPath, task.sessionId, task.conversationId), {
        method: "POST", body: { messageId: route.messageId, message: route.input.message, reviewAction: "retry" }
      });
      updateTask(taskId, { busy: true, error: "" });
      void pollTask(taskId);
    } catch (error) { updateTask(taskId, { error: error.message }); }
  }

  function updateAgentSetting(taskId = "", parameterId = "", value = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    const settings = normalizeVibe64AgentSettings({ ...task.agentSettings, [parameterId]: value });
    updateTask(taskId, { agentSettings: settings, settingsToSave: settings });
  }

  function reportRecoveryOutcome(taskId = "", {
    message = "",
    status = "",
    retryMessage = "",
    retryKey = "",
    recoveryConflictId = ""
  } = {}) {
    const outcome = temporaryAiText(status);
    const task = tasks.value.find((task) => task.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || !["checking", "failed", "succeeded"].includes(outcome)) {
      return false;
    }
    const messages = [...task.messages];
    const messageId = `recovery_${task.runId || task.id}`;
    if (outcome === "succeeded" && !messages.some(({ id }) => id === messageId)) {
      messages.push({
        id: messageId,
        role: "system",
        text: temporaryAiText(message) || "Repair verified."
      });
    }
    updateTask(taskId, {
      messages,
      recoveryOutcome: outcome,
      recoveryAutoPaused: false,
      recoveryOutcomeMessage: temporaryAiText(message),
      ...(outcome !== "checking" ? {
        recoveryContext: outcome === "failed" ? retryMessage || message : message,
        recoveryConflictId: temporaryAiText(recoveryConflictId)
      } : {})
    });
    if (outcome === "failed" && task.recoveryOperation === "update" && retryMessage && retryKey &&
        !readRefOrGetterValue(operationBusy) && !stoppingTaskIds.has(taskId) &&
        !task.busy && task.status !== "interrupted") {
      const retries = task.recoveryRetryKeys || [];
      if (retries.includes(retryKey) || retries.length >= 3) {
        updateTask(taskId, {
          recoveryAutoPaused: true,
          recoveryOutcomeMessage: `${message}\nAutomatic repair paused after repeated conflicts. Review the result, then continue here or check Update again.`
        });
      } else if (!task.draft.trim() && !task.attachments.length) {
        updateTask(taskId, {
          recoveryRetryKeys: [...retries, retryKey],
          draft: "Continue repairing the remaining conflicts from Vibe64's latest Update check.",
          displayMessage: "Continue repairing the remaining conflicts."
        });
        void send(taskId);
      }
    }
    return true;
  }

  function updateAttachments(taskId = "", attachments = []) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    updateTask(taskId, {
      attachments: [...(task.restoredAttachments || []), ...(Array.isArray(attachments) ? attachments : [])]
    });
  }

  async function request(path = "", options = {}) {
    const response = await getHttpWebClient().request(path, options);
    if (response?.ok === false) {
      throw temporaryAiRequestError(response);
    }
    return response;
  }

  function stopPolling(taskId = "") {
    clearTimeout(pollTimers.get(taskId));
    pollTimers.delete(taskId);
  }

  async function pollTask(taskId = "") {
    stopPolling(taskId);
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const canApplyResponse = () => {
      const current = tasks.value.find((candidate) => candidate.id === taskId);
      return canApplyTaskResponse(task) && current?.busy && current.runId === task.runId &&
        current.sendVersion === task.sendVersion &&
        !closingTaskIds.has(taskId) && !stoppingTaskIds.has(taskId);
    };
    if (!task?.conversationId || !canApplyResponse()) {
      return;
    }
    // Realtime routing updates can arrive faster than a native history read.
    // Share the pending read; each mounted conversation owns one poll at a time.
    if (pendingPolls.has(task.delivery)) return;
    pendingPolls.add(task.delivery);
    try {
      const response = await request(
        vibe64TemporaryConversationPath(
          task.apiPath,
          task.sessionId,
          task.conversationId
        ),
        { method: "GET" }
      );
      if (!canApplyResponse()) return;
      const text = temporaryAiText(response.text || response.message || response.rawText);
      const status = temporaryAiText(response.status) || "completed";
      const messages = response.messages || temporaryAiTurnMessages(task.messages, task.runId, {
        progressUpdates: temporaryAiProgressUpdates(response.progressUpdates),
        status,
        text
      });
      const active = temporaryAiTurnIsActive(status);
      updateTask(taskId, {
        busy: active,
        routingMetadata: response.routingMetadata,
        purposes: response.purposes,
        canSteer: response.canSteer,
        assistantSelection: response.assistantSelection,
        ...(Object.hasOwn(response, "goal") ? { goal: response.goal } : {}),
        conversationId: response.conversationExpired === true ? "" : task.conversationId,
        error: temporaryAiText(response.error),
        messages,
        outcomeKind: temporaryAiText(response.outcome?.kind),
        runId: response.conversationExpired === true ? "" : response.runId || task.runId,
        status
      });
      task.delivery.reconcile(conversationTurnsFromMessages(messages));
      if (active) {
        pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      } else {
        reportTaskFinished(taskId);
      }
    } catch (error) {
      if (!canApplyResponse()) return;
      if (error.code === "vibe64_conversation_closed") {
        removeTask(taskId);
        return;
      }
      const message = temporaryAiText(error?.message || error) || "Temporary AI response could not be read.";
      // A failed read does not prove that native work has stopped.
      const active = error?.conversationExpired !== true &&
        !["completed", "failed", "interrupted"].includes(error?.status);
      updateTask(taskId, {
        busy: active,
        conversationId: error?.conversationExpired === true ? "" : task.conversationId,
        error: message,
        messages: temporaryAiTurnMessages(task.messages, task.runId, {
          status: active ? task.status : "failed"
        }),
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: active ? task.status : "failed"
      });
      if (active) {
        pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      } else {
        reportTaskFinished(taskId);
      }
    } finally {
      pendingPolls.delete(task.delivery);
      // A new turn can replace this poll while Stop/Send is in flight. Once
      // the stale response settles, keep observing the current turn.
      if (canApplyTaskResponse(task) && tasks.value.find((current) => current.id === taskId)?.busy &&
          !pollTimers.has(taskId)) void pollTask(taskId);
    }
  }

  function pendingMessage(task, messageId) {
    const local = task?.delivery.find(messageId);
    if (local) return local;
    const route = JSON.parse(task?.routingMetadata?.assistant_routing_request || "null");
    return route?.messageId === messageId && ["failed", "uncertain", "routing", "sending"].includes(route.status)
      ? { id: messageId, status: ["failed", "uncertain"].includes(route.status) ? "failed" : "pending",
        text: route.input.displayMessage || route.input.message, payload: { ...route.input, draftSnapshot: route.input.displayMessage || route.input.message } } : null;
  }

  async function send(taskId = "", { retryMessageId = "" } = {}) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || stoppingTaskIds.has(taskId) ||
        readRefOrGetterValue(operationBusy) || task.delivery.state.sending || task.recoveryOutcome === "checking") {
      return false;
    }
    const route = JSON.parse(task.routingMetadata?.assistant_routing_request || "null");
    if (!retryMessageId && assistantRoutingStatusIsPending(route?.status)) return false;
    const retry = retryMessageId ? pendingMessage(task, retryMessageId) : null;
    if (retryMessageId && retry?.status !== "failed") return false;
    const draftPayload = chatMessagePayload(task.draft, task.attachments);
    const payload = retry?.payload || (draftPayload && {
      ...draftPayload,
      agentSettings: task.agentSettings,
      displayMessage: task.displayMessage || draftPayload.displayMessage,
      draftSnapshot: task.draft,
      presentation: { ...taskPresentation(task), draft: "" },
      message: task.recoveryOperation === "update" && task.recoveryContext
        ? `${task.recoveryContext}\n\nUser message:\n${draftPayload.message}`
        : draftPayload.message,
      ...(task.recoveryOperation === "update" ? { outputSchema: VIBE64_AGENT_TASK_RESULT_SCHEMA } : {}),
      promptLabel: task.title
    });
    if (!payload?.message) {
      return false;
    }
    const messageId = retryMessageId || task.pendingMessageId || temporaryAiId("message");
    stopPolling(taskId);
    updateTask(taskId, {
      sendVersion: (task.sendVersion || 0) + 1,
      busy: true,
      draft: retry && task.draft !== payload.draftSnapshot ? task.draft : "",
      error: "",
      errorCode: "",
      pendingMessageId: messageId,
      outcomeKind: "",
      // Keep this turn's review separate from diagnostics returned by a later Update.
      runConflictId: task.recoveryConflictId,
      recoveryOutcome: task.recoveryOutcome === "failed" ? "failed" : "",
      recoveryOutcomeMessage: task.recoveryOutcome === "failed" ? task.recoveryOutcomeMessage : "",
      status: "starting"
    });
    clearTimeout(saveTimers.get(taskId));
    saveTimers.delete(taskId);
    let conversationId = task.conversationId;
    const apiPath = task.apiPath;
    const ownerSessionId = task.sessionId;
    try {
      const response = await task.delivery.send(payload, {
        messageId,
        isCurrent: () => canApplyTaskResponse(task) && !closingTaskIds.has(taskId),
        async deliver(submission) {
          if (saves.has(taskId)) await saves.get(taskId);
          if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
          conversationId = conversationId || await ensureConversation(task);
          if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
          return request(vibe64TemporaryConversationTurnsPath(apiPath, ownerSessionId, conversationId), {
            body: {
              agentSettings: submission.agentSettings,
              ...(submission.attachmentIds?.length ? { attachmentIds: submission.attachmentIds } : {}),
              messageId,
              displayMessage: submission.displayMessage,
              presentation: submission.presentation,
              message: submission.message,
              submissionKind: ["starting", "inProgress"].includes(task.status) ? "steer" : "send",
              ...(submission.outputSchema ? { outputSchema: submission.outputSchema } : {}),
              promptLabel: submission.promptLabel
            },
            method: "POST"
          });
        }
      });
      const current = tasks.value.find((candidate) => candidate.id === taskId);
      if (response === false || !canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
      const status = current.status === "interrupted" ? "interrupted" : response.status || "inProgress";
      const messages = response.messages || [
        ...current.messages.map((entry) => (
          entry.role === "assistant" ? { ...entry, runId: "", status: "completed" } : entry
        )),
        {
          attachments: payload.displayAttachments || [],
          id: messageId,
          role: "user",
          status: "completed",
          text: payload.displayMessage
        },
        {
          id: temporaryAiId("message"),
          role: "assistant",
          runId: response.runId,
          status,
          progressUpdates: [],
          text: ""
        }
      ];
      const acceptedAttachmentIds = new Set(payload.attachmentIds || []);
      updateTask(taskId, {
        attachments: current.attachments.filter((attachment) => !acceptedAttachmentIds.has(attachment.attachmentId)),
        ...(response.assistantRoutingRequest ? { routingMetadata: { ...current.routingMetadata, assistant_routing_request: JSON.stringify(response.assistantRoutingRequest) } } : {}),
        restoredAttachments: current.restoredAttachments.filter((attachment) => !acceptedAttachmentIds.has(attachment.attachmentId)),
        busy: temporaryAiTurnIsActive(status),
        ...(Object.hasOwn(response, "goal") ? { goal: response.goal } : {}),
        conversationId,
        displayMessage: "",
        error: "",
        messages,
        pendingMessageId: "",
        runId: response.runId,
        status
      });
      task.delivery.reconcile(conversationTurnsFromMessages(messages));
      if (retry || current.draft || current.agentSettings !== task.agentSettings ||
          current.attachments.some((attachment) => !acceptedAttachmentIds.has(attachment.attachmentId))) {
        scheduleSave(taskId);
      }
      if (temporaryAiTurnIsActive(status)) void pollTask(taskId);
      else if (status !== "interrupted") reportTaskFinished(taskId);
      return true;
    } catch (error) {
      if (!canApplyTaskResponse(task)) return false;
      if (error.code === "vibe64_conversation_closed") {
        removeTask(taskId);
        return false;
      }
      if (error.code === "vibe64_assistant_routing_cancelled") {
        const current = tasks.value.find((candidate) => candidate.id === taskId);
        const draft = current.draft;
        const text = payload.draftSnapshot || payload.displayMessage;
        task.delivery.remove(messageId);
        updateTask(taskId, {
          busy: false, conversationId, pendingMessageId: "", error: "", errorCode: "", status: "interrupted",
          draft: !draft || draft.startsWith(text) ? draft || text : `${text}\n\n${draft}`
        });
        scheduleSave(taskId);
        return false;
      }
      const stillWorking = task.busy && error?.conversationExpired !== true;
      updateTask(taskId, {
        busy: stillWorking,
        conversationId: error?.conversationExpired === true ? "" : conversationId,
        draft: tasks.value.find((candidate) => candidate.id === taskId).draft || payload.draftSnapshot,
        error: temporaryAiText(error?.message || error) || "Temporary AI message could not be sent.",
        errorCode: temporaryAiText(error?.code),
        pendingMessageId: messageId,
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: stillWorking ? task.status : "failed"
      });
      if (stillWorking) void pollTask(taskId);
      else reportTaskFinished(taskId);
      return false;
    }
  }

  async function cancelMessage(taskId, messageId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const message = pendingMessage(task, messageId);
    if (disposed || !message || message.status !== "failed" ||
        readRefOrGetterValue(operationBusy) || closingTaskIds.has(taskId) || task.recoveryOutcome === "checking") return false;
    const route = JSON.parse(task.routingMetadata?.assistant_routing_request || "null");
    if (route?.messageId === messageId) {
      if (route.status === "uncertain") { updateTask(taskId, { error: "Check delivery before editing or cancelling this message." }); return false; }
      await stopTask(taskId);
    } else if (task.busy) return false;
    task.delivery.remove(messageId);
    updateTask(taskId, {
      ...(task.pendingMessageId === messageId ? { pendingMessageId: "" } : {}),
      ...(task.error === message.error ? { error: "", errorCode: "" } : {}),
      ...(task.draft === message.payload.draftSnapshot ? { draft: "", displayMessage: "" } : {})
    });
    return true;
  }

  async function editMessage(taskId, messageId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const message = pendingMessage(task, messageId);
    if (!message || !await cancelMessage(taskId, messageId)) return false;
    const draft = task.draft;
    updateDraft(taskId, !draft || draft === message.payload.draftSnapshot
      ? message.text
      : draft.startsWith(message.text) ? draft : `${message.text}\n\n${draft}`);
    return true;
  }

  async function stopTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task || !task.busy && !task.routingMetadata?.assistant_routing_request || stoppingTaskIds.has(taskId)) {
      return false;
    }
    if (!task.conversationId) {
      throw new Error("Temporary AI is still starting. Wait for it to start, then stop it.");
    }
    stoppingTaskIds.add(taskId);
    stopPolling(taskId);
    try {
      const response = await request(
        vibe64TemporaryConversationStopPath(
          task.apiPath,
          task.sessionId,
          task.conversationId
        ),
        {
          body: { runId: task.runId },
          method: "POST"
        }
      );
      if (!canApplyTaskResponse(task)) return false;
      updateTask(taskId, {
        busy: false,
        ...(response.routingMetadata ? { routingMetadata: response.routingMetadata } : {}),
        error: "",
        messages: temporaryAiTurnMessages(task.messages, task.runId, {
          status: "interrupted"
        }),
        status: "interrupted"
      });
      return true;
    } catch (error) {
      if (!canApplyTaskResponse(task)) return false;
      if (error.code === "vibe64_conversation_closed") {
        removeTask(taskId);
        return false;
      }
      pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      throw error;
    } finally {
      stoppingTaskIds.delete(taskId);
    }
  }

  async function closeTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || stoppingTaskIds.has(taskId)) {
      return;
    }
    if (readRefOrGetterValue(operationBusy) || task.recoveryOutcome === "checking") {
      throw new Error("Wait for Update to finish before closing this repair.");
    }
    closingTaskIds.add(taskId);
    stopPolling(taskId);
    try {
      clearTimeout(saveTimers.get(taskId));
      saveTimers.delete(taskId);
      if (saves.has(taskId)) await saves.get(taskId);
      const conversationId = task.conversationId || (creations.has(taskId) ? await creations.get(taskId) : "");
      if (conversationId) {
        await request(
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
      if (task.busy) pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      throw error;
    } finally {
      closingTaskIds.delete(taskId);
    }
  }

  function closeWorkspace() {
    open.value = false;
  }

  function removeTask(taskId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    closedConversationIds.add(task?.conversationId || taskId);
    stopPolling(taskId);
    clearTimeout(saveTimers.get(taskId));
    saveTimers.delete(taskId);
    tasks.value = tasks.value.filter((candidate) => candidate.id !== taskId);
    if (activeTaskId.value === taskId) activeTaskId.value = tasks.value[0]?.id || "";
    if (!tasks.value.length) open.value = false;
  }

  for (const event of [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT]) {
    useRealtimeEvent({ event, onEvent: () => void restoreTasks() });
  }
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} }) => (
      !disposed && payload.projectSlug === projectSlug.value &&
      payload.sessionId === currentSessionId() && ["temporary-conversation-closed", "assistant-routing-changed"].includes(payload.reason) &&
      Boolean(payload.conversationId)
    ),
    onEvent: ({ payload }) => {
      const task = tasks.value.find((candidate) => (
        candidate.conversationId === payload.conversationId || candidate.id === payload.conversationId
      ));
      if (payload.reason === "temporary-conversation-closed") removeTask(task?.id || payload.conversationId);
      else if (task && payload.assistantRoutingRequest) {
        updateTask(task.id, { routingMetadata: { ...task.routingMetadata, assistant_routing_request: JSON.stringify(payload.assistantRoutingRequest) }, busy: true });
        void pollTask(task.id);
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
      for (const timer of pollTimers.values()) clearTimeout(timer);
      for (const timer of saveTimers.values()) clearTimeout(timer);
      pollTimers.clear();
      saveTimers.clear();
      closedConversationIds.clear();
      tasks.value = [];
      activeTaskId.value = "";
      open.value = false;
    }
  }, { flush: "sync" });
  watch([currentSessionId, currentSessionsApiPath, actorKey, () => readRefOrGetterValue(assistantReady)],
    () => void restoreTasks(), { immediate: true });
  onBeforeUnmount(() => {
    // Removing a view never closes a conversation or interrupts native work.
    for (const taskId of saveTimers.keys()) void saveTask(taskId);
    disposed = true;
    clearTimeout(restoreRetryTimer);
    restoreGeneration += 1;
    for (const timer of pollTimers.values()) clearTimeout(timer);
    for (const timer of saveTimers.values()) clearTimeout(timer);
    pollTimers.clear();
    saveTimers.clear();
  });

  return {
    activeTask,
    activeTaskId,
    closeTask,
    closeWorkspace,
    cancelMessage,
    editMessage,
    hasUnreadMessages,
    open,
    openTask,
    reportRecoveryOutcome,
    restoreError,
    restoreTasks,
    removeRestoredAttachment(taskId, attachmentId) {
      const task = tasks.value.find((candidate) => candidate.id === taskId);
      if (!task) return;
      updateTask(taskId, {
        restoredAttachments: task.restoredAttachments.filter((attachment) => attachment.attachmentId !== attachmentId),
        attachments: task.attachments.filter((attachment) => attachment.attachmentId !== attachmentId)
      });
    },
    selectTask,
    send,
    showWorkspace,
    startTask,
    stopTask,
    tasks,
    updateAgentSetting,
    updateAttachments,
    updateDraft,
    updateRouting,
    retryReview,
    updateRepairTask
  };
}

export {
  temporaryAiTurnIsActive,
  useVibe64TemporaryAi
};
