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
// commentary, so commentary is shown as thinking. accountLabel names the
// account a Codex or Claude Code selection runs on as AI Accounts does: its
// curated key provider, or the tool's own sign-in that plan usage also names.
// OpenCode names its connections itself, so its account has no name here.
function vibe64ProviderPresentation(selection = {}) {
  const provider = curatedCodexProvider(selection?.modelProviderId);
  const nativeTool = [VIBE64_ASSISTANT_ENGINE_IDS.CODEX, VIBE64_ASSISTANT_ENGINE_IDS.CLAUDE].includes(selection?.engineId);
  return Object.freeze({
    label: provider?.shortLabel || findVibe64AgentProvider(selection?.engineId)?.label || "",
    accountLabel: nativeTool ? provider?.label || findVibe64AgentProvider(selection.engineId).planUsage.label : "",
    keyUsage: Boolean(provider),
    commentaryAsThinking: Boolean(provider) && nativeTool
  });
}

export { vibe64AssistantSelectionLabel, vibe64ProviderPresentation };
