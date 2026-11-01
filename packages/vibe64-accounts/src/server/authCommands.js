import { operatorCliCommand, shellQuote } from "@local/vibe64-execution/server";
import { STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG } from "@local/studio-terminal-core/server/studioRuntimeIdentity";

import { validateGitIdentityInputs } from "../shared/gitIdentityInput.js";
import { cleanAuthOutput, deviceUserCode, OPENAI_API_KEY_REDACTION_PATTERN } from "../shared/authOutput.js";
import { API_KEY_AUTH_MODE, authError, BROWSER_AUTH_MODE, DEVICE_AUTH_MODE } from "./accountsRuntime.js";
import { commandArgv } from "./accountHostCommands.js";
import { ACCOUNT_DEFINITIONS } from "./accountRecords.js";

// Sign-in and sign-out commands for each account, what their output shows the
// person, and the shape of a sign-in terminal session.

const ACCOUNT_AUTH_NAMESPACE = "vibe64-accounts";

const CODEX_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";

const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device";

const CODEX_API_KEY_ENV = "VIBE64_CODEX_API_KEY";

const REQUIRED_GITHUB_SCOPES = Object.freeze(["repo", "read:org", "gist", "workflow"]);

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
      ...ghGitIdentityWhenUnsetCommandLines(gitIdentity)
    ].join("\n")
  ];
}

// Signing in to GitHub never replaces a name or email the person already gave
// Git, and never writes an empty one.
function ghGitIdentityWhenUnsetCommandLines(gitIdentity = {}) {
  return [["user.name", gitIdentity.name], ["user.email", gitIdentity.email]]
    .map(([key, value]) => [key, String(value || "").trim()])
    .filter(([, value]) => value)
    .map(([key, value]) => `[ -n "$(git config --global --get ${key} 2>/dev/null)" ] || git config --global ${key} ${shellQuote(value)}`);
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

function codexLoginCommandArgs(mode = BROWSER_AUTH_MODE, env = process.env) {
  const codex = operatorCliCommand("codex", { env });
  if (mode === API_KEY_AUTH_MODE) {
    return codexApiKeyLoginCommandArgs(codex);
  }
  return mode === DEVICE_AUTH_MODE
    ? [codex, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login", "--device-auth"]
    : [codex, "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "login"];
}

function codexApiKeyLoginCommandArgs(codex) {
  return [
    "bash",
    "-lc",
    [
      "set -e",
      `if [ -z "\${${CODEX_API_KEY_ENV}:-}" ]; then`,
      "  printf '%s\\n' 'OpenAI API key is required.' >&2",
      "  exit 2",
      "fi",
      `printf '%s\\n' "$${CODEX_API_KEY_ENV}" | ${shellQuote(codex)} -c ${shellQuote(STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG)} login --with-api-key`,
      `unset ${CODEX_API_KEY_ENV}`
    ].join("\n")
  ];
}

function logoutCommandArgs(accountId, env = process.env) {
  if (accountId === "claude") return [operatorCliCommand("claude", { env }), "auth", "logout"];
  return accountId === "github"
    ? ["gh", "auth", "logout", "--hostname", "github.com"]
    : [operatorCliCommand("codex", { env }), "-c", STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG, "logout"];
}

function terminalArgsForAuth(accountId, mode, gitIdentity = {}, env = process.env) {
  if (accountId === "claude") return commandArgv([operatorCliCommand("claude", { env }), "auth", "login", "--claudeai"]);
  if (accountId === "github") return commandArgv(ghLoginCommandArgs(gitIdentity));
  return commandArgv(codexLoginCommandArgs(mode, env));
}

function authCommandPreview(commandArgs = []) {
  return commandArgs.map(shellQuote).join(" ");
}

function accountAuthWorkingDirectory(providerContext, fallback = process.cwd()) {
  return String(providerContext?.toolHomeSource || providerContext?.home || fallback || process.cwd());
}

function firstMatchingUrl(output = "", predicate = () => true) {
  const matches = cleanAuthOutput(output).match(/https:\/\/[^\s"'<>]+/gu) || [];
  for (const match of matches) {
    const url = match.replace(/[),.;]+$/u, "");
    if (predicate(url)) {
      return url;
    }
  }
  return "";
}

function parseGithubUserCode(output = "") {
  const normalizedOutput = cleanAuthOutput(output);
  const labelledMatch = normalizedOutput.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4,8})/iu);
  if (labelledMatch) {
    return labelledMatch[1].toUpperCase();
  }
  return deviceUserCode(normalizedOutput);
}

function parseAuthOutput({
  accountId,
  mode,
  output
} = {}) {
  if (accountId === "claude") return { authUrl: "", userCode: "" };
  if (accountId === "github") {
    const userCode = parseGithubUserCode(output);
    return {
      authUrl: firstMatchingUrl(output, (url) => url.includes("github.com/")) || (userCode ? GITHUB_DEVICE_AUTH_URL : ""),
      userCode
    };
  }

  if (mode === DEVICE_AUTH_MODE) {
    const userCode = deviceUserCode(output);
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

function authTerminalMetadata(accountId, mode, githubContext = null, actorId = "") {
  const metadata = {
    accountId,
    credentialScope: ACCOUNT_DEFINITIONS[accountId]?.scope || "",
    mode,
  };
  if (actorId) {
    metadata.actorId = String(actorId);
  }
  if (accountId === "github" && githubContext?.userKey) {
    metadata.userKey = githubContext.userKey;
  }
  return metadata;
}

function unsupportedAuthMode(accountId, mode, accountRuntime) {
  if (accountId === "codex" && accountRuntime.codexModeAllowed(mode) !== true) {
    return authError("unsupported_auth_mode", accountRuntime.unsupportedCodexAuthModeMessage(mode));
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

function authTerminalCredentialHome(providerContext) {
  return {
    gid: providerContext?.gid ?? providerContext?.hostGid ?? null,
    home: providerContext?.toolHomeSource || providerContext?.home || "",
    uid: providerContext?.uid ?? providerContext?.hostUid ?? null,
    username: providerContext?.username || providerContext?.ownerUserKey || ""
  };
}

function authTerminalPurpose(accountId = "") {
  return accountId === "github" ? "github" : "account";
}

function authSessionStatus({
  account,
  terminal
}) {
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
  const output = cleanAuthOutput(terminal.output)
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

export {
  ACCOUNT_AUTH_NAMESPACE,
  accountAuthWorkingDirectory,
  authCommandPreview,
  authTerminalCredentialHome,
  authTerminalMetadata,
  authTerminalPurpose,
  authTerminalRunningLimitFilter,
  canReuseAuthTerminal,
  CODEX_API_KEY_ENV,
  codexApiKeyLoginCommandArgs,
  ghLoginCommandArgs,
  GITHUB_DEVICE_AUTH_URL,
  githubGitIdentityFromInput,
  gitIdentitySaveCommandArgs,
  logoutCommandArgs,
  parseAuthOutput,
  publicAuthSession,
  REQUIRED_GITHUB_SCOPES,
  terminalArgsForAuth,
  unsupportedAuthMode
};
