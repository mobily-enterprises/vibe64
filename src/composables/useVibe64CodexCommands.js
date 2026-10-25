import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { useVibe64AttachmentCommands } from "@/composables/useVibe64AttachmentCommands.js";

function useVibe64CodexCommands() {
  return { ...useVibe64TerminalCommands(), ...useVibe64AttachmentCommands() };
}

export { useVibe64CodexCommands };
