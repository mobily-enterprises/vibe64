import { nativeAiModel, nativeAiProvider } from "@jskit-ai/assistant-core/shared/native-providers";

// Product choices and presentation. JSKIT owns native routes and capabilities.
const model = (providerId, id, label, defaultThinking) => {
  const { modelProviderId: _provider, ...definition } = nativeAiModel(id, providerId);
  return Object.freeze({ ...definition, label, defaultThinking });
};
const CURATED_CODEX_PROVIDERS = Object.freeze([
  Object.freeze({
    ...nativeAiProvider("deepseek"), label: "DeepSeek",
    description: "DeepSeek API key · usage-based billing",
    keyUrl: "https://platform.deepseek.com/api_keys",
    guideUrl: "https://api-docs.deepseek.com/quick_start/agent_integrations/codex/",
    ownerOnly: false,
    models: Object.freeze([
      model("deepseek", "deepseek-flash", "DeepSeek V4.1 Flash", "high"),
      model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", "high")
    ])
  }),
  Object.freeze({
    ...nativeAiProvider("zai-coding-plan"), label: "GLM · Coding Plan",
    description: "Z.AI Coding Plan key · uses your subscription quota",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    guideUrl: "https://docs.z.ai/devpack/tool/codex",
    ownerOnly: true,
    models: Object.freeze([
      model("zai-coding-plan", "glm-5.3", "GLM 5.3", "max")
    ])
  }),
  Object.freeze({
    ...nativeAiProvider("zai"), label: "GLM · Pay-as-you-go API",
    description: "Z.AI API key · pay-as-you-go account",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    guideUrl: "https://docs.z.ai/guides/overview/quick-start",
    setupNote: "Use a key from a Z.AI account without a Coding Plan. Pay-as-you-go access through Codex and Claude Code still needs live verification; a successful check confirms model access, not billing.",
    ownerOnly: false,
    models: Object.freeze([
      model("zai", "glm-5.3", "GLM 5.3", "max")
    ])
  })
]);

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

export { CURATED_CODEX_PROVIDERS, curatedCodexProvider, curatedCodexModel };
