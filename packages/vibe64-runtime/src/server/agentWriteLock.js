/** @typedef {import("./runtime.js").Vibe64SessionRuntime} Vibe64SessionRuntime */

const VIBE64_AGENT_WRITE_LOCK = "agent-write-mode";

const VIBE64_AGENT_WRITE_BUSY_RESULT = Object.freeze({
  code: "vibe64_agent_write_mode_busy",
  error: "Another assistant operation is starting. Try again in a moment.",
  ok: false,
  retryable: true
});

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 * @param {(context?: object) => Promise<unknown>} operation
 * @param {object} [options]
 */
async function runVibe64AgentWriteExclusive(runtime, sessionId, operation, options = {}) {
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

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 * @param {(context?: object) => Promise<unknown>} operation
 * @param {object} [options]
 */
async function runVibe64RenewalAgentWriteExclusive(runtime, sessionId, operation, options = {}) {
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

/**
 * A busy agent-write lock refuses the caller with a retryable 409 conflict.
 * HTTP callers show its message; without a status it would be a server error.
 */
function agentWriteBusyError(result = VIBE64_AGENT_WRITE_BUSY_RESULT) {
  return Object.assign(
    new Error(result.error || VIBE64_AGENT_WRITE_BUSY_RESULT.error),
    VIBE64_AGENT_WRITE_BUSY_RESULT,
    result,
    { retryable: true, statusCode: 409 }
  );
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
