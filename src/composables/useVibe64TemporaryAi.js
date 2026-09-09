import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";

import { chatMessagePayload } from "@/lib/vibe64ChatMessage.js";
import {
  vibe64AgentAttachmentFilePath,
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath,
  vibe64TemporaryConversationStopPath,
  vibe64TemporaryConversationTurnsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const TEMPORARY_AI_POLL_INTERVAL_MS = 650;
const TEMPORARY_AI_WORKSPACE_WRITE_POLICY = "workspace_write";

function temporaryAiId(prefix = "temporary") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function temporaryAiText(value = "") {
  return String(value || "").trim();
}

function temporaryAiRequestError(response = {}, fallback = "Temporary AI request failed.") {
  return Object.assign(new Error(vibe64ApiResponseError(response, fallback)), {
    code: temporaryAiText(response.code),
    conversationExpired: response.conversationExpired === true
  });
}

function temporaryAiTurnIsActive(status = "") {
  return ["starting", "inProgress"].includes(temporaryAiText(status));
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
  agentSettings = () => defaultVibe64AgentSettings(),
  onTaskFinished = null,
  operationBusy = () => false,
  sessionId,
  sessionsApiPath
} = {}) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  const pollTimers = new Map();
  const closingTaskIds = new Set();
  const stoppingTaskIds = new Set();
  let disposed = false;
  let nextTaskNumber = 1;

  const activeTask = computed(() => (
    tasks.value.find((task) => task.id === activeTaskId.value) || tasks.value[0] || null
  ));
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

  function updateTask(taskId = "", update = {}) {
    tasks.value = tasks.value.map((task) => (
      task.id === taskId ? { ...task, ...update } : task
    ));
    return tasks.value.find((task) => task.id === taskId) || null;
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
        error: temporaryAiText(task.error),
        failureMessage: temporaryAiText(task.failureMessage),
        id: task.id,
        outcomeKind: temporaryAiText(task.outcomeKind),
        recoveryOperation: temporaryAiText(task.recoveryOperation),
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
    policy = "read",
    recoveryNotice = "",
    recoveryOperation = "",
    title = ""
  } = {}) {
    const number = nextTaskNumber;
    nextTaskNumber += 1;
    const task = {
      agentSettings: normalizeVibe64AgentSettings(readRefOrGetterValue(agentSettings)),
      attachments: [],
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
      nextStepMessage: temporaryAiText(nextStepMessage),
      ownedAttachmentIds: [],
      pendingMessageId: "",
      policy: policy === TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        ? TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        : "read",
      recoveryOutcome: "",
      recoveryOutcomeMessage: "",
      recoveryNotice: temporaryAiText(recoveryNotice),
      recoveryOperation: recoveryOperation === "update" ? "update" : "",
      recoveryContext: "",
      recoveryRetryKeys: [],
      recoveryAutoPaused: false,
      runId: "",
      sessionId: currentSessionId(),
      status: "ready",
      title: temporaryAiText(title) || `Temporary ${number}`
    };
    tasks.value = [...tasks.value, task];
    activeTaskId.value = task.id;
    open.value = true;
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
        updateTask(repair.id, { draft: message, displayMessage: "Continue repairing this Update.", recoveryRetryKeys: [] });
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

  function updateAgentSetting(taskId = "", parameterId = "", value = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    updateTask(taskId, {
      agentSettings: normalizeVibe64AgentSettings({
        ...task.agentSettings,
        [parameterId]: value
      })
    });
  }

  function updatePolicy(taskId = "", policy = "read") {
    updateTask(taskId, {
      policy: policy === TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        ? TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        : "read"
    });
  }

  function reportRecoveryOutcome(taskId = "", {
    message = "",
    status = "",
    retryMessage = "",
    retryKey = ""
  } = {}) {
    const outcome = temporaryAiText(status);
    const task = tasks.value.find((task) => task.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || !["checking", "failed", "succeeded"].includes(outcome)) {
      return false;
    }
    updateTask(taskId, {
      recoveryOutcome: outcome,
      recoveryAutoPaused: false,
      recoveryOutcomeMessage: temporaryAiText(message),
      ...(outcome !== "checking" ? { recoveryContext: outcome === "failed" ? retryMessage || message : message } : {})
    });
    if (outcome === "failed" && task.recoveryOperation === "update" && retryMessage && retryKey &&
        !readRefOrGetterValue(operationBusy) && !stoppingTaskIds.has(taskId) &&
        !task.busy && task.status !== "interrupted" && task.policy === TEMPORARY_AI_WORKSPACE_WRITE_POLICY) {
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
    const current = Array.isArray(attachments) ? attachments : [];
    const ids = current
      .map((attachment) => temporaryAiText(attachment?.attachmentId))
      .filter(Boolean);
    updateTask(taskId, {
      attachments: current,
      ownedAttachmentIds: [...new Set(ids)]
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
      return !disposed && current?.busy && current.runId === task.runId &&
        !closingTaskIds.has(taskId) && !stoppingTaskIds.has(taskId);
    };
    if (!task?.conversationId || !task.runId || !canApplyResponse()) {
      return;
    }
    try {
      const response = await request(
        vibe64TemporaryConversationPath(
          currentSessionsApiPath(),
          currentSessionId(),
          task.conversationId
        ),
        { method: "GET" }
      );
      if (!canApplyResponse()) return;
      const text = temporaryAiText(response.text || response.message || response.rawText);
      const status = temporaryAiText(response.status) || "completed";
      const messages = temporaryAiTurnMessages(task.messages, task.runId, {
        progressUpdates: temporaryAiProgressUpdates(response.progressUpdates),
        status,
        text
      });
      const active = temporaryAiTurnIsActive(status);
      updateTask(taskId, {
        busy: active,
        conversationId: response.conversationExpired === true ? "" : task.conversationId,
        error: active ? "" : temporaryAiText(response.error),
        messages,
        outcomeKind: temporaryAiText(response.outcome?.kind),
        runId: response.conversationExpired === true ? "" : task.runId,
        status
      });
      if (active) {
        pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      } else {
        reportTaskFinished(taskId);
      }
    } catch (error) {
      if (!canApplyResponse()) return;
      const message = temporaryAiText(error?.message || error) || "Temporary AI response could not be read.";
      updateTask(taskId, {
        busy: false,
        conversationId: error?.conversationExpired === true ? "" : task.conversationId,
        error: message,
        messages: temporaryAiTurnMessages(task.messages, task.runId, {
          status: "failed"
        }),
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: "failed"
      });
      reportTaskFinished(taskId);
    }
  }

  async function send(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task || closingTaskIds.has(taskId) || stoppingTaskIds.has(taskId) ||
        readRefOrGetterValue(operationBusy) || task.busy || task.recoveryOutcome === "checking") {
      return false;
    }
    const payload = chatMessagePayload(task.draft, task.attachments);
    if (!payload?.message) {
      return false;
    }
    const messageId = task.pendingMessageId || temporaryAiId("message");
    updateTask(taskId, {
      busy: true,
      draft: "",
      error: "",
      pendingMessageId: messageId,
      outcomeKind: "",
      recoveryOutcome: task.recoveryOutcome === "failed" ? "failed" : "",
      recoveryOutcomeMessage: task.recoveryOutcome === "failed" ? task.recoveryOutcomeMessage : "",
      status: "starting"
    });
    let conversationId = task.conversationId;
    const apiPath = currentSessionsApiPath();
    const ownerSessionId = task.sessionId;
    try {
      if (!conversationId) {
        const created = await request(vibe64TemporaryConversationsPath(apiPath, ownerSessionId), {
          body: { agentSettings: task.agentSettings, policy: task.policy },
          method: "POST"
        });
        conversationId = created.conversationId;
        if (disposed) {
          // Unmount could not delete a conversation whose creation was still pending.
          await request(vibe64TemporaryConversationPath(apiPath, ownerSessionId, conversationId), {
            method: "DELETE"
          });
          return false;
        }
        updateTask(task.id, { conversationId });
      }
      const response = await request(
        vibe64TemporaryConversationTurnsPath(
          apiPath,
          ownerSessionId,
          conversationId
        ),
        {
          body: {
            agentSettings: task.agentSettings,
            ...(payload.attachmentIds?.length ? { attachmentIds: payload.attachmentIds } : {}),
            messageId,
            message: task.recoveryOperation === "update" && task.recoveryContext
              ? `${task.recoveryContext}\n\nUser message:\n${payload.message}`
              : payload.message,
            policy: task.policy,
            promptLabel: task.title
          },
          method: "POST"
        }
      );
      if (disposed) return false;
      const messages = [
        ...task.messages,
        {
          attachments: payload.displayAttachments || [],
          id: messageId,
          role: "user",
          status: "completed",
          text: task.displayMessage || payload.displayMessage
        },
        {
          id: temporaryAiId("message"),
          role: "assistant",
          runId: response.runId,
          status: response.status || "inProgress",
          progressUpdates: [],
          text: ""
        }
      ];
      updateTask(taskId, {
        attachments: [],
        busy: true,
        conversationId,
        displayMessage: "",
        messages,
        ownedAttachmentIds: [],
        pendingMessageId: "",
        runId: response.runId,
        status: response.status || "inProgress"
      });
      void pollTask(taskId);
      return true;
    } catch (error) {
      if (disposed) return false;
      updateTask(taskId, {
        busy: false,
        conversationId: error?.conversationExpired === true ? "" : conversationId,
        draft: task.draft,
        error: temporaryAiText(error?.message || error) || "Temporary AI message could not be sent.",
        pendingMessageId: messageId,
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: "failed"
      });
      reportTaskFinished(taskId);
      return false;
    }
  }

  async function stopTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (disposed || !task?.busy || stoppingTaskIds.has(taskId)) {
      return false;
    }
    if (task.status === "starting" || !task.conversationId || !task.runId) {
      throw new Error("Temporary AI is still starting. Wait for it to start, then stop it.");
    }
    stoppingTaskIds.add(taskId);
    stopPolling(taskId);
    try {
      await request(
        vibe64TemporaryConversationStopPath(
          currentSessionsApiPath(),
          currentSessionId(),
          task.conversationId
        ),
        {
          body: { runId: task.runId },
          method: "POST"
        }
      );
      if (disposed) return false;
      updateTask(taskId, {
        busy: false,
        messages: temporaryAiTurnMessages(task.messages, task.runId, {
          status: "interrupted"
        }),
        status: "interrupted"
      });
      return true;
    } catch (error) {
      if (disposed) return false;
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
      if (task.busy) {
        await stopTask(taskId);
      }
      if (disposed) return;
      if (task.conversationId) {
        await request(
          vibe64TemporaryConversationPath(
            currentSessionsApiPath(),
            currentSessionId(),
            task.conversationId
          ),
          { method: "DELETE" }
        );
      }
      if (disposed) return;
      tasks.value = tasks.value.filter((candidate) => candidate.id !== taskId);
      if (activeTaskId.value === taskId) {
        activeTaskId.value = tasks.value[0]?.id || "";
      }
      if (tasks.value.length === 0) {
        open.value = false;
      }
    } catch (error) {
      if (disposed) return;
      throw error;
    } finally {
      closingTaskIds.delete(taskId);
    }
  }

  function closeWorkspace() {
    open.value = false;
  }

  function cleanupOnPageExit() {
    const currentSession = currentSessionId();
    const apiPath = currentSessionsApiPath();
    for (const task of tasks.value) {
      if (task.conversationId) {
        void fetch(resolveStudioRequestUrl(vibe64TemporaryConversationPath(
          apiPath,
          currentSession,
          task.conversationId
        )), {
          credentials: "same-origin",
          keepalive: true,
          method: "DELETE"
        });
      }
      for (const attachmentId of task.ownedAttachmentIds) {
        void fetch(resolveStudioRequestUrl(vibe64AgentAttachmentFilePath(
          apiPath,
          currentSession,
          attachmentId
        )), {
          credentials: "same-origin",
          keepalive: true,
          method: "DELETE"
        });
      }
    }
  }

  onMounted(() => window.addEventListener("beforeunload", cleanupOnPageExit));
  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener("beforeunload", cleanupOnPageExit);
    cleanupOnPageExit();
    for (const task of tasks.value) {
      stopPolling(task.id);
    }
  });

  return {
    activeTask,
    activeTaskId,
    closeTask,
    closeWorkspace,
    open,
    openTask,
    reportRecoveryOutcome,
    selectTask,
    send,
    showWorkspace,
    startTask,
    stopTask,
    tasks,
    updateAgentSetting,
    updateAttachments,
    updateDraft,
    updateRepairTask,
    updatePolicy
  };
}

export {
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY,
  temporaryAiTurnIsActive,
  useVibe64TemporaryAi
};
