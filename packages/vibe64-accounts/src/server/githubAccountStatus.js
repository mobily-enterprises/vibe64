import { rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { USER_CREDENTIAL_SCOPE } from "@local/vibe64-execution/server";

import {
  GITHUB_RECONNECT_REQUIRED_CODE,
  GITHUB_RECONNECT_REQUIRED_MESSAGE,
  githubCliAccountFailureMessage
} from "./githubCliAuth.js";
import { authError } from "./accountsRuntime.js";
import {
  ensureToolHomeSource,
  isUserCredentialContext,
  readOptionalJson,
  readOptionalText,
  writeJsonFile
} from "./accountFiles.js";
import { hostCommandOptionsForCredentialContext, hostCommandResultOutput } from "./accountHostCommands.js";
import { accountConnected, accountDisconnected } from "./accountRecords.js";
import { REQUIRED_GITHUB_SCOPES } from "./authCommands.js";

/** @typedef {import("./types.js").PublishAccountChanged} PublishAccountChanged */

// GitHub's account status: live gh and Git checks with transient retries, the
// stored status a logout or a rejected token records, and the remembered identity.

const GITHUB_GIT_CREDENTIAL_HELPER = "gh auth git-credential";

const GITHUB_STATUS_TRANSIENT_RETRY_ATTEMPTS = 3;

const GITHUB_STATUS_TRANSIENT_RETRY_DELAY_MS = 75;

const GITHUB_STATUS_TRANSIENT_FAILURE_PATTERN = /\b(?:EAGAIN|EINTR|EBUSY|resource temporarily unavailable)\b/iu;

const GITHUB_STATUS_TEMPORARILY_UNAVAILABLE_CODE = "vibe64_github_status_temporarily_unavailable";

const GITHUB_HOSTS_RELATIVE_PATH = Object.freeze([".config", "gh", "hosts.yml"]);

const GITHUB_GITCONFIG_RELATIVE_PATH = Object.freeze([".gitconfig"]);

function hostCommandResultTransientFailure(result) {
  return result?.ok !== true && GITHUB_STATUS_TRANSIENT_FAILURE_PATTERN.test(hostCommandResultOutput(result));
}

async function runGithubStatusProbe(runHostToolCommand, commandArgs = [], options = {}) {
  let result = null;
  for (let attempt = 1; attempt <= GITHUB_STATUS_TRANSIENT_RETRY_ATTEMPTS; attempt += 1) {
    result = await runHostToolCommand(commandArgs, options);
    if (!hostCommandResultTransientFailure(result) || attempt >= GITHUB_STATUS_TRANSIENT_RETRY_ATTEMPTS) {
      return result;
    }
    await delay(GITHUB_STATUS_TRANSIENT_RETRY_DELAY_MS * attempt);
  }
  return result;
}

function parseGithubHosts(hostsText = "") {
  const hasGithubHost = /^\s*github\.com\s*:/mu.test(hostsText);
  return {
    tokenPresent: hasGithubHost && /^\s*oauth_token\s*:\s*\S+/mu.test(hostsText),
    username: String(hostsText.match(/^\s*user\s*:\s*([^\s#]+)/mu)?.[1] || "").trim()
  };
}

function parseGitIdentity(gitConfigText = "") {
  return {
    email: String(gitConfigText.match(/^\s*email\s*=\s*(.+?)\s*$/mu)?.[1] || "").trim(),
    name: String(gitConfigText.match(/^\s*name\s*=\s*(.+?)\s*$/mu)?.[1] || "").trim()
  };
}

function gitCredentialHelperConfigured(gitConfigText = "") {
  return gitConfigText.includes(GITHUB_GIT_CREDENTIAL_HELPER);
}

function githubLocalObserved({
  gitIdentity = {},
  helperConfigured = false,
  tokenPresent = false
} = {}) {
  return [
    `Local GitHub token: ${tokenPresent ? "present" : "missing"}.`,
    `Git credential helper: ${helperConfigured ? "present" : "missing"}.`,
    `Git identity: ${gitIdentity.name && gitIdentity.email ? "present" : "missing"}.`
  ].join(" ");
}

/**
 * A disconnected GitHub row that keeps the remembered identity, so the card
 * can offer to reconnect the account it was previously linked to.
 */
function githubDisconnected(previousGithub, fields) {
  const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
  return accountDisconnected({
    id: "github",
    label: "GitHub",
    previousGithub: previousGithubIdentity,
    previousUsername: previousGithubIdentity?.login || "",
    scope: USER_CREDENTIAL_SCOPE,
    ...fields
  });
}

function githubPreviouslyLinkedMessage(login) {
  return `GitHub was previously linked as @${login}, but this host is not ready to use it. Reconnect GitHub to continue.`;
}

async function readGithubStoredStatus({
  githubContext,
  previousGithub,
  systemRoot
}) {
  const authStatus = await readGithubAuthStatus({
    githubContext,
    systemRoot
  });
  if (authStatus?.status === "reconnect_required") {
    return githubDisconnected(previousGithub, {
      code: GITHUB_RECONNECT_REQUIRED_CODE,
      message: authStatus.message || GITHUB_RECONNECT_REQUIRED_MESSAGE,
      status: "reconnect_required"
    });
  }
  if (authStatus?.status === "not_connected") {
    return githubDisconnected(previousGithub, {
      message: authStatus.message || "GitHub is not connected for this Vibe64 user.",
      observed: "GitHub logout was recorded locally."
    });
  }
  if (isUserCredentialContext(githubContext)) {
    const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
    return previousGithubIdentity
      ? accountConnected({
        id: "github",
        label: "GitHub",
        message: `GitHub is connected as @${previousGithubIdentity.login}.`,
        observed: "Cached Vibe64 user identity.",
        scope: USER_CREDENTIAL_SCOPE,
        username: previousGithubIdentity.login
      })
      : null;
  }

  const toolHomeSource = String(githubContext?.toolHomeSource || "");
  const [hostsText, gitConfigText] = await Promise.all([
    readOptionalText(toolHomeSource ? path.join(toolHomeSource, ...GITHUB_HOSTS_RELATIVE_PATH) : ""),
    readOptionalText(toolHomeSource ? path.join(toolHomeSource, ...GITHUB_GITCONFIG_RELATIVE_PATH) : "")
  ]);
  const hosts = parseGithubHosts(hostsText);
  const gitIdentity = parseGitIdentity(gitConfigText);
  const helperConfigured = gitCredentialHelperConfigured(gitConfigText);
  const missingGitIdentity = !gitIdentity.name || !gitIdentity.email;
  const observed = githubLocalObserved({
    gitIdentity,
    helperConfigured,
    tokenPresent: hosts.tokenPresent
  });

  if (!hosts.tokenPresent || !helperConfigured || missingGitIdentity) {
    const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
    if (previousGithubIdentity) {
      return githubDisconnected(previousGithubIdentity, {
        gitIdentity,
        message: githubPreviouslyLinkedMessage(previousGithubIdentity.login),
        observed,
        status: "reconnect_required"
      });
    }

    const tokenMessage = hosts.tokenPresent ? "" : " GitHub token is not configured.";
    const gitCredentialMessage = helperConfigured ? "" : " Git credential helper is not configured.";
    const gitIdentityMessage = missingGitIdentity ? " Git identity is not configured." : "";
    return githubDisconnected(null, {
      gitIdentity,
      message: `GitHub CLI is not ready for this Vibe64 user.${tokenMessage}${gitCredentialMessage}${gitIdentityMessage}`,
      observed
    });
  }

  return accountConnected({
    id: "github",
    gitIdentity,
    label: "GitHub",
    message: "GitHub CLI is configured for this Vibe64 user.",
    observed,
    scope: USER_CREDENTIAL_SCOPE,
    username: hosts.username || rememberedGithubIdentity(previousGithub)?.login || ""
  });
}

/**
 * The person's current Git name and email, read as that person in their tool
 * home, so their GitHub card shows what their next Save will use.
 */
async function readPersonGitIdentity(runHostToolCommand, githubContext) {
  const options = hostCommandOptionsForCredentialContext(githubContext);
  const [nameResult, emailResult] = await Promise.all(["user.name", "user.email"].map((key) =>
    runGithubStatusProbe(runHostToolCommand, ["git", "config", "--global", "--get", key], options)));
  return {
    email: emailResult?.ok ? String(emailResult.stdout || "").trim() : "",
    name: nameResult?.ok ? String(nameResult.stdout || "").trim() : ""
  };
}

async function readGithubStatus({
  githubContext,
  previousGithub,
  runHostToolCommand,
  systemRoot
}) {
  await ensureToolHomeSource(githubContext);
  const hostCommandOptions = hostCommandOptionsForCredentialContext(githubContext);
  const [statusResult, userResult, gitCredentialResult, gitNameResult, gitEmailResult] = await Promise.all([
    runGithubStatusProbe(
      runHostToolCommand,
      ["gh", "auth", "status", "--hostname", "github.com"],
      hostCommandOptions
    ),
    runGithubStatusProbe(
      runHostToolCommand,
      ["gh", "api", "user", "--jq", ".login"],
      hostCommandOptions
    ),
    runGithubStatusProbe(
      runHostToolCommand,
      ["git", "config", "--global", "--get-urlmatch", "credential.helper", "https://github.com"],
      hostCommandOptions
    ),
    runGithubStatusProbe(
      runHostToolCommand,
      ["git", "config", "--global", "--get", "user.name"],
      hostCommandOptions
    ),
    runGithubStatusProbe(
      runHostToolCommand,
      ["git", "config", "--global", "--get", "user.email"],
      hostCommandOptions
    )
  ]);
  const output = [statusResult.output, userResult.output].filter(Boolean).join("\n");
  const transientFailure = [statusResult, userResult, gitCredentialResult, gitNameResult, gitEmailResult]
    .find((result) => hostCommandResultTransientFailure(result));
  const canInspectAuthenticatedUser = statusResult.ok && userResult.ok && userResult.stdout;
  const missingScopes = canInspectAuthenticatedUser
    ? REQUIRED_GITHUB_SCOPES.filter((scope) => !output.includes(scope))
    : [];
  const credentialHelperOutput = [gitCredentialResult.stdout, gitCredentialResult.output].filter(Boolean).join("\n");
  const missingGitIdentity = !gitNameResult.ok || !gitNameResult.stdout || !gitEmailResult.ok || !gitEmailResult.stdout;
  const gitIdentity = {
    email: gitEmailResult.stdout || "",
    name: gitNameResult.stdout || ""
  };

  if (!statusResult.ok || !userResult.ok || !userResult.stdout || missingScopes.length > 0 || missingGitIdentity) {
    const observed = [output, credentialHelperOutput, gitNameResult.output, gitEmailResult.output].filter(Boolean).join("\n");
    if (transientFailure) {
      return githubDisconnected(previousGithub, {
        code: GITHUB_STATUS_TEMPORARILY_UNAVAILABLE_CODE,
        gitIdentity,
        message: "GitHub status could not be checked because the host command temporarily failed. Refresh and retry.",
        observed
      });
    }
    const authFailureMessage = githubCliAccountFailureMessage(output);
    const reconnectRequired = authFailureMessage === GITHUB_RECONNECT_REQUIRED_MESSAGE;
    if (reconnectRequired) {
      await markGithubReconnectRequired({
        githubContext,
        systemRoot
      }, {
        reason: "live-status"
      });
    }
    const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
    if (previousGithubIdentity) {
      return githubDisconnected(previousGithubIdentity, {
        code: reconnectRequired ? GITHUB_RECONNECT_REQUIRED_CODE : "",
        gitIdentity,
        message: reconnectRequired
          ? GITHUB_RECONNECT_REQUIRED_MESSAGE
          : githubPreviouslyLinkedMessage(previousGithubIdentity.login),
        observed,
        status: "reconnect_required"
      });
    }
    const authMessage = !statusResult.ok
      ? ` ${authFailureMessage}`
      : "";
    const userMessage = statusResult.ok && (!userResult.ok || !userResult.stdout)
      ? " GitHub CLI could not read the authenticated GitHub user. Reconnect GitHub to continue."
      : "";
    const scopeMessage = missingScopes.length
      ? ` Missing scopes: ${missingScopes.join(", ")}.`
      : "";
    const gitIdentityMessage = missingGitIdentity
      ? " Git identity is not configured."
      : "";
    return githubDisconnected(null, {
      code: reconnectRequired ? GITHUB_RECONNECT_REQUIRED_CODE : "",
      gitIdentity,
      message: `GitHub CLI is not ready for this Vibe64 user.${authMessage}${userMessage}${scopeMessage}${gitIdentityMessage}`,
      observed
    });
  }

  await clearGithubAuthStatus({
    githubContext,
    systemRoot
  });
  return accountConnected({
    id: "github",
    gitIdentity,
    label: "GitHub",
    message: "GitHub CLI is authenticated for this Vibe64 user.",
    observed: output,
    scope: USER_CREDENTIAL_SCOPE,
    username: userResult.stdout
  });
}

async function readGithubAccountStatus({
  githubContext,
  previousGithub,
  readGitIdentity,
  runHostToolCommand,
  systemRoot
}) {
  const stored = await readGithubStoredStatus({
    githubContext,
    previousGithub,
    systemRoot
  });
  if (readGitIdentity && stored?.connected === true && isUserCredentialContext(githubContext)) {
    return {
      ...stored,
      gitIdentity: await readPersonGitIdentity(runHostToolCommand, githubContext)
    };
  }
  if (stored) {
    return stored;
  }
  return readGithubStatus({
    githubContext,
    previousGithub,
    runHostToolCommand,
    systemRoot
  });
}

function githubAuthStatusKey(githubContext) {
  return String(githubContext?.userKey || githubContext?.username || githubContext?.accountMode || "local").trim();
}

function githubAuthStatusPath({
  githubContext = {},
  systemRoot = ""
} = {}) {
  const root = String(systemRoot || "").trim();
  const key = githubAuthStatusKey(githubContext);
  return root && key
    ? path.join(path.resolve(root), "auth", "github", "users", encodeURIComponent(key), "status.json")
    : "";
}

async function readGithubAuthStatus(input = {}) {
  return readOptionalJson(githubAuthStatusPath(input));
}

async function clearGithubAuthStatus(input = {}) {
  const filePath = githubAuthStatusPath(input);
  if (!filePath) {
    return;
  }
  await rm(filePath, {
    force: true
  });
}

async function writeGithubAuthStatus(input = {}, status = {}) {
  const filePath = githubAuthStatusPath(input);
  if (!filePath) {
    return null;
  }
  const value = {
    ...status,
    updatedAt: new Date().toISOString(),
    version: 1
  };
  await writeJsonFile(filePath, value);
  return value;
}

async function markGithubReconnectRequired(input = {}, options = {}) {
  const {
    reason = "github-command"
  } = options;
  return writeGithubAuthStatus(input, {
    code: GITHUB_RECONNECT_REQUIRED_CODE,
    message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
    reason: String(reason || "github-command"),
    status: "reconnect_required"
  });
}

/**
 * @param {object} dependencies
 * @param {object} dependencies.githubContext
 * @param {object | null} dependencies.previousGithub
 * @param {PublishAccountChanged} dependencies.publishAccountChanged
 * @param {string} dependencies.reason
 * @param {string} dependencies.systemRoot
 */
async function recordGithubAuthInvalidState({
  githubContext,
  previousGithub,
  publishAccountChanged,
  reason,
  systemRoot
}) {
  if (!githubContext?.ok) {
    return githubContext || authError("vibe64_user_required", "A logged-in Vibe64 user is required for GitHub account operations.");
  }
  await markGithubReconnectRequired({
    githubContext,
    systemRoot
  }, {
    reason
  });
  const account = await readGithubStoredStatus({
    githubContext,
    previousGithub,
    systemRoot
  });
  await publishAccountChanged("github", {
    actorId: githubContext?.uid ? String(githubContext.uid) : null,
    account,
    reason,
    status: account?.status || ""
  });
  return {
    account,
    ok: true
  };
}

function rememberedGithubIdentity(value) {
  const login = String(value?.login || "").trim();
  if (!login) {
    return null;
  }
  return {
    avatarUrl: String(value.avatarUrl || ""),
    connectedAt: String(value.connectedAt || ""),
    id: Number.isFinite(Number(value.id)) ? Number(value.id) : 0,
    login
  };
}

export {
  readGithubAccountStatus,
  readGithubStatus,
  readGithubStoredStatus,
  recordGithubAuthInvalidState,
  writeGithubAuthStatus
};
