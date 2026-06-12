import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  validateGitIdentityInputs
} from "@local/setup-doctor-core/server/setupDoctorGit";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  codexAuthMarkerPath
} from "@local/vibe64-core/server/codexAuthState";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  resolveStudioTargetRoot,
  resolveVibe64SystemRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  APP_PROVIDER_SCOPE,
  USER_PROVIDER_SCOPE,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  resolveProviderHomesRoot
} from "@local/studio-terminal-core/server/providerHomes";

const ACCOUNT_AUTH_NAMESPACE = "vibe64-accounts";
const BROWSER_AUTH_MODE = "browser";
const DEVICE_AUTH_MODE = "device";
const API_KEY_AUTH_MODE = "api_key";
const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";
const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device";
const GITHUB_GIT_CREDENTIAL_HELPER = "gh auth git-credential";
const CODEX_API_KEY_ENV = "VIBE64_CODEX_API_KEY";
const REQUIRED_GITHUB_SCOPES = Object.freeze(["repo", "read:org", "gist", "workflow"]);
const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;
const DEVICE_USER_CODE_PATTERN = /\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/iu;
const DEVICE_USER_CODE_REDACTION_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/gu;
const OPENAI_API_KEY_REDACTION_PATTERN = /\bsk-[A-Za-z0-9_-]{16,}\b/gu;
const VISIBLE_ANSI_ESCAPE_PATTERN = /\u00a4\[[0-?]*[ -/]*[@-~]/gu;
const GITHUB_HOSTS_RELATIVE_PATH = Object.freeze([".config", "gh", "hosts.yml"]);
const GITHUB_GITCONFIG_RELATIVE_PATH = Object.freeze([".gitconfig"]);

const ACCOUNT_DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    required: true,
    scope: APP_PROVIDER_SCOPE
  }),
  github: Object.freeze({
    id: "github",
    label: "GitHub",
    required: true,
    scope: USER_PROVIDER_SCOPE
  })
});

function resolveVibe64AccountsRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

async function ensureToolHomeSource(context = {}) {
  if (!context?.toolHomeSource) {
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

function authDebug(event, fields = {}) {
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
    ? ["codex", "-c", "check_for_update_on_startup=false", "login", "--device-auth"]
    : ["codex", "-c", "check_for_update_on_startup=false", "login"];
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
      `printf '%s\\n' "$${CODEX_API_KEY_ENV}" | codex -c check_for_update_on_startup=false login --with-api-key`,
      `unset ${CODEX_API_KEY_ENV}`
    ].join("\n")
  ];
}

function logoutCommandArgs(accountId) {
  return accountId === "github"
    ? ["gh", "auth", "logout", "--hostname", "github.com"]
    : ["codex", "logout"];
}

function terminalArgsForAuth(accountId, mode, toolchainOptions = {}, gitIdentity = {}) {
  if (accountId === "github") {
    return buildDoctorTerminalArgs(ghLoginCommandArgs(gitIdentity), toolchainOptions);
  }

  const extraArgs = [
    ...(mode === BROWSER_AUTH_MODE ? ["--network", "host"] : []),
    ...(mode === API_KEY_AUTH_MODE ? ["-e", CODEX_API_KEY_ENV] : [])
  ];
  return buildDoctorTerminalArgs(codexLoginCommandArgs(mode), {
    extraArgs
  });
}

function statusArgs(commandArgs, toolchainOptions = {}) {
  return buildDoctorToolchainArgs(commandArgs, toolchainOptions);
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
  providerHomesRoot = "",
  systemRoot = ""
} = {}) {
  const marker = await readOptionalJson(codexAuthMarkerPath(systemRoot, {
    providerHomesRoot
  }));
  if (marker?.connected === true) {
    return accountConnected({
      id: "codex",
      label: "Codex",
      message: "Codex is authenticated for the shared Vibe64 app account.",
      observed: "Local Codex authentication marker is present.",
      scope: APP_PROVIDER_SCOPE
    });
  }

  return accountDisconnected({
    id: "codex",
    label: "Codex",
    message: "Codex is not authenticated for the shared Vibe64 app account.",
    observed: "Local Codex authentication marker is missing.",
    scope: APP_PROVIDER_SCOPE
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

async function readGithubLocalStatus({
  githubContext,
  previousGithub = null
} = {}) {
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
        scope: USER_PROVIDER_SCOPE,
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
      scope: USER_PROVIDER_SCOPE
    });
  }

  return accountConnected({
    id: "github",
    gitIdentity,
    label: "GitHub",
    message: "GitHub CLI is configured for this Vibe64 user.",
    observed,
    scope: USER_PROVIDER_SCOPE,
    username: hosts.username || rememberedGithubIdentity(previousGithub)?.login || ""
  });
}

async function runDefaultToolchain(commandArgs, options = {}) {
  return runHostCommand("docker", statusArgs(commandArgs, {
    toolHomeSource: options.toolHomeSource || ""
  }), {
    timeout: options.timeout || 20_000
  });
}

async function readGithubStatus({
  githubContext,
  previousGithub = null,
  runToolchain = runDefaultToolchain
} = {}) {
  await ensureToolHomeSource(githubContext);
  const toolchainOptions = {
    toolHomeSource: githubContext?.toolHomeSource || ""
  };
  const [statusResult, userResult, gitCredentialResult, gitNameResult, gitEmailResult] = await Promise.all([
    runToolchain(["gh", "auth", "status", "--hostname", "github.com"], toolchainOptions),
    runToolchain(["gh", "api", "user", "--jq", ".login"], toolchainOptions),
    runToolchain(["git", "config", "--global", "--get-urlmatch", "credential.helper", "https://github.com"], toolchainOptions),
    runToolchain(["git", "config", "--global", "--get", "user.name"], toolchainOptions),
    runToolchain(["git", "config", "--global", "--get", "user.email"], toolchainOptions)
  ]);
  const output = [statusResult.output, userResult.output].filter(Boolean).join("\n");
  const missingScopes = REQUIRED_GITHUB_SCOPES.filter((scope) => !output.includes(scope));
  const credentialHelperOutput = [gitCredentialResult.stdout, gitCredentialResult.output].filter(Boolean).join("\n");
  const missingGitCredentialHelper = !credentialHelperOutput.includes(GITHUB_GIT_CREDENTIAL_HELPER);
  const missingGitIdentity = !gitNameResult.ok || !gitNameResult.stdout || !gitEmailResult.ok || !gitEmailResult.stdout;
  const gitIdentity = {
    email: gitEmailResult.stdout || "",
    name: gitNameResult.stdout || ""
  };

  if (!statusResult.ok || !userResult.ok || !userResult.stdout || missingScopes.length > 0 || missingGitCredentialHelper || missingGitIdentity) {
    const previousGithubIdentity = rememberedGithubIdentity(previousGithub);
    if (previousGithubIdentity) {
      return accountDisconnected({
        id: "github",
        gitIdentity,
        label: "GitHub",
        message: `GitHub was previously linked as @${previousGithubIdentity.login}, but this host is not ready to use it. Reconnect GitHub to continue.`,
        observed: [output, credentialHelperOutput, gitNameResult.output, gitEmailResult.output].filter(Boolean).join("\n"),
        previousGithub: previousGithubIdentity,
        previousUsername: previousGithubIdentity.login,
        scope: USER_PROVIDER_SCOPE,
        status: "reconnect_required"
      });
    }
    const scopeMessage = missingScopes.length
      ? ` Missing scopes: ${missingScopes.join(", ")}.`
      : "";
    const gitCredentialMessage = missingGitCredentialHelper
      ? " Git credential helper is not configured."
      : "";
    const gitIdentityMessage = missingGitIdentity
      ? " Git identity is not configured."
      : "";
    return accountDisconnected({
      id: "github",
      gitIdentity,
      label: "GitHub",
      message: `GitHub CLI is not ready for this Vibe64 user.${scopeMessage}${gitCredentialMessage}${gitIdentityMessage}`,
      observed: [output, credentialHelperOutput, gitNameResult.output, gitEmailResult.output].filter(Boolean).join("\n"),
      scope: USER_PROVIDER_SCOPE
    });
  }

  return accountConnected({
    id: "github",
    gitIdentity,
    label: "GitHub",
    message: "GitHub CLI is authenticated for this Vibe64 user.",
    observed: output,
    scope: USER_PROVIDER_SCOPE,
    username: userResult.stdout
  });
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
  runToolchain = runDefaultToolchain
} = {}) {
  const result = await runToolchain(["codex", "-c", "check_for_update_on_startup=false", "login", "status"]);

  if (!result.ok) {
    return accountDisconnected({
      id: "codex",
      label: "Codex",
      message: "Codex is not authenticated for the shared Vibe64 app account.",
      observed: result.output,
      scope: APP_PROVIDER_SCOPE
    });
  }

  return accountConnected({
    id: "codex",
    label: "Codex",
    message: "Codex is authenticated for the shared Vibe64 app account.",
    observed: result.output,
    scope: APP_PROVIDER_SCOPE
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

function ownerRequiredForCodex(input = {}) {
  if (input?.vibe64User?.role === "owner") {
    return null;
  }
  return authError(
    "vibe64_owner_required",
    "Only the Vibe64 owner can manage the shared Codex account."
  );
}

function authTerminalMetadata(accountId, mode, githubContext = null) {
  const metadata = {
    accountId,
    mode,
    providerScope: ACCOUNT_DEFINITIONS[accountId]?.scope || ""
  };
  if (accountId === "github" && githubContext?.userKey) {
    metadata.userKey = githubContext.userKey;
  }
  return metadata;
}

function unsupportedAuthMode(accountId, mode) {
  if (accountId === "codex" && mode !== DEVICE_AUTH_MODE && mode !== API_KEY_AUTH_MODE) {
    return authError(
      "unsupported_auth_mode",
      "Codex login on hosted Vibe64 uses device code authentication or OpenAI API key authentication. Browser link login is not available for Codex."
    );
  }
  return null;
}

function canReuseAuthTerminal(accountId, mode, githubContext = null) {
  if (accountId === "codex" && mode === API_KEY_AUTH_MODE) {
    return () => false;
  }
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

function createService({
  env = process.env,
  projectService = null,
  providerHomesRoot = "",
  publishAccountChanged = async () => null,
  runToolchain = runDefaultToolchain,
  startTerminalSessionFn = startTerminalSession,
  systemRoot = "",
  targetRoot = ""
} = {}) {
  const authSessions = new Map();
  const resolvedSystemRoot = resolveVibe64SystemRoot({
    env,
    explicitRoot: systemRoot
  });
  const resolvedProviderHomesRoot = resolveProviderHomesRoot({
    env,
    explicitRoot: providerHomesRoot,
    systemRoot: resolvedSystemRoot
  });

  async function rememberCodexStatus(account = {}) {
    const markerPath = codexAuthMarkerPath(resolvedSystemRoot, {
      providerHomesRoot: resolvedProviderHomesRoot
    });
    if (account?.connected === true) {
      authDebug("server.auth.codex_marker.write", {
        account: accountDebugSummary(account),
        markerPath
      });
      await writeJsonFile(markerPath, {
        connected: true,
        updatedAt: new Date().toISOString(),
        version: 1
      });
      return;
    }
    authDebug("server.auth.codex_marker.remove", {
      account: accountDebugSummary(account),
      markerPath
    });
    await rm(markerPath, {
      force: true
    });
  }

  async function readLiveCodexStatus() {
    authDebug("server.auth.codex_status.live.start", {});
    const account = await readCodexStatus({
      runToolchain
    });
    await rememberCodexStatus(account);
    authDebug("server.auth.codex_status.live.done", {
      account: accountDebugSummary(account)
    });
    return account;
  }

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceTargetRoot(projectService)).trim();
    return selectedTargetRoot ? resolveVibe64AccountsRoot(selectedTargetRoot) : "";
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
    return githubProviderContext(input, {
      providerHomesRoot: resolvedProviderHomesRoot
    });
  }

  async function accountStatus(accountId, {
    githubContext = null,
    previousGithub = null
  } = {}) {
    authDebug("server.auth.account_status.start", {
      accountId,
      githubContextOk: githubContext ? githubContext.ok === true : null,
      previousGithubPresent: Boolean(previousGithub)
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
        runToolchain
      });
      authDebug("server.auth.account_status.done", {
        account: accountDebugSummary(account),
        accountId
      });
      return account;
    }
    if (accountId === "codex") {
      account = await readLiveCodexStatus();
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
    authDebug("server.auth.accounts_status.start", {
      refresh,
      vibe64UserEmail: input?.vibe64User?.email || ""
    });
    const githubContext = githubContextForInput(input);
    if (!githubContext.ok) {
      authDebug("server.auth.accounts_status.github_context_error", {
        code: githubContext.code || "",
        error: githubContext.error || ""
      });
      return githubContext;
    }
    const accounts = refresh
      ? await Promise.all([
          readLiveCodexStatus(),
          readGithubStatus({
            githubContext,
            previousGithub: input?.vibe64User?.github || null,
            runToolchain
          })
        ])
      : await Promise.all([
          readCodexLocalStatus({
            providerHomesRoot: resolvedProviderHomesRoot,
            systemRoot: resolvedSystemRoot
          }),
          readGithubLocalStatus({
            githubContext,
            previousGithub: input?.vibe64User?.github || null
          })
        ]);
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
      providerScopes: {
        codex: APP_PROVIDER_SCOPE,
        github: USER_PROVIDER_SCOPE
      },
      ready,
      targetRoot: currentTargetRoot(),
      updatedAt: new Date().toISOString()
    };
  }

  function sessionVisibleToInput(input = {}, metadata = {}) {
    if (metadata.accountId === "codex") {
      return input?.vibe64User?.role === "owner";
    }
    if (metadata.accountId !== "github") {
      return true;
    }
    const githubContext = githubContextForInput(input);
    return githubContext.ok && metadata.userKey === githubContext.userKey;
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

    const account = terminal.status === "exited"
      ? await accountStatus(metadata.accountId, {
          githubContext: metadata.githubContext || null,
          previousGithub: input?.vibe64User?.github || null
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
      authDebug("server.auth.terminal.finalize.start", {
        accountId,
        reason,
        sessionId: id
      });
      const account = await accountStatus(accountId, {
        githubContext,
        previousGithub
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
    if (accountId === "github") {
      await ensureToolHomeSource(githubContext);
    }
    const toolchainOptions = accountId === "github"
      ? {
          toolHomeSource: githubContext?.toolHomeSource || ""
        }
      : {};
    const args = terminalArgsForAuth(accountId, mode, toolchainOptions, gitIdentity);
    const authCwd = currentTargetRoot() || process.cwd();
    authDebug("server.auth.terminal.start", {
      accountId,
      gitIdentityConfigured: accountId !== "github" || Boolean(gitIdentity.name && gitIdentity.email),
      mode,
      providerScope: ACCOUNT_DEFINITIONS[accountId]?.scope || "",
      toolHomeSource: accountId === "github" ? githubContext?.toolHomeSource || "" : "",
      userKey: accountId === "github" ? String(githubContext?.userKey || "") : ""
    });
    const terminal = startTerminalSessionFn({
      args,
      command: "docker",
      commandPreview: dockerCommand(args),
      cwd: authCwd,
      env: authSecrets,
      maxRunning: 1,
      metadata: authTerminalMetadata(accountId, mode, githubContext),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      onClose: createAuthTerminalCloseHandler({
        accountId,
        githubContext,
        previousGithub: options.previousGithub || null
      }),
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

    async startAuth(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        authDebug("server.auth.start.request", {
          accountId: accountId || String(input.accountId || ""),
          mode: input.mode || "",
          vibe64UserEmail: input.vibe64User?.email || ""
        });
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (accountId === "codex") {
          const ownerError = ownerRequiredForCodex(input);
          if (ownerError) {
            return ownerError;
          }
        }

        const mode = normalizedAuthMode(accountId, input.mode);
        const unsupportedMode = unsupportedAuthMode(accountId, mode);
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
          previousGithub: input?.vibe64User?.github || null
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

    async readAuthSession(input = {}) {
      return accountsResult(() => readSessionWithAccount(input));
    },

    async logout(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        authDebug("server.auth.logout.start", {
          accountId: accountId || String(input.accountId || ""),
          vibe64UserEmail: input?.vibe64User?.email || ""
        });
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (accountId === "codex") {
          const ownerError = ownerRequiredForCodex(input);
          if (ownerError) {
            return ownerError;
          }
        }

        const githubContext = accountId === "github" ? githubContextForInput(input) : null;
        if (githubContext && !githubContext.ok) {
          return githubContext;
        }
        if (githubContext) {
          await ensureToolHomeSource(githubContext);
        }
        const result = await runToolchain(logoutCommandArgs(accountId), {
          toolHomeSource: githubContext?.toolHomeSource || "",
          timeout: 30_000
        });
        authDebug("server.auth.logout.toolchain_done", {
          accountId,
          ok: result.ok === true,
          outputLength: cleanOutput(result.output).length,
          outputTail: sanitizedAuthOutputTail(result.output)
        });
        const account = await accountStatus(accountId, {
          githubContext
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
  APP_PROVIDER_SCOPE,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  GITHUB_DEVICE_AUTH_URL,
  GITHUB_GIT_CREDENTIAL_HELPER,
  USER_PROVIDER_SCOPE,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  authTerminalMetadata,
  createService,
  ghLoginCommandArgs,
  terminalArgsForAuth,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  resolveProviderHomesRoot,
  resolveVibe64AccountsRoot
};
