// A session agent run's states, which sessionRecordRules.js validates and the session store writes, and the run id
// that names its file. They live in this file, which imports nothing, so that workingTurns.js reads runs by the same
// rules without loading the editor's modules.

const VIBE64_AGENT_RUN_STATE = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  FINALIZING: "finalizing",
  INTERRUPTED: "interrupted",
  STARTING: "starting",
  TIMED_OUT: "timed_out"
});
const AGENT_RUN_STATES = new Set(Object.values(VIBE64_AGENT_RUN_STATE));
const TERMINAL_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.CANCELLED,
  VIBE64_AGENT_RUN_STATE.COMPLETED,
  VIBE64_AGENT_RUN_STATE.FAILED,
  VIBE64_AGENT_RUN_STATE.INTERRUPTED,
  VIBE64_AGENT_RUN_STATE.TIMED_OUT
]);
const ACTIVE_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.ACTIVE,
  VIBE64_AGENT_RUN_STATE.FINALIZING,
  VIBE64_AGENT_RUN_STATE.STARTING
]);
const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;

export {
  ACTIVE_AGENT_RUN_STATES,
  AGENT_RUN_ID_PATTERN,
  AGENT_RUN_STATES,
  TERMINAL_AGENT_RUN_STATES,
  VIBE64_AGENT_RUN_STATE
};
