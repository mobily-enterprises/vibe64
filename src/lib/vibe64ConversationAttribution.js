import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";

// A reply keeps its recorded selection, even after the composer selects another AI.
export function conversationAttribution(selection, routing) {
  return {
    assistantLabel: !selection ? "agent" : `${routing?.resolvedMode ? `${assistantModeLabel(routing.resolvedMode)} · ` : ""}${vibe64AssistantSelectionLabel(selection)}`,
    assistantDetails: selection
      ? `${vibe64AssistantSelectionLabel(selection)}\nProvider: ${selection.modelProviderId}`
      : undefined
  };
}
