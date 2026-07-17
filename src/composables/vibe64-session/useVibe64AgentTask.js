import { computed, ref, watch } from "vue";

import {
  VIBE64_AGENT_TASK_STATES,
  vibe64AgentTaskIsActive
} from "@local/vibe64-runtime/shared";

function conversationTurns(messages = []) {
  const turns = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || "").trim();
    const text = String(message?.text || "").trim();
    if (!text || !["assistant", "user"].includes(role)) {
      continue;
    }
    const entry = {
      at: String(message.at || ""),
      role,
      text
    };
    const current = turns.at(-1);
    if (role === "assistant" && current && !current.assistant) {
      current.assistant = entry;
      continue;
    }
    turns.push({
      [role]: entry,
      thinking: [],
      turnId: `task:${String(message.id || turns.length + 1)}`
    });
  }
  return turns;
}

function useVibe64AgentTask(props = {}) {
  const agentTask = computed(() => props.session?.agentTask || null);
  const agentTaskActive = computed(() => vibe64AgentTaskIsActive(agentTask.value));
  const agentTaskRequestBusy = ref(false);
  const agentTaskDraft = ref("");
  const agentTaskRunning = computed(() => Boolean(
    agentTaskRequestBusy.value ||
    [
      VIBE64_AGENT_TASK_STATES.RUNNING,
      VIBE64_AGENT_TASK_STATES.STARTING,
      VIBE64_AGENT_TASK_STATES.STOPPING
    ].includes(String(agentTask.value?.state || ""))
  ));
  const agentTaskWaiting = computed(() => (
    agentTask.value?.state === VIBE64_AGENT_TASK_STATES.WAITING
  ));
  const agentTaskCanSubmit = computed(() => Boolean(
    agentTaskWaiting.value &&
    !agentTaskRequestBusy.value &&
    agentTaskDraft.value.trim()
  ));
  const agentTaskControl = computed(() => ({
    id: "agent-task-message",
    inputFields: [{
      ariaLabel: `Message ${String(agentTask.value?.label || "focused task")}`,
      kind: "textarea",
      label: "",
      name: "message",
      placeholder: agentTaskRunning.value ? "Task is working…" : "Reply to this task…",
      required: true,
      rows: 3
    }],
    label: "Send",
    submitLabel: "Send"
  }));
  const agentTaskValues = computed(() => ({
    message: agentTaskDraft.value
  }));
  const agentTaskTurns = computed(() => conversationTurns(agentTask.value?.turns));
  const agentTaskStatusLabel = computed(() => {
    if (agentTaskWaiting.value) {
      return "Waiting for you";
    }
    return agentTask.value?.state === VIBE64_AGENT_TASK_STATES.STOPPING
      ? "Stopping…"
      : "Working…";
  });

  async function requestTaskAction(action, input = {}) {
    if (agentTaskRequestBusy.value) {
      return false;
    }
    agentTaskRequestBusy.value = true;
    try {
      return await props.requestAgentTask(action, input) !== false;
    } finally {
      agentTaskRequestBusy.value = false;
    }
  }

  function updateAgentTaskDraft(name = "", value = "") {
    if (name === "message") {
      agentTaskDraft.value = String(value || "");
    }
  }

  async function submitAgentTaskMessage() {
    const message = agentTaskDraft.value.trim();
    if (!agentTaskCanSubmit.value || !message) {
      return false;
    }
    const accepted = await requestTaskAction("message", {
      message
    });
    if (accepted) {
      agentTaskDraft.value = "";
    }
    return accepted;
  }

  function startAgentTask(item = {}, agentSettings = null) {
    return requestTaskAction("start", {
      agentSettings,
      taskId: item.id
    });
  }

  function finishAgentTask() {
    return requestTaskAction("finish");
  }

  function stopAgentTask() {
    return requestTaskAction("stop");
  }

  watch(() => agentTask.value?.id || "", () => {
    agentTaskDraft.value = "";
  });

  return {
    agentTask,
    agentTaskActive,
    agentTaskCanSubmit,
    agentTaskControl,
    agentTaskRequestBusy,
    agentTaskRunning,
    agentTaskStatusLabel,
    agentTaskTurns,
    agentTaskValues,
    agentTaskWaiting,
    finishAgentTask,
    startAgentTask,
    stopAgentTask,
    submitAgentTaskMessage,
    updateAgentTaskDraft
  };
}

export {
  useVibe64AgentTask
};
