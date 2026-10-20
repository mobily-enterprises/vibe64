import { inject } from "vue";
import { VIBE64_LEARNING_KEY } from "@/lib/vibe64AssistantHost.js";

// The host shell's one Learning environment controller, or null where no host
// shell provides it (isolated components and tests).
export function useVibe64Learning() {
  return inject(VIBE64_LEARNING_KEY, null);
}
