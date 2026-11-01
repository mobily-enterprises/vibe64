import { cleanAuthOutput, redactedAuthOutputTail } from "../shared/authOutput.js";
import { authError } from "./accountsRuntime.js";
import { ensureToolHomeSource } from "./accountFiles.js";
import { hostCommandOptionsForCredentialContext } from "./accountHostCommands.js";
import { accountsResult, normalizedAccountId } from "./accountRecords.js";
import { accountDebugSummary, authDebug } from "./accountsDebug.js";
import { githubGitIdentityFromInput, gitIdentitySaveCommandArgs, logoutCommandArgs } from "./authCommands.js";
import { readGithubStoredStatus, recordGithubAuthInvalidState, writeGithubAuthStatus } from "./githubAccountStatus.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */
/** @typedef {import("./types.js").AuthSessionViews} AuthSessionViews */
/** @typedef {import("./types.js").AccountStatusReads} AccountStatusReads */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */

/**
 * Credential changes outside a sign-in: a GitHub token found invalid, the
 * person's Git identity, and signing out of an account.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {AuthSessionViews} dependencies.authSessionViews
 * @param {RuntimeEnv} dependencies.env
 * @param {AccountNotifications} dependencies.notifications
 * @param {AccountStatusReads} dependencies.statusReads
 */
function createAccountCredentials({
  access,
  authSessionViews,
  env,
  notifications,
  statusReads
}) {
  async function recordGithubAuthInvalid(input = {}) {
    return accountsResult(async () => {
      const githubContext = access.githubContextForInput(input);
      return recordGithubAuthInvalidState({
        githubContext,
        previousGithub: access.previousGithubForInput(input),
        publishAccountChanged: notifications.publishAccountChanged,
        reason: input.reason || "github-command",
        systemRoot: access.systemRoot
      });
    });
  }

  async function saveGitIdentity(input) {
    return accountsResult(async () => {
      const githubContext = access.githubContextForInput(input);
      if (!githubContext.ok) {
        return githubContext;
      }
      const gitIdentity = githubGitIdentityFromInput(input);
      if (!gitIdentity.ok) {
        return authError("github_git_identity_required", gitIdentity.error || "Git identity is required.");
      }
      await ensureToolHomeSource(githubContext);
      const result = await access.accountRunHostCommand(gitIdentitySaveCommandArgs(gitIdentity), {
        ...hostCommandOptionsForCredentialContext(githubContext),
        timeout: 30_000
      });
      if (result.ok === false) {
        return {
          error: result.error || result.output || "Git identity could not be saved.",
          errors: [
            {
              code: "github_git_identity_save_failed",
              message: result.error || result.output || "Git identity could not be saved."
            }
          ],
          ok: false,
          output: result.output || ""
        };
      }
      const account = await statusReads.accountStatus("github", {
        githubContext,
        previousGithub: access.previousGithubForInput(input)
      });
      return {
        account,
        ok: account?.ok !== false,
        output: result.output || ""
      };
    });
  }

  async function logout(input) {
    return access.accountChange("logout", input, { accountId: String(input.accountId || "") }, async () => {
      const accountId = normalizedAccountId(input.accountId);
      authDebug("server.auth.logout.start", {
        accountId: accountId || String(input.accountId || ""),
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

      const githubContext = accountId === "github" ? access.githubContextForInput(input) : null;
      if (githubContext && !githubContext.ok) {
        return githubContext;
      }
      const providerContext = access.authCredentialContext(accountId, githubContext);
      await ensureToolHomeSource(providerContext);
      const result = await access.accountRunHostCommand(logoutCommandArgs(accountId, env), {
        ...hostCommandOptionsForCredentialContext(providerContext),
        timeout: 30_000
      });
      authDebug("server.auth.logout.host_command_done", {
        accountId,
        ok: result.ok === true,
        outputLength: cleanAuthOutput(result.output).length,
        outputTail: redactedAuthOutputTail(result.output)
      });
      let account;
      if (accountId === "github" && result.ok) {
        await writeGithubAuthStatus({
          githubContext,
          systemRoot: access.systemRoot
        }, {
          message: "GitHub is not connected for this Vibe64 user.",
          reason: "logout",
          status: "not_connected"
        });
        account = await readGithubStoredStatus({
          githubContext,
          previousGithub: access.previousGithubForInput(input),
          systemRoot: access.systemRoot
        });
      } else {
        account = accountId === "codex"
          ? await statusReads.codexStatusWithNewMarker("logout")
          : await statusReads.accountStatus(accountId, { githubContext });
      }
      if (result.ok) await authSessionViews.forgetFinishedAuthSessions(accountId, String(githubContext?.userKey || ""));
      authDebug("server.auth.logout.done", {
        account: accountDebugSummary(account),
        accountId,
        ok: result.ok === true
      });
      return {
        account,
        ok: result.ok,
        output: result.output
      };
    });
  }

  return Object.freeze({
    recordGithubAuthInvalid,
    saveGitIdentity,
    logout
  });
}

export {
  createAccountCredentials
};
