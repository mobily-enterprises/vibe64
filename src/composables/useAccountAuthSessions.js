import { computed, proxyRefs, reactive, ref, unref } from "vue";

const DEFAULT_POLL_INTERVAL_MS = 1000;

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
  const authLinkCopyStatus = reactive({});
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

  function loginDisabled(account = {}) {
    return authBusy.value || logoutBusy.value || account.connected === true;
  }

  async function refreshStatus() {
    await accounts.refresh();
  }

  async function startBrowserAuth(accountId) {
    await startAuth(accountId, "browser");
  }

  async function startDeviceAuth(accountId = "codex") {
    await startAuth(accountId || "codex", "device");
  }

  async function startAuth(accountId, mode = "browser") {
    localError.value = "";
    if (accountFor(accountId)?.connected === true) {
      return;
    }

    try {
      const session = await accounts.startAuth(accountId, mode);
      if (!session?.id) {
        throw new Error("Login did not return an auth session.");
      }
      rememberAuthSession(session);
      startPolling();
    } catch (error) {
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
      authLinkCopyStatus[sessionId] = "Auth link copied.";
      return true;
    } catch (error) {
      localError.value = String(error?.message || error || "Auth link could not be copied.");
      return false;
    }
  }

  async function pollAuthSessions() {
    const sessions = Object.values(activeSessions).filter((session) => {
      return session?.id && session.status === "authenticating";
    });
    if (!sessions.length) {
      stopPolling();
      return;
    }

    for (const session of sessions) {
      const nextSession = await accounts.readAuthSession(session.id);
      rememberAuthSession(nextSession);
      if (nextSession.status === "connected") {
        forgetSession(nextSession);
        await refreshStatus();
      } else if (nextSession.status === "failed") {
        await refreshStatus();
      }
    }

    stopPollingIfIdle();
  }

  function startPolling() {
    if (pollTimer) {
      return;
    }
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
    const accountId = session.account?.id || session.account || "";
    if (!accountId || !session.id) {
      return;
    }
    activeSessions[accountId] = session;
  }

  function forgetSession(session = {}) {
    const accountId = session.account?.id || session.account || "";
    if (!accountId) {
      return;
    }
    if (session.id) {
      delete authLinkCopyStatus[session.id];
    }
    delete activeSessions[accountId];
  }

  return proxyRefs({
    activeSessionFor,
    authLinkCopyStatus,
    authBusy,
    cancelSession,
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
    stopPolling
  });
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

export { useAccountAuthSessions };
