import {
  CUSTOM_AI_PROVIDER_ID,
  customAiProvider,
  nativeAiModel,
  nativeAiProvider
} from "@jskit-ai/assistant-core/shared/native-providers";

/**
 * Product choices and presentation. JSKIT owns native routes and capabilities.
 */
const curatedModel = (providerId, id, label, defaultThinking) => {
  const { modelProviderId: _provider, ...definition } = nativeAiModel(id, providerId);
  return Object.freeze({
    ...definition,
    label,
    defaultThinking
  });
};
const CURATED_CODEX_PROVIDERS = Object.freeze([
  Object.freeze({
    ...nativeAiProvider("deepseek"),
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    description: "DeepSeek API key · usage-based billing",
    keyUrl: "https://platform.deepseek.com/api_keys",
    guideUrl: "https://api-docs.deepseek.com/quick_start/agent_integrations/codex/",
    ownerOnly: false,
    models: Object.freeze([
      curatedModel("deepseek", "deepseek-flash", "DeepSeek V4.1 Flash", "high"),
      curatedModel("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", "high")
    ])
  }),
  Object.freeze({
    ...nativeAiProvider("zai-coding-plan"),
    label: "GLM · Coding Plan",
    shortLabel: "GLM",
    description: "Z.AI Coding Plan key · uses your subscription quota",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    guideUrl: "https://docs.z.ai/devpack/tool/codex",
    ownerOnly: true,
    models: Object.freeze([
      curatedModel("zai-coding-plan", "glm-5.3", "GLM 5.3", "max")
    ])
  }),
  Object.freeze({
    ...nativeAiProvider("zai"),
    label: "GLM · Pay-as-you-go API",
    shortLabel: "GLM",
    description: "Z.AI API key · pay-as-you-go account",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    guideUrl: "https://docs.z.ai/guides/overview/quick-start",
    setupNote: "Use a key from a Z.AI account without a Coding Plan. Pay-as-you-go access through Codex and Claude Code still needs live verification; a successful check confirms model access, not billing.",
    ownerOnly: false,
    models: Object.freeze([
      curatedModel("zai", "glm-5.3", "GLM 5.3", "max")
    ])
  }),
  // A model server the owner runs or reaches. Its one model comes from the
  // saved connection, so this entry lists none.
  Object.freeze({
    id: CUSTOM_AI_PROVIDER_ID,
    custom: true,
    label: "Custom endpoint",
    shortLabel: "Custom",
    description: "Your own model server · no Vibe64 billing",
    ownerOnly: true,
    models: Object.freeze([])
  })
]);

/** Each engine a provider connects; only a custom endpoint also connects OpenCode. */
function curatedProviderEngines(providerId) {
  return providerId === CUSTOM_AI_PROVIDER_ID ? ["codex", "claude", "opencode"] : ["codex", "claude"];
}

/**
 * The custom endpoint as one engine's provider, from its saved connection.
 * @param {"codex" | "claude" | "opencode"} engineId
 * @param {{ baseUrl: string, model: string, contextWindow: number }} endpoint
 */
function customEndpointProvider(engineId, { baseUrl, model, contextWindow }) {
  const { models, ...route } = customAiProvider({ engineId, baseUrl, model, contextWindow, label: "Custom endpoint" });
  return Object.freeze({
    ...curatedCodexProvider(CUSTOM_AI_PROVIDER_ID),
    ...route,
    label: "Custom endpoint",
    models
  });
}

function curatedCodexProvider(id) {
  return CURATED_CODEX_PROVIDERS.find((provider) => provider.id === id) || null;
}

function curatedCodexModel(id, providerId = "") {
  for (const provider of CURATED_CODEX_PROVIDERS) {
    if (providerId && provider.id !== providerId) continue;
    const model = provider.models.find((candidate) => candidate.id === id);
    if (model) return { ...model, modelProviderId: provider.id };
  }
  return null;
}

export {
  CURATED_CODEX_PROVIDERS,
  CUSTOM_AI_PROVIDER_ID,
  curatedCodexProvider,
  curatedCodexModel,
  curatedProviderEngines,
  customEndpointProvider
};
