const VIBE64_AGENT_WRITE_LOCK = "agent-write-mode";

const VIBE64_AGENT_WRITE_BUSY_RESULT = Object.freeze({
  code: "vibe64_agent_write_mode_busy",
  error: "Another assistant operation is starting. Try again in a moment.",
  ok: false,
  retryable: true
});

const VIBE64_AGENT_TASK_ACTIVE_RESULT = Object.freeze({
  code: "vibe64_agent_task_active",
  error: "Finish or stop the focused task before using the main conversation.",
  ok: false
});

async function runVibe64AgentWriteExclusive(runtime, sessionId = "", operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Exclusive Vibe64 agent work requires an operation.");
  }
  if (typeof runtime?.store?.runSessionExclusive !== "function") {
    return {
      acquired: true,
      value: await operation()
    };
  }
  const exclusive = await runtime.store.runSessionExclusive(
    sessionId,
    VIBE64_AGENT_WRITE_LOCK,
    operation
  );
  return exclusive.acquired
    ? exclusive
    : {
        acquired: false,
        value: VIBE64_AGENT_WRITE_BUSY_RESULT
      };
}

export {
  VIBE64_AGENT_TASK_ACTIVE_RESULT,
  runVibe64AgentWriteExclusive
};
