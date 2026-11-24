import { randomUUID } from "node:crypto";

import {
  envRecord,
  normalizeAbsolutePath,
  normalizeText,
  recordValue,
  uniqueStrings
} from "./normalize.js";
import { rejectCallerEnvPolicy } from "./env/callerEnv.js";
import {
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "./runtime/runtimePacks.js";

const VIBE64_COMMAND_ACTORS = Object.freeze([
  "daemon",
  "owner-user",
  "named-user",
  "app"
]);
// A host may run an application under its own registered OS account instead of
// the editor's account; only that host's privileged helper can switch to it.
const STAGING_ACCOUNT_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/u;
const VIBE64_COMMAND_PURPOSES = Object.freeze([
  "account",
  "assistant",
  "terminal",
  "codex",
  "github",
  "github-api",
  "source-editor",
  "preview",
  "output",
  "staging",
  "health",
  "workspace-cache",
  "source"
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
  "staging"
]);
// "anonymous" reaches a remote with no credential: no Vibe64 one and none of
// Git's own credential helpers.
const VIBE64_COMMAND_GIT_TRANSPORTS = Object.freeze([
  "none",
  "anonymous",
  "github-https",
  "github-token"
]);
// Who a command's Git commits name: the session's person, as every command
// gets by default, or "none" for plain local Git in a session's temporary
// folder, where the command's own GIT_AUTHOR_* and GIT_COMMITTER_* (or Git's
// own configuration) decide.
const VIBE64_COMMAND_GIT_IDENTITIES = Object.freeze([
  "session",
  "none"
]);
const VIBE64_EXECUTION_KINDS = Object.freeze([
  "assistant",
  "browser",
  "control",
  "job",
  "preview",
  "service",
  "terminal"
]);
const VIBE64_EXECUTION_LIFECYCLES = Object.freeze([
  "finite",
  "interactive",
  "service"
]);
const DEFAULT_COMMAND_MAX_BUFFER_BYTES = 1000 * 1000 * 100;
const DEFAULT_INTERACTIVE_RUNTIME_PURPOSES = new Set([
  "assistant",
  "codex",
  "staging",
  "output",
  "preview",
  "source",
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

function normalizeCommandArgs(args = [], options = {}) {
  const {
    mode = "capture"
  } = options;
  // readable-check: allow method-probe - input validation: arguments are a list or a function of the command input
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

function normalizeCommandEnv(envInput = {}, options = {}) {
  const {
    mode = "capture"
  } = options;
  // readable-check: allow method-probe - input validation: a command's env is a record or a function of the command input
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
    helperPayloadRoot: normalizeAbsolutePath(terminal.helperPayloadRoot),
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
    cacheRoot: normalizeAbsolutePath(credentialHome.cacheRoot),
    configRoot: normalizeAbsolutePath(credentialHome.configRoot),
    dataRoot: normalizeAbsolutePath(credentialHome.dataRoot),
    gid: Number.isSafeInteger(Number(credentialHome.gid ?? credentialHome.hostGid))
      ? Number(credentialHome.gid ?? credentialHome.hostGid)
      : null,
    home,
    scope: normalizeText(credentialHome.scope),
    stateRoot: normalizeAbsolutePath(credentialHome.stateRoot),
    uid: Number.isSafeInteger(Number(credentialHome.uid ?? credentialHome.hostUid))
      ? Number(credentialHome.uid ?? credentialHome.hostUid)
      : null,
    username: normalizeText(credentialHome.username || credentialHome.ownerUserKey || credentialHome.userKey)
  };
}

function defaultExecutionLifecycle(mode = "capture") {
  if (mode === "detached") {
    return "service";
  }
  if (mode === "pty") {
    return "interactive";
  }
  return "finite";
}

function defaultExecutionKind({
  mode = "capture",
  purpose = "terminal"
} = {}) {
  if (purpose === "preview") {
    return "preview";
  }
  if (mode === "pty") {
    return "terminal";
  }
  return "job";
}

function normalizeExecutionIdentifier(value = "") {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254}[A-Za-z0-9])?$/u.test(normalized)) {
    throw commandRequestError(
      `Invalid Vibe64 execution identifier: ${normalized}.`,
      "vibe64_execution_identifier_invalid"
    );
  }
  return normalized;
}

function normalizeExecutionDescriptor(value = {}, options = {}) {
  const {
    mode = "capture",
    project = {},
    purpose = "terminal",
    session = {}
  } = options;
  const execution = recordValue(value);
  const kind = normalizeEnum(
    execution.kind,
    VIBE64_EXECUTION_KINDS,
    defaultExecutionKind({ mode, purpose }),
    "execution_kind"
  );
  const lifecycle = normalizeEnum(
    execution.lifecycle,
    VIBE64_EXECUTION_LIFECYCLES,
    defaultExecutionLifecycle(mode),
    "execution_lifecycle"
  );
  if (
    (mode === "detached" && lifecycle !== "service") ||
    (mode === "pty" && lifecycle !== "interactive") ||
    (mode === "capture" && lifecycle !== "finite")
  ) {
    throw commandRequestError(
      `Execution lifecycle ${lifecycle} is incompatible with command mode ${mode}.`,
      "vibe64_execution_lifecycle_incompatible"
    );
  }
  const ownerId = normalizeExecutionIdentifier(
    execution.ownerId || session.sessionId
  );
  if (lifecycle === "service" && !ownerId) {
    throw commandRequestError(
      "Service execution requires a durable owner id.",
      "vibe64_execution_owner_required"
    );
  }
  const resourceProfile = execution.resourceProfile;
  if (resourceProfile != null && (!resourceProfile || typeof resourceProfile !== "object" ||
      Object.keys(resourceProfile).some((key) => !["key", "compatibilityKey", "environment"].includes(key)) ||
      !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(resourceProfile.key || "") ||
      !/^[a-f0-9]{64}$/u.test(resourceProfile.compatibilityKey || "") ||
      !["development", "test", "staging"].includes(resourceProfile.environment))) {
    throw commandRequestError("Invalid activity resource profile identity.", "vibe64_resource_profile_invalid");
  }
  return Object.freeze({
    ...(resourceProfile ? { resourceProfile: Object.freeze({ ...resourceProfile }) } : {}),
    controlGenerationId: normalizeExecutionIdentifier(execution.controlGenerationId),
    ...(execution.workflowId === undefined || execution.workflowId === null || execution.workflowId === ""
      ? {} : { workflowId: normalizeWorkflowId(execution.workflowId) }),
    id: randomUUID(),
    kind,
    label: normalizeText(execution.label),
    lifecycle,
    operationId: normalizeExecutionIdentifier(execution.operationId),
    ownerId,
    parentExecutionId: normalizeExecutionIdentifier(execution.parentExecutionId),
    projectSlug: normalizeExecutionIdentifier(
      execution.projectSlug || project.slug || project.projectSlug
    ),
    sessionId: normalizeExecutionIdentifier(
      execution.sessionId || session.sessionId
    )
  });
}

function normalizeWorkflowId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value)) {
    throw commandRequestError("Execution requires a valid managed workflow id.", "vibe64_workflow_id_invalid");
  }
  return value.toLowerCase();
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
  if (request.signal != null && (!(request.signal instanceof AbortSignal) || mode !== "capture")) {
    throw commandRequestError("Cancellation signals require a finite capture command.", "vibe64_command_signal_invalid");
  }
  const baseEnv = envRecord(request.baseEnv);
  const normalizedEnv = normalizeCommandEnv(request.env, {
    mode
  });
  const purpose = normalizeEnum(request.purpose, VIBE64_COMMAND_PURPOSES, "terminal", "purpose");
  const runtimes = normalizeRequestedRuntimes(request, purpose);
  for (const runtime of runtimes) {
    if (!Object.hasOwn(RUNTIME_PACKS, runtime)) {
      throw commandRequestError(`Unsupported Vibe64 runtime: ${runtime}.`, "vibe64_command_runtime_unsupported");
    }
  }
  const project = recordValue(request.project);
  const session = recordValue(request.session);
  const stagingEnvironmentFile = request.stagingEnvironmentFile ?? "";
  if (typeof stagingEnvironmentFile !== "string" || (stagingEnvironmentFile && (!stagingEnvironmentFile.startsWith("/") ||
      /[\r\n\0]/u.test(stagingEnvironmentFile) ||
      mode !== "capture" || request.actor !== "app" || request.envPolicy !== "staging" ||
      Object.keys(normalizedEnv.env).length || normalizedEnv.envFactory || Object.keys(baseEnv).length))) {
    throw commandRequestError(
      "Staging environment files require a finite staging command without caller Env.",
      "vibe64_command_staging_environment_invalid"
    );
  }
  // A usage recording launch names the recorder's Node preload; Vibe64 or its
  // host helper turns it into NODE_OPTIONS only after checking the file.
  const usageRecordingPreload = request.usageRecordingPreload ?? "";
  if (typeof usageRecordingPreload !== "string" || (usageRecordingPreload &&
      (!usageRecordingPreload.startsWith("/") || /[\s"'\\\0]/u.test(usageRecordingPreload) ||
      !["preview", "output"].includes(purpose) || request.actor === "app"))) {
    throw commandRequestError(
      "A usage recording preload belongs only to a Preview or Output target launch.",
      "vibe64_command_usage_recording_preload_invalid"
    );
  }
  // A usage recording launch completes its recorder's variables from the environment the gateway resolves for it (the
  // PATH its target runs with): a function of that environment, called by Vibe64 for each environment it resolves.
  const usageRecordingEnvironment = request.usageRecordingEnvironment ?? null;
  // readable-check: allow method-probe - input validation: the completion is a function of the resolved environment
  if (usageRecordingEnvironment !== null && (typeof usageRecordingEnvironment !== "function" ||
      !["preview", "output"].includes(purpose) || request.actor === "app")) {
    throw commandRequestError(
      "A usage recording environment belongs only to a Preview or Output target launch.",
      "vibe64_command_usage_recording_environment_invalid"
    );
  }
  const stagingAccount = request.stagingAccount ?? "";
  if (typeof stagingAccount !== "string" || (stagingAccount &&
      (!STAGING_ACCOUNT_PATTERN.test(stagingAccount) || request.actor !== "app" || mode !== "capture"))) {
    throw commandRequestError("Staging accounts run only finite application commands.", "vibe64_command_staging_account_invalid");
  }
  // What the application's release allows its sandbox; the host helper grants
  // each allowance only where the host's owner permits it.
  const sandboxAllowances = request.sandboxAllowances ?? [];
  if (!Array.isArray(sandboxAllowances) ||
      sandboxAllowances.some((name) => typeof name !== "string" || !/^[a-z][a-z0-9-]*$/u.test(name)) ||
      new Set(sandboxAllowances).size !== sandboxAllowances.length ||
      (sandboxAllowances.length > 0 && !stagingAccount)) {
    throw commandRequestError(
      "Sandbox allowances belong only to a staging account's own commands.",
      "vibe64_command_sandbox_allowances_invalid"
    );
  }
  // A session's own temporary folder, the command's TMPDIR; the gateway and
  // the host helper own TMPDIR, so no caller Env can name it.
  const tempDirectory = request.tempDirectory ?? "";
  if (typeof tempDirectory !== "string" || (tempDirectory && (!tempDirectory.startsWith("/") ||
      /[\r\n\0]/u.test(tempDirectory) || stagingAccount || request.envPolicy === "staging"))) {
    throw commandRequestError(
      "A temporary folder belongs only to a session's own commands and must be an absolute path.",
      "vibe64_command_temp_directory_invalid"
    );
  }
  return {
    actor: normalizeEnum(request.actor, VIBE64_COMMAND_ACTORS, "daemon", "actor"),
    stagingAccount,
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
    stagingEnvironmentFile,
    sandboxAllowances: [...sandboxAllowances],
    tempDirectory: normalizeAbsolutePath(tempDirectory),
    execution: normalizeExecutionDescriptor(request.execution, {
      mode,
      project,
      purpose,
      session
    }),
    credentialHome: normalizeCredentialHome(request.credentialHome),
    gitAuthToken: normalizeText(request.gitAuthToken),
    gitIdentity: normalizeEnum(request.gitIdentity, VIBE64_COMMAND_GIT_IDENTITIES, "session", "git_identity"),
    gitSafeDirectories: normalizeAbsolutePaths(request.gitSafeDirectories),
    personGitIdentity: {
      email: normalizeText(request.personGitIdentity?.email),
      name: normalizeText(request.personGitIdentity?.name)
    },
    gitTransport: normalizeEnum(request.gitTransport, VIBE64_COMMAND_GIT_TRANSPORTS, "none", "git_transport"),
    inheritProcessEnv: !stagingEnvironmentFile && request.inheritProcessEnv !== false,
    input: request.input,
    logPath: normalizeAbsolutePath(request.logPath),
    maxBuffer: Number.isSafeInteger(Number(request.maxBuffer)) && Number(request.maxBuffer) > 0
      ? Number(request.maxBuffer)
      : DEFAULT_COMMAND_MAX_BUFFER_BYTES,
    mode,
    // readable-check: allow method-probe - input validation: a request's optional output observer
    onOutput: typeof request.onOutput === "function" ? request.onOutput : null,
    outputEncoding: normalizeEnum(
      request.outputEncoding,
      VIBE64_COMMAND_OUTPUT_ENCODINGS,
      "utf8",
      "output_encoding"
    ),
    project,
    purpose,
    runtimes,
    session,
    signal: request.signal ?? null,
    shimDirs: normalizeAbsolutePaths(request.shimDirs),
    terminal: normalizeTerminalOptions(request.terminal),
    timeout: Number.isSafeInteger(Number(request.timeout)) && Number(request.timeout) > 0
      ? Number(request.timeout)
      : 15_000,
    usageRecordingEnvironment,
    usageRecordingPreload,
    userKey: normalizeText(request.userKey)
  };
}

const __testables = Object.freeze({ normalizeExecutionDescriptor });

export {
  DEFAULT_COMMAND_MAX_BUFFER_BYTES,
  normalizeVibe64CommandRequest,
  __testables
};
