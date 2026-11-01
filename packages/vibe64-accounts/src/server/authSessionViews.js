import { readFile } from "node:fs/promises";
import {
  closeTerminalSession,
  readTerminalSession,
  resizeTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";

import { cleanAuthOutput, redactedAuthOutputTail } from "../shared/authOutput.js";
import { authError } from "./accountsRuntime.js";
import { accountsResult, authenticatingAccount, normalizedAccountId, normalizedAuthMode } from "./accountRecords.js";
import { accountDebugSummary, authDebug } from "./accountsDebug.js";
import { ACCOUNT_AUTH_NAMESPACE, parseAuthOutput, publicAuthSession } from "./authCommands.js";

/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {import("./types.js").AccountStatusReads} AccountStatusReads */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */
/** @typedef {ReturnType<typeof createAuthSessionState>} AuthSessionState */

// The sign-in sessions this process started or found, shared by their readers
// and their terminals: each session's metadata, a Claude session's browser
// handoff file, and the sessions being cancelled or already finalized for Codex.
function createAuthSessionState() {
  return Object.freeze({
    authSessions: new Map(),
    claudeBrowserFiles: new Map(),
    cancelledAuthSessions: new Set(),
    finalizedCodexAuthSessions: new Set()
  });
}

/**
 * Sign-in sessions as their readers see them: who may see one, what it shows,
 * the events it publishes, its terminal's input and size, and its cancel.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {AccountNotifications} dependencies.notifications
 * @param {AuthSessionState} dependencies.state
 * @param {AccountStatusReads} dependencies.statusReads
 */
function createAuthSessionViews({ access, notifications, state, statusReads }) {
  function authMetadata(sessionId = "", input = {}) {
    const existing = state.authSessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const terminal = readTerminalSession(sessionId, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
    if (terminal.ok === false) {
      return null;
    }

    const accountId = normalizedAccountId(terminal.metadata?.accountId);
    if (!accountId) {
      return null;
    }
    const mode = normalizedAuthMode(accountId, terminal.metadata?.mode);
    const githubContext = accountId === "github" ? access.githubContextForInput(input) : null;
    if (githubContext && (!githubContext.ok || terminal.metadata?.userKey !== githubContext.userKey)) {
      return null;
    }

    const metadata = {
      accountId,
      actorId: String(terminal.metadata?.actorId || ""),
      githubContext,
      mode,
      startedAt: terminal.createdAt || "",
      userKey: accountId === "github" ? String(terminal.metadata?.userKey || "") : ""
    };
    state.authSessions.set(sessionId, metadata);
    return metadata;
  }

  // A finished sign-in is kept so readers can see how it ended, until the same
  // account changes again: a later sign-in finishes, or it signs out.
  async function forgetFinishedAuthSessions(accountId = "", userKey = "", { except = "" } = {}) {
    for (const [sessionId, metadata] of state.authSessions) {
      if (sessionId === except || metadata.accountId !== accountId || (accountId === "github" && metadata.userKey !== userKey)) continue;
      const terminal = readTerminalSession(sessionId, { namespace: ACCOUNT_AUTH_NAMESPACE });
      if (terminal.ok !== false && terminal.status !== "exited") continue;
      if (terminal.ok !== false) {
        const closed = await closeTerminalSession(sessionId, { namespace: ACCOUNT_AUTH_NAMESPACE });
        if (closed.ok === false) continue;
      }
      state.authSessions.delete(sessionId);
      state.cancelledAuthSessions.delete(sessionId);
      state.finalizedCodexAuthSessions.delete(sessionId);
      state.claudeBrowserFiles.delete(sessionId);
    }
  }

  function sessionVisibleToInput(input = {}, metadata = {}) {
    if (["claude", "codex"].includes(metadata.accountId)) return !access.aiManagementError(input);
    if (metadata.accountId !== "github") {
      return true;
    }
    const githubContext = access.githubContextForInput(input);
    return githubContext.ok && metadata.userKey === githubContext.userKey;
  }

  function rotateCodexMarkerForFinalizedAuthSession(sessionId, metadata, exitCode) {
    if (metadata.accountId !== "codex" || exitCode !== 0) {
      return false;
    }
    const normalizedSessionId = String(sessionId || "").trim();
    if (
      !normalizedSessionId ||
      state.cancelledAuthSessions.has(normalizedSessionId) ||
      state.finalizedCodexAuthSessions.has(normalizedSessionId)
    ) {
      return false;
    }
    state.finalizedCodexAuthSessions.add(normalizedSessionId);
    return true;
  }

  async function readSessionWithAccount(input) {
    const sessionId = String(input.sessionId || "");
    authDebug("server.auth.read.start", {
      sessionId
    });
    const metadata = authMetadata(sessionId, input);
    if (!metadata || !sessionVisibleToInput(input, metadata)) {
      authDebug("server.auth.read.missing", {
        hasMetadata: Boolean(metadata),
        sessionId
      });
      return authError("unknown_auth_session", "Account auth session not found.");
    }

    const terminal = readTerminalSession(sessionId, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
    if (terminal.ok === false) {
      authDebug("server.auth.read.terminal_error", {
        accountId: metadata.accountId,
        error: terminal.error || "",
        sessionId
      });
      return terminal;
    }

    const parsed = await authSessionHandoff({
      sessionId,
      accountId: metadata.accountId,
      mode: metadata.mode,
      output: terminal.output
    });
    authDebug("server.auth.read.terminal", {
      accountId: metadata.accountId,
      authUrlPresent: Boolean(parsed.authUrl),
      exitCode: terminal.exitCode,
      inputVersion: terminal.inputVersion || 0,
      mode: metadata.mode,
      outputLength: cleanAuthOutput(terminal.output).length,
      outputTail: metadata.accountId === "claude" ? "" : redactedAuthOutputTail(terminal.output),
      outputVersion: terminal.outputVersion || 0,
      sessionId,
      terminalStatus: terminal.status,
      userCodePresent: Boolean(parsed.userCode)
    });

    const finalizedCodexAuthSession = terminal.status === "exited"
      ? rotateCodexMarkerForFinalizedAuthSession(sessionId, metadata, terminal.exitCode)
      : false;
    const account = terminal.status === "exited"
      ? metadata.account || await statusReads.accountStatus(metadata.accountId, {
          codexMarkerReason: finalizedCodexAuthSession ? "auth-session-exited" : "auth-session-status",
          githubContext: metadata.githubContext,
          previousGithub: access.previousGithubForInput(input),
          rotateCodexMarker: finalizedCodexAuthSession
        })
      : authenticatingAccount(metadata.accountId);
    authDebug("server.auth.read.account_status", {
      account: accountDebugSummary(account),
      accountId: metadata.accountId,
      sessionId,
      terminalStatus: terminal.status
    });

    return publicAuthSession({
      account,
      mode: metadata.mode,
      parsed,
      terminal
    });
  }

  async function authSessionHandoff({ sessionId, accountId, mode, output }) {
    if (accountId !== "claude") return parseAuthOutput({ accountId, mode, output });
    const filename = state.claudeBrowserFiles.get(sessionId);
    if (!filename) return { authUrl: "", userCode: "" };
    try {
      const { authUrl } = JSON.parse(await readFile(filename, "utf8"));
      return { authUrl, userCode: "" };
    } catch (error) {
      if (error.code === "ENOENT") return { authUrl: "", userCode: "" };
      throw error;
    }
  }

  async function authSessionSnapshot({
    account,
    metadata,
    terminal
  }) {
    const parsed = await authSessionHandoff({
      sessionId: terminal.id,
      accountId: metadata.accountId,
      mode: metadata.mode,
      output: terminal.output
    });
    return publicAuthSession({
      account: account || authenticatingAccount(metadata.accountId),
      mode: metadata.mode,
      parsed,
      terminal
    });
  }

  async function publishAuthSessionSnapshot({
    account = null,
    metadata = {},
    reason = "",
    terminal = {}
  } = {}) {
    if (!metadata?.accountId || !terminal?.id) {
      return null;
    }
    const session = await authSessionSnapshot({
      account,
      metadata,
      terminal
    });
    return notifications.publishAuthSessionChanged(session, {
      actorId: metadata.actorId || "",
      reason
    });
  }

  function publishAuthTerminalOutput({
    metadata = {},
    terminal = {}
  } = {}) {
    void publishAuthSessionSnapshot({
      metadata,
      reason: "terminal-output",
      terminal
    }).catch((error) => {
      authDebug("server.auth.session_changed.publish.error", {
        accountId: metadata.accountId || "",
        message: String(error?.message || error || "Account auth session event could not be published."),
        reason: "terminal-output",
        sessionId: terminal.id || ""
      });
    });
  }

  function requireVisibleAuthTerminal(input) {
    const sessionId = String(input.sessionId || "");
    const metadata = authMetadata(sessionId, input);
    if (!metadata || !sessionVisibleToInput(input, metadata)) {
      return authError("unknown_auth_session", "Account auth session not found.");
    }
    return {
      metadata,
      sessionId
    };
  }

  async function readAuthSession(input) {
    return accountsResult(() => readSessionWithAccount(input));
  }

  async function cancelAuthSession(input) {
    return access.accountChange("cancel-sign-in", input, { authSessionId: String(input.sessionId || "") }, async () => {
      const id = String(input.sessionId || "");
      const metadata = authMetadata(id, input);
      if (!metadata || !sessionVisibleToInput(input, metadata)) {
        return authError("unknown_auth_session", "Account auth session not found.");
      }
      state.cancelledAuthSessions.add(id);
      const result = await closeTerminalSession(id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
      state.cancelledAuthSessions.delete(id);
      if (result.ok === false) return result;
      state.authSessions.delete(id);
      state.finalizedCodexAuthSessions.delete(id);
      return {
        ...result,
        ok: true
      };
    });
  }

  function subscribeAuthTerminal(input = {}, subscriber) {
    const visible = requireVisibleAuthTerminal(input);
    if (visible.ok === false) {
      return visible;
    }
    return subscribeTerminalSession(visible.sessionId, subscriber, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
  }

  function writeAuthTerminal(input = {}, data = "") {
    const visible = requireVisibleAuthTerminal(input);
    if (visible.ok === false) {
      return visible;
    }
    return writeTerminalSession(visible.sessionId, data, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
  }

  function resizeAuthTerminal(input = {}, size = {}) {
    const visible = requireVisibleAuthTerminal(input);
    if (visible.ok === false) {
      return visible;
    }
    return resizeTerminalSession(visible.sessionId, size, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
  }

  return Object.freeze({
    authMetadata,
    forgetFinishedAuthSessions,
    rotateCodexMarkerForFinalizedAuthSession,
    readSessionWithAccount,
    publishAuthSessionSnapshot,
    publishAuthTerminalOutput,
    readAuthSession,
    cancelAuthSession,
    subscribeAuthTerminal,
    writeAuthTerminal,
    resizeAuthTerminal
  });
}

export {
  createAuthSessionState,
  createAuthSessionViews
};
