const VIBE64_AGENT_PROVIDER_IDS = Object.freeze({
  CLAUDE: "claude",
  CODEX: "codex",
  OPENCODE: "opencode"
});

const VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE = "vibe64_agent_provider_not_implemented";
const VIBE64_AGENT_PROVIDER_UNKNOWN_CODE = "vibe64_agent_provider_unknown";

const VIBE64_AGENT_PARAMETER_IDS = Object.freeze({
  MODEL: "model",
  THINKING: "thinking"
});

const VIBE64_DEFAULT_AGENT_PROVIDER_ID = VIBE64_AGENT_PROVIDER_IDS.CODEX;
const VIBE64_CODEX_SOL_MODEL = "gpt-5.6-sol";
const VIBE64_CODEX_GPT_5_5_MODEL = "gpt-5.5";
const VIBE64_CODEX_DEFAULT_MODEL = VIBE64_CODEX_SOL_MODEL;
const VIBE64_CODEX_DEFAULT_THINKING = "xhigh";
const VIBE64_CODEX_SPARK_MODEL = "gpt-5.3-codex-spark";
const VIBE64_CODEX_SOURCE_EXPLANATION_MODEL = VIBE64_CODEX_SPARK_MODEL;
const VIBE64_CODEX_SOURCE_EXPLANATION_THINKING = "medium";
const VIBE64_CODEX_STANDARD_THINKING_VALUES = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh"
]);
const VIBE64_CODEX_SOL_THINKING_VALUES = Object.freeze([
  ...VIBE64_CODEX_STANDARD_THINKING_VALUES,
  "max"
]);

const VIBE64_AGENT_PROVIDERS = Object.freeze([
  Object.freeze({
    id: VIBE64_AGENT_PROVIDER_IDS.CODEX,
    implemented: true,
    label: "Codex",
    parameters: Object.freeze([
      Object.freeze({
        id: VIBE64_AGENT_PARAMETER_IDS.MODEL,
        defaultValue: VIBE64_CODEX_DEFAULT_MODEL,
        label: "Model",
        options: Object.freeze([
          Object.freeze({
            label: "Automatic (GPT-5.6 Sol)",
            value: ""
          }),
          Object.freeze({
            label: "GPT-5.6 Sol",
            supportedThinking: VIBE64_CODEX_SOL_THINKING_VALUES,
            value: VIBE64_CODEX_DEFAULT_MODEL
          }),
          Object.freeze({
            label: "GPT-5.5",
            supportedThinking: VIBE64_CODEX_STANDARD_THINKING_VALUES,
            value: VIBE64_CODEX_GPT_5_5_MODEL
          }),
          Object.freeze({
            label: "Codex Spark",
            request: Object.freeze({
              summary: false
            }),
            supportedThinking: VIBE64_CODEX_STANDARD_THINKING_VALUES,
            value: VIBE64_CODEX_SPARK_MODEL
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
          }),
          Object.freeze({
            label: "Max",
            value: "max"
          })
        ])
      })
    ])
  }),
  Object.freeze({
    id: VIBE64_AGENT_PROVIDER_IDS.CLAUDE,
    implemented: false,
    label: "Claude",
    parameters: Object.freeze([])
  }),
  Object.freeze({
    id: VIBE64_AGENT_PROVIDER_IDS.OPENCODE,
    implemented: false,
    label: "OpenCode",
    parameters: Object.freeze([])
  })
]);

function agentProviderDefinition(providerId = "") {
  const normalizedProviderId = normalizeAgentSettingText(providerId) || VIBE64_DEFAULT_AGENT_PROVIDER_ID;
  const provider = VIBE64_AGENT_PROVIDERS.find((candidate) => candidate.id === normalizedProviderId);
  if (provider) {
    return provider;
  }
  const error = new Error(`Unknown assistant provider: ${normalizedProviderId}.`);
  error.code = VIBE64_AGENT_PROVIDER_UNKNOWN_CODE;
  error.providerId = normalizedProviderId;
  throw error;
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
  const model = normalizedParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.MODEL, input.model);
  return {
    model,
    providerId: provider.id,
    thinking: normalizedAgentThinkingValue(provider, model, input.thinking)
  };
}

function defaultVibe64AgentSettings(providerId = VIBE64_DEFAULT_AGENT_PROVIDER_ID) {
  return normalizeVibe64AgentSettings({
    providerId
  });
}

function defaultVibe64SourceExplanationAgentSettings(providerId = VIBE64_DEFAULT_AGENT_PROVIDER_ID) {
  const provider = agentProviderDefinition(providerId);
  if (provider.id !== VIBE64_AGENT_PROVIDER_IDS.CODEX) {
    return defaultVibe64AgentSettings(provider.id);
  }
  return normalizeVibe64AgentSettings({
    model: VIBE64_CODEX_SOURCE_EXPLANATION_MODEL,
    providerId: provider.id,
    thinking: VIBE64_CODEX_SOURCE_EXPLANATION_THINKING
  });
}

function effectiveAgentParameterValue(provider = {}, parameterId = "", value = "") {
  const parameter = agentProviderParameter(provider, parameterId);
  const normalizedValue = normalizedParameterValue(provider, parameterId, value);
  return normalizedValue || normalizeAgentSettingText(parameter?.defaultValue);
}

function effectiveAgentParameterOption(provider = {}, parameterId = "", value = "") {
  const parameter = agentProviderParameter(provider, parameterId);
  const effectiveValue = effectiveAgentParameterValue(provider, parameterId, value);
  return (Array.isArray(parameter?.options) ? parameter.options : [])
    .find((option) => normalizeAgentSettingText(option.value) === effectiveValue) || null;
}

function supportedAgentThinkingValues(provider = {}, model = "") {
  const modelOption = effectiveAgentParameterOption(
    provider,
    VIBE64_AGENT_PARAMETER_IDS.MODEL,
    model
  );
  return Array.isArray(modelOption?.supportedThinking)
    ? new Set(modelOption.supportedThinking.map((value) => normalizeAgentSettingText(value)))
    : null;
}

function normalizedAgentThinkingValue(provider = {}, model = "", value = "") {
  const normalized = normalizedParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.THINKING, value);
  const supported = supportedAgentThinkingValues(provider, model);
  if (!supported || !normalized || supported.has(normalized)) {
    return normalized;
  }
  const fallback = normalizeAgentSettingText(
    agentProviderParameter(provider, VIBE64_AGENT_PARAMETER_IDS.THINKING)?.defaultValue
  );
  return supported.has(fallback) ? fallback : "";
}

function vibe64AgentSettingParameters(value = {}) {
  const normalized = normalizeVibe64AgentSettings(value);
  const provider = agentProviderDefinition(normalized.providerId);
  const modelOption = effectiveAgentParameterOption(
    provider,
    VIBE64_AGENT_PARAMETER_IDS.MODEL,
    normalized.model
  );
  const requestsReasoning = agentOptionRequestValue(modelOption, "reasoning", true);
  const supportedThinking = supportedAgentThinkingValues(provider, normalized.model);
  return (Array.isArray(provider.parameters) ? provider.parameters : []).flatMap((parameter) => {
    if (parameter.id === VIBE64_AGENT_PARAMETER_IDS.THINKING && requestsReasoning === false) {
      return [];
    }
    if (parameter.id !== VIBE64_AGENT_PARAMETER_IDS.THINKING || !supportedThinking) {
      return [parameter];
    }
    return [{
      ...parameter,
      options: parameter.options.filter((option) => (
        !normalizeAgentSettingText(option.value) ||
        supportedThinking.has(normalizeAgentSettingText(option.value))
      ))
    }];
  });
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

function agentOptionRequestValue(option = {}, name = "", fallback = true) {
  const request = option && typeof option.request === "object" && !Array.isArray(option.request)
    ? option.request
    : {};
  return Object.hasOwn(request, name) ? request[name] : fallback;
}

function effectiveVibe64AgentExecutionSettings(value = {}) {
  const normalized = normalizeVibe64AgentSettings(value);
  const provider = agentProviderDefinition(normalized.providerId);
  if (provider.implemented !== true) {
    const error = new Error(`Assistant provider is not implemented: ${provider.id}.`);
    error.code = VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE;
    error.providerId = provider.id;
    throw error;
  }
  const modelOption = effectiveAgentParameterOption(
    provider,
    VIBE64_AGENT_PARAMETER_IDS.MODEL,
    normalized.model
  );
  return {
    model: effectiveAgentParameterValue(provider, VIBE64_AGENT_PARAMETER_IDS.MODEL, normalized.model),
    providerId: provider.id,
    request: {
      reasoning: agentOptionRequestValue(modelOption, "reasoning", true),
      summary: agentOptionRequestValue(modelOption, "summary", true)
    },
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
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE,
  VIBE64_AGENT_PROVIDER_IDS,
  VIBE64_AGENT_PROVIDER_UNKNOWN_CODE,
  VIBE64_AGENT_PROVIDERS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  VIBE64_CODEX_GPT_5_5_MODEL,
  VIBE64_CODEX_SOL_MODEL,
  VIBE64_CODEX_SOURCE_EXPLANATION_MODEL,
  VIBE64_CODEX_SOURCE_EXPLANATION_THINKING,
  VIBE64_CODEX_SPARK_MODEL,
  VIBE64_DEFAULT_AGENT_PROVIDER_ID,
  defaultVibe64AgentSettings,
  defaultVibe64SourceExplanationAgentSettings,
  displayVibe64AgentSetting,
  effectiveVibe64AgentExecutionSettings,
  effectiveVibe64AgentSettings,
  normalizeVibe64AgentSettings,
  publicVibe64AgentSettings,
  vibe64AgentSettingParameters
};
