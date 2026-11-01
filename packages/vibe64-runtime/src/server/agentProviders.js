
const AGENT_PROVIDER_IDS = Object.freeze({
  CODEX_APP_SERVER: "codex_app_server"
});

function textAgentInput(text = "") {
  return {
    text: String(text ?? ""),
    type: "text"
  };
}

export {
  AGENT_PROVIDER_IDS,
  textAgentInput
};
