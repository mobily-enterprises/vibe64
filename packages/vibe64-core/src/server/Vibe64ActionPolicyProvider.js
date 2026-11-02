import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createVibe64ActionPolicy } from "./actionContext.js";
import { isLocalhostCheckBypassEnabled } from "./localhostCheckBypass.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * Supplies the rule every Vibe64 operation runs under to JSKIT's action
 * catalogue. A provider rather than a feature: a feature requires
 * `runtime.actions`, which takes this policy.
 */
const Vibe64ActionPolicyProvider = defineProvider({
  id: "vibe64.action-policy",
  requires: { env: "runtime.env" },
  provides: { policy: "runtime.actions.policy" },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   */
  setup: ({ env }) => ({
    policy: createVibe64ActionPolicy({ localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }) })
  })
});

export { Vibe64ActionPolicyProvider };
