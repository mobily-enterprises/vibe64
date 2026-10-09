/** Pure mapping; the calling application owner must authorize the selection. */
export function conversationConfiguration(assistantSelection, systemPrompt) {
  const { engineId, modelProviderId, modelId, variantId } = assistantSelection;
  const nativeAccount = engineId === "codex" && modelProviderId === "openai" ||
    engineId === "claude" && modelProviderId === "anthropic";
  return { engine: engineId, configuration: { systemPrompt, model: modelId,
    ...(!nativeAccount ? { integrationId: modelProviderId } : {}), ...(variantId ? { effort: variantId } : {}) } };
}
