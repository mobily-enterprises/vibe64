const VIBE64_AGENT_PROVIDER_IDS = Object.freeze({
  CODEX: "codex"
});

const VIBE64_AGENT_PARAMETER_IDS = Object.freeze({
  MODEL: "model",
  THINKING: "thinking"
});

const VIBE64_DEFAULT_AGENT_PROVIDER_ID = VIBE64_AGENT_PROVIDER_IDS.CODEX;
const VIBE64_CODEX_DEFAULT_MODEL = "gpt-5.5";
const VIBE64_CODEX_DEFAULT_THINKING = "xhigh";

const VIBE64_AGENT_PROVIDERS = Object.freeze([
  Object.freeze({
    id: VIBE64_AGENT_PROVIDER_IDS.CODEX,
    label: "Codex",
    parameters: Object.freeze([
      Object.freeze({
        id: VIBE64_AGENT_PARAMETER_IDS.MODEL,
        defaultValue: VIBE64_CODEX_DEFAULT_MODEL,
        label: "Model",
        options: Object.freeze([
          Object.freeze({
            label: "Automatic",
            value: ""
          }),
          Object.freeze({
            label: "GPT-5.5",
            value: VIBE64_CODEX_DEFAULT_MODEL
          })
        ])
      }),
      Object.freeze({
        id: VIBE64_AGENT_PARAMETER_IDS.THINKING,
        defaultValue: VIBE64_CODEX_DEFAULT_THINKING,
        label: "Thinking",
        options: Object.freeze([
          Object.freeze({
            label: "Automatic",
            value: ""
          }),
          Object.freeze({
            label: "Low",
            value: "low"
          }),
          Object.freeze({
            label: "Medium",
            value: "medium"
          }),
          Object.freeze({
            label: "High",
            value: "high"
          }),
          Object.freeze({
            label: "X High",
            value: "xhigh"
          })
        ])
      })
    ])
  })
]);

function agentProviderDefinition(providerId = "") {
  const normalizedProviderId = normalizeAgentSettingText(providerId) || VIBE64_DEFAULT_AGENT_PROVIDER_ID;
  return VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === normalizedProviderId) ||
    VIBE64_AGENT_PROVIDERS[0];
}

function agentProviderParameter(provider = {}, parameterId = "") {
  const normalizedParameterId = normalizeAgentSettingText(parameterId);
  return (Array.isArray(provider.parameters) ? provider.parameters : [])
    .find((parameter) => parameter.id === normalizedParameterId) || null;
}

function normalizeAgentSettingText(value = "") {
  return String(value || "").trim();
}

function normalizedParameterValue(provider = {}, parameterId = "", value = "") {
  const parameter = agentProviderParameter(provider, parameterId);
  if (!parameter) {
    return "";
  }
  const requested = normalizeAgentSettingText(value);
  const options = Array.isArray(parameter.options) ? parameter.options : [];
  const supported = options.some((option) => (
    normalizeAgentSettingText(option.value) === requested
  ));
  if (supported) {
    return requested;
  }
  return normalizeAgentSettingText(parameter.defaultValue);
}

function normalizeVibe64AgentSettings(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const provider = agentProviderDefinition(input.providerId || input.provider);
  return {
    model: normalizedParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.MODEL, input.model),
    providerId: provider.id,
    thinking: normalizedParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.THINKING, input.thinking)
  };
}

function defaultVibe64AgentSettings(providerId = VIBE64_DEFAULT_AGENT_PROVIDER_ID) {
  return normalizeVibe64AgentSettings({
    providerId
  });
}

function effectiveAgentParameterValue(provider = {}, parameterId = "", value = "") {
  const parameter = agentProviderParameter(provider, parameterId);
  const normalizedValue = normalizedParameterValue(provider, parameterId, value);
  return normalizedValue || normalizeAgentSettingText(parameter?.defaultValue);
}

function effectiveVibe64AgentSettings(value = {}) {
  const normalized = normalizeVibe64AgentSettings(value);
  const provider = agentProviderDefinition(normalized.providerId);
  return {
    model: effectiveAgentParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.MODEL, normalized.model),
    providerId: provider.id,
    thinking: effectiveAgentParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.THINKING, normalized.thinking)
  };
}

function publicVibe64AgentSettings(value = {}) {
  const normalized = normalizeVibe64AgentSettings(value);
  return {
    model: normalized.model,
    providerId: normalized.providerId,
    thinking: normalized.thinking
  };
}

function displayVibe64AgentSetting(providerId = "", parameterId = "", value = "") {
  const provider = agentProviderDefinition(providerId);
  const parameter = agentProviderParameter(provider, parameterId);
  const normalizedValue = normalizeAgentSettingText(value);
  const option = (Array.isArray(parameter?.options) ? parameter.options : [])
    .find((candidate) => normalizeAgentSettingText(candidate.value) === normalizedValue);
  return option?.label || normalizedValue || "Automatic";
}

export {
  VIBE64_AGENT_PARAMETER_IDS,
  VIBE64_AGENT_PROVIDER_IDS,
  VIBE64_AGENT_PROVIDERS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  VIBE64_DEFAULT_AGENT_PROVIDER_ID,
  defaultVibe64AgentSettings,
  displayVibe64AgentSetting,
  effectiveVibe64AgentSettings,
  normalizeVibe64AgentSettings,
  publicVibe64AgentSettings
};
