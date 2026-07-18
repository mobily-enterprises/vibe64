import { computed, onBeforeUnmount, reactive, ref, unref, watch } from "vue";
import { useAccountAuthSessions } from "./useAccountAuthSessions.js";
import { useVibe64Terminal } from "/src/composables/useVibe64Terminal.js";
import { createWebSocketTerminalDriver } from "/src/lib/vibe64TerminalDriver.js";
import {
  accountAuthTerminalWebSocketUrl
} from "../lib/accountsGateApi.js";

const CHATGPT_SECURITY_SETTINGS_URL = "https://chatgpt.com/#settings/Security";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
const VISIBLE_ANSI_ESCAPE_PATTERN = /\u00a4\[[0-?]*[ -/]*[@-~]/gu;

function useProviderAccountsSetup(props) {
  const accountRows = computed(() => Array.isArray(props.accountRows) ? props.accountRows : []);
  const gitIdentityInputs = reactive({});
  const apiKeyInputs = reactive({});
  const apiKeyFormsVisible = reactive({});
  const statusReady = computed(() => (
    accountRows.value.length > 0 &&
    accountRows.value.every((account) => account.connected === true)
  ));
  const gitIdentitySaveBusy = computed(() => props.accounts.saveGitIdentityCommand?.isRunning === true);
  const accountsLoading = computed(() => Boolean(unref(props.accounts.isLoading)));
  const accountsReadyForActions = computed(() => {
    return props.actionsEnabled === true && props.statusLoaded === true && !accountsLoading.value;
  });
  const {
    activeSessionFor,
    authBusy,
    authCopyStatus,
    authSessionNeedsTerminalAttention: sessionNeedsTerminalAttention,
    cancelSession,
    copyAuthCode,
    errorMessage: authSessionErrorMessage,
    localError,
    loginDisabled,
    logoutAccount,
    logoutAccountId,
    openAuthUrl,
    refreshStatus,
    startApiKeyAuth,
    startBrowserAuth,
    startDeviceAuth,
    stopPolling
  } = useAccountAuthSessions(props.accounts, {
    accountRows
  });
  const errorMessage = computed(() => {
    if (authSessionErrorMessage.value) {
      return authSessionErrorMessage.value;
    }
    return props.accounts.saveGitIdentityCommand?.messageType === "error"
      ? props.accounts.saveGitIdentityCommand.message
      : "";
  });
  const codexAuthStepsBySessionId = reactive({});
  const authTerminalAttentionOpenedSessionIds = new Set();
  const authTerminalSessionId = ref("");
  const authTerminal = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      webSocketUrl: accountAuthTerminalWebSocketUrl
    }),
    resizeReportDelayMs: 120
  });
  const authTerminalSession = computed(() => {
    if (!authTerminalSessionId.value) {
      return null;
    }
    for (const account of accountRows.value) {
      const session = activeSessionFor(account.id);
      if (session?.id === authTerminalSessionId.value) {
        return session;
      }
    }
    return null;
  });

  function accountStatusMessage(account = {}) {
    return account.connected ? `${account.label} is connected.` : `${account.label} is not connected.`;
  }

  function accountActiveSession(account = {}) {
    if (account.connected === true) {
      return null;
    }
    return activeSessionFor(account.id);
  }

  function activeAuthSessions() {
    return accountRows.value
      .map((account) => accountActiveSession(account))
      .filter(Boolean);
  }

  function requiresGitIdentity(account = {}) {
    return account.gitIdentityRequired === true;
  }

  function gitIdentityInput(account = {}) {
    const accountId = String(account.id || "");
    if (!accountId) {
      return {
        email: "",
        name: ""
      };
    }
    if (!gitIdentityInputs[accountId]) {
      gitIdentityInputs[accountId] = {
        email: String(account.gitIdentity?.email || ""),
        name: String(account.gitIdentity?.name || "")
      };
    }
    return gitIdentityInputs[accountId];
  }

  function syncGitIdentityInput(account = {}) {
    if (!requiresGitIdentity(account)) {
      return;
    }
    const input = gitIdentityInput(account);
    if (!input.name && account.gitIdentity?.name) {
      input.name = String(account.gitIdentity.name || "");
    }
    if (!input.email && account.gitIdentity?.email) {
      input.email = String(account.gitIdentity.email || "");
    }
  }

  function gitIdentityAuthOptions(account = {}) {
    const input = gitIdentityInput(account);
    return {
      gitUserEmail: input.email,
      gitUserName: input.name
    };
  }

  function accountLoginDisabled(account = {}) {
    if (requiresGitIdentity(account) && account.connected === true) {
      return gitIdentitySaveDisabled(account);
    }
    return loginDisabled(
      account,
      requiresGitIdentity(account) ? gitIdentityAuthOptions(account) : {}
    );
  }

  function gitIdentitySaveDisabled(account = {}) {
    return !accountsReadyForActions.value ||
      gitIdentitySaveBusy.value ||
      loginDisabled(account, gitIdentityAuthOptions(account));
  }

  function primaryAuthMode(account = {}) {
    const mode = String(account.authMode || "").trim().toLowerCase();
    if (mode) {
      return mode;
    }
    return account.deviceAuth === true ? "device" : "browser";
  }

  async function startAccountAuth(account = {}) {
    if (!accountsReadyForActions.value) {
      return;
    }
    if (requiresGitIdentity(account) && account.connected === true) {
      await saveGitIdentity(account);
      return;
    }
    const mode = primaryAuthMode(account);
    const options = requiresGitIdentity(account) ? gitIdentityAuthOptions(account) : {};
    if (mode === "device") {
      void startDeviceAuth(account.id);
      return;
    }
    void startBrowserAuth(account.id, options);
  }

  async function saveGitIdentity(account = {}) {
    if (gitIdentitySaveDisabled(account)) {
      return;
    }
    localError.value = "";
    try {
      await props.accounts.saveGitIdentity(gitIdentityAuthOptions(account));
      await refreshStatus();
    } catch (error) {
      localError.value = String(error?.message || error || "Git identity could not be saved.");
    }
  }

  function primaryAuthLabel(account = {}) {
    if (requiresGitIdentity(account) && account.connected === true) {
      return "Save Git identity";
    }
    return account.authLabel || `Auth ${account.label}`;
  }

  function accountSupportsApiKeyAuth(account = {}) {
    return String(account.id || "") === "codex" && account.connected !== true;
  }

  function apiKeyInput(account = {}) {
    const accountId = String(account.id || "");
    if (!accountId) {
      return {
        value: ""
      };
    }
    if (!apiKeyInputs[accountId]) {
      apiKeyInputs[accountId] = {
        value: ""
      };
    }
    return apiKeyInputs[accountId];
  }

  function apiKeyFormVisible(account = {}) {
    return Boolean(apiKeyFormsVisible[String(account.id || "")]);
  }

  function toggleApiKeyForm(account = {}) {
    if (!accountsReadyForActions.value) {
      return;
    }
    const accountId = String(account.id || "");
    if (!accountId) {
      return;
    }
    apiKeyFormsVisible[accountId] = !apiKeyFormsVisible[accountId];
  }

  function apiKeyLoginDisabled(account = {}) {
    return authBusy.value || !apiKeyInput(account).value.trim();
  }

  async function startAccountApiKeyAuth(account = {}) {
    if (!accountsReadyForActions.value) {
      return;
    }
    const input = apiKeyInput(account);
    const apiKey = input.value.trim();
    if (!apiKey) {
      return;
    }
    try {
      await startApiKeyAuth(account.id, apiKey);
    } finally {
      input.value = "";
    }
  }

  function isCodexDeviceSession(session = {}) {
    return String(session?.account?.id || "") === "codex" &&
      session?.mode === "device";
  }

  function codexAuthStep(session = {}) {
    if (!isCodexDeviceSession(session) || !session?.id) {
      return "authorize";
    }
    return codexAuthStepsBySessionId[session.id] || "settings";
  }

  function setCodexAuthStep(session = {}, step = "settings") {
    if (!isCodexDeviceSession(session) || !session?.id) {
      return;
    }
    codexAuthStepsBySessionId[session.id] = step === "authorize" ? "authorize" : "settings";
  }

  function codexSettingsStepVisible(session = {}) {
    return isCodexDeviceSession(session) && codexAuthStep(session) === "settings";
  }

  function codexAuthorizeStepVisible(session = {}) {
    return isCodexDeviceSession(session) && codexAuthStep(session) === "authorize";
  }

  function loginOutputVisible(session = {}) {
    return Boolean(session?.output) && (
      session.status === "failed" ||
      (session.mode === "device" && !authSessionUserCode(session))
    );
  }

  function authSessionNeedsTerminalAttention(session = {}) {
    return sessionNeedsTerminalAttention(session);
  }

  function authTerminalAvailable(session = {}) {
    return Boolean(session?.id);
  }

  function authTerminalVisible(session = {}) {
    return Boolean(session?.id && authTerminalSessionId.value === session.id);
  }

  async function toggleAuthTerminal(session = {}) {
    if (!session?.id) {
      return;
    }
    if (authTerminalVisible(session)) {
      closeAuthTerminal();
      return;
    }
    await openAuthTerminal(session);
  }

  async function openAuthTerminal(session = {}) {
    if (!session?.id) {
      return;
    }
    authTerminalSessionId.value = session.id;
    await authTerminal.attachTerminal(session, {
      ownership: "attached",
      show: true
    });
  }

  async function openAuthTerminalForAttention(session = {}) {
    if (
      !authSessionNeedsTerminalAttention(session) ||
      authTerminalVisible(session) ||
      authTerminalAttentionOpenedSessionIds.has(session.id)
    ) {
      return;
    }
    authTerminalAttentionOpenedSessionIds.add(session.id);
    await openAuthTerminal(session);
  }

  function closeAuthTerminal() {
    authTerminalSessionId.value = "";
    authTerminal.hideTerminal({ manual: true });
    authTerminal.disposeTerminalDisplay();
  }

  function cleanAuthOutput(output = "") {
    return String(output || "")
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(VISIBLE_ANSI_ESCAPE_PATTERN, "");
  }

  function authSessionUserCode(session = {}) {
    const existing = String(session?.userCode || "").trim();
    if (existing) {
      return existing.toUpperCase();
    }
    if (session?.mode !== "device") {
      return "";
    }
    const output = [
      session?.output || "",
      authTerminalVisible(session) ? authTerminal.terminalOutput.value : ""
    ].join("\n");
    return cleanAuthOutput(output).match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/iu)?.[1]?.toUpperCase() || "";
  }

  function authTerminalError(session = {}) {
    if (authSessionUserCode(session)) {
      return "";
    }
    return authTerminal.terminalError.value;
  }

  function sessionStatusMessage(session = {}) {
    if (session.status === "connected") {
      return `${session.account?.label || "Account"} is connected.`;
    }
    if (authSessionNeedsTerminalAttention(session)) {
      return "Codex needs attention in the terminal. Review the terminal output and respond there.";
    }
    if (session.status === "failed") {
      return "Login did not finish cleanly. Review the logs and try again.";
    }
    if (session.mode === "api_key") {
      return "Signing in with the OpenAI API key. Open the terminal if Vibe64 needs more details.";
    }
    if (session.mode === "device" && authSessionUserCode(session)) {
      return "Copy the one-time code, then finalise authorization in your browser.";
    }
    if (session.mode === "device" && session.authUrl) {
      return "Waiting for Codex to print the one-time code.";
    }
    if (session.mode === "device") {
      return "Starting code login and waiting for Codex to print a device code.";
    }
    if (session.authUrl) {
      return "Browser login is open. Complete authorization there, then Studio will continue.";
    }
    return "Starting login and waiting for the browser URL.";
  }

  onBeforeUnmount(() => {
    stopPolling();
    authTerminal.disposeTerminalUi();
  });

  watch(
    authTerminalSession,
    (session) => {
      if (!authTerminalSessionId.value) {
        return;
      }
      if (!session) {
        closeAuthTerminal();
        return;
      }
      authTerminal.applyTerminalSession(session, {
        preserveOutput: true
      });
    },
    {
      deep: true
    }
  );

  watch(
    accountRows,
    (rows) => {
      for (const account of rows) {
        syncGitIdentityInput(account);
      }
    },
    {
      deep: true,
      immediate: true
    }
  );

  watch(
    () => accountRows.value
      .map((account) => activeSessionFor(account.id)?.id)
      .filter(Boolean),
    (activeSessionIds) => {
      const activeSessionIdSet = new Set(activeSessionIds);
      for (const sessionId of Object.keys(codexAuthStepsBySessionId)) {
        if (!activeSessionIdSet.has(sessionId)) {
          delete codexAuthStepsBySessionId[sessionId];
        }
      }
    },
    {
      deep: true
    }
  );

  watch(
    () => activeAuthSessions().map((session) => [
      session.id,
      session.account?.id || session.account || "",
      session.mode || "",
      session.status || "",
      session.terminalStatus || "",
      session.outputVersion || 0,
      String(session.output || "").length,
      String(session.userCode || ""),
      String(session.closeError || session.error || session.terminalError || "")
    ].join(":")),
    () => {
      const activeSessionIdSet = new Set(activeAuthSessions().map((session) => session.id).filter(Boolean));
      for (const sessionId of Array.from(authTerminalAttentionOpenedSessionIds)) {
        if (!activeSessionIdSet.has(sessionId)) {
          authTerminalAttentionOpenedSessionIds.delete(sessionId);
        }
      }
      for (const session of activeAuthSessions()) {
        void openAuthTerminalForAttention(session);
      }
    },
    {
      immediate: true
    }
  );

  return {
    CHATGPT_SECURITY_SETTINGS_URL,
    accountActiveSession,
    accountLoginDisabled,
    accountRows,
    accountStatusMessage,
    accountSupportsApiKeyAuth,
    accountsLoading,
    accountsReadyForActions,
    apiKeyFormVisible,
    apiKeyInput,
    apiKeyLoginDisabled,
    authSessionUserCode,
    authBusy,
    authCopyStatus,
    authTerminal,
    authTerminalAvailable,
    authTerminalError,
    authTerminalVisible,
    cancelSession,
    closeAuthTerminal,
    codexAuthorizeStepVisible,
    codexSettingsStepVisible,
    copyAuthCode,
    errorMessage,
    gitIdentityInput,
    loginOutputVisible,
    logoutAccount,
    logoutAccountId,
    openAuthUrl,
    primaryAuthLabel,
    requiresGitIdentity,
    refreshStatus,
    sessionStatusMessage,
    setCodexAuthStep,
    startAccountApiKeyAuth,
    startAccountAuth,
    statusReady,
    toggleApiKeyForm,
    toggleAuthTerminal
  };
}

export {
  useProviderAccountsSetup
};
