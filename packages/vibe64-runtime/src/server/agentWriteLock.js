const VIBE64_AGENT_WRITE_LOCK = "agent-write-mode";

const VIBE64_AGENT_WRITE_BUSY_RESULT = Object.freeze({
  code: "vibe64_agent_write_mode_busy",
  error: "Another assistant operation is starting. Try again in a moment.",
  ok: false,
  retryable: true
});

async function runVibe64AgentWriteExclusive(runtime, sessionId = "", operation, options = {}) {
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
    operation,
    { ...options, operation: options.operation || "assistant-operation" }
  );
  return exclusive.acquired
    ? exclusive
    : {
        acquired: false,
        value: exclusive.blockingOperation === "prepare-agent-session"
          ? {
              ...VIBE64_AGENT_WRITE_BUSY_RESULT,
              error: "The assistant is still reconnecting. Wait until it is ready, then try again.",
              details: { blockingOperation: exclusive.blockingOperation }
            }
          : VIBE64_AGENT_WRITE_BUSY_RESULT
      };
}

async function runVibe64RenewalAgentWriteExclusive(runtime, sessionId = "", operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("Exclusive Vibe64 renewal agent work requires an operation.");
  }
  if (typeof runtime?.store?.runSessionExclusiveForRenewal !== "function") {
    throw new TypeError("Exclusive Vibe64 renewal agent work requires the private renewal lock boundary.");
  }
  const exclusive = await runtime.store.runSessionExclusiveForRenewal(
    sessionId,
    VIBE64_AGENT_WRITE_LOCK,
    operation,
    { ...options, operation: options.operation || "session-renewal" }
  );
  return exclusive.acquired
    ? exclusive
    : {
        acquired: false,
        value: VIBE64_AGENT_WRITE_BUSY_RESULT
      };
}

// A busy agent-write lock refuses the caller with a retryable 409 conflict.
// HTTP callers show its message; without a status it would be a server error.
function agentWriteBusyError(result = VIBE64_AGENT_WRITE_BUSY_RESULT) {
  return Object.assign(new Error(result.error || VIBE64_AGENT_WRITE_BUSY_RESULT.error),
    VIBE64_AGENT_WRITE_BUSY_RESULT, result, { retryable: true, statusCode: 409 });
}

function throwIfAgentWriteBusy(result) {
  if (result?.ok === false && result.code === VIBE64_AGENT_WRITE_BUSY_RESULT.code) {
    throw agentWriteBusyError(result);
  }
  return result;
}

export {
  agentWriteBusyError,
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive,
  throwIfAgentWriteBusy
};
