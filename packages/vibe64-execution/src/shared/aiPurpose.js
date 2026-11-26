// What an AI run is for, carried on its execution record (`execution.aiPurpose`), in its label and in its unit's
// description, so whatever lists running work tells a chat's agent turn from a helper feature's one-off turn:
// "agent-turn", or "helper:<feature>" ("helper:prompt_hint"); a process serving several helper features is
// "helper:shared". A helper turn is never a crucial operation and never steered; a restart simply ends it.

const AI_PURPOSE_AGENT_TURN = "agent-turn";
const AI_PURPOSE_HELPER_SHARED = "helper:shared";
const AI_PURPOSE_PATTERN = /^(?:agent-turn|helper:[a-z0-9][a-z0-9_-]{0,63})$/u;

/** @param {string} feature a helper's workload id, such as "prompt_hint" */
function aiHelperPurpose(feature) {
  return `helper:${feature}`;
}

/** @param {unknown} value */
function isAiPurpose(value) {
  return typeof value === "string" && AI_PURPOSE_PATTERN.test(value);
}

export { AI_PURPOSE_AGENT_TURN, AI_PURPOSE_HELPER_SHARED, aiHelperPurpose, isAiPurpose };
