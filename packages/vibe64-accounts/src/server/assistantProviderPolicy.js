import { aiConnectionError } from "./aiConnectionError.js";

const OPENCODE_NATIVE_ENDPOINT_CODE = "opencode-native";
// The Z.AI model Vibe64 starts on: free, and verified directly against Z.AI.
const ZAI_FREE_MODEL_ID = "glm-4.7-flash";

const ASSISTANT_PROVIDER_POLICIES = Object.freeze({
  anthropic: Object.freeze({
    billingLabel: "Usage-based API billing",
    defaultModelId: "claude-haiku-4-5",
    managementUrl: "https://platform.claude.com/settings/billing",
    ownerOnly: false
  }),
  deepseek: Object.freeze({
    billingLabel: "Usage-based API billing",
    defaultModelId: "deepseek-flash",
    managementUrl: "https://platform.deepseek.com/top_up",
    ownerOnly: false
  }),
  opencode: Object.freeze({
    billingLabel: "Usage-based Zen API billing",
    defaultModelId: "claude-haiku-4-5",
    managementUrl: "https://opencode.ai/zen",
    ownerOnly: false,
    productLabel: "OpenCode Zen"
  }),
  openai: Object.freeze({
    billingLabel: "Usage-based API billing",
    defaultModelId: "gpt-5-mini",
    managementUrl: "https://platform.openai.com/settings/organization/billing/overview",
    ownerOnly: false
  }),
  zai: Object.freeze({
    billingLabel: "Free and usage-based API",
    defaultModelId: ZAI_FREE_MODEL_ID,
    managementUrl: "https://z.ai/manage-apikey/billing",
    modelAccess: Object.freeze({
      configurable: true,
      label: "Unlock all Z.AI models",
      recommendedModelId: ZAI_FREE_MODEL_ID,
      warning: "Other Z.AI models use paid API credit. Unlock them only if this Z.AI account has billing or credit available."
    }),
    ownerOnly: false,
    productLabel: "GLM-4.7 Flash · Regular Z.AI API",
    routeLabel: "Regular Z.AI API",
    routeNote: "Does not use Personal Coding Plan quota."
  }),
  "zai-coding-plan": Object.freeze({
    billingLabel: "Coding Plan quota",
    defaultModelId: "glm-5.3-flash",
    managementUrl: "https://z.ai/subscribe",
    ownerOnly: true,
    productLabel: "GLM · Personal Coding Plan",
    routeLabel: "Z.AI Personal Coding Plan"
  })
});

function text(value = "") {
  return String(value ?? "").trim();
}

function assistantProviderPolicy(provider = {}) {
  const modelProviderId = text(provider.id || provider.modelProviderId);
  if (!modelProviderId) {
    throw aiConnectionError(
      "vibe64_ai_provider_unknown",
      "Choose a provider from the current OpenCode catalog."
    );
  }
  const configured = ASSISTANT_PROVIDER_POLICIES[modelProviderId] || {};
  const defaultModelId = text(configured.defaultModelId || provider.defaultModelId);
  if (!defaultModelId) {
    throw aiConnectionError(
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
    defaultModelId,
    endpointCode: OPENCODE_NATIVE_ENDPOINT_CODE,
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
  ZAI_FREE_MODEL_ID,
  assistantProviderPolicy
};
