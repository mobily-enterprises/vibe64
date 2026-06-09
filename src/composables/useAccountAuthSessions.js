import { computed, proxyRefs, reactive, ref, unref } from "vue";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;
const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";
const ANSI_ESCAPE_PATTERN = new RegExp("\\u001b\\[[0-?]*[ -/]*[@-~]", "gu");
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
        rememberAuthSession(nextSession);
        if (nextSession.status === "connected") {
          forgetSession(nextSession);
          await refreshStatus();
        } else if (nextSession.status === "failed") {
          await refreshStatus();
        }
      } catch (error) {
        authDebug("client.auth.poll.error", {
          accountId: session.account?.id || session.account || "",
          message: String(error?.message || error || "Login polling failed."),
          sessionId: session.id
        });
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

  return proxyRefs({
    activeSessionFor,
    authCopyStatus,
    authLinkCopyStatus: authCopyStatus,
    authBusy,
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
  return {
    accountId: session.account?.id || session.account || "",
    authUrl: session.authUrl || "",
    exitCode: session.exitCode ?? null,
    hasOutput: Boolean(session.output),
    mode: session.mode || "",
    outputLength: String(session.output || "").length,
    outputTail: sanitizedAuthOutputTail(session.output),
    sessionId: session.id || "",
    status: session.status || "",
    terminalStatus: session.terminalStatus || "",
    userCodePresent: Boolean(session.userCode)
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
  const existing = String(session.userCode || "").trim();
  if (existing) {
    return existing.toUpperCase();
  }
  if (session.mode !== "device") {
    return "";
  }
  return cleanAuthOutput(session.output).match(DEVICE_USER_CODE_PATTERN)?.[1]?.toUpperCase() || "";
}

function enrichAuthSession(session = {}) {
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return session;
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

export { useAccountAuthSessions };
