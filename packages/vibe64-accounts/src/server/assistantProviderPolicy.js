const OPENCODE_NATIVE_ENDPOINT_CODE = "opencode-native";

const ASSISTANT_PROVIDER_POLICIES = Object.freeze({
  anthropic: Object.freeze({
    billingLabel: "Usage-based API billing",
    economyModelId: "claude-haiku-4-5",
    managementUrl: "https://platform.claude.com/settings/billing",
    ownerOnly: false
  }),
  deepseek: Object.freeze({
    billingLabel: "Usage-based API billing",
    economyModelId: "deepseek-v4-flash",
    managementUrl: "https://platform.deepseek.com/top_up",
    ownerOnly: false
  }),
  opencode: Object.freeze({
    billingLabel: "Big Pickle included; a Zen key unlocks every Zen model",
    economyModelId: "big-pickle",
    includedModelId: "big-pickle",
    managementUrl: "https://opencode.ai/zen",
    ownerOnly: false,
    productLabel: "OpenCode Zen"
  }),
  openai: Object.freeze({
    billingLabel: "Usage-based API billing",
    economyModelId: "gpt-5-mini",
    managementUrl: "https://platform.openai.com/settings/organization/billing/overview",
    ownerOnly: false
  }),
  zai: Object.freeze({
    billingLabel: "Free and usage-based API",
    economyModelId: "glm-4.7-flash",
    managementUrl: "https://z.ai/manage-apikey/billing",
    modelAccess: Object.freeze({
      configurable: true,
      label: "Unlock all Z.AI models",
      recommendedModelId: "glm-4.7-flash",
      warning: "Other Z.AI models use paid API credit. Unlock them only if this Z.AI account has billing or credit available."
    }),
    ownerOnly: false,
    productLabel: "GLM-4.7 Flash · Regular Z.AI API",
    routeLabel: "Regular Z.AI API",
    routeNote: "Does not use Personal Coding Plan quota."
  }),
  "zai-coding-plan": Object.freeze({
    billingLabel: "Coding Plan quota",
    economyModelId: "glm-5.3-flash",
    managementUrl: "https://z.ai/subscribe",
    ownerOnly: true,
    productLabel: "GLM · Personal Coding Plan",
    routeLabel: "Z.AI Personal Coding Plan"
  })
});

function text(value = "") {
  return String(value ?? "").trim();
}

function assistantProviderError(code = "", message = "", statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assistantProviderPolicy(provider = {}) {
  const modelProviderId = text(provider.id || provider.modelProviderId);
  if (!modelProviderId) {
    throw assistantProviderError(
      "vibe64_ai_provider_unknown",
      "Choose a provider from the current OpenCode catalog."
    );
  }
  const configured = ASSISTANT_PROVIDER_POLICIES[modelProviderId] || {};
  const economyModelId = text(configured.economyModelId || provider.defaultModelId);
  if (!economyModelId) {
    throw assistantProviderError(
      "vibe64_ai_provider_default_model_missing",
      "OpenCode did not identify a default model for this provider.",
      409
    );
  }
  const ownerOnly = configured.ownerOnly !== false;
  return {
    accessLabel: ownerOnly ? "Personal use" : "Workspace use",
    billingLabel: text(configured.billingLabel) || "Provider API key",
    canonicalUrl: "",
    economyModelId,
    endpointCode: OPENCODE_NATIVE_ENDPOINT_CODE,
    includedModelId: text(configured.includedModelId),
    managementUrl: text(configured.managementUrl),
    modelAccess: configured.modelAccess
      ? { ...configured.modelAccess }
      : null,
    modelProviderId,
    ownerOnly,
    productLabel: text(configured.productLabel || provider.label) || modelProviderId,
    routeLabel: text(configured.routeLabel || configured.productLabel || provider.label) || modelProviderId,
    routeNote: text(configured.routeNote)
  };
}

export {
  OPENCODE_NATIVE_ENDPOINT_CODE,
  assistantProviderPolicy
};
