import stripAnsi from "strip-ansi";

import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  createRepositoryReadyStatusCache
} from "@local/setup-doctor-core/server/doctorStatusCache";
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
  isRemoteStudioRuntime,
  studioRuntimeLocation
} from "@local/vibe64-core/server/studioRuntimeLocation";
import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

const ACCOUNT_AUTH_NAMESPACE = "vibe64-accounts";
const BROWSER_AUTH_MODE = "browser";
const DEVICE_AUTH_MODE = "device";
const GITHUB_DEVICE_AUTH_URL = "https://github.com/login/device";
const GITHUB_GIT_CREDENTIAL_HELPER = "gh auth git-credential";
const REQUIRED_GITHUB_SCOPES = Object.freeze(["repo", "read:org", "gist", "workflow"]);

const ACCOUNT_DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    required: false
  }),
  github: Object.freeze({
    id: "github",
    label: "GitHub",
    required: true
  })
});
const AGENT_RUNTIME_DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    mode: "optional",
    runtime: "codex"
  }),
  opencode: Object.freeze({
    default: true,
    id: "opencode",
    label: "OpenCode",
    mode: "free",
    runtime: "opencode"
  })
});

function resolveVibe64AccountsRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
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

function cleanOutput(output = "") {
  return stripAnsi(String(output || ""));
}

function normalizedAccountId(value = "") {
  const accountId = String(value || "").trim().toLowerCase();
  return ACCOUNT_DEFINITIONS[accountId] ? accountId : "";
}

function accountDefinition(accountId = "") {
  return ACCOUNT_DEFINITIONS[String(accountId || "").trim().toLowerCase()] || null;
}

function accountRequired(accountId = "") {
  return accountDefinition(accountId)?.required === true;
}

function normalizedAuthMode(accountId, mode = "") {
  const requestedMode = String(mode || "").trim().toLowerCase();
  if (accountId === "codex" && requestedMode === DEVICE_AUTH_MODE) {
    return DEVICE_AUTH_MODE;
  }
  return BROWSER_AUTH_MODE;
}

function ghLoginCommandArgs() {
  return [
    "bash",
    "-lc",
    [
      "set -e",
      "if ! gh auth status --hostname github.com >/dev/null 2>&1; then",
      `  ${ghLoginCommandOnlyArgs().map(shellQuote).join(" ")}`,
      "fi",
      "gh auth setup-git --hostname github.com --force"
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

function terminalArgsForAuth(accountId, mode) {
  if (accountId === "github") {
    return buildDoctorTerminalArgs(ghLoginCommandArgs());
  }

  const extraArgs = mode === BROWSER_AUTH_MODE ? ["--network", "host"] : [];
  return buildDoctorTerminalArgs(codexLoginCommandArgs(mode), {
    extraArgs
  });
}

function statusArgs(commandArgs) {
  return buildDoctorToolchainArgs(commandArgs);
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

function shouldPressEnterForBrowserFlow(output = "") {
  return /press\s+enter/iu.test(cleanOutput(output));
}

function accountDisconnected({
  id,
  label,
  message,
  observed = "",
  required = accountRequired(id)
}) {
  return {
    connected: false,
    id,
    label,
    message,
    observed,
    required,
    status: "not_connected"
  };
}

function accountConnected({
  id,
  label,
  message,
  observed = "",
  required = accountRequired(id),
  username = ""
}) {
  return {
    connected: true,
    id,
    label,
    message,
    observed,
    required,
    status: "connected",
    username
  };
}

function opencodeRuntimeStatus(runtimeStatus = null) {
  const status = runtimeStatus && typeof runtimeStatus === "object" && !Array.isArray(runtimeStatus)
    ? runtimeStatus
    : null;
  const ready = status ? status.ready === true : true;
  const providers = Array.isArray(status?.providers) ? status.providers : [];
  return {
    ...AGENT_RUNTIME_DEFINITIONS.opencode,
    available: ready,
    connected: ready,
    connectedProviderCount: Number(status?.connectedProviderCount || 0),
    connectedProviders: Array.isArray(status?.connectedProviders) ? status.connectedProviders : [],
    error: String(status?.error || ""),
    healthy: status ? status.healthy === true : true,
    message: ready
      ? "OpenCode is available as Vibe64's default AI runtime."
      : String(status?.error || "OpenCode is not available."),
    providers,
    ready,
    remote: status?.remote === true,
    runtimeLocation: String(status?.runtimeLocation || "local"),
    server: status?.server || null,
    status: ready ? "available" : "not_available",
    version: String(status?.version || "")
  };
}

function codexRuntimeStatus(codexAccount = {}) {
  const connected = codexAccount.connected === true;
  return {
    ...AGENT_RUNTIME_DEFINITIONS.codex,
    available: connected,
    connected,
    message: connected
      ? "Codex is authenticated and available for Codex sessions."
      : "Codex sessions are available after Codex authentication.",
    ready: connected,
    status: connected ? "available" : "not_connected"
  };
}

function agentRuntimeStatus({
  codex = {},
  opencode = null
} = {}) {
  const runtimes = [
    opencodeRuntimeStatus(opencode),
    codexRuntimeStatus(codex)
  ];
  const defaultRuntime = runtimes.find((runtime) => runtime.default === true) || runtimes[0] || null;
  return {
    defaultRuntimeId: defaultRuntime?.id || "opencode",
    ready: defaultRuntime?.ready === true,
    runtimes
  };
}

function aiBlockedReason(ai = {}) {
  const runtimes = Array.isArray(ai.runtimes) ? ai.runtimes : [];
  const defaultRuntime = runtimes.find((runtime) => runtime.id === ai.defaultRuntimeId)
    || runtimes.find((runtime) => runtime.default === true)
    || null;
  return defaultRuntime?.message || "Default AI runtime is not available.";
}

async function runDefaultToolchain(commandArgs, options = {}) {
  return runHostCommand("docker", statusArgs(commandArgs), {
    timeout: options.timeout || 20_000
  });
}

async function readGithubStatus({
  runToolchain = runDefaultToolchain
} = {}) {
  const [statusResult, userResult, gitCredentialResult] = await Promise.all([
    runToolchain(["gh", "auth", "status", "--hostname", "github.com"]),
    runToolchain(["gh", "api", "user", "--jq", ".login"]),
    runToolchain(["git", "config", "--global", "--get-urlmatch", "credential.helper", "https://github.com"])
  ]);
  const output = [statusResult.output, userResult.output].filter(Boolean).join("\n");
  const missingScopes = REQUIRED_GITHUB_SCOPES.filter((scope) => !output.includes(scope));
  const credentialHelperOutput = [gitCredentialResult.stdout, gitCredentialResult.output].filter(Boolean).join("\n");
  const missingGitCredentialHelper = !credentialHelperOutput.includes(GITHUB_GIT_CREDENTIAL_HELPER);

  if (!statusResult.ok || !userResult.ok || !userResult.stdout || missingScopes.length > 0 || missingGitCredentialHelper) {
    const scopeMessage = missingScopes.length
      ? ` Missing scopes: ${missingScopes.join(", ")}.`
      : "";
    const gitCredentialMessage = missingGitCredentialHelper
      ? " Git credential helper is not configured."
      : "";
    return accountDisconnected({
      id: "github",
      label: "GitHub",
      message: `GitHub CLI is not authenticated for Studio.${scopeMessage}${gitCredentialMessage}`,
      observed: [output, credentialHelperOutput].filter(Boolean).join("\n")
    });
  }

  return accountConnected({
    id: "github",
    label: "GitHub",
    message: "GitHub CLI is authenticated for Studio.",
    observed: output,
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
      message: "Codex is not authenticated for Studio.",
      observed: result.output
    });
  }

  return accountConnected({
    id: "codex",
    label: "Codex",
    message: "Codex is authenticated for Studio.",
    observed: result.output
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

function authTerminalMetadata(accountId, mode) {
  return {
    accountId,
    mode
  };
}

function canReuseAuthTerminal(accountId, mode) {
  return (session = {}) => {
    return session.metadata?.accountId === accountId && session.metadata?.mode === mode;
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
  agentRuntimeService = null,
  projectService = null,
  readyStatusCacheRoot = "",
  runToolchain = runDefaultToolchain,
  targetRoot = ""
} = {}) {
  const authSessions = new Map();

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceTargetRoot(projectService)).trim();
    return selectedTargetRoot ? resolveVibe64AccountsRoot(selectedTargetRoot) : "";
  }

  function readyStatusCache() {
    return createRepositoryReadyStatusCache({
      doctorId: "accounts",
      stateRoot: readyStatusCacheRoot,
      targetRoot: currentTargetRoot() || process.cwd()
    });
  }

  function authMetadata(sessionId = "") {
    return authSessions.get(sessionId) || null;
  }

  async function accountStatus(accountId) {
    if (accountId === "github") {
      return readGithubStatus({
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

  async function accountsStatus() {
    const [codex, github, opencode] = await Promise.all([
      readCodexStatus({
        runToolchain
      }),
      readGithubStatus({
        runToolchain
      }),
      typeof agentRuntimeService?.opencodeRuntimeStatus === "function"
        ? agentRuntimeService.opencodeRuntimeStatus()
        : Promise.resolve(null)
    ]);
    const accounts = [codex, github];
    const accountsReady = accounts.every((account) => account.required !== true || account.connected === true);
    const ai = agentRuntimeStatus({
      codex,
      opencode
    });
    const ready = accountsReady && ai.ready === true;

    return {
      agentRuntimes: ai.runtimes,
      accounts,
      ai,
      blockedReason: ready ? "" : blockedReason(accounts) || aiBlockedReason(ai),
      ok: true,
      ready,
      remote: isRemoteStudioRuntime(),
      runtimeLocation: studioRuntimeLocation(),
      targetRoot: currentTargetRoot(),
      updatedAt: new Date().toISOString()
    };
  }

  function maybeContinueBrowserFlow(sessionId, terminal, parsed) {
    const metadata = authMetadata(sessionId);
    if (!metadata || metadata.enterSent) {
      return;
    }
    if (!parsed.authUrl && !parsed.userCode) {
      return;
    }
    if (!shouldPressEnterForBrowserFlow(terminal.output)) {
      return;
    }

    writeTerminalSession(sessionId, "\r", {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
    metadata.enterSent = true;
  }

  async function readSessionWithAccount(sessionId) {
    const metadata = authMetadata(sessionId);
    if (!metadata) {
      return authError("unknown_auth_session", "Account auth session not found.");
    }

    const terminal = readTerminalSession(sessionId, {
      namespace: ACCOUNT_AUTH_NAMESPACE
    });
    if (terminal.ok === false) {
      return terminal;
    }

    const parsed = parseAuthOutput({
      accountId: metadata.accountId,
      mode: metadata.mode,
      output: terminal.output
    });
    maybeContinueBrowserFlow(sessionId, terminal, parsed);

    const account = terminal.status === "exited"
      ? await accountStatus(metadata.accountId)
      : {
          connected: false,
          id: metadata.accountId,
          label: ACCOUNT_DEFINITIONS[metadata.accountId].label,
          required: accountRequired(metadata.accountId),
          status: "authenticating"
        };

    return publicAuthSession({
      account,
      mode: metadata.mode,
      parsed,
      terminal
    });
  }

  function startAuthTerminal(accountId, mode) {
    const args = terminalArgsForAuth(accountId, mode);
    const authCwd = currentTargetRoot() || process.cwd();
    const terminal = startTerminalSession({
      args,
      command: "docker",
      commandPreview: dockerCommand(args),
      cwd: authCwd,
      maxRunning: 1,
      metadata: authTerminalMetadata(accountId, mode),
      namespace: ACCOUNT_AUTH_NAMESPACE,
      reuseRunning: canReuseAuthTerminal(accountId, mode)
    });
    if (terminal.ok === false) {
      return terminal;
    }

    if (!authSessions.has(terminal.id)) {
      authSessions.set(terminal.id, {
        accountId,
        enterSent: false,
        mode,
        startedAt: new Date().toISOString()
      });
    }
    return terminal;
  }

  return Object.freeze({
    async getStatus(input = {}) {
      return accountsResult(async () => {
        const useReadyStatusCache = !agentRuntimeService;
        if (useReadyStatusCache && !refreshRequested(input)) {
          const cache = readyStatusCache();
          const cachedStatus = await cache.read();
          if (cachedStatus) {
            return cachedStatus;
          }
        }
        const status = await accountsStatus();
        return useReadyStatusCache ? readyStatusCache().remember(status) : status;
      });
    },

    async startAuth(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (isRemoteStudioRuntime()) {
          return authError("oauth_remote_disabled", "OAuth account changes are disabled when Vibe64 runs with --remote.");
        }

        const mode = normalizedAuthMode(accountId, input.mode);
        const terminal = startAuthTerminal(accountId, mode);
        if (terminal.ok === false) {
          return terminal;
        }

        return readSessionWithAccount(terminal.id);
      });
    },

    async readAuthSession(sessionId) {
      return accountsResult(() => readSessionWithAccount(String(sessionId || "")));
    },

    async logout(input = {}) {
      return accountsResult(async () => {
        const accountId = normalizedAccountId(input.accountId);
        if (!accountId) {
          return authError("unknown_account", "Unknown account.");
        }
        if (isRemoteStudioRuntime()) {
          return authError("oauth_remote_disabled", "OAuth account changes are disabled when Vibe64 runs with --remote.");
        }

        const result = await runToolchain(logoutCommandArgs(accountId), {
          timeout: 30_000
        });
        const account = await accountStatus(accountId);
        if (result.ok && account.connected !== true) {
          await readyStatusCache().remember({
            ready: false
          });
        }
        return {
          account,
          ok: result.ok,
          output: result.output
        };
      });
    },

    async setOpenCodeProviderAuth(input = {}) {
      return accountsResult(async () => {
        const providerId = String(input.providerId || "").trim();
        if (!providerId) {
          return authError("unknown_opencode_provider", "Choose an OpenCode provider.");
        }
        if (typeof agentRuntimeService?.setOpenCodeProviderAuth !== "function") {
          return authError("opencode_auth_unavailable", "OpenCode provider authentication is not available.");
        }
        const result = await agentRuntimeService.setOpenCodeProviderAuth(providerId, {
          apiKey: input.apiKey
        });
        if (result?.ok !== false) {
          await readyStatusCache().remember({
            ready: false
          });
        }
        return result;
      });
    },

    async startOpenCodeProviderOAuth(input = {}) {
      return accountsResult(async () => {
        const providerId = String(input.providerId || "").trim();
        const methodIndex = input.methodIndex == null ? "" : String(input.methodIndex).trim();
        if (!providerId) {
          return authError("unknown_opencode_provider", "Choose an OpenCode provider.");
        }
        if (!methodIndex) {
          return authError("unknown_opencode_oauth_method", "Choose an OpenCode OAuth method.");
        }
        if (typeof agentRuntimeService?.startOpenCodeProviderOAuth !== "function") {
          return authError("opencode_oauth_unavailable", "OpenCode OAuth login is not available.");
        }
        return agentRuntimeService.startOpenCodeProviderOAuth(providerId, {
          methodIndex
        });
      });
    },

    async cancelAuthSession(sessionId) {
      return accountsResult(async () => {
        const id = String(sessionId || "");
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
  canReuseAuthTerminal,
  GITHUB_DEVICE_AUTH_URL,
  GITHUB_GIT_CREDENTIAL_HELPER,
  parseAuthOutput,
  REQUIRED_GITHUB_SCOPES,
  authTerminalMetadata,
  createService,
  ghLoginCommandArgs,
  resolveVibe64AccountsRoot
};
