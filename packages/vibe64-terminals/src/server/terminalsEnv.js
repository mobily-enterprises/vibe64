import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import { VIBE64_CODEX_ATTACHMENTS_ROOT_ENV } from "@local/vibe64-runtime/server/codexAttachmentPaths";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const LIVE_HOST_ENV_KEYS = Object.freeze([
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV,
  "VIBE64_PREVIEW_PROXY_SOCKET_DIR",
  "VIBE64_HOST_AGENT_GUIDANCE",
  "VIBE64_CLAUDE_COMMAND",
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV
]);

/**
 * The terminals service's env: the runtime env, with the host's live Preview, public address, guidance, Claude
 * command and attachment root values read from the process env when set. The server names the attachment root at
 * startup, before features compose, so every agent environment built from this env shares one live state root.
 * @param {RuntimeEnv} runtimeEnv
 * @param {NodeJS.ProcessEnv} liveEnv this process's environment
 */
function terminalsProviderEnv(runtimeEnv, liveEnv) {
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
