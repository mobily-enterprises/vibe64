import { VIBE64_AGENT_PROVIDERS } from "./agentSettings.js";

function vibe64AssistantSelectionLabel(selection, { includeThinking = true } = {}) {
  const engine = VIBE64_AGENT_PROVIDERS.find(({ id }) => id === selection.engineId)?.label || selection.engineId;
  if (!includeThinking) return `${engine} (${selection.modelId})`;
  const thinking = selection.variantId === "" ? "default" : selection.variantId || "not recorded";
  return `${engine} (${selection.modelId} ${thinking})`;
}

export { vibe64AssistantSelectionLabel };
