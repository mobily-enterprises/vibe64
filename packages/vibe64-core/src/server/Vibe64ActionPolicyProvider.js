import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { vibe64ActionPolicy } from "./actionContext.js";

/**
 * Supplies the rule every Vibe64 operation runs under to JSKIT's action
 * catalogue. A provider rather than a feature: a feature requires
 * `runtime.actions`, which takes this policy.
 */
const Vibe64ActionPolicyProvider = defineProvider({
  id: "vibe64.action-policy",
  provides: { policy: "runtime.actions.policy" },
  setup: () => ({ policy: vibe64ActionPolicy })
});

export { Vibe64ActionPolicyProvider };
