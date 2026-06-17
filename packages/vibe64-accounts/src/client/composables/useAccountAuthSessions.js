import { computed, proxyRefs, reactive, ref, unref } from "vue";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;
const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
const VISIBLE_ANSI_ESCAPE_PATTERN = /\u00a4\[[0-?]*[ -/]*[@-~]/gu;
const DEVICE_USER_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/iu;

function authDebug(event, fields = {}) {
  console.debug(`[${AUTH_DEBUG_MARKER}] ${JSON.stringify({
    marker: AUTH_DEBUG_MARKER,
    timestamp: new Date().toISOString(),
    event,
    ...fields
  })}`);
}

function useAccountAuthSessions(
  accounts,
  {
    accountRows,
    browserWindow = defaultBrowserWindow(),
    clearIntervalFn,
    clipboard = defaultClipboard(browserWindow),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    setIntervalFn
  } = {}
) {
  const activeSessions = reactive({});
  const authCopyStatus = reactive({});
  const localError = ref("");
  const logoutAccountId = ref("");
  const scheduler = createScheduler({
    browserWindow,
    clearIntervalFn,
    setIntervalFn
  });

  let pollTimer = null;

  const authBusy = computed(() => {
    return Object.values(activeSessions).some((session) => session?.status === "authenticating");
  });
  const logoutBusy = computed(() => Boolean(logoutAccountId.value));
  const errorMessage = computed(() => {
    if (localError.value || accounts.loadError) {
      return localError.value || accounts.loadError;
    }
    return accounts.startAuthCommand?.messageType === "error"
      ? accounts.startAuthCommand.message
      : "";
  });

  function activeSessionFor(accountId) {
    return activeSessions[accountId] || null;
  }

  function loginDisabled(account = {}, authOptions = {}) {
    return authBusy.value ||
      logoutBusy.value ||
      (account.connected === true && account.gitIdentityRequired !== true) ||
      (account.gitIdentityRequired === true && !validGitIdentity(authOptions));
  }

  async function refreshStatus() {
    await accounts.refresh();
  }

  async function startBrowserAuth(accountId, authOptions = {}) {
    await startAuth(accountId, "browser", authOptions);
  }

  async function startDeviceAuth(accountId = "codex") {
    await startAuth(accountId || "codex", "device");
  }

  async function startApiKeyAuth(accountId = "codex", apiKey = "") {
    await startAuth(accountId || "codex", "api_key", {
      apiKey
    });
  }

  async function startAuth(accountId, mode = "browser", authOptions = {}) {
    localError.value = "";
    authDebug("client.auth.start.request", {
      accountId,
      mode
    });
    const account = accountFor(accountId);
    if (account?.gitIdentityRequired === true && !validGitIdentity(authOptions)) {
      localError.value = "Git user.name and user.email are required before GitHub login.";
      authDebug("client.auth.start.skip", {
        accountId,
        reason: "missing_git_identity"
      });
      return;
    }
    if (account?.connected === true && account.gitIdentityRequired !== true) {
      authDebug("client.auth.start.skip", {
        accountId,
        reason: "already_connected"
      });
      return;
    }

    try {
      const startArgs = [accountId, mode];
      if (Object.keys(authOptions || {}).length) {
        startArgs.push(authOptions);
      }
      const session = await accounts.startAuth(...startArgs);
      authDebug("client.auth.start.response", authSessionDebugFields(session));
      if (!session?.id) {
        throw new Error("Login did not return an auth session.");
      }
      rememberAuthSession(session);
      startPolling();
    } catch (error) {
      authDebug("client.auth.start.error", {
        accountId,
        message: String(error?.message || error || "Login could not start."),
        mode
      });
      localError.value = String(error?.message || error || "Login could not start.");
    }
  }

  async function logoutAccount(accountId) {
    localError.value = "";
    logoutAccountId.value = String(accountId || "");
    try {
      await accounts.logout(accountId);
      await refreshStatus();
      await invalidateCapabilitiesForAccountChange({
        event: "client.auth.logout.completed",
        payload: {
          accountId: String(accountId || ""),
          connected: false,
          status: "not_connected"
        }
      });
    } catch (error) {
      localError.value = String(error?.message || error || "Logout failed.");
    } finally {
      logoutAccountId.value = "";
    }
  }

  async function cancelSession(session = {}) {
    if (!session.id) {
      return;
    }
    await accounts.cancelAuthSession(session.id).catch(() => null);
    forgetSession(session);
    await refreshStatus();
    stopPollingIfIdle();
  }

  async function copyAuthUrl(session = {}) {
    const sessionId = String(session.id || "");
    const url = String(session.authUrl || "").trim();
    if (!sessionId || !url) {
      return false;
    }
    if (typeof clipboard?.writeText !== "function") {
      localError.value = "Auth link could not be copied because clipboard access is unavailable.";
      return false;
    }

    try {
      await clipboard.writeText(url);
      authCopyStatus[sessionId] = "Auth link copied.";
      return true;
    } catch (error) {
      localError.value = String(error?.message || error || "Auth link could not be copied.");
      return false;
    }
  }

  async function copyAuthCode(session = {}) {
    const sessionId = String(session.id || "");
    const userCode = authSessionUserCode(session);
    if (!sessionId || !userCode) {
      return false;
    }
    if (typeof clipboard?.writeText !== "function") {
      localError.value = "One-time code could not be copied because clipboard access is unavailable.";
      return false;
    }

    try {
      await clipboard.writeText(userCode);
      authCopyStatus[sessionId] = "One-time code copied.";
      return true;
    } catch (error) {
      localError.value = String(error?.message || error || "One-time code could not be copied.");
      return false;
    }
  }

  async function pollAuthSessions() {
    const sessions = Object.values(activeSessions).filter((session) => {
      return session?.id && session.status === "authenticating";
    });
    authDebug("client.auth.poll.start", {
      sessionCount: sessions.length
    });
    if (!sessions.length) {
      stopPolling();
      return;
    }

    for (const session of sessions) {
      try {
        const nextSession = await accounts.readAuthSession(session.id);
        authDebug("client.auth.poll.response", authSessionDebugFields(nextSession));
        if (!isPlainAuthSession(nextSession) || !nextSession.id) {
          throw new Error("Account login session did not return status.");
        }
        rememberAuthSession(nextSession);
        if (nextSession.status === "connected") {
          const accountId = authSessionAccountId(nextSession) || authSessionAccountId(session);
          forgetSession(nextSession);
          await refreshStatus();
          await invalidateCapabilitiesForAccountChange({
            event: "client.auth.session.connected",
            payload: {
              accountId,
              authSessionId: String(nextSession.id || session.id || ""),
              connected: true,
              status: "connected"
            }
          });
        } else if (nextSession.status === "failed") {
          await refreshStatus();
        }
      } catch (error) {
        const message = String(error?.message || error || "Login polling failed.");
        authDebug("client.auth.poll.error", {
          accountId: session.account?.id || session.account || "",
          message,
          sessionId: session.id
        });
        localError.value = message;
        throw error;
      }
    }

    stopPollingIfIdle();
  }

  function startPolling() {
    if (pollTimer) {
      authDebug("client.auth.poll.reuse_timer", {});
      return;
    }
    authDebug("client.auth.poll.start_timer", {
      pollIntervalMs
    });
    pollTimer = scheduler.setInterval(() => {
      void pollAuthSessions().catch((error) => {
        localError.value = String(error?.message || error || "Login polling failed.");
      });
    }, pollIntervalMs);
  }

  function stopPolling() {
    if (!pollTimer) {
      return;
    }
    authDebug("client.auth.poll.stop_timer", {});
    scheduler.clearInterval(pollTimer);
    pollTimer = null;
  }

  function stopPollingIfIdle() {
    if (!Object.values(activeSessions).some((session) => session?.status === "authenticating")) {
      stopPolling();
    }
  }

  function accountFor(accountId) {
    const rows = Array.isArray(unref(accountRows)) ? unref(accountRows) : [];
    return rows.find((account) => account.id === accountId) || null;
  }

  function openAuthUrl(session = {}) {
    const url = String(session.authUrl || "").trim();
    if (!url) {
      return;
    }

    browserWindow?.open?.(url, "_blank", "noopener");
  }

  function authSessionNeedsTerminalAttention(session = {}) {
    return codexAuthSessionNeedsTerminalAttention(session);
  }

  function rememberAuthSession(session = {}) {
    const enrichedSession = enrichAuthSession(session);
    const accountId = enrichedSession.account?.id || enrichedSession.account || "";
    if (!accountId || !enrichedSession.id) {
      authDebug("client.auth.session.remember_skip", {
        hasAccountId: Boolean(accountId),
        hasSessionId: Boolean(enrichedSession.id),
        status: enrichedSession.status || ""
      });
      return;
    }
    authDebug("client.auth.session.remember", authSessionDebugFields(enrichedSession));
    activeSessions[accountId] = enrichedSession;
  }

  function forgetSession(session = {}) {
    const accountId = session.account?.id || session.account || "";
    if (!accountId) {
      return;
    }
    if (session.id) {
      delete authCopyStatus[session.id];
    }
    authDebug("client.auth.session.forget", {
      accountId,
      sessionId: session.id || ""
    });
    delete activeSessions[accountId];
  }

  async function invalidateCapabilitiesForAccountChange(context = {}) {
    const invalidateCapabilities = accounts?.invalidateCapabilities;
    if (typeof invalidateCapabilities !== "function") {
      authDebug("client.auth.capabilities.invalidate.skip", {
        event: String(context.event || ""),
        reason: "missing_accounts_invalidator"
      });
      return;
    }

    authDebug("client.auth.capabilities.invalidate.request", {
      accountId: String(context.payload?.accountId || ""),
      event: String(context.event || ""),
      status: String(context.payload?.status || "")
    });
    try {
      await invalidateCapabilities(context);
    } catch (error) {
      authDebug("client.auth.capabilities.invalidate.error", {
        accountId: String(context.payload?.accountId || ""),
        event: String(context.event || ""),
        message: String(error?.message || error || "Capabilities invalidation failed."),
        status: String(context.payload?.status || "")
      });
    }
  }

  return proxyRefs({
    activeSessionFor,
    authCopyStatus,
    authLinkCopyStatus: authCopyStatus,
    authBusy,
    authSessionNeedsTerminalAttention,
    cancelSession,
    copyAuthCode,
    copyAuthUrl,
    errorMessage,
    localError,
    loginDisabled,
    logoutAccount,
    logoutAccountId,
    logoutBusy,
    openAuthUrl,
    pollAuthSessions,
    refreshStatus,
    startBrowserAuth,
    startDeviceAuth,
    startApiKeyAuth,
    stopPolling
  });
}

function authSessionDebugFields(session = {}) {
  const normalizedSession = plainAuthSession(session);
  return {
    accountId: normalizedSession.account?.id || normalizedSession.account || "",
    authUrl: normalizedSession.authUrl || "",
    exitCode: normalizedSession.exitCode ?? null,
    hasOutput: Boolean(normalizedSession.output),
    mode: normalizedSession.mode || "",
    outputLength: String(normalizedSession.output || "").length,
    outputTail: sanitizedAuthOutputTail(normalizedSession.output),
    sessionId: normalizedSession.id || "",
    status: normalizedSession.status || "",
    terminalStatus: normalizedSession.terminalStatus || "",
    userCodePresent: Boolean(normalizedSession.userCode)
  };
}

function sanitizedAuthOutputTail(output = "") {
  return cleanAuthOutput(output)
    .slice(-AUTH_DEBUG_OUTPUT_TAIL_LENGTH)
    .replace(/https:\/\/[^\s"'<>]+/gu, (url) => {
      try {
        const parsed = new URL(url.replace(/[),.;]+$/u, ""));
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "https://[redacted-url]";
      }
    })
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/gu, "[redacted-code]");
}

function cleanAuthOutput(output = "") {
  return String(output || "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(VISIBLE_ANSI_ESCAPE_PATTERN, "");
}

function authSessionUserCode(session = {}) {
  const normalizedSession = plainAuthSession(session);
  const existing = String(normalizedSession.userCode || "").trim();
  if (existing) {
    return existing.toUpperCase();
  }
  if (normalizedSession.mode !== "device") {
    return "";
  }
  return cleanAuthOutput(normalizedSession.output).match(DEVICE_USER_CODE_PATTERN)?.[1]?.toUpperCase() || "";
}

function authSessionAccountId(session = {}) {
  const normalizedSession = plainAuthSession(session);
  return String(normalizedSession.account?.id || normalizedSession.account || "").trim();
}

function codexAuthSessionNeedsTerminalAttention(session = {}) {
  if (authSessionAccountId(session) !== "codex" || !session?.id || session.status === "connected") {
    return false;
  }
  if (session.status === "failed" || session.terminalStatus === "exited") {
    return true;
  }
  if (session.error || session.closeError || session.terminalError) {
    return true;
  }
  const output = cleanAuthOutput(session.output).trim();
  if (!output) {
    return false;
  }
  if (session.mode === "device") {
    return !authSessionUserCode(session);
  }
  return session.mode === "api_key";
}

function enrichAuthSession(session = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return {};
  }
  const userCode = authSessionUserCode(session);
  if (!userCode) {
    return session;
  }
  return {
    ...session,
    authUrl: String(session.authUrl || "").trim() || CODEX_DEVICE_AUTH_URL,
    userCode
  };
}

function plainAuthSession(session = {}) {
  return session && typeof session === "object" && !Array.isArray(session) ? session : {};
}

function isPlainAuthSession(session = {}) {
  return session && typeof session === "object" && !Array.isArray(session);
}

function defaultBrowserWindow() {
  return typeof window === "undefined" ? null : window;
}

function defaultClipboard(browserWindow) {
  return browserWindow?.navigator?.clipboard || globalThis.navigator?.clipboard || null;
}

function createScheduler({
  browserWindow,
  clearIntervalFn,
  setIntervalFn
}) {
  return {
    clearInterval: clearIntervalFn || browserWindow?.clearInterval?.bind(browserWindow) || globalThis.clearInterval,
    setInterval: setIntervalFn || browserWindow?.setInterval?.bind(browserWindow) || globalThis.setInterval
  };
}

function validGitIdentity(input = {}) {
  const name = String(input.gitUserName || input.name || "").trim();
  const email = String(input.gitUserEmail || input.email || "").trim();
  return Boolean(name) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}

export {
  codexAuthSessionNeedsTerminalAttention,
  useAccountAuthSessions
};
