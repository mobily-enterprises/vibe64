import { computed } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { useVibe64AttachmentCommands } from "@/composables/useVibe64AttachmentCommands.js";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";

function useVibe64CodexCommands() {
  const paths = usePaths();
  const terminalCommands = useVibe64TerminalCommands({
    sessionsApiPath: computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, { surface: VIBE64_SURFACE_ID }))
  });
  return { ...terminalCommands, ...useVibe64AttachmentCommands() };
}

export { useVibe64CodexCommands };
