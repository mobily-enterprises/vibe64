import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { findVibe64AgentProvider, VIBE64_AGENT_PROVIDERS } from "./agentSettings.js";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "./assistantSelection.js";

function vibe64AssistantSelectionLabel(selection, { includeThinking = true } = {}) {
  const engine = VIBE64_AGENT_PROVIDERS.find(({ id }) => id === selection.engineId)?.label || selection.engineId;
  if (!includeThinking) return `${engine} (${selection.modelId})`;
  const thinking = selection.variantId === "" ? "default" : selection.variantId || "not recorded";
  return `${engine} (${selection.modelId} ${thinking})`;
}

// How a selection's model provider is shown. Curated key providers report their
// own key usage and, through Codex or Claude Code, send their reasoning as
// commentary, so commentary is shown as thinking.
function vibe64ProviderPresentation(selection = {}) {
  const provider = curatedCodexProvider(selection?.modelProviderId);
  return Object.freeze({
    label: provider?.shortLabel || findVibe64AgentProvider(selection?.engineId)?.label || "",
    keyUsage: Boolean(provider),
    commentaryAsThinking: Boolean(provider) &&
      [VIBE64_ASSISTANT_ENGINE_IDS.CODEX, VIBE64_ASSISTANT_ENGINE_IDS.CLAUDE].includes(selection?.engineId)
  });
}

export { vibe64AssistantSelectionLabel, vibe64ProviderPresentation };
