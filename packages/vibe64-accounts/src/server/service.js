import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  resizeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  buildDoctorTerminalArgs,
  buildDoctorHostCommandArgs
} from "@local/setup-doctor-core/server/doctorHostCommand";
import {
  GITHUB_RECONNECT_REQUIRED_CODE,
  GITHUB_RECONNECT_REQUIRED_MESSAGE,
  githubCliAccountFailureMessage
} from "@local/setup-doctor-core/server/githubCliAuth";
import {
  validateGitIdentityInputs
} from "@local/setup-doctor-core/server/setupDoctorGit";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  isVibe64DebugLoggingEnabled
} from "@local/vibe64-core/shared";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  clearCodexAuthStatus,
  codexAuthMarkerPath,
  codexAuthOutputRequiresReconnect,
  markCodexReconnectRequired,
  readCodexAuthStatus
} from "@local/vibe64-core/server/codexAuthState";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  resolveStudioTargetRoot,
  resolveVibe64SystemRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  HOST_USER_EXECUTION_DIRECT,
  HOST_USER_EXECUTION_HELPER,
  hostUserExecHelperPath,
  hostUserExecutionMode,
  hostUserExecutionPayload,
  realUserHomeEnv,
  runHostUserCommand
} from "@local/studio-terminal-core/server/hostUserExecution";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE,
  codexCredentialContext,
  githubCredentialContext
} from "@local/studio-terminal-core/server/credentialHomes";

const ACCOUNT_AUTH_NAMESPACE = "vibe64-accounts";
const VIBE64_ACCOUNTS_SERVICE = "feature.vibe64-accounts.service";
const VIBE64_ACCOUNTS_RUNTIME_SERVICE = "feature.vibe64-accounts.runtime";
const BROWSER_AUTH_MODE = "browser";
const DEVICE_AUTH_MODE = "device";
const API_KEY_AUTH_MODE = "api_key";
const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";
const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device";
const GITHUB_GIT_CREDENTIAL_HELPER = "gh auth git-credential";
const CODEX_API_KEY_ENV = "VIBE64_CODEX_API_KEY";
const REQUIRED_GITHUB_SCOPES = Object.freeze(["repo", "read:org", "gist", "workflow"]);
const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_ENV = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;
const GITHUB_STATUS_TRANSIENT_RETRY_ATTEMPTS = 3;
const GITHUB_STATUS_TRANSIENT_RETRY_DELAY_MS = 75;
const GITHUB_STATUS_TRANSIENT_FAILURE_PATTERN = /\b(?:EAGAIN|EINTR|EBUSY|resource temporarily unavailable)\b/iu;
const GITHUB_STATUS_TEMPORARILY_UNAVAILABLE_CODE = "vibe64_github_status_temporarily_unavailable";
const DEVICE_USER_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/iu;
const DEVICE_USER_CODE_REDACTION_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/gu;
const OPENAI_API_KEY_REDACTION_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/gu;
const VISIBLE_ANSI_ESCAPE_PATTERN = /\u00a4\[[0-?]*[ -/]*[@-~]/gu;
const GITHUB_HOSTS_RELATIVE_PATH = Object.freeze([".config", "gh", "hosts.yml"]);
const GITHUB_GITCONFIG_RELATIVE_PATH = Object.freeze([".gitconfig"]);
const ALL_CODEX_AUTH_MODES = Object.freeze([
  BROWSER_AUTH_MODE,
  DEVICE_AUTH_MODE,
  API_KEY_AUTH_MODE
]);

const ACCOUNT_DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    required: true,
    scope: APP_CREDENTIAL_SCOPE
  }),
  github: Object.freeze({
    id: "github",
    label: "GitHub",
    required: true,
    scope: USER_CREDENTIAL_SCOPE
  })
});
const DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS = Object.freeze(["codex", "github"]);

function resolveVibe64AccountsRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function isUserCredentialContext(context = {}) {
  return context?.scope === USER_CREDENTIAL_SCOPE || context?.accountMode === GITHUB_ACCOUNT_MODE_USER;
}

async function ensureToolHomeSource(context = {}) {
  if (!context?.toolHomeSource) {
    return;
  }
  if (isUserCredentialContext(context)) {
    return;
  }
  await mkdir(context.toolHomeSource, {
    mode: 0o700,
    recursive: true
  });
}

function accountsResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_accounts_request_failed",
    fallbackMessage: "Vibe64 accounts request failed."
  });
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

async function readOptionalText(filePath = "") {
  if (!filePath) {
    return "";
  }
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath = "") {
  const text = await readOptionalText(filePath);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath = "", value = {}) {
  await mkdir(path.dirname(filePath), {
    mode: 0o700,
    recursive: true
  });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
}

function cleanOutput(output = "") {
  return stripAnsi(String(output || "")).replace(VISIBLE_ANSI_ESCAPE_PATTERN, "");
}

function sanitizedAuthOutputTail(output = "") {
  const tail = cleanOutput(output).slice(-AUTH_DEBUG_OUTPUT_TAIL_LENGTH);
  return tail
    .replace(/https:\/\/[^\s"'<>]+/gu, (url) => {
      try {
        const parsed = new URL(url.replace(/[),.;]+$/u, ""));
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "https://[redacted-url]";
      }
    })
    .replace(DEVICE_USER_CODE_REDACTION_PATTERN, "[redacted-code]")
    .replace(OPENAI_API_KEY_REDACTION_PATTERN, "[redacted-openai-api-key]");
}

function hostCommandResultOutput(result = {}) {
  return [result?.output, result?.stderr, result?.stdout].filter(Boolean).join("\n");
}

function hostCommandResultTransientFailure(result = {}) {
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

function authDebug(event, fields = {}) {
  if (!isVibe64DebugLoggingEnabled({
    flagName: AUTH_DEBUG_ENV
  })) {
    return;
  }
  const payload = {
    marker: AUTH_DEBUG_MARKER,
    timestamp: new Date().toISOString(),
    event,
    ...fields
  };
  console.info(`[${AUTH_DEBUG_MARKER}] ${JSON.stringify(payload)}`);
}

function accountDebugSummary(account = {}) {
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

function normalizedAccountId(value = "") {
  const accountId = String(value || "").trim().toLowerCase();
  return ACCOUNT_DEFINITIONS[accountId] ? accountId : "";
}

function normalizedAccountIdList(value = DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const accountIds = [];
  const seen = new Set();
  for (const item of source) {
    const accountId = normalizedAccountId(item);
    if (!accountId || seen.has(accountId)) {
      continue;
    }
    seen.add(accountId);
    accountIds.push(accountId);
  }
  return accountIds;
}

function requestedAccountIds(input = {}) {
  const explicit = Object.hasOwn(input, "providerIds") ||
    Object.hasOwn(input, "providers") ||
    Object.hasOwn(input, "accountIds");
  if (!explicit) {
    return [...DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS];
  }
  return normalizedAccountIdList(input.providerIds || input.providers || input.accountIds);
}

function normalizedAuthMode(accountId, mode = "") {
  const requestedMode = String(mode || "").trim().toLowerCase();
  if (accountId === "codex" && requestedMode === DEVICE_AUTH_MODE) {
    return DEVICE_AUTH_MODE;
  }
  if (accountId === "codex" && requestedMode === API_KEY_AUTH_MODE) {
    return API_KEY_AUTH_MODE;
  }
  return BROWSER_AUTH_MODE;
}

function ghLoginCommandArgs(gitIdentity = {}) {
  return [
    "bash",
    "-lc",
    [
      "set -e",
      "if ! gh auth status --hostname github.com >/dev/null 2>&1; then",
      `  printf '\\n' | ${ghLoginCommandOnlyArgs().map(shellQuote).join(" ")}`,
      "fi",
      "gh auth setup-git --hostname github.com --force",
      ...ghGitIdentityCommandLines(gitIdentity)
    ].join("\n")
  ];
}

function ghLoginCommandOnlyArgs() {
  return [
    "gh",
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--git-protocol",
    "https",
    "--web",
    "--scopes",
    REQUIRED_GITHUB_SCOPES.join(",")
  ];
}

function ghGitIdentityCommandLines(gitIdentity = {}) {
  return [
    `git config --global user.name ${shellQuote(gitIdentity.name || "")}`,
    `git config --global user.email ${shellQuote(gitIdentity.email || "")}`
  ];
}

function gitIdentitySaveCommandArgs(gitIdentity = {}) {
  return [
    "bash",
    "-lc",
    [
      "set -e",
      ...ghGitIdentityCommandLines(gitIdentity)
    ].join("\n")
  ];
}

function githubGitIdentityFromInput(input = {}) {
  return validateGitIdentityInputs({
    email: input.gitUserEmail,
    name: input.gitUserName
  });
}

function codexLoginCommandArgs(mode = BROWSER_AUTH_MODE) {
  if (mode === API_KEY_AUTH_MODE) {
    return codexApiKeyLoginCommandArgs();
  }
  return mode === DEVICE_AUTH_MODE
    ? [STUDIO_MANAGED_CODEX_COMMAND, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login", "--device-auth"]
    : [STUDIO_MANAGED_CODEX_COMMAND, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login"];
}

function codexApiKeyLoginCommandArgs() {
  return [
    "bash",
    "-lc",
    [
      "set -e",
      `if [ -z "\${${CODEX_API_KEY_ENV}:-}" ]; then`,
      "  printf '%s\\n' 'OpenAI API key is required.' >&2",
      "  exit 2",
      "fi",
      `printf '%s\\n' "$${CODEX_API_KEY_ENV}" | ${shellQuote(STUDIO_MANAGED_CODEX_COMMAND)} -c ${shellQuote(STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG)} login --with-api-key`,
      `unset ${CODEX_API_KEY_ENV}`
    ].join("\n")
  ];
}

function logoutCommandArgs(accountId) {
  return accountId === "github"
    ? ["gh", "auth", "logout", "--hostname", "github.com"]
    : [STUDIO_MANAGED_CODEX_COMMAND, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "logout"];
}

function terminalArgsForAuth(accountId, mode, hostCommandOptions = {}, gitIdentity = {}) {
  if (accountId === "github") {
    return buildDoctorTerminalArgs(ghLoginCommandArgs(gitIdentity), hostCommandOptions);
  }

  return buildDoctorTerminalArgs(codexLoginCommandArgs(mode), {
    ...hostCommandOptions
  });
}

function statusArgs(commandArgs, hostCommandOptions = {}) {
  return buildDoctorHostCommandArgs(commandArgs, hostCommandOptions);
}

function hostCommandOptionsForCredentialContext(context = {}) {
  return {
    hostGid: context?.gid ?? context?.hostGid ?? "",
    hostUid: context?.uid ?? context?.hostUid ?? "",
    toolHomeSource: context?.toolHomeSource || "",
    username: context?.username || context?.ownerUserKey || ""
  };
}

function authCommandPreview(commandArgs = []) {
  return commandArgs.map(shellQuote).join(" ");
}

function accountAuthWorkingDirectory(providerContext = {}, fallback = process.cwd()) {
  return String(providerContext?.toolHomeSource || providerContext?.home || fallback || process.cwd());
}

function authTerminalSessionWorkingDirectory(startSpec = {}, {
  authCwd = "",
  payloadRoot = ""
} = {}) {
  if (startSpec?.executionMode === HOST_USER_EXECUTION_HELPER && payloadRoot) {
    return payloadRoot;
  }
  return authCwd || process.cwd();
}

function authTerminalPayloadPath(providerContext = {}, {
  payloadRoot = ""
} = {}) {
  const resolvedPayloadRoot = String(payloadRoot || "").trim();
  const baseDir = resolvedPayloadRoot
    ? path.join(resolvedPayloadRoot, "auth-terminals")
    : path.join(
      providerContext?.toolHomeSource || tmpdir(),
      ".local",
      "state",
      "vibe64",
      "auth-terminals"
    );
  mkdirSync(baseDir, {
    mode: 0o700,
    recursive: true
  });
  return path.join(baseDir, `${process.pid}-${Date.now()}-${randomUUID()}.json`);
}

function authTerminalEnvironment(providerContext = {}, authSecrets = {}) {
  return realUserHomeEnv({
    env: authSecrets,
    home: providerContext?.toolHomeSource || providerContext?.home || "",
    username: providerContext?.username || providerContext?.ownerUserKey || ""
  });
}

function createAuthTerminalStartSpec(commandArgs = [], providerContext = {}, {
  authSecrets = {},
  cwd = process.cwd(),
  payloadRoot = ""
} = {}) {
  const command = String(commandArgs[0] || "").trim();
  if (!command) {
    return {
      error: "No auth command was provided.",
      ok: false
    };
  }
  const uid = providerContext?.uid ?? providerContext?.hostUid ?? null;
  const gid = providerContext?.gid ?? providerContext?.hostGid ?? null;
  const execution = hostUserExecutionMode({
    gid,
    uid
  });
  if (execution.ok === false) {
    return execution;
  }

  const env = authTerminalEnvironment(providerContext, authSecrets);
  if (execution.executionMode === HOST_USER_EXECUTION_HELPER) {
    const payloadPath = authTerminalPayloadPath(providerContext, {
      payloadRoot
    });
    const payload = hostUserExecutionPayload({
      args: commandArgs.slice(1),
      command,
      cwd,
      env,
      gid,
      home: providerContext?.toolHomeSource || providerContext?.home || "",
      operation: "account-auth-terminal",
      uid,
      username: providerContext?.username || providerContext?.ownerUserKey || ""
    });
    writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`, {
      mode: 0o600
    });
    return {
      args: [
        "-n",
        hostUserExecHelperPath(),
        "execute",
        payloadPath
      ],
      command: "sudo",
      env: {},
      executionMode: HOST_USER_EXECUTION_HELPER,
      ok: true
    };
  }

  return {
    args: commandArgs.slice(1),
    command,
    env,
    executionMode: HOST_USER_EXECUTION_DIRECT,
    ok: true
  };
}

function firstMatchingUrl(output = "", predicate = () => true) {
  const matches = cleanOutput(output).match(/https:\/\/[^\s"'<>]+/gu) || [];
  for (const match of matches) {
    const url = match.replace(/[),.;]+$/u, "");
    if (predicate(url)) {
      return url;
    }
  }
  return "";
}

function parseGithubUserCode(output = "") {
  const normalizedOutput = cleanOutput(output);
  const labelledMatch = normalizedOutput.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4,8})/iu);
  if (labelledMatch) {
    return labelledMatch[1].toUpperCase();
  }
  return normalizedOutput.match(DEVICE_USER_CODE_PATTERN)?.[1]?.toUpperCase() || "";
}

function parseCodexUserCode(output = "") {
  return cleanOutput(output).match(DEVICE_USER_CODE_PATTERN)?.[1]?.toUpperCase() || "";
}

function parseAuthOutput({
  accountId,
  mode,
  output
} = {}) {
  if (accountId === "github") {
    const userCode = parseGithubUserCode(output);
    return {
      authUrl: firstMatchingUrl(output, (url) => url.includes("github.com/")) || (userCode ? GITHUB_DEVICE_AUTH_URL : ""),
      userCode
    };
  }

  if (mode === DEVICE_AUTH_MODE) {
    const userCode = parseCodexUserCode(output);
    return {
      authUrl: firstMatchingUrl(output, (url) => url.includes("openai.com/") || url.includes("chatgpt.com/")) || (userCode ? CODEX_DEVICE_AUTH_URL : ""),
      userCode
    };
  }

  if (mode === API_KEY_AUTH_MODE) {
    return {
      authUrl: "",
      userCode: ""
    };
  }

  return {
    authUrl: firstMatchingUrl(output, (url) => url.includes("openai.com/") || url.includes("chatgpt.com/")),
    userCode: ""
  };
}

function accountDisconnected({
  code = "",
  id,
  gitIdentity = null,
  label,
  message,
  observed = "",
  previousGithub = null,
  previousUsername = "",
  scope = "",
  status = "not_connected"
}) {
  return {
    ...(code ? { code } : {}),
    connected: false,
    id,
    label,
    gitIdentity,
    message,
    observed,
    previousGithub,
    previousUsername,
    previouslyLinked: Boolean(previousUsername),
    required: true,
    scope,
    status
  };
}

function accountConnected({
  id,
  gitIdentity = null,
  label,
  message,
  observed = "",
  scope = "",
  username = ""
}) {
  return {
    connected: true,
    id,
    label,
    gitIdentity,
    message,
    observed,
    required: true,
    scope,
    status: "connected",
    username
  };
}

async function readCodexLocalStatus({
  systemRoot = ""
} = {}) {
  const authStatus = await readCodexAuthStatus(systemRoot);
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
      message: "Codex is authenticated for the shared Vibe64 app account.",
      observed: "Local Codex authentication marker is present.",
      scope: APP_CREDENTIAL_SCOPE
    });
  }

  return accountDisconnected({
    id: "codex",
    label: "Codex",
    message: "Codex is not authenticated for the shared Vibe64 app account.",
    observed: "Local Codex authentication marker is missing.",
    scope: APP_CREDENTIAL_SCOPE
  });
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

function githubReconnectRequiredAccount({
  authStatus = null,
  gitIdentity = null,
  observed = "",
  previousGithub = null,
  previousUsername = ""
} = {}) {
  const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
  return accountDisconnected({
    code: GITHUB_RECONNECT_REQUIRED_CODE,
    id: "github",
    gitIdentity,
    label: "GitHub",
    message: authStatus?.message || GITHUB_RECONNECT_REQUIRED_MESSAGE,
    observed,
    previousGithub: previousGithubIdentity,
    previousUsername: previousGithubIdentity?.login || previousUsername || "",
    scope: USER_CREDENTIAL_SCOPE,
    status: "reconnect_required"
  });
}

async function readGithubStoredStatus({
  githubContext,
  previousGithub = null,
  systemRoot = ""
} = {}) {
  const authStatus = await readGithubAuthStatus({
    githubContext,
    systemRoot
  });
  if (authStatus?.status === "reconnect_required") {
    return githubReconnectRequiredAccount({
      authStatus,
      previousGithub
    });
  }
  if (isUserCredentialContext(githubContext)) {
    return null;
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
      return accountDisconnected({
        id: "github",
        gitIdentity,
        label: "GitHub",
        message: `GitHub was previously linked as @${previousGithubIdentity.login}, but this host is not ready to use it. Reconnect GitHub to continue.`,
        observed,
        previousGithub: previousGithubIdentity,
        previousUsername: previousGithubIdentity.login,
        scope: USER_CREDENTIAL_SCOPE,
        status: "reconnect_required"
      });
    }

    const tokenMessage = hosts.tokenPresent ? "" : " GitHub token is not configured.";
    const gitCredentialMessage = helperConfigured ? "" : " Git credential helper is not configured.";
    const gitIdentityMessage = missingGitIdentity ? " Git identity is not configured." : "";
    return accountDisconnected({
      id: "github",
      gitIdentity,
      label: "GitHub",
      message: `GitHub CLI is not ready for this Vibe64 user.${tokenMessage}${gitCredentialMessage}${gitIdentityMessage}`,
      observed,
      scope: USER_CREDENTIAL_SCOPE
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

async function runDefaultHostCommand(commandArgs, options = {}) {
  const args = statusArgs(commandArgs, options);
  const command = args.shift();
  if (!command) {
    return {
      exitCode: 1,
      ok: false,
      output: "No host command was provided.",
      stderr: "No host command was provided.",
      stdout: ""
    };
  }
  return runHostUserCommand(command, args, {
    gid: options.hostGid ?? options.gid ?? null,
    home: options.toolHomeSource || "",
    operation: "account-status",
    timeout: options.timeout || 20_000,
    uid: options.hostUid ?? options.uid ?? null,
    username: options.username || options.ownerUserKey || ""
  });
}

async function readGithubStatus({
  githubContext,
  previousGithub = null,
  runHostToolCommand = runDefaultHostCommand,
  systemRoot = ""
} = {}) {
  await ensureToolHomeSource(githubContext);
  const hostCommandOptions = hostCommandOptionsForCredentialContext(githubContext);
  const statusResult = await runGithubStatusProbe(
    runHostToolCommand,
    ["gh", "auth", "status", "--hostname", "github.com"],
    hostCommandOptions
  );
  const userResult = await runGithubStatusProbe(
    runHostToolCommand,
    ["gh", "api", "user", "--jq", ".login"],
    hostCommandOptions
  );
  const gitCredentialResult = await runGithubStatusProbe(
    runHostToolCommand,
    ["git", "config", "--global", "--get-urlmatch", "credential.helper", "https://github.com"],
    hostCommandOptions
  );
  const gitNameResult = await runGithubStatusProbe(
    runHostToolCommand,
    ["git", "config", "--global", "--get", "user.name"],
    hostCommandOptions
  );
  const gitEmailResult = await runGithubStatusProbe(
    runHostToolCommand,
    ["git", "config", "--global", "--get", "user.email"],
    hostCommandOptions
  );
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
      const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
      return accountDisconnected({
        code: GITHUB_STATUS_TEMPORARILY_UNAVAILABLE_CODE,
        id: "github",
        gitIdentity,
        label: "GitHub",
        message: "GitHub status could not be checked because the host command temporarily failed. Refresh and retry.",
        observed,
        previousGithub: previousGithubIdentity,
        previousUsername: previousGithubIdentity?.login || "",
        scope: USER_CREDENTIAL_SCOPE
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
      return accountDisconnected({
        code: reconnectRequired ? GITHUB_RECONNECT_REQUIRED_CODE : "",
        id: "github",
        gitIdentity,
        label: "GitHub",
        message: reconnectRequired
          ? GITHUB_RECONNECT_REQUIRED_MESSAGE
          : `GitHub was previously linked as @${previousGithubIdentity.login}, but this host is not ready to use it. Reconnect GitHub to continue.`,
        observed,
        previousGithub: previousGithubIdentity,
        previousUsername: previousGithubIdentity.login,
        scope: USER_CREDENTIAL_SCOPE,
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
    return accountDisconnected({
      code: reconnectRequired ? GITHUB_RECONNECT_REQUIRED_CODE : "",
      id: "github",
      gitIdentity,
      label: "GitHub",
      message: `GitHub CLI is not ready for this Vibe64 user.${authMessage}${userMessage}${scopeMessage}${gitIdentityMessage}`,
      observed,
      scope: USER_CREDENTIAL_SCOPE
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
  previousGithub = null,
  runHostToolCommand = runDefaultHostCommand,
  systemRoot = ""
} = {}) {
  const stored = await readGithubStoredStatus({
    githubContext,
    previousGithub,
    systemRoot
  });
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

function githubAuthStatusKey(githubContext = {}) {
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

async function markGithubReconnectRequired(input = {}, {
  reason = "github-command"
} = {}) {
  const filePath = githubAuthStatusPath(input);
  if (!filePath) {
    return null;
  }
  await writeJsonFile(filePath, {
    code: GITHUB_RECONNECT_REQUIRED_CODE,
    message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
    reason: String(reason || "github-command"),
    status: "reconnect_required",
    updatedAt: new Date().toISOString(),
    version: 1
  });
  return {
    code: GITHUB_RECONNECT_REQUIRED_CODE,
    message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
    status: "reconnect_required"
  };
}

async function recordGithubAuthInvalidState({
  githubContext = null,
  previousGithub = null,
  publishAccountChanged = async () => null,
  reason = "github-command",
  systemRoot = ""
} = {}) {
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
    account,
    reason,
    status: account?.status || ""
  });
  return {
    account,
    ok: true
  };
}

function rememberedGithubIdentity(value = {}) {
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

async function readCodexStatus({
  codexContext = null,
  runHostToolCommand = runDefaultHostCommand
} = {}) {
  await ensureToolHomeSource(codexContext);
  const result = await runHostToolCommand(
    [STUDIO_MANAGED_CODEX_COMMAND, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login", "status"],
    hostCommandOptionsForCredentialContext(codexContext)
  );

  if (!result.ok) {
    const reconnectRequired = codexAuthOutputRequiresReconnect(result.output);
    return accountDisconnected({
      code: reconnectRequired ? CODEX_RECONNECT_REQUIRED_CODE : "",
      id: "codex",
      label: "Codex",
      message: reconnectRequired
        ? CODEX_RECONNECT_REQUIRED_MESSAGE
        : "Codex is not authenticated for the shared Vibe64 app account.",
      observed: result.output,
      scope: APP_CREDENTIAL_SCOPE,
      status: reconnectRequired ? "reconnect_required" : undefined
    });
  }

  return accountConnected({
    id: "codex",
    label: "Codex",
    message: "Codex is authenticated for the shared Vibe64 app account.",
    observed: result.output,
    scope: APP_CREDENTIAL_SCOPE
  });
}

function blockedReason(accounts = []) {
  const firstMissingAccount = accounts.find((account) => account.required && account.connected !== true);
  return firstMissingAccount ? firstMissingAccount.message : "";
}

function authError(code, message, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function authTerminalMetadata(accountId, mode, githubContext = null) {
  const metadata = {
    accountId,
    credentialScope: ACCOUNT_DEFINITIONS[accountId]?.scope || "",
    mode,
  };
  if (accountId === "github" && githubContext?.userKey) {
    metadata.userKey = githubContext.userKey;
  }
  return metadata;
}

function unsupportedAuthMode(accountId, mode, accountRuntime = {}) {
  if (
    accountId === "codex" &&
    typeof accountRuntime.codexModeAllowed === "function" &&
    accountRuntime.codexModeAllowed(mode) !== true
  ) {
    return authError(
      "unsupported_auth_mode",
      typeof accountRuntime.unsupportedCodexAuthModeMessage === "function"
        ? accountRuntime.unsupportedCodexAuthModeMessage(mode)
        : "This Codex login method is not available for this Vibe64 account runtime."
    );
  }
  return null;
}

function authTerminalRunningLimitFilter(accountId, mode, githubContext = null) {
  const expectedUserKey = accountId === "github" ? String(githubContext?.userKey || "") : "";
  return (session = {}) => {
    if (session.metadata?.accountId !== accountId || session.metadata?.mode !== mode) {
      return false;
    }
    if (accountId !== "github") {
      return true;
    }
    return Boolean(expectedUserKey) && session.metadata?.userKey === expectedUserKey;
  };
}

function canReuseAuthTerminal(accountId, mode, githubContext = null) {
  if (accountId === "codex" && mode === API_KEY_AUTH_MODE) {
    return () => false;
  }
  return authTerminalRunningLimitFilter(accountId, mode, githubContext);
}

function authSessionStatus({
  account = null,
  terminal = null
} = {}) {
  if (account?.connected) {
    return "connected";
  }
  if (terminal?.status === "exited") {
    return "failed";
  }
  return "authenticating";
}

function publicAuthSession({
  account,
  mode,
  parsed,
  terminal
} = {}) {
  const output = cleanOutput(terminal.output)
    .replace(OPENAI_API_KEY_REDACTION_PATTERN, "[redacted-openai-api-key]");
  return {
    account,
    authUrl: parsed.authUrl,
    commandPreview: terminal.commandPreview,
    closeError: terminal.closeError || "",
    exitCode: terminal.exitCode,
    id: terminal.id,
    mode,
    ok: true,
    output,
    outputVersion: terminal.outputVersion || 0,
    status: authSessionStatus({
      account,
      terminal
    }),
    terminalStatus: terminal.status,
    userCode: parsed.userCode
  };
}

function authenticatingAccount(accountId = "") {
  const definition = ACCOUNT_DEFINITIONS[accountId] || {};
  return {
    connected: false,
    id: accountId,
    label: definition.label || accountId,
    required: true,
    scope: definition.scope || "",
    status: "authenticating"
  };
}

function normalizeCodexAuthModes(modes = ALL_CODEX_AUTH_MODES) {
  const normalizedModes = Array.isArray(modes) && modes.length
    ? modes
    : ALL_CODEX_AUTH_MODES;
  return new Set(
    normalizedModes
      .map((mode) => String(mode || "").trim().toLowerCase())
      .filter((mode) => ALL_CODEX_AUTH_MODES.includes(mode))
  );
}

function createAccountsRuntime({
  allowedCodexAuthModes = ALL_CODEX_AUTH_MODES,
  canManageCodex = null,
  daemonHome = "",
  daemonGid = null,
  daemonUid = null,
  daemonUsername = "",
  debugInput = null,
  env = process.env,
  githubAccountMode = GITHUB_ACCOUNT_MODE_LOCAL,
  previousGithub = null,
  projectService = null,
  requireExplicitRoots = true,
  systemRoot = "",
  targetRoot = "",
  unsupportedCodexAuthModeMessage = null
} = {}) {
  const explicitSystemRoot = String(systemRoot || "").trim();
  const resolvedSystemRoot = requireExplicitRoots && !explicitSystemRoot
    ? ""
    : resolveVibe64SystemRoot({
        env,
        explicitRoot: systemRoot
      });
  const codexAuthModes = normalizeCodexAuthModes(allowedCodexAuthModes);

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceTargetRoot(projectService)).trim();
    return selectedTargetRoot ? resolveVibe64AccountsRoot(selectedTargetRoot) : "";
  }

  return Object.freeze({
    codexContext() {
      return codexCredentialContext({
        gid: daemonGid ?? undefined,
        home: daemonHome || undefined,
        uid: daemonUid ?? undefined,
        username: daemonUsername
      });
    },
    codexModeAllowed(mode = "") {
      return codexAuthModes.has(String(mode || "").trim().toLowerCase());
    },
    currentTargetRoot,
    debugInput(input = {}) {
      return typeof debugInput === "function" ? debugInput(input) || {} : {};
    },
    githubContext(input = {}) {
      return githubCredentialContext(input, {
        accountMode: githubAccountMode
      });
    },
    previousGithub(input = {}) {
      return typeof previousGithub === "function" ? previousGithub(input) : null;
    },
    requireCodexManagement(input = {}) {
      return typeof canManageCodex === "function" ? canManageCodex(input) : null;
    },
    systemRoot: resolvedSystemRoot,
    unsupportedCodexAuthModeMessage(mode = "") {
      return typeof unsupportedCodexAuthModeMessage === "function"
        ? unsupportedCodexAuthModeMessage(mode)
        : "This Codex login method is not available for this Vibe64 account runtime.";
    }
  });
}

function createService({
  accountRuntime = null,
  allowedCodexAuthModes = ALL_CODEX_AUTH_MODES,
  canManageCodex = null,
  daemonHome = "",
  daemonGid = null,
  daemonUid = null,
  daemonUsername = "",
  debugInput = null,
  env = process.env,
  githubAccountMode = GITHUB_ACCOUNT_MODE_LOCAL,
  invalidateAgentRuntimes = async () => null,
  previousGithub = null,
  projectService = null,
  requireExplicitRoots = true,
  publishAccountChanged = async () => null,
  publishAuthSessionChanged = async () => null,
  runHostToolCommand = runDefaultHostCommand,
  startTerminalSessionFn = startTerminalSession,
  systemRoot = "",
  targetRoot = "",
  unsupportedCodexAuthModeMessage = null
} = {}) {
  const authSessions = new Map();
  const resolvedAccountRuntime = accountRuntime || createAccountsRuntime({
    allowedCodexAuthModes,
    canManageCodex,
    daemonHome,
    daemonGid,
    daemonUid,
    daemonUsername,
    debugInput,
    env,
    githubAccountMode,
    previousGithub,
    projectService,
    requireExplicitRoots,
    systemRoot,
    targetRoot,
    unsupportedCodexAuthModeMessage
  });
  const resolvedSystemRoot = resolvedAccountRuntime.systemRoot;
  const cancelledAuthSessions = new Set();
  const finalizedCodexAuthSessions = new Set();
  const accountRunHostCommand = typeof resolvedAccountRuntime.runHostToolCommand === "function"
    ? (commandArgs, options = {}) => resolvedAccountRuntime.runHostToolCommand(commandArgs, options, {
        fallback: runHostToolCommand
      })
    : runHostToolCommand;

  function codexManagementError(input = {}) {
    return resolvedAccountRuntime.requireCodexManagement(input);
  }

  async function invalidateCodexAppServersForAuthChange({
    account = {},
    markerPath = "",
    reason = ""
  } = {}) {
    const codexContext = codexContextForInput();
    if (!codexContext.ok) {
      authDebug("server.auth.codex_app_server.invalidate.skipped", {
        code: codexContext.code || "",
        reason: reason || "codex-auth-state-changed"
      });
      return null;
    }
    try {
      const result = await invalidateAgentRuntimes({
        account,
        markerPath,
        provider: "codex",
        reason: reason || "codex-auth-state-changed",
        systemRoot: resolvedSystemRoot,
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
      return result;
    } catch (error) {
      authDebug("server.auth.codex_app_server.invalidate.error", {
        error: String(error?.message || error || "Codex app-server invalidation failed."),
        reason: reason || "codex-auth-state-changed"
      });
      return null;
    }
  }

  async function rememberCodexStatus(account = {}, {
    reason = "",
    rotateMarker = false
  } = {}) {
    const markerPath = codexAuthMarkerPath(resolvedSystemRoot);
    const existingMarkerText = await readOptionalText(markerPath);
    let existingMarker = null;
    try {
      existingMarker = existingMarkerText ? JSON.parse(existingMarkerText) : null;
    } catch {
      existingMarker = null;
    }
    const existingMarkerPresent = Boolean(existingMarkerText);
    const existingConnected = existingMarker?.connected === true;
    if (account?.connected === true) {
      await clearCodexAuthStatus(resolvedSystemRoot);
      if (existingConnected && !rotateMarker) {
        authDebug("server.auth.codex_marker.unchanged", {
          account: accountDebugSummary(account),
          markerPath,
          reason: reason || "codex-status-refresh"
        });
        return;
      }
      authDebug("server.auth.codex_marker.write", {
        account: accountDebugSummary(account),
        markerPath,
        reason: reason || "codex-status-refresh",
        rotateMarker
      });
      await writeJsonFile(markerPath, {
        connected: true,
        updatedAt: new Date().toISOString(),
        version: 1
      });
      await invalidateCodexAppServersForAuthChange({
        account,
        markerPath,
        reason: reason || "codex-connected"
      });
      return;
    }
    if (!existingMarkerPresent && !rotateMarker) {
      authDebug("server.auth.codex_marker.missing", {
        account: accountDebugSummary(account),
        markerPath,
        reason: reason || "codex-status-refresh"
      });
      return;
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
  }

  async function readLiveCodexStatus({
    reason = "codex-status-refresh",
    rotateMarker = false
  } = {}) {
    authDebug("server.auth.codex_status.live.start", {
      reason,
      rotateMarker
    });
    const codexContext = codexContextForInput();
    if (!codexContext.ok) {
      return codexContext;
    }
    const existingAuthStatus = await readCodexAuthStatus(resolvedSystemRoot);
    if (existingAuthStatus?.status === "reconnect_required" && !rotateMarker) {
      const account = await readCodexLocalStatus({
        systemRoot: resolvedSystemRoot
      });
      authDebug("server.auth.codex_status.live.reconnect_required", {
        account: accountDebugSummary(account),
        reason
      });
      return account;
    }
    const account = await readCodexStatus({
      codexContext,
      runHostToolCommand: accountRunHostCommand
    });
    if (account?.status === "reconnect_required") {
      await markCodexReconnectRequired(resolvedSystemRoot, {
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
  }

  function currentTargetRoot() {
    return resolvedAccountRuntime.currentTargetRoot();
  }

  function authMetadata(sessionId = "", input = {}) {
    const existing = authSessions.get(sessionId);
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
    const githubContext = accountId === "github" ? githubContextForInput(input) : null;
    if (githubContext && (!githubContext.ok || terminal.metadata?.userKey !== githubContext.userKey)) {
      return null;
    }

    const metadata = {
      accountId,
      githubContext,
      mode,
      startedAt: terminal.createdAt || "",
      userKey: accountId === "github" ? String(terminal.metadata?.userKey || "") : ""
    };
    authSessions.set(sessionId, metadata);
    return metadata;
  }

  function githubContextForInput(input = {}) {
    return resolvedAccountRuntime.githubContext(input);
  }

  function codexContextForInput() {
    return resolvedAccountRuntime.codexContext();
  }

  function previousGithubForInput(input = {}) {
    return resolvedAccountRuntime.previousGithub(input);
  }

  function debugInputForLog(input = {}) {
    return resolvedAccountRuntime.debugInput(input);
  }

  async function accountStatus(accountId, {
    codexMarkerReason = "",
    githubContext = null,
    previousGithub = null,
    rotateCodexMarker = false
  } = {}) {
    authDebug("server.auth.account_status.start", {
      accountId,
      codexMarkerReason,
      githubContextOk: githubContext ? githubContext.ok === true : null,
      previousGithubPresent: Boolean(previousGithub),
      rotateCodexMarker
    });
    let account;
    if (accountId === "github") {
      if (!githubContext?.ok) {
        account = githubContext || authError("vibe64_user_required", "A logged-in Vibe64 user is required for GitHub account operations.");
        authDebug("server.auth.account_status.done", {
          account: accountDebugSummary(account),
          accountId
        });
        return account;
      }
      account = await readGithubStatus({
        githubContext,
        previousGithub,
        runHostToolCommand: accountRunHostCommand,
        systemRoot: resolvedSystemRoot
      });
      authDebug("server.auth.account_status.done", {
        account: accountDebugSummary(account),
        accountId
      });
      return account;
    }
    if (accountId === "codex") {
      account = await readLiveCodexStatus({
        reason: codexMarkerReason || "codex-status-refresh",
        rotateMarker: rotateCodexMarker
      });
      authDebug("server.auth.account_status.done", {
        account: accountDebugSummary(account),
        accountId
      });
      return account;
    }
    throw new Error(`Unknown account: ${accountId}`);
  }

  async function accountsStatus(input = {}) {
    const refresh = refreshRequested(input);
    const accountIds = requestedAccountIds(input);
    const includesGithub = accountIds.includes("github");
    authDebug("server.auth.accounts_status.start", {
      accountIds,
      refresh,
      ...debugInputForLog(input)
    });
    const githubContext = includesGithub ? githubContextForInput(input) : null;
    if (includesGithub && !githubContext.ok) {
      authDebug("server.auth.accounts_status.github_context_error", {
        code: githubContext.code || "",
        error: githubContext.error || ""
      });
      return githubContext;
    }
    const previousGithub = includesGithub ? previousGithubForInput(input) : null;
    const accounts = await Promise.all(accountIds.map((accountId) => {
      if (accountId === "codex") {
        return refresh
          ? readLiveCodexStatus({
              reason: "accounts-status-refresh"
            })
          : readCodexLocalStatus({
              systemRoot: resolvedSystemRoot
            });
      }
      if (accountId === "github") {
        return refresh
          ? readGithubStatus({
              githubContext,
              previousGithub,
              runHostToolCommand: accountRunHostCommand,
              systemRoot: resolvedSystemRoot
            })
          : readGithubAccountStatus({
              githubContext,
              previousGithub,
              runHostToolCommand: accountRunHostCommand,
              systemRoot: resolvedSystemRoot
            });
      }
      throw new Error(`Unknown account: ${accountId}`);
    }));
    const ready = accounts.every((account) => account.required !== true || account.connected === true);
    authDebug("server.auth.accounts_status.done", {
      accounts: accountsDebugSummary(accounts),
      blockedReason: ready ? "" : blockedReason(accounts),
      ready,
      refresh,
      targetRoot: currentTargetRoot()
    });

    return {
      accounts,
      blockedReason: ready ? "" : blockedReason(accounts),
      ok: true,
      credentialScopes: {
        codex: APP_CREDENTIAL_SCOPE,
        github: USER_CREDENTIAL_SCOPE
      },
      ready,
      targetRoot: currentTargetRoot(),
      updatedAt: new Date().toISOString()
    };
  }

  function sessionVisibleToInput(input = {}, metadata = {}) {
    if (metadata.accountId === "codex") {
      return !codexManagementError(input);
    }
    if (metadata.accountId !== "github") {
      return true;
    }
    const githubContext = githubContextForInput(input);
    return githubContext.ok && metadata.userKey === githubContext.userKey;
  }

  function rotateCodexMarkerForFinalizedAuthSession(sessionId = "", metadata = {}) {
    if (metadata.accountId !== "codex") {
      return false;
    }
    const normalizedSessionId = String(sessionId || "").trim();
    if (
      !normalizedSessionId ||
      cancelledAuthSessions.has(normalizedSessionId) ||
      finalizedCodexAuthSessions.has(normalizedSessionId)
    ) {
      return false;
    }
    finalizedCodexAuthSessions.add(normalizedSessionId);
    return true;
  }

  async function readSessionWithAccount(input = {}) {
    const sessionId = String(input?.sessionId || input || "");
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

    const parsed = parseAuthOutput({
      accountId: metadata.accountId,
      mode: metadata.mode,
      output: terminal.output
    });
    authDebug("server.auth.read.terminal", {
      accountId: metadata.accountId,
      authUrl: parsed.authUrl || "",
      exitCode: terminal.exitCode,
      inputVersion: terminal.inputVersion || 0,
      mode: metadata.mode,
      outputLength: cleanOutput(terminal.output).length,
      outputTail: sanitizedAuthOutputTail(terminal.output),
      outputVersion: terminal.outputVersion || 0,
      sessionId,
      terminalStatus: terminal.status,
      userCodePresent: Boolean(parsed.userCode)
    });

    const finalizedCodexAuthSession = terminal.status === "exited"
      ? rotateCodexMarkerForFinalizedAuthSession(sessionId, metadata)
      : false;
    const account = terminal.status === "exited"
      ? await accountStatus(metadata.accountId, {
          codexMarkerReason: finalizedCodexAuthSession ? "auth-session-exited" : "auth-session-status",
          githubContext: metadata.githubContext || null,
          previousGithub: previousGithubForInput(input),
          rotateCodexMarker: finalizedCodexAuthSession
        })
      : {
          connected: false,
          id: metadata.accountId,
          label: ACCOUNT_DEFINITIONS[metadata.accountId].label,
          required: true,
          scope: ACCOUNT_DEFINITIONS[metadata.accountId].scope,
          status: "authenticating"
        };
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

  function authSessionSnapshot({
    account = null,
    metadata = {},
    terminal = {}
  } = {}) {
    const parsed = parseAuthOutput({
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
    const session = authSessionSnapshot({
      account,
      metadata,
      terminal
    });
    return publishAuthSessionChanged(session, {
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

  function requireVisibleAuthTerminal(input = {}) {
    const sessionId = String(input?.terminalSessionId || input?.sessionId || input || "");
    const metadata = authMetadata(sessionId, input);
    if (!metadata || !sessionVisibleToInput(input, metadata)) {
      return authError("unknown_auth_session", "Account auth session not found.");
    }
    return {
      metadata,
      sessionId
    };
  }

  function createAuthTerminalCloseHandler({
    accountId,
    githubContext = null,
    previousGithub = null
  } = {}) {
    return async function handleAuthTerminalClose({
      id = "",
      reason = ""
    } = {}) {
      if (cancelledAuthSessions.has(String(id || ""))) {
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
      const finalizedCodexAuthSession = rotateCodexMarkerForFinalizedAuthSession(id, {
        accountId
      });
      const account = await accountStatus(accountId, {
        codexMarkerReason: finalizedCodexAuthSession
          ? reason || "terminal-close"
          : "terminal-close-status",
        githubContext,
        previousGithub,
        rotateCodexMarker: finalizedCodexAuthSession
      });
      authDebug("server.auth.account_changed.publish.start", {
        account: accountDebugSummary(account),
        accountId,
        reason: reason || "terminal-close",
        sessionId: id
      });
      const publishResult = await publishAccountChanged(accountId, {
        account,
        authSessionId: id,
        reason: reason || "terminal-close",
        status: account?.status || ""
      });
      const terminal = readTerminalSession(id, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
      if (terminal.ok !== false) {
        await publishAuthSessionSnapshot({
          account,
          metadata: authMetadata(id) || {
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
      authDebug("server.auth.terminal.finalize.done", {
        accountId,
        connected: account?.connected === true,
        reason,
        sessionId: id,
        status: account?.status || ""
      });
    };
  }

  async function startAuthTerminal(accountId, mode, githubContext = null, gitIdentity = {}, authSecrets = {}, options = {}) {
    const providerContext = accountId === "github" ? githubContext : codexContextForInput();
    await ensureToolHomeSource(providerContext);
    const hostCommandOptions = hostCommandOptionsForCredentialContext(providerContext);
    const args = terminalArgsForAuth(accountId, mode, hostCommandOptions, gitIdentity);
    const authCwd = accountAuthWorkingDirectory(providerContext, currentTargetRoot() || process.cwd());
    const terminalStartSpec = createAuthTerminalStartSpec(args, providerContext, {
      authSecrets,
      cwd: authCwd,
      payloadRoot: resolvedSystemRoot
    });
    const terminalCwd = authTerminalSessionWorkingDirectory(terminalStartSpec, {
      authCwd,
      payloadRoot: resolvedSystemRoot
    });
    if (terminalStartSpec.ok === false) {
      return authError(terminalStartSpec.code || "host_user_execution_unavailable", terminalStartSpec.error || "Host user execution is not available for account auth.");
    }
    authDebug("server.auth.terminal.start", {
      accountId,
      credentialScope: ACCOUNT_DEFINITIONS[accountId]?.scope || "",
      gitIdentityConfigured: accountId !== "github" || Boolean(gitIdentity.name && gitIdentity.email),
      mode,
      toolHomeSource: providerContext?.toolHomeSource || "",
      userKey: accountId === "github" ? String(githubContext?.userKey || "") : ""
    });
    const terminal = startTerminalSessionFn({
      args: terminalStartSpec.args,
      command: terminalStartSpec.command,
      commandPreview: authCommandPreview(args),
      cwd: terminalCwd,
      env: terminalStartSpec.env,
      maxRunning: 1,
      metadata: authTerminalMetadata(accountId, mode, githubContext),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      onClose: createAuthTerminalCloseHandler({
        accountId,
        githubContext,
        previousGithub: options.previousGithub || null
      }),
      onOutput: ({ session } = {}) => {
        publishAuthTerminalOutput({
          metadata: authTerminalMetadata(accountId, mode, githubContext),
          terminal: session
        });
      },
      runningLimitFilter: authTerminalRunningLimitFilter(accountId, mode, githubContext),
      reuseRunning: canReuseAuthTerminal(accountId, mode, githubContext)
    });
    if (terminal.ok === false) {
      authDebug("server.auth.terminal.start_failed", {
        accountId,
        code: terminal.code || "",
        error: terminal.error || "",
        mode
      });
      return terminal;
    }

    if (!authSessions.has(terminal.id)) {
      authSessions.set(terminal.id, {
        accountId,
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

  return Object.freeze({
    async getStatus(input = {}) {
      return accountsResult(async () => {
        return accountsStatus(input);
      });
    },

    async getCodexStatus() {
      return accountsResult(async () => {
        return {
          account: await accountStatus("codex"),
          ok: true
        };
      });
    },

    async recordGithubAuthInvalid(input = {}) {
      return accountsResult(async () => {
        const githubContext = githubContextForInput(input);
        return recordGithubAuthInvalidState({
          githubContext,
          previousGithub: previousGithubForInput(input),
          publishAccountChanged,
          reason: input.reason || "github-command",
          systemRoot: resolvedSystemRoot
        });
      });
    },

    async startAuth(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        authDebug("server.auth.start.request", {
          accountId: accountId || String(input.accountId || ""),
          mode: input.mode || "",
          ...debugInputForLog(input)
        });
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (accountId === "codex") {
          const managementError = codexManagementError(input);
          if (managementError) {
            return managementError;
          }
        }

        const mode = normalizedAuthMode(accountId, input.mode);
        const unsupportedMode = unsupportedAuthMode(accountId, mode, resolvedAccountRuntime);
        if (unsupportedMode) {
          authDebug("server.auth.start.unsupported_mode", {
            accountId,
            mode
          });
          return unsupportedMode;
        }
        const githubContext = accountId === "github" ? githubContextForInput(input) : null;
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
          previousGithub: previousGithubForInput(input)
        });
        if (terminal.ok === false) {
          return terminal;
        }

        return readSessionWithAccount({
          ...input,
          sessionId: terminal.id
        });
      });
    },

    async saveGitIdentity(input = {}) {
      return accountsResult(async () => {
        const githubContext = githubContextForInput(input);
        if (!githubContext.ok) {
          return githubContext;
        }
        const gitIdentity = githubGitIdentityFromInput(input);
        if (!gitIdentity.ok) {
          return authError("github_git_identity_required", gitIdentity.error || "Git identity is required.");
        }
        await ensureToolHomeSource(githubContext);
        const result = await accountRunHostCommand(gitIdentitySaveCommandArgs(gitIdentity), {
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
        const account = await accountStatus("github", {
          githubContext,
          previousGithub: previousGithubForInput(input)
        });
        return {
          account,
          ok: account?.ok !== false,
          output: result.output || ""
        };
      });
    },

    async readAuthSession(input = {}) {
      return accountsResult(() => readSessionWithAccount(input));
    },

    async logout(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        authDebug("server.auth.logout.start", {
          accountId: accountId || String(input.accountId || ""),
          ...debugInputForLog(input)
        });
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (accountId === "codex") {
          const managementError = codexManagementError(input);
          if (managementError) {
            return managementError;
          }
        }

        const githubContext = accountId === "github" ? githubContextForInput(input) : null;
        if (githubContext && !githubContext.ok) {
          return githubContext;
        }
        const providerContext = accountId === "github" ? githubContext : codexContextForInput();
        await ensureToolHomeSource(providerContext);
        if (accountId === "github") {
          await clearGithubAuthStatus({
            githubContext,
            systemRoot: resolvedSystemRoot
          });
        }
        const result = await accountRunHostCommand(logoutCommandArgs(accountId), {
          ...hostCommandOptionsForCredentialContext(providerContext),
          timeout: 30_000
        });
        authDebug("server.auth.logout.host_command_done", {
          accountId,
          ok: result.ok === true,
          outputLength: cleanOutput(result.output).length,
          outputTail: sanitizedAuthOutputTail(result.output)
        });
        const account = await accountStatus(accountId, {
          codexMarkerReason: accountId === "codex" ? "logout" : "",
          githubContext,
          rotateCodexMarker: accountId === "codex"
        });
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
    },

    async cancelAuthSession(input = {}) {
      return accountsResult(async () => {
        const id = String(input?.sessionId || input || "");
        const metadata = authMetadata(id, input);
        if (!metadata || !sessionVisibleToInput(input, metadata)) {
          return authError("unknown_auth_session", "Account auth session not found.");
        }
        cancelledAuthSessions.add(id);
        const result = await closeTerminalSession(id, {
          namespace: ACCOUNT_AUTH_NAMESPACE
        });
        authSessions.delete(id);
        return {
          ...result,
          ok: true
        };
      });
    },

    subscribeAuthTerminal(input = {}, subscriber) {
      const visible = requireVisibleAuthTerminal(input);
      if (visible.ok === false) {
        return visible;
      }
      return subscribeTerminalSession(visible.sessionId, subscriber, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    },

    writeAuthTerminal(input = {}, data = "") {
      const visible = requireVisibleAuthTerminal(input);
      if (visible.ok === false) {
        return visible;
      }
      return writeTerminalSession(visible.sessionId, data, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    },

    resizeAuthTerminal(input = {}, size = {}) {
      const visible = requireVisibleAuthTerminal(input);
      if (visible.ok === false) {
        return visible;
      }
      return resizeTerminalSession(visible.sessionId, size, {
        namespace: ACCOUNT_AUTH_NAMESPACE
      });
    }
  });
}

export {
  ACCOUNT_AUTH_NAMESPACE,
  API_KEY_AUTH_MODE,
  APP_CREDENTIAL_SCOPE,
  ALL_CODEX_AUTH_MODES,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  codexCredentialContext,
  BROWSER_AUTH_MODE,
  DEVICE_AUTH_MODE,
  GITHUB_DEVICE_AUTH_URL,
  GITHUB_GIT_CREDENTIAL_HELPER,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  authTerminalMetadata,
  createAccountsRuntime,
  createService,
  gitIdentitySaveCommandArgs,
  ghLoginCommandArgs,
  terminalArgsForAuth,
  VIBE64_ACCOUNTS_SERVICE,
  VIBE64_ACCOUNTS_RUNTIME_SERVICE,
  githubCredentialContext,
  resolveVibe64AccountsRoot
};
