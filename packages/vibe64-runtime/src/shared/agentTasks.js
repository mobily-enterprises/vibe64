import { toText } from "@jskit-ai/kernel/shared/support/normalize";

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
  const kind = toText(source.kind);
  const message = toText(source.message);
  const report = toText(source.report);
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

export {
  VIBE64_AGENT_TASK_RESULT_SCHEMA,
  normalizeVibe64AgentTaskResult
};
