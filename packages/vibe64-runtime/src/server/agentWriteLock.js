import { vibe64Error } from "@local/vibe64-core/server/core";

/** @typedef {import("./runtime.js").Vibe64SessionRuntime} Vibe64SessionRuntime */

const VIBE64_AGENT_WRITE_LOCK = "agent-write-mode";

const VIBE64_AGENT_WRITE_BUSY_RESULT = Object.freeze({
  code: "vibe64_agent_write_mode_busy",
  error: "Another assistant operation is starting. Try again in a moment.",
  ok: false,
  retryable: true
});

// What a refusal says is running, by the operation its holder recorded on the lock. A holder not named here
// is "another assistant operation".
const AGENT_WRITE_HOLDERS = new Map([
  ["prepare-agent-session", "The assistant is still reconnecting. Wait until it is ready, then try again."],
  ["prepare-renewal-workspace", "The workspace is being prepared. Try again when it is ready."],
  ["prepare-workspace", "The workspace is being prepared. Try again when it is ready."],
  ["recover-session-save", "An interrupted Save is being recovered. Try again when it finishes."],
  ["recover-session-update", "An interrupted Update is being recovered. Try again when it finishes."],
  ["save-session-work", "This session is being saved. Try again when Save finishes."],
  ["update-session-work", "This session is being updated. Try again when Update finishes."]
]);

/** The refusal of a lock that `blockingOperation` holds, naming what it is doing when it says. */
function agentWriteBusyResult(blockingOperation = "") {
  const error = AGENT_WRITE_HOLDERS.get(blockingOperation);
  return error
    ? { ...VIBE64_AGENT_WRITE_BUSY_RESULT, error, details: { blockingOperation } }
    : VIBE64_AGENT_WRITE_BUSY_RESULT;
}

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
  return exclusive.acquired ? exclusive : { acquired: false, value: agentWriteBusyResult(exclusive.blockingOperation) };
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
  return exclusive.acquired ? exclusive : { acquired: false, value: agentWriteBusyResult(exclusive.blockingOperation) };
}

/**
 * A busy agent-write lock refuses the caller with a retryable 409 conflict.
 * HTTP callers show its message; without a status it would be a server error.
 */
function agentWriteBusyError(result = VIBE64_AGENT_WRITE_BUSY_RESULT) {
  const { code, details, error, ok: _ok, retryable: _retryable, ...fields } = { ...VIBE64_AGENT_WRITE_BUSY_RESULT, ...result };
  const message = error || VIBE64_AGENT_WRITE_BUSY_RESULT.error;
  return Object.assign(vibe64Error(message, code, { status: 409, details }), fields, { retryable: true });
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
