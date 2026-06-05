const AGENT_PROVIDER_IDS = Object.freeze({
  CODEX_APP_SERVER: "codex_app_server"
});

function normalizeAgentText(value = "") {
  return String(value ?? "").trim();
}

function textAgentInput(text = "") {
  return {
    text: String(text ?? ""),
    type: "text"
  };
}

function normalizeAgentThread(value = {}) {
  const thread = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(thread.id || thread.threadId),
    provider: normalizeAgentText(thread.provider),
    raw: thread.raw || thread
  };
}

function normalizeAgentTurn(value = {}) {
  const turn = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    id: normalizeAgentText(turn.id || turn.turnId),
    provider: normalizeAgentText(turn.provider),
    raw: turn.raw || turn,
    status: normalizeAgentText(turn.status || turn.raw?.status)
  };
}

export {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  normalizeAgentThread,
  normalizeAgentTurn,
  textAgentInput
};
