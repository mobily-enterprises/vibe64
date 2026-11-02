import { inject } from "vue";
import { VIBE64_LEARNING_KEY } from "@/lib/vibe64AssistantHost.js";

/**
 * The host shell's one Learning environment controller, which
 * Vibe64AssistantShellContext provides to every page and view of the shell.
 * @returns {ReturnType<typeof import("../lib/vibe64Learning.js").createVibe64Learning>}
 */
export function useVibe64Learning() {
  return inject(VIBE64_LEARNING_KEY);
}
