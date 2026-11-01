import { readCodexSelectedAccountAccess } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  clearCodexAuthStatus,
  CODEX_AUTH_RECONNECTING_CODE,
  CODEX_AUTH_RECONNECTING_MESSAGE,
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  codexAuthMarkerPath,
  codexAuthOutputRequiresReconnect,
  markCodexAuthReconnecting,
  markCodexReconnectRequired,
  readCodexAuthStatus,
  readCodexLoginId,
  writeCodexAuthMarker
} from "@local/vibe64-core/server/codexAuthState";
import { APP_CREDENTIAL_SCOPE, operatorCliStartFailed, resolveOperatorCli } from "@local/vibe64-execution/server";
import { STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG } from "@local/studio-terminal-core/server/studioRuntimeIdentity";

import { ensureToolHomeSource, readOptionalJson, readOptionalText } from "./accountFiles.js";
import { hostCommandOptionsForCredentialContext, hostCommandResultOutput } from "./accountHostCommands.js";
import { accountConnected, accountDisconnected, operatorCliAccount } from "./accountRecords.js";
import { accountDebugSummary, authDebug } from "./accountsDebug.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */

// Codex's account status: the local marker, the live CLI read, and the marker
// turnover that retires runtimes from an earlier sign-in.

async function readCodexUsername(codexContext) {
  if (!codexContext?.toolHomeSource) return "";
  try {
    const auth = await readOptionalJson(path.join(codexContext.toolHomeSource, ".codex", "auth.json"));
    if (auth?.OPENAI_API_KEY || (auth?.auth_mode && auth.auth_mode !== "chatgpt")) return "";
    const token = auth?.tokens?.id_token;
    if (typeof token !== "string") return "";
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) return "";
    // Display metadata only; Codex and the existing auth state still determine readiness.
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const email = claims?.email ?? claims?.["https://api.openai.com/profile"]?.email;
    return typeof email === "string" ? email.trim() : "";
  } catch {
    return "";
  }
}

async function readCodexLocalStatus({
  codexContext = null,
  systemRoot = ""
} = {}) {
  const authStatus = await readCodexAuthStatus(systemRoot);
  if (authStatus?.status === "reconnecting") {
    return accountDisconnected({
      code: authStatus.code || CODEX_AUTH_RECONNECTING_CODE,
      id: "codex",
      label: "Codex",
      message: authStatus.message || CODEX_AUTH_RECONNECTING_MESSAGE,
      observed: "Vibe64 is retiring Codex runtimes from the previous authentication generation.",
      scope: APP_CREDENTIAL_SCOPE,
      status: "reconnecting"
    });
  }
  if (authStatus?.status === "reconnect_required") {
    return accountDisconnected({
      code: authStatus.code || CODEX_RECONNECT_REQUIRED_CODE,
      id: "codex",
      label: "Codex",
      message: authStatus.message || CODEX_RECONNECT_REQUIRED_MESSAGE,
      observed: "Codex authentication was rejected during use.",
      scope: APP_CREDENTIAL_SCOPE,
      status: "reconnect_required"
    });
  }

  const marker = await readOptionalJson(codexAuthMarkerPath(systemRoot));
  if (marker?.connected === true) {
    return accountConnected({
      id: "codex",
      label: "Codex",
      message: "Codex is signed in.",
      observed: "Local Codex authentication marker is present.",
      ownerOnly: (await readCodexSelectedAccountAccess(codexContext).catch(() => null))?.ownerOnly,
      scope: APP_CREDENTIAL_SCOPE,
      username: await readCodexUsername(codexContext)
    });
  }

  return accountDisconnected({
    id: "codex",
    label: "Codex",
    message: "Codex is not signed in.",
    observed: "Local Codex authentication marker is missing.",
    scope: APP_CREDENTIAL_SCOPE
  });
}

async function readCodexStatus({
  codexContext,
  env,
  runHostToolCommand
}) {
  const cli = resolveOperatorCli("codex", { env });
  if (!cli.installed) return operatorCliAccount("codex");
  await ensureToolHomeSource(codexContext);
  const result = await runHostToolCommand(
    [cli.command, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login", "status"],
    hostCommandOptionsForCredentialContext(codexContext)
  );

  if (operatorCliStartFailed(result)) {
    return operatorCliAccount("codex", { installed: true, observed: hostCommandResultOutput(result) });
  }
  if (!result.ok) {
    const reconnectRequired = codexAuthOutputRequiresReconnect(result.output);
    return accountDisconnected({
      code: reconnectRequired ? CODEX_RECONNECT_REQUIRED_CODE : "",
      id: "codex",
      label: "Codex",
      message: reconnectRequired
        ? CODEX_RECONNECT_REQUIRED_MESSAGE
        : "Codex is not signed in.",
      observed: result.output,
      scope: APP_CREDENTIAL_SCOPE,
      status: reconnectRequired ? "reconnect_required" : undefined
    });
  }

  return accountConnected({
    id: "codex",
    label: "Codex",
    message: "Codex is signed in.",
    observed: result.output,
    scope: APP_CREDENTIAL_SCOPE,
    ownerOnly: (await readCodexSelectedAccountAccess(codexContext).catch(() => null))?.ownerOnly,
    username: await readCodexUsername(codexContext)
  });
}

/**
 * The live Codex status read, one at a time, and the marker turnover it records.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {RuntimeEnv} dependencies.env
 * @param {AccountNotifications} dependencies.notifications
 */
function createCodexAccountStatus({
  access,
  env,
  notifications
}) {
  let codexStatusRead = null;

  async function invalidateCodexAppServersForAuthChange({
    account = {},
    markerPath = "",
    reason = ""
  } = {}) {
    const codexContext = access.codexContextForInput();
    if (!codexContext.ok) {
      authDebug("server.auth.codex_app_server.invalidate.skipped", {
        code: codexContext.code || "",
        reason: reason || "codex-auth-state-changed"
      });
      return null;
    }
    try {
      const result = await notifications.invalidateAgentRuntimes({
        account,
        includeOwned: true,
        markerPath,
        provider: "codex",
        reason: reason || "codex-auth-state-changed",
        systemRoot: access.systemRoot,
        hostGid: codexContext.gid,
        hostUid: codexContext.uid,
        toolHomeSource: codexContext.toolHomeSource || ""
      });
      authDebug("server.auth.codex_app_server.invalidate.done", {
        ok: result?.ok !== false,
        providerCount: Number(result?.providerCount || 0),
        reason: reason || "codex-auth-state-changed",
        stopped: Number(result?.stopped || 0)
      });
      if (result?.ok === false) {
        const error = new Error("Codex app-server authentication turnover could not retire every old runtime.");
        error.code = "vibe64_codex_auth_runtime_invalidation_failed";
        error.details = result;
        throw error;
      }
      return result;
    } catch (error) {
      authDebug("server.auth.codex_app_server.invalidate.error", {
        error: String(error?.message || error || "Codex app-server invalidation failed."),
        reason: reason || "codex-auth-state-changed"
      });
      throw error;
    }
  }

  async function rememberCodexStatus(account = {}, {
    reason = "",
    rotateMarker = false
  } = {}) {
    const markerPath = codexAuthMarkerPath(access.systemRoot);
    const existingMarkerText = await readOptionalText(markerPath);
    let existingMarker = null;
    try {
      existingMarker = existingMarkerText ? JSON.parse(existingMarkerText) : null;
    } catch {
      existingMarker = null;
    }
    const existingMarkerPresent = Boolean(existingMarkerText);
    const existingConnected = existingMarker?.connected === true;
    const existingLoginId = await readCodexLoginId(access.systemRoot);
    const existingAuthStatus = await readCodexAuthStatus(access.systemRoot);
    const transitionPending = existingAuthStatus?.status === "reconnecting";
    const preserveReconnectRequired = account.status === "reconnect_required";
    if (account.connected === true) {
      if (existingConnected && !rotateMarker && !transitionPending) {
        authDebug("server.auth.codex_marker.unchanged", {
          account: accountDebugSummary(account),
          markerPath,
          reason: reason || "codex-status-refresh"
        });
        return;
      }
      const loginId = rotateMarker || !existingConnected ? randomUUID() : existingLoginId;
      if (!loginId) {
        throw new Error("Codex login identity is invalid. Run the Vibe64 state upgrades with the service stopped.");
      }
      if (!preserveReconnectRequired) {
        await markCodexAuthReconnecting(access.systemRoot, {
          reason: reason || "codex-connected"
        });
      }
      authDebug("server.auth.codex_marker.write", {
        account: accountDebugSummary(account),
        markerPath,
        reason: reason || "codex-status-refresh",
        rotateMarker
      });
      await writeCodexAuthMarker(access.systemRoot, {
        connected: true,
        loginId,
        updatedAt: new Date().toISOString(),
        version: 1
      });
      await invalidateCodexAppServersForAuthChange({
        account,
        markerPath,
        reason: reason || "codex-connected"
      });
      if (!preserveReconnectRequired) {
        await clearCodexAuthStatus(access.systemRoot);
      }
      return;
    }
    if (!existingMarkerPresent && !rotateMarker && !transitionPending) {
      authDebug("server.auth.codex_marker.missing", {
        account: accountDebugSummary(account),
        markerPath,
        reason: reason || "codex-status-refresh"
      });
      return;
    }
    if (!preserveReconnectRequired) {
      await markCodexAuthReconnecting(access.systemRoot, {
        reason: reason || "codex-disconnected"
      });
    }
    authDebug("server.auth.codex_marker.remove", {
      account: accountDebugSummary(account),
      markerPath,
      reason: reason || "codex-status-refresh",
      rotateMarker
    });
    await rm(markerPath, {
      force: true
    });
    await invalidateCodexAppServersForAuthChange({
      account,
      markerPath,
      reason: reason || "codex-disconnected"
    });
    if (!preserveReconnectRequired) {
      await clearCodexAuthStatus(access.systemRoot);
    }
  }

  async function readLiveCodexStatus({
    reason = "codex-status-refresh",
    rotateMarker = false
  } = {}) {
    if (codexStatusRead && !rotateMarker) {
      return codexStatusRead;
    }
    const previousRead = codexStatusRead;
    const pending = (async () => {
      await previousRead?.catch(() => null);
      authDebug("server.auth.codex_status.live.start", {
        reason,
        rotateMarker
      });
      const codexContext = access.codexContextForInput();
      if (!codexContext.ok) {
        return codexContext;
      }
      const existingAuthStatus = await readCodexAuthStatus(access.systemRoot);
      if (existingAuthStatus?.status === "reconnect_required" && !rotateMarker) {
        const account = await readCodexLocalStatus({
          systemRoot: access.systemRoot
        });
        authDebug("server.auth.codex_status.live.reconnect_required", {
          account: accountDebugSummary(account),
          reason
        });
        return account;
      }
      const account = await readCodexStatus({
        codexContext,
        env,
        runHostToolCommand: access.accountRunHostCommand
      });
      if (account?.status === "reconnect_required") {
        await markCodexReconnectRequired(access.systemRoot, {
          reason
        });
      }
      await rememberCodexStatus(account, {
        reason,
        rotateMarker
      });
      authDebug("server.auth.codex_status.live.done", {
        account: accountDebugSummary(account),
        reason,
        rotateMarker
      });
      return account;
    })();
    codexStatusRead = pending;
    try {
      return await pending;
    } finally {
      if (codexStatusRead === pending) {
        codexStatusRead = null;
      }
    }
  }

  return Object.freeze({
    readLiveCodexStatus
  });
}

export {
  createCodexAccountStatus,
  readCodexLocalStatus
};
