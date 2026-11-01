import process from "node:process";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const LIVE_HOST_ENV_KEYS = Object.freeze([
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV,
  "VIBE64_PREVIEW_PROXY_SOCKET_DIR",
  "VIBE64_HOST_AGENT_GUIDANCE",
  "VIBE64_CLAUDE_COMMAND"
]);

/**
 * The terminals service's env: the runtime env, with the host's live Preview, public address, guidance and Claude
 * command values read from the process env when set.
 * @param {RuntimeEnv} runtimeEnv
 * @param {NodeJS.ProcessEnv} [liveEnv]
 */
function terminalsProviderEnv(runtimeEnv, liveEnv = process.env) {
  const env = {
    ...runtimeEnv
  };
  for (const key of LIVE_HOST_ENV_KEYS) {
    const value = String(liveEnv[key] || "").trim();
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

export {
  terminalsProviderEnv
};
