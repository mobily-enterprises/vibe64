// The Preview proxy's debug log, written only when its debug setting is on.

import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";

const PREVIEW_PROXY_DEBUG_ENV = "VIBE64_PREVIEW_DEBUG";

function previewProxyDebugEnabled(env = process.env) {
  return /^(1|true|yes|on)$/iu.test(String(env?.[PREVIEW_PROXY_DEBUG_ENV] || "").trim());
}

function previewProxyDebugLog(event = "", details = {}) {
  if (!previewProxyDebugEnabled()) {
    return null;
  }
  return vibe64SessionDebugLog(event, details);
}

export {
  previewProxyDebugEnabled,
  previewProxyDebugLog
};
