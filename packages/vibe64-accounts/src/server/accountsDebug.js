import { isVibe64DebugLoggingEnabled } from "@local/vibe64-core/shared";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

// The accounts debug trail: one JSON line per step while the accounts debug
// flag is on, with account rows summarised.

const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";

const AUTH_DEBUG_ENV = "VIBE64_ACCOUNTS_DEBUG";

/** @typedef {(event: string, fields?: object) => void} AuthDebug */

/**
 * This server's accounts debug trail: on while its runtime env sets the
 * accounts debug flag or debug logging.
 * @param {RuntimeEnv} env
 * @returns {AuthDebug}
 */
function createAuthDebug(env) {
  const enabled = isVibe64DebugLoggingEnabled({
    env,
    flagName: AUTH_DEBUG_ENV
  });
  return function authDebug(event, fields = {}) {
    if (!enabled) {
      return;
    }
    const payload = {
      marker: AUTH_DEBUG_MARKER,
      timestamp: new Date().toISOString(),
      event,
      ...fields
    };
    console.info(`[${AUTH_DEBUG_MARKER}] ${JSON.stringify(payload)}`);
  };
}

function accountDebugSummary(account) {
  return {
    code: String(account?.code || ""),
    connected: account?.connected === true,
    id: String(account?.id || ""),
    message: String(account?.message || account?.error || ""),
    ok: account?.ok !== false,
    status: String(account?.status || ""),
    username: String(account?.username || "")
  };
}

function accountsDebugSummary(accounts = []) {
  return Array.isArray(accounts) ? accounts.map((account) => accountDebugSummary(account)) : [];
}

export {
  accountDebugSummary,
  accountsDebugSummary,
  createAuthDebug
};
