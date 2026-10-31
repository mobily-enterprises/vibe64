import { watch } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTerminalSession } from "@local/vibe64-execution/server/terminalSessions";
import { operatorCliProblem, resolveOperatorCli } from "@local/vibe64-execution/server";

import { logAccountChange } from "./accountChangeLog.js";
import { API_KEY_AUTH_MODE, authError } from "./accountsRuntime.js";
import { ensureToolHomeSource } from "./accountFiles.js";
import {
  accountCommandActor,
  accountCommandRuntimes,
  hostCommandOptionsForCredentialContext
} from "./accountHostCommands.js";
import { ACCOUNT_DEFINITIONS, normalizedAccountId, normalizedAuthMode } from "./accountRecords.js";
import { accountDebugSummary, authDebug } from "./accountsDebug.js";
import {
  ACCOUNT_AUTH_NAMESPACE,
  accountAuthWorkingDirectory,
  authCommandPreview,
  authTerminalCredentialHome,
  authTerminalMetadata,
  authTerminalPurpose,
  authTerminalRunningLimitFilter,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  githubGitIdentityFromInput,
  terminalArgsForAuth,
  unsupportedAuthMode
} from "./authCommands.js";

/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {ReturnType<typeof import("./authSessionViews.js").createAuthSessionViews>} AuthSessionViews */
/** @typedef {ReturnType<typeof import("./accountStatusReads.js").createAccountStatusReads>} AccountStatusReads */
/** @typedef {ReturnType<typeof import("./modelRouting.js").createModelRouting>} ModelRouting */
/** @typedef {ReturnType<typeof import("./authSessionViews.js").createAuthSessionState>} AuthSessionState */
/** @typedef {ReturnType<typeof import("./accountAccess.js").createAccountAccess>} AccountAccess */

/**
 * Sign-in terminals: starting one for an account, and finishing its account
 * change when it closes.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {AccountsRuntime} dependencies.accountRuntime
 * @param {AuthSessionViews} dependencies.authSessionViews
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {ModelRouting} dependencies.modelRouting
 * @param {AccountNotifications} dependencies.notifications
 * @param {typeof import("@local/vibe64-execution/server").runVibe64Command} dependencies.runAuthTerminalCommand
 * @param {AuthSessionState} dependencies.state
 * @param {AccountStatusReads} dependencies.statusReads
 */
function createAuthTerminals({ access, accountRuntime, authSessionViews, env, logger, modelRouting, notifications, runAuthTerminalCommand, state, statusReads }) {
  function createAuthTerminalCloseHandler({
    accountId,
    githubContext,
    previousGithub,
    vibe64User
  }) {
    return async function handleAuthTerminalClose({
      exitCode = null,
      id = "",
      reason = ""
    } = {}) {
      if (state.cancelledAuthSessions.has(String(id || ""))) {
        authDebug("server.auth.terminal.finalize.skipped_cancelled", {
          accountId,
          reason,
          sessionId: id
        });
        return;
      }
      authDebug("server.auth.terminal.finalize.start", {
        accountId,
        reason,
        sessionId: id
      });
      const finalizedCodexAuthSession = authSessionViews.rotateCodexMarkerForFinalizedAuthSession(id, {
        accountId
      }, exitCode);
      const account = await statusReads.accountStatus(accountId, {
        codexMarkerReason: finalizedCodexAuthSession
          ? reason || "terminal-close"
          : "terminal-close-status",
        githubContext,
        previousGithub,
        rotateCodexMarker: finalizedCodexAuthSession
      });
      if (["codex", "claude"].includes(accountId) && account?.connected === true && exitCode === 0) {
        account.routing = await modelRouting.initializeModelRouting({ vibe64User });
      }
      // Reads of the finished session reuse this status instead of asking the CLI again.
      const finishedMetadata = authSessionViews.authMetadata(id);
      if (finishedMetadata) finishedMetadata.account = account;
      authDebug("server.auth.account_changed.publish.start", {
        account: accountDebugSummary(account),
        accountId,
        reason: reason || "terminal-close",
        sessionId: id
      });
      const publishResult = await notifications.publishAccountChanged(accountId, {
        actorId: githubContext?.uid ? String(githubContext.uid) : null,
        account,
        authSessionId: id,
        reason: reason || "terminal-close",
        status: account?.status || ""
      });
      const terminal = readTerminalSession(id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
      if (terminal.ok !== false) {
        await authSessionViews.publishAuthSessionSnapshot({
          account,
          metadata: authSessionViews.authMetadata(id) || {
            accountId
          },
          reason: reason || "terminal-close",
          terminal: {
            ...terminal,
            status: "exited"
          }
        });
      }
      authDebug("server.auth.account_changed.publish.done", {
        accountId,
        publishResultPresent: Boolean(publishResult),
        reason: reason || "terminal-close",
        sessionId: id
      });
      await authSessionViews.forgetFinishedAuthSessions(accountId, String(githubContext?.userKey || ""), { except: id });
      const startedAt = Date.parse(finishedMetadata?.startedAt || "");
      logAccountChange(logger, "finish-sign-in", { accountId, authSessionId: id, exitCode },
        exitCode === 0 && account?.connected === true ? { ok: true }
          : { ok: false, code: account?.code || "", error: account?.message || "The sign-in did not connect the account." },
        Number.isFinite(startedAt) ? startedAt : Date.now());
      authDebug("server.auth.terminal.finalize.done", {
        accountId,
        connected: account?.connected === true,
        reason,
        sessionId: id,
        status: account?.status || ""
      });
    };
  }

  async function startAuthTerminal(accountId, mode, githubContext, gitIdentity, authSecrets, options) {
    const reuseRunning = canReuseAuthTerminal(accountId, mode, githubContext);
    for (const sessionId of state.authSessions.keys()) {
      const session = readTerminalSession(sessionId, { namespace: ACCOUNT_AUTH_NAMESPACE });
      if (session.ok === false || !["running", "closing"].includes(session.status) || !reuseRunning(session)) continue;
      if (session.status === "closing") {
        return authError("account_auth_session_closing", "The previous sign-in is still closing. Try again shortly.");
      }
      // Reuse before the gateway reserves a new execution that would never start.
      return session;
    }
    if (["claude", "codex"].includes(accountId) && !resolveOperatorCli(accountId, { env }).installed) {
      const { code, message, install } = operatorCliProblem(accountId);
      return authError(code, message, { install });
    }
    const actorId = String(options.actorId || "");
    const providerContext = access.authCredentialContext(accountId, githubContext);
    await ensureToolHomeSource(providerContext);
    const hostCommandOptions = hostCommandOptionsForCredentialContext(providerContext);
    const args = terminalArgsForAuth(accountId, mode, gitIdentity, env);
    const command = String(args[0] || "").trim();
    if (!command) {
      return authError("account_auth_command_missing", "No auth command was provided.");
    }
    const authCwd = accountAuthWorkingDirectory(providerContext, access.currentTargetRoot() || process.cwd());
    const credentialHome = authTerminalCredentialHome(providerContext);
    const browserRoot = accountId === "claude" ? await mkdtemp(path.join(os.tmpdir(), "v64-claude-auth-")) : "";
    const browserFile = browserRoot ? path.join(browserRoot, "handoff.json") : "";
    // Claude prints its sign-in prompt before it runs BROWSER, so no later
    // output announces the link: publish the session when the link lands.
    let browserSessionId = "";
    const browserWatcher = browserRoot ? watch(browserRoot, (_event, name) => {
      const terminal = name === path.basename(browserFile) && browserSessionId
        ? readTerminalSession(browserSessionId, { namespace: ACCOUNT_AUTH_NAMESPACE }) : null;
      if (terminal && terminal.ok !== false) {
        authSessionViews.publishAuthTerminalOutput({ metadata: authTerminalMetadata(accountId, mode, githubContext, actorId), terminal });
      }
    }) : null;
    const cleanupBrowser = async () => {
      browserWatcher?.close();
      if (browserRoot) await rm(browserRoot, { recursive: true, force: true });
    };
    authDebug("server.auth.terminal.start", {
      accountId,
      credentialScope: ACCOUNT_DEFINITIONS[accountId]?.scope || "",
      gitIdentityConfigured: accountId !== "github" || Boolean(gitIdentity.name && gitIdentity.email),
      mode,
      toolHomeSource: providerContext?.toolHomeSource || "",
      userKey: accountId === "github" ? String(githubContext?.userKey || "") : ""
    });
    let terminal;
    try {
      terminal = await runAuthTerminalCommand({
        actor: accountCommandActor(hostCommandOptions),
        allowedRoots: [
          authCwd
        ],
        args: args.slice(1),
        command,
        credentialHome,
        cwd: authCwd,
        env: { ...authSecrets, ...(browserFile ? {
          BROWSER: fileURLToPath(import.meta.resolve("@local/vibe64-accounts/bin/claude-auth-browser")),
          VIBE64_CLAUDE_AUTH_HANDOFF: browserFile,
          DISABLE_AUTOUPDATER: "1"
        } : {}) },
        envPolicy: "auth",
        mode: "pty",
        purpose: authTerminalPurpose(accountId),
        runtimes: accountCommandRuntimes(command),
        terminal: {
          commandPreview: authCommandPreview(args),
          helperPayloadRoot: access.systemRoot,
          maxRunning: 1,
          metadata: authTerminalMetadata(accountId, mode, githubContext, actorId),
          namespace: ACCOUNT_AUTH_NAMESPACE,
          onClose: async (event) => {
            try {
              await createAuthTerminalCloseHandler({ accountId, githubContext,
                previousGithub: options.previousGithub, vibe64User: options.vibe64User })(event);
            } finally {
              state.claudeBrowserFiles.delete(event.id);
              await cleanupBrowser();
            }
          },
          onOutput: ({ session } = {}) => {
            if (browserFile && session?.id) state.claudeBrowserFiles.set(session.id, browserFile);
            authSessionViews.publishAuthTerminalOutput({
              metadata: authTerminalMetadata(accountId, mode, githubContext, actorId),
              terminal: session
            });
          },
          runningLimitFilter: authTerminalRunningLimitFilter(accountId, mode, githubContext),
          reuseRunning
        },
        userKey: credentialHome.username
      });
    } catch (error) {
      await cleanupBrowser();
      throw error;
    }
    if (terminal.ok === false) {
      await cleanupBrowser();
      authDebug("server.auth.terminal.start_failed", {
        accountId,
        code: terminal.code || "",
        error: terminal.error || "",
        mode
      });
      return terminal;
    }

    if (browserFile) {
      if (state.authSessions.has(terminal.id)) await cleanupBrowser();
      else {
        state.claudeBrowserFiles.set(terminal.id, browserFile);
        browserSessionId = terminal.id;
      }
    }

    if (!state.authSessions.has(terminal.id)) {
      state.authSessions.set(terminal.id, {
        accountId,
        actorId,
        githubContext: accountId === "github" ? githubContext : null,
        mode,
        startedAt: new Date().toISOString(),
        userKey: accountId === "github" ? String(githubContext?.userKey || "") : ""
      });
    }
    authDebug("server.auth.terminal.started", {
      accountId,
      mode,
      reused: terminal.outputVersion > 0 || terminal.inputVersion > 0,
      sessionId: terminal.id,
      terminalStatus: terminal.status
    });
    return terminal;
  }

  async function startAuth(input) {
    return access.accountChange("start-sign-in", input, { accountId: String(input.accountId || ""), mode: String(input.mode || "") }, async () => {
      const accountId = normalizedAccountId(input.accountId);
      authDebug("server.auth.start.request", {
        accountId: accountId || String(input.accountId || ""),
        mode: input.mode || "",
        ...access.debugInputForLog(input)
      });
      if (!accountId) {
        return authError("unknown_account", "Unknown account.");
      }
      if (accountId === "claude") {
        const failure = await access.prepareClaudeAuthChange(input);
        if (failure) return failure;
      }
      if (accountId === "codex") {
        const managementError = access.aiManagementError(input);
        if (managementError) {
          return managementError;
        }
      }

      const mode = normalizedAuthMode(accountId, input.mode);
      const unsupportedMode = unsupportedAuthMode(accountId, mode, accountRuntime);
      if (unsupportedMode) {
        authDebug("server.auth.start.unsupported_mode", {
          accountId,
          mode
        });
        return unsupportedMode;
      }
      const githubContext = accountId === "github" ? access.githubContextForInput(input) : null;
      if (githubContext && !githubContext.ok) {
        authDebug("server.auth.start.github_context_error", {
          code: githubContext.code || "",
          error: githubContext.error || ""
        });
        return githubContext;
      }
      const gitIdentity = accountId === "github" ? githubGitIdentityFromInput(input) : {};
      if (accountId === "github" && !gitIdentity.ok) {
        return authError("github_git_identity_required", gitIdentity.error || "Git identity is required before GitHub login.");
      }
      const authSecrets = {};
      if (mode === API_KEY_AUTH_MODE) {
        const apiKey = String(input.apiKey || "").trim();
        if (!apiKey) {
          return authError("codex_api_key_required", "OpenAI API key is required.");
        }
        authSecrets[CODEX_API_KEY_ENV] = apiKey;
      }
      const terminal = await startAuthTerminal(accountId, mode, githubContext, gitIdentity, authSecrets, {
        actorId: input.vibe64User?.uid || "",
        vibe64User: input.vibe64User || null,
        previousGithub: access.previousGithubForInput(input)
      });
      if (terminal.ok === false) {
        return terminal;
      }

      return authSessionViews.readSessionWithAccount({
        ...input,
        sessionId: terminal.id
      });
    });
  }

  return Object.freeze({
    startAuth
  });
}

export {
  createAuthTerminals
};
