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

export {
  AGENT_PROVIDER_IDS,
  normalizeAgentText,
  textAgentInput
};
