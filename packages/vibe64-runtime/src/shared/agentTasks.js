const VIBE64_AGENT_WORKSPACE_WRITE_POLICY = "workspace_write";

const VIBE64_AGENT_TASK_STATES = Object.freeze({
  COMPLETED: "completed",
  RUNNING: "running",
  STARTING: "starting",
  STOPPED: "stopped",
  STOPPING: "stopping",
  WAITING: "waiting"
});

const VIBE64_AGENT_TASK_ACTIVE_STATES = new Set([
  VIBE64_AGENT_TASK_STATES.RUNNING,
  VIBE64_AGENT_TASK_STATES.STARTING,
  VIBE64_AGENT_TASK_STATES.STOPPING,
  VIBE64_AGENT_TASK_STATES.WAITING
]);

const VIBE64_AGENT_TASK_RESULT_KINDS = Object.freeze({
  COMPLETE: "complete",
  CONTINUE: "continue"
});

const VIBE64_AGENT_TASK_RESULT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    kind: {
      enum: Object.values(VIBE64_AGENT_TASK_RESULT_KINDS),
      type: "string"
    },
    message: {
      description: "Normal Markdown shown to the user for this task turn.",
      type: "string"
    },
    report: {
      description: "A concise factual handoff for the main conversation when the task is complete; otherwise an empty string.",
      type: "string"
    }
  },
  required: ["kind", "message", "report"],
  type: "object"
});

function normalizedAgentTaskText(value = "") {
  return String(value ?? "").trim();
}

function normalizeVibe64AgentTaskResult(value = null) {
  let source = value;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const kind = normalizedAgentTaskText(source.kind);
  const message = normalizedAgentTaskText(source.message);
  const report = normalizedAgentTaskText(source.report);
  if (!Object.values(VIBE64_AGENT_TASK_RESULT_KINDS).includes(kind) || !message) {
    return null;
  }
  if (kind === VIBE64_AGENT_TASK_RESULT_KINDS.COMPLETE && !report) {
    return null;
  }
  return {
    kind,
    message,
    report: kind === VIBE64_AGENT_TASK_RESULT_KINDS.COMPLETE ? report : ""
  };
}

function vibe64AgentTaskIsActive(task = null) {
  return Boolean(
    task &&
    typeof task === "object" &&
    !Array.isArray(task) &&
    VIBE64_AGENT_TASK_ACTIVE_STATES.has(normalizedAgentTaskText(task.state))
  );
}

export {
  VIBE64_AGENT_WORKSPACE_WRITE_POLICY,
  VIBE64_AGENT_TASK_RESULT_KINDS,
  VIBE64_AGENT_TASK_RESULT_SCHEMA,
  VIBE64_AGENT_TASK_STATES,
  normalizeVibe64AgentTaskResult,
  vibe64AgentTaskIsActive
};
