import {
  envRecord,
  normalizeAbsolutePath,
  normalizeText,
  recordValue,
  uniqueStrings
} from "./normalize.js";
import {
  RESERVED_CALLER_ENV_NAMES,
  rejectCallerEnvPolicy
} from "./env/callerEnv.js";
import {
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "./runtime/runtimePacks.js";

const VIBE64_COMMAND_ACTORS = Object.freeze([
  "daemon",
  "owner-user",
  "named-user",
  "app"
]);
const VIBE64_COMMAND_PURPOSES = Object.freeze([
  "account",
  "terminal",
  "codex",
  "github",
  "github-api",
  "source-editor",
  "preview",
  "adapter",
  "deployment",
  "setup"
]);
const VIBE64_COMMAND_MODES = Object.freeze([
  "capture",
  "pty",
  "detached"
]);
const VIBE64_COMMAND_OUTPUT_ENCODINGS = Object.freeze([
  "utf8",
  "base64"
]);
const VIBE64_COMMAND_ENV_POLICIES = Object.freeze([
  "session",
  "project",
  "preview",
  "auth",
  "deployment"
]);
const VIBE64_COMMAND_GIT_TRANSPORTS = Object.freeze([
  "none",
  "github-https",
  "github-token"
]);
const VIBE64_COMMAND_RUNTIMES = Object.freeze([
  "node26",
  "git",
  "gh",
  "mysql",
  "mariadb",
  "postgresql",
  "ripgrep",
  "bubblewrap",
  "bun",
  "php",
  "composer",
  "playwright",
  "operator-clis"
]);
const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 1000 * 1000 * 100;
const DEFAULT_INTERACTIVE_RUNTIME_PURPOSES = new Set([
  "adapter",
  "codex",
  "deployment",
  "preview",
  "setup",
  "terminal"
]);

function commandRequestError(message = "", code = "vibe64_command_request_invalid") {
  const error = new Error(message || "Invalid Vibe64 command request.");
  error.code = code;
  return error;
}

function normalizeEnum(value = "", allowed = [], fallback = "", label = "value") {
  const normalized = normalizeText(value) || fallback;
  if (!allowed.includes(normalized)) {
    throw commandRequestError(`Unsupported Vibe64 command ${label}: ${normalized || "(empty)"}.`, `vibe64_command_${label}_unsupported`);
  }
  return normalized;
}

function normalizeCommandArgs(args = [], {
  mode = "capture"
} = {}) {
  if (typeof args === "function") {
    if (mode !== "pty") {
      throw commandRequestError(
        "Function-valued command args are only supported for PTY commands.",
        "vibe64_command_args_function_requires_pty"
      );
    }
    return args;
  }
  return (Array.isArray(args) ? args : [args]).map((arg) => String(arg ?? ""));
}

function normalizeCommandEnv(envInput = {}, {
  mode = "capture"
} = {}) {
  if (typeof envInput === "function") {
    if (mode !== "pty") {
      throw commandRequestError(
        "Function-valued command env is only supported for PTY commands.",
        "vibe64_command_env_function_requires_pty"
      );
    }
    return {
      env: {},
      envFactory: envInput
    };
  }
  const env = envRecord(envInput);
  rejectCallerEnvPolicy(env);
  return {
    env,
    envFactory: null
  };
}

function normalizeAbsolutePaths(values = []) {
  return (Array.isArray(values) ? values : [values])
    .map(normalizeAbsolutePath)
    .filter(Boolean);
}

function normalizeTerminalOptions(value = {}) {
  const terminal = recordValue(value);
  return {
    commandPreview: terminal.commandPreview,
    detachedIdleTimeoutMs: terminal.detachedIdleTimeoutMs,
    helperPayloadRoot: normalizeAbsolutePath(terminal.helperPayloadRoot || terminal.payloadRoot),
    maxRunning: terminal.maxRunning,
    metadata: terminal.metadata,
    namespace: normalizeText(terminal.namespace),
    namespaceLimitPrefix: normalizeText(terminal.namespaceLimitPrefix),
    onClose: terminal.onClose,
    onOutput: terminal.onOutput,
    onStop: terminal.onStop,
    reuseRunning: terminal.reuseRunning,
    runningLimitFilter: terminal.runningLimitFilter
  };
}

function normalizeCredentialHome(value = {}) {
  const credentialHome = recordValue(value);
  const home = normalizeAbsolutePath(credentialHome.home || credentialHome.toolHomeSource);
  if (!home) {
    return {};
  }
  return {
    gid: Number.isSafeInteger(Number(credentialHome.gid ?? credentialHome.hostGid))
      ? Number(credentialHome.gid ?? credentialHome.hostGid)
      : null,
    home,
    scope: normalizeText(credentialHome.scope),
    uid: Number.isSafeInteger(Number(credentialHome.uid ?? credentialHome.hostUid))
      ? Number(credentialHome.uid ?? credentialHome.hostUid)
      : null,
    username: normalizeText(credentialHome.username || credentialHome.ownerUserKey || credentialHome.userKey)
  };
}

function defaultRuntimesForPurpose(purpose = "") {
  return DEFAULT_INTERACTIVE_RUNTIME_PURPOSES.has(purpose)
    ? VIBE64_INTERACTIVE_RUNTIME_PACKS
    : [];
}

function hasOwnProperty(record = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeRequestedRuntimes(request = {}, purpose = "") {
  const hasRuntimes = hasOwnProperty(request, "runtimes");
  const hasRuntime = hasOwnProperty(request, "runtime");
  if (!hasRuntimes && !hasRuntime) {
    return uniqueStrings(defaultRuntimesForPurpose(purpose));
  }
  const requestedRuntimes = hasRuntimes
    ? request.runtimes
    : request.runtime;
  return uniqueStrings((Array.isArray(requestedRuntimes) ? requestedRuntimes : [requestedRuntimes])
    .map(normalizeText)
    .filter(Boolean));
}

function normalizeVibe64CommandRequest(input = {}) {
  const request = recordValue(input);
  const command = normalizeText(request.command);
  if (!command) {
    throw commandRequestError("A command is required.", "vibe64_command_required");
  }
  const mode = normalizeEnum(request.mode, VIBE64_COMMAND_MODES, "capture", "mode");
  const baseEnv = envRecord(request.baseEnv);
  const normalizedEnv = normalizeCommandEnv(request.env !== undefined ? request.env : request.extraEnv, {
    mode
  });
  const purpose = normalizeEnum(request.purpose, VIBE64_COMMAND_PURPOSES, "terminal", "purpose");
  const runtimes = normalizeRequestedRuntimes(request, purpose);
  for (const runtime of runtimes) {
    if (!VIBE64_COMMAND_RUNTIMES.includes(runtime)) {
      throw commandRequestError(`Unsupported Vibe64 runtime: ${runtime}.`, "vibe64_command_runtime_unsupported");
    }
  }
  return {
    actor: normalizeEnum(request.actor, VIBE64_COMMAND_ACTORS, "daemon", "actor"),
    allowedRoots: normalizeAbsolutePaths(request.allowedRoots),
    args: normalizeCommandArgs(request.args, {
      mode
    }),
    baseEnv,
    command,
    cwd: normalizeAbsolutePath(request.cwd || process.cwd()),
    env: normalizedEnv.env,
    envFactory: normalizedEnv.envFactory,
    envPolicy: normalizeEnum(request.envPolicy, VIBE64_COMMAND_ENV_POLICIES, "session", "env_policy"),
    credentialHome: normalizeCredentialHome(request.credentialHome),
    gitAuthToken: normalizeText(request.gitAuthToken || request.gitCredentials?.token),
    gitSafeDirectories: normalizeAbsolutePaths(request.gitSafeDirectories || request.safeDirectories),
    gitTransport: normalizeEnum(request.gitTransport, VIBE64_COMMAND_GIT_TRANSPORTS, request.githubTransport ? "github-https" : "none", "git_transport"),
    input: request.stdin ?? request.input,
    logPath: normalizeAbsolutePath(request.logPath),
    maxBuffer: Number.isSafeInteger(Number(request.maxBuffer)) && Number(request.maxBuffer) > 0
      ? Number(request.maxBuffer)
      : DEFAULT_COMMAND_MAX_BUFFER_BYTES,
    mode,
    onOutput: typeof request.onOutput === "function" ? request.onOutput : null,
    outputEncoding: normalizeEnum(
      request.outputEncoding,
      VIBE64_COMMAND_OUTPUT_ENCODINGS,
      "utf8",
      "output_encoding"
    ),
    project: recordValue(request.project),
    purpose,
    runtimes,
    session: recordValue(request.session),
    shimDirs: normalizeAbsolutePaths(request.shimDirs),
    terminal: normalizeTerminalOptions(request.terminal || request.pty),
    timeout: Number.isSafeInteger(Number(request.timeout)) && Number(request.timeout) > 0
      ? Number(request.timeout)
      : 15_000,
    userKey: normalizeText(request.userKey)
  };
}

export {
  DEFAULT_COMMAND_MAX_BUFFER_BYTES,
  RESERVED_CALLER_ENV_NAMES,
  VIBE64_COMMAND_ACTORS,
  VIBE64_COMMAND_ENV_POLICIES,
  VIBE64_COMMAND_GIT_TRANSPORTS,
  VIBE64_COMMAND_MODES,
  VIBE64_COMMAND_PURPOSES,
  VIBE64_COMMAND_RUNTIMES,
  normalizeVibe64CommandRequest,
  rejectCallerEnvPolicy
};
