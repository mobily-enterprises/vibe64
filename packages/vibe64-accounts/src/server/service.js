import { mkdir } from "node:fs/promises";

import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession
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
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  resolveStudioTargetRoot
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
const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device";
const GITHUB_GIT_CREDENTIAL_HELPER = "gh auth git-credential";
const REQUIRED_GITHUB_SCOPES = Object.freeze(["repo", "read:org", "gist", "workflow"]);
const AUTH_DEBUG_MARKER = "VIBE64_ACCOUNTS_DEBUG";
const AUTH_DEBUG_OUTPUT_TAIL_LENGTH = 1200;

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

function cleanOutput(output = "") {
  return stripAnsi(String(output || ""));
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
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/gu, "[redacted-code]");
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

function normalizedAccountId(value = "") {
  const accountId = String(value || "").trim().toLowerCase();
  return ACCOUNT_DEFINITIONS[accountId] ? accountId : "";
}

function normalizedAuthMode(accountId, mode = "") {
  const requestedMode = String(mode || "").trim().toLowerCase();
  if (accountId === "codex" && requestedMode === DEVICE_AUTH_MODE) {
    return DEVICE_AUTH_MODE;
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
  return mode === DEVICE_AUTH_MODE
    ? ["codex", "login", "--device-auth"]
    : ["codex", "login"];
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

  const extraArgs = mode === BROWSER_AUTH_MODE ? ["--network", "host"] : [];
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
  const labelledMatch = normalizedOutput.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/iu);
  if (labelledMatch) {
    return labelledMatch[1].toUpperCase();
  }
  return normalizedOutput.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/u)?.[1]?.toUpperCase() || "";
}

function parseCodexUserCode(output = "") {
  return cleanOutput(output).match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/u)?.[1]?.toUpperCase() || "";
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
    return {
      authUrl: firstMatchingUrl(output, (url) => url.includes("openai.com/") || url.includes("chatgpt.com/")),
      userCode: parseCodexUserCode(output)
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
  scope = ""
}) {
  return {
    connected: false,
    id,
    label,
    gitIdentity,
    message,
    observed,
    required: true,
    scope,
    status: "not_connected"
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

async function runDefaultToolchain(commandArgs, options = {}) {
  return runHostCommand("docker", statusArgs(commandArgs, {
    toolHomeSource: options.toolHomeSource || ""
  }), {
    timeout: options.timeout || 20_000
  });
}

async function readGithubStatus({
  githubContext,
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

async function readCodexStatus({
  runToolchain = runDefaultToolchain
} = {}) {
  const result = await runToolchain(["codex", "login", "status"]);

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

function canReuseAuthTerminal(accountId, mode, githubContext = null) {
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
  return {
    account,
    authUrl: parsed.authUrl,
    commandPreview: terminal.commandPreview,
    exitCode: terminal.exitCode,
    id: terminal.id,
    mode,
    ok: true,
    output: terminal.output,
    status: authSessionStatus({
      account,
      terminal
    }),
    terminalStatus: terminal.status,
    userCode: parsed.userCode
  };
}

function createService({
  dataRoot = "",
  env = process.env,
  projectService = null,
  providerHomesRoot = "",
  runToolchain = runDefaultToolchain,
  targetRoot = ""
} = {}) {
  const authSessions = new Map();
  const resolvedProviderHomesRoot = resolveProviderHomesRoot({
    dataRoot,
    env,
    explicitRoot: providerHomesRoot
  });

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
    githubContext = null
  } = {}) {
    if (accountId === "github") {
      if (!githubContext?.ok) {
        return githubContext || authError("vibe64_user_required", "A logged-in Vibe64 user is required for GitHub account operations.");
      }
      return readGithubStatus({
        githubContext,
        runToolchain
      });
    }
    if (accountId === "codex") {
      return readCodexStatus({
        runToolchain
      });
    }
    throw new Error(`Unknown account: ${accountId}`);
  }

  async function accountsStatus(input = {}) {
    const githubContext = githubContextForInput(input);
    if (!githubContext.ok) {
      return githubContext;
    }
    const accounts = await Promise.all([
      readCodexStatus({
        runToolchain
      }),
      readGithubStatus({
        githubContext,
        runToolchain
      })
    ]);
    const ready = accounts.every((account) => account.required !== true || account.connected === true);

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
          githubContext: metadata.githubContext || null
        })
      : {
          connected: false,
          id: metadata.accountId,
          label: ACCOUNT_DEFINITIONS[metadata.accountId].label,
          required: true,
          scope: ACCOUNT_DEFINITIONS[metadata.accountId].scope,
          status: "authenticating"
        };

    return publicAuthSession({
      account,
      mode: metadata.mode,
      parsed,
      terminal
    });
  }

  async function startAuthTerminal(accountId, mode, githubContext = null, gitIdentity = {}) {
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
    const terminal = startTerminalSession({
      args,
      command: "docker",
      commandPreview: dockerCommand(args),
      cwd: authCwd,
      maxRunning: 1,
      metadata: authTerminalMetadata(accountId, mode, githubContext),
      namespace: ACCOUNT_AUTH_NAMESPACE,
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

        const mode = normalizedAuthMode(accountId, input.mode);
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
        const terminal = await startAuthTerminal(accountId, mode, githubContext, gitIdentity);
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
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
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
        const account = await accountStatus(accountId, {
          githubContext
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
    }
  });
}

export {
  ACCOUNT_AUTH_NAMESPACE,
  APP_PROVIDER_SCOPE,
  canReuseAuthTerminal,
  GITHUB_DEVICE_AUTH_URL,
  GITHUB_GIT_CREDENTIAL_HELPER,
  USER_PROVIDER_SCOPE,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  authTerminalMetadata,
  createService,
  ghLoginCommandArgs,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  resolveProviderHomesRoot,
  resolveVibe64AccountsRoot
};
