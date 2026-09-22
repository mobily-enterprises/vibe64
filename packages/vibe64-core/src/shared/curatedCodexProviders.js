// Fixed routes and model metadata from the providers' Codex integration guides.
// Reviewed 2026-09-22. Provider keys and native configuration are server-owned.
const model = (id, label, contextWindow, variants, options = {}) => Object.freeze({
  id, label, contextWindow, variants: Object.freeze(variants), ...options
});
const CURATED_CODEX_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/",
    description: "DeepSeek API key · usage-based billing",
    keyUrl: "https://platform.deepseek.com/api_keys",
    guideUrl: "https://api-docs.deepseek.com/quick_start/agent_integrations/codex/",
    ownerOnly: false, webSearch: false,
    models: Object.freeze([
      model("deepseek-flash", "DeepSeek V4.1 Flash", 1048576, ["low", "high", "max"], { images: true, defaultThinking: "high", freeformPatch: true }),
      model("deepseek-v4-pro", "DeepSeek V4 Pro", 1048576, ["low", "high", "max"], { defaultThinking: "high", freeformPatch: true })
    ])
  }),
  Object.freeze({
    id: "zai-coding-plan", label: "GLM · Coding Plan", baseUrl: "https://api.z.ai/api/v1",
    description: "Z.AI Coding Plan key · uses your subscription quota",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    guideUrl: "https://docs.z.ai/devpack/tool/codex",
    ownerOnly: true, webSearch: false,
    models: Object.freeze([
      model("glm-5.3", "GLM 5.3", 1048576, ["low", "high", "max"], { defaultThinking: "max", freeformPatch: true })
    ])
  })
]);

function curatedCodexProvider(id) {
  return CURATED_CODEX_PROVIDERS.find((provider) => provider.id === id) || null;
}

function curatedCodexModel(id) {
  for (const provider of CURATED_CODEX_PROVIDERS) {
    const model = provider.models.find((candidate) => candidate.id === id);
    if (model) return { ...model, modelProviderId: provider.id };
  }
  return null;
}

export { CURATED_CODEX_PROVIDERS, curatedCodexProvider, curatedCodexModel };
