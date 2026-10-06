import { createCodexSessionAgentProvider as createProvider } from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";

// Original adapter units mock application facilities, not native ownership.
// Keep their mock identity (including the attachment retry key) unchanged.
export function createCodexSessionAgentProvider({ controller, ...options } = {}) {
  const provider = createProvider({
    ...options,
    catalog: controller,
    terminals: controller,
    attachments: controller,
    lifecyclePreparation: controller
  });
  return typeof controller?.prepareConversationHost === "function"
    ? { ...provider, prepareConversationHost: controller.prepareConversationHost }
    : provider;
}
