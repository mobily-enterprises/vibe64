import {
  CodexAppServerAgentProvider as SharedCodexAppServerAgentProvider,
  CODEX_APP_SERVER_INVALID_REQUEST_CODE,
  assertCodexAuthPreflightReady as assertNativeCodexAuthPreflightReady,
  codexAppServerEndpointForTarget, codexAppServerRequestIsInvalid,
  codexCliResumeCommand as nativeCodexCliResumeCommand, codexTextInput, codexTurnInput, shellQuote
} from "@jskit-ai/assistant-core/server/codex-provider";
import { createCodexAccountReader } from "@jskit-ai/assistant-core/server/codex-configuration";
import {
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_RUNTIME_DIR_NAME,
  CODEX_APP_SERVER_TRANSPORT,
  codexAppServerExecutionMode,
  codexAppServerHelperHomeDir,
  codexAppServerHelperWorkspaceDir,
  codexAppServerIsHelper,
  createCodexAppServerRuntime,
  normalizeCodexAppServerTerminalEnv
} from "@jskit-ai/assistant-core/server/codex-process";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

import {
  CODEX_AUTH_RECONNECTING_CODE,
  CODEX_AUTH_RECONNECTING_MESSAGE,
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE,
  codexAuthOutputRequiresReconnect,
  codexAuthStateSignature,
  markCodexReconnectRequired,
  readCodexAuthStatus,
  readCodexLoginId
} from "@local/vibe64-core/server/codexAuthState";
import {
  runVibe64Command as defaultCommandRunner,
  stableHash,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64ManagedExecutionProvider,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  AGENT_PROVIDER_IDS,
  normalizeAgentText
} from "./agentProviders.js";
import {
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "./codexAttachmentPaths.js";

const CODEX_APP_SERVER_PROVIDER_ID = AGENT_PROVIDER_IDS.CODEX_APP_SERVER;
const CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE = "vibe64_codex_model_catalog_invalid";
const CODEX_APP_SERVER_RUNTIME_BUSY_CODE = "vibe64_codex_app_server_runtime_busy";
const CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV = "VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN";
const CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV = "VIBE64_CODEX_APP_SERVER_COMMAND_HASH";
const CODEX_APP_SERVER_SESSION_COMMAND_HOOK_PATH = fileURLToPath(
  new URL("./agentSessionCommandHook.js", import.meta.url)
);
const CODEX_APP_SERVER_PROCESS_PATH = fileURLToPath(new URL("./codexAppServerProcess.js", import.meta.url));
const CODEX_APP_SERVER_CLIENT_VERSION = "0.1.0";
const CODEX_APP_SERVER_EXECUTION_MODES = Object.freeze({
  HELPER: "helper",
  INTERACTIVE: "interactive"
});
const VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV = "VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR";

// Keep the established identity hashes and public errors while JSKIT owns the parser.
const codexAccountReader = createCodexAccountReader({
  errorPrefix: "vibe64_",
  identityNamespace: "vibe64-codex-account-v1",
  secretNamespace: "vibe64-codex-auth-secret-v1"
});
const codexAppServerHelperAuthError = codexAccountReader.error;
const codexAccountIdentitySignature = codexAccountReader.identitySignature;
const readBoundedCodexAuthJson = codexAccountReader.readRecord;
const readCodexSelectedAccountAuth = codexAccountReader.readSelected;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function readCodexSelectedAccountAccess(options = {}) {
  const toolHomeSource = normalizeAgentText(options.toolHomeSource);
  if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
    throw codexAppServerHelperAuthError(
      "vibe64_codex_helper_auth_unavailable",
      "The selected Codex account is unavailable. Reconnect Codex and retry."
    );
  }
  const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
  const authMode = normalizeAgentText(auth.auth_mode).toLowerCase();
  if (!["chatgpt", "apikey", "api_key"].includes(authMode)) {
    throw codexAppServerHelperAuthError(
      "vibe64_codex_helper_auth_invalid",
      "The selected Codex authentication mode is unsupported. Reconnect Codex and retry."
    );
  }
  const ownerOnly = authMode === "chatgpt";
  const endpointCode = ownerOnly ? "codex_subscription" : "openai_api";
  const loginId = options.systemRoot ? await readCodexLoginId(options.systemRoot) : "";
  return Object.freeze({
    connectionIdentity: loginId ? codexAccountIdentitySignature("vibe64-login", loginId) : "",
    endpointCode,
    ownerOnly
  });
}

async function currentCodexAccountIdentitySignature(options = {}, { includeInteractive = false } = {}) {
  if (options.modelProviderId && options.modelProviderId !== "openai") {
    const config = await readFile(path.join(options.toolHomeSource, ".codex", "config.toml"), "utf8");
    return `sha256:${createHash("sha256").update(config).digest("hex")}`;
  }
  const explicit = normalizeAgentText(options.accountIdentitySignature);
  if (explicit) {
    return explicit;
  }
  if (!codexAppServerIsHelper(options)) {
    if (!includeInteractive) {
      return "";
    }
    await assertCodexAuthGenerationCurrent("", options);
    const loginId = await readCodexLoginId(options.systemRoot);
    if (!loginId) {
      throw codexAppServerHelperAuthError(
        "vibe64_codex_login_identity_unavailable",
        "Codex login identity is unavailable. Run the Vibe64 state upgrades with the service stopped, or sign in again."
      );
    }
    // This identifies a Vibe64 login, never an OpenAI account or workspace.
    return codexAccountIdentitySignature("vibe64-login", loginId);
  }
  return (await readCodexSelectedAccountAuth(options)).identitySignature;
}

function hasOwn(object = {}, property = "") {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function runtimeEnvValue(env = {}, hostEnv = process.env, name = "") {
  const primaryEnv = isPlainObject(env) ? env : {};
  const fallbackEnv = isPlainObject(hostEnv) ? hostEnv : {};
  return normalizeAgentText(hasOwn(primaryEnv, name) ? primaryEnv[name] : fallbackEnv[name]);
}

function processUid() {
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

function codexAppServerRuntimeBaseDir({
  env = process.env,
  hostEnv = process.env
} = {}) {
  const explicitDir = runtimeEnvValue(env, hostEnv, "VIBE64_AGENT_RUNTIME_DIR");
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  const xdgRuntimeDir = runtimeEnvValue(env, hostEnv, "XDG_RUNTIME_DIR");
  if (xdgRuntimeDir && path.isAbsolute(xdgRuntimeDir)) {
    return path.join(xdgRuntimeDir, "vibe64", "agent-providers");
  }
  const homeDir = normalizeAgentText(os.homedir());
  if (homeDir && path.isAbsolute(homeDir)) {
    return path.join(homeDir, ".cache", "vibe64", "agent-providers");
  }
  return path.join(os.tmpdir(), `vibe64-${processUid()}`, "agent-providers");
}

function codexAppServerRuntimeScope({
  executionRoot = "",
  workdir = ""
} = {}) {
  const normalizedExecutionRoot = normalizeAgentText(executionRoot);
  if (normalizedExecutionRoot) {
    return path.resolve(normalizedExecutionRoot);
  }
  const normalizedWorkdir = normalizeAgentText(workdir);
  return normalizedWorkdir ? path.resolve(normalizedWorkdir) : "";
}

function codexAppServerRuntimeIdentityScope(options = {}) {
  const scope = codexAppServerRuntimeScope(options);
  if (!scope && !options.modelProviderId) {
    return "";
  }
  const namespace = runtimeNamespace();
  const runtimeInstanceId = normalizeAgentText(options.runtimeInstanceId);
  const executionMode = codexAppServerExecutionMode(options);
  return [
    namespace ? `namespace:${namespace}` : "",
    `scope:${scope}`,
    options.modelProviderId ? `provider:${options.modelProviderId}` : "",
    runtimeInstanceId ? `instance:${runtimeInstanceId}` : "",
    executionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
      ? `mode:${executionMode}`
      : ""
  ].filter(Boolean).join("\n");
}

function codexAppServerRuntimeDir(options = {}) {
  const scope = codexAppServerRuntimeIdentityScope(options);
  const dirName = scope
    ? `${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-${stableHash(scope)}`
    : CODEX_APP_SERVER_RUNTIME_DIR_NAME;
  return path.join(codexAppServerRuntimeBaseDir(options), dirName);
}

async function currentCodexAuthStateSignature(options = {}) {
  const signature = normalizeAgentText(options.authStateSignature);
  if (signature) {
    return signature;
  }
  return codexAuthStateSignature({
    systemRoot: options.systemRoot
  });
}

async function assertCodexAuthGenerationCurrent(capturedSignature = "", options = {}) {
  const systemRoot = normalizeAgentText(options.systemRoot);
  if (!systemRoot) {
    return normalizeAgentText(capturedSignature);
  }
  const authStatus = await readCodexAuthStatus(systemRoot);
  if (authStatus?.status === "reconnecting") {
    const error = new Error(authStatus.message || CODEX_AUTH_RECONNECTING_MESSAGE);
    error.code = authStatus.code || CODEX_AUTH_RECONNECTING_CODE;
    error.retryable = false;
    throw error;
  }
  if (authStatus?.status === "reconnect_required") {
    throw codexReconnectRequiredError({ modelProviderId: options.modelProviderId });
  }
  const currentSignature = await codexAuthStateSignature({
    systemRoot
  });
  if (
    normalizeAgentText(capturedSignature) &&
    normalizeAgentText(capturedSignature) !== currentSignature
  ) {
    const error = new Error("Codex authentication changed while the app-server was starting.");
    error.code = "vibe64_codex_auth_generation_changed";
    error.retryable = false;
    throw error;
  }
  return currentSignature;
}

function codexReconnectRequiredError({
  modelProviderId = "",
  cause = null,
  observed = ""
} = {}) {
  const provider = curatedCodexProvider(modelProviderId);
  const message = provider ? `Reconnect Codex - ${provider.label} in AI Accounts to continue.` : CODEX_RECONNECT_REQUIRED_MESSAGE;
  const code = provider ? "vibe64_codex_provider_reconnect_required" : CODEX_RECONNECT_REQUIRED_CODE;
  const error = new Error(message);
  error.code = code;
  error.errors = [
    {
      code,
      message
    }
  ];
  error.observed = provider ? "" : normalizeAgentText(observed);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function markCodexAppServerReconnectRequired(options = {}, {
  reason = "codex-app-server",
  observed = ""
} = {}) {
  await markCodexReconnectRequired(options.systemRoot, {
    reason
  });
  throw codexReconnectRequiredError({
    modelProviderId: options.modelProviderId, observed
  });
}

function codexAppServerEffectiveRuntimeInput(options = {}) {
  if (!codexAppServerIsHelper(options)) {
    return {
      project: options.project,
      runtimes: options.runtimes,
      session: options.session,
      terminalEnv: options.terminalEnv,
      toolHomeSource: options.toolHomeSource,
      userKey: options.userKey
    };
  }
  return {
    project: {},
    runtimes: [],
    session: {},
    terminalEnv: {},
    toolHomeSource: "",
    userKey: ""
  };
}

function codexAppServerControlGeneration(terminalEnv = {}) {
  const normalized = normalizeCodexAppServerTerminalEnv(terminalEnv);
  const generations = [
    normalized.VIBE64_CODEX_GIT_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_ENV_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_PREVIEW_COMMAND_GENERATION,
    normalized.VIBE64_AGENT_SESSION_COMMAND_GENERATION
  ].map(normalizeAgentText);
  return generations.every(Boolean)
    ? stableHash(JSON.stringify(generations))
    : "";
}

function codexAppServerShimDirs(terminalEnv = {}) {
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  return withGenesisCommandShim([
    normalizedTerminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  ].map(normalizeAgentText).filter(Boolean));
}

function codexAppServerRuntimes(runtimes = []) {
  const requested = Array.isArray(runtimes) ? runtimes : [];
  const values = [
    ...VIBE64_INTERACTIVE_RUNTIME_PACKS,
    ...requested
  ];
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeAgentText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function codexAppServerRuntimesHash(runtimes = []) {
  return stableHash(JSON.stringify(codexAppServerRuntimes(runtimes)));
}

function codexAppServerEffectiveRuntimesHash(options = {}) {
  if (codexAppServerIsHelper(options)) {
    return stableHash(JSON.stringify([]));
  }
  return codexAppServerRuntimesHash(options.runtimes);
}

function normalizeCodexAppServerContextRecord(value = {}) {
  return isPlainObject(value) ? value : {};
}

function codexAppServerExecutionContextHash({
  project = {},
  session = {},
  userKey = ""
} = {}) {
  return stableHash(JSON.stringify({
    project: normalizeCodexAppServerContextRecord(project),
    session: normalizeCodexAppServerContextRecord(session),
    userKey: normalizeAgentText(userKey)
  }));
}

function codexAppServerRuntimeHost(options = {}) {
  const helper = codexAppServerIsHelper(options);
  const effective = codexAppServerEffectiveRuntimeInput(options);
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(effective.terminalEnv);
  const normalizedRuntimes = codexAppServerRuntimes(helper ? [] : options.runtimes);
  const credentials = {
    identity: (native, context) => currentCodexAccountIdentitySignature({ ...options, ...native }, context),
    generation: (native) => currentCodexAuthStateSignature({ ...options, ...native }),
    assertCurrent: (signature) => assertCodexAuthGenerationCurrent(signature, options),
    reconnectRequiredCode: CODEX_RECONNECT_REQUIRED_CODE,
    markInvalid: ({ reason }) => markCodexReconnectRequired(options.systemRoot, { reason }),
    reconnectError: (fields) => codexReconnectRequiredError({ modelProviderId: options.modelProviderId, ...fields }),
    async observeFailure(logTail) {
      if (codexAuthOutputRequiresReconnect(logTail)) {
        await markCodexAppServerReconnectRequired(options, {
          observed: logTail, reason: "codex-app-server-start"
        });
      }
    }
  };
  const execution = {
    prepare: () => prepareCodexAttachmentRoot({ env: options.env }),
    stop: stopVibe64Execution,
    stopOwned: stopVibe64OwnedExecutions,
    get authoritative() { return Boolean(vibe64ManagedExecutionProvider()); },
    run({ processProfile, ...request }) {
      const { command, helper: profileHelper, executionMode, ...profile } = processProfile || {};
      const commandRunner = options.commandRunner === undefined ? defaultCommandRunner : options.commandRunner;
      if (request.mode === "capture") {
        return commandRunner({
          ...request,
          actor: "app",
          allowedRoots: request.cwd ? [request.cwd] : [],
          envPolicy: "auth",
          purpose: "codex",
          runtimes: codexAppServerRuntimes(options.runtimes),
          shimDirs: codexAppServerShimDirs(options.terminalEnv)
        });
      }
      return commandRunner({
        ...request,
        actor: "app",
        allowedRoots: request.cwd ? [request.cwd] : [],
        envPolicy: "auth",
        execution: {
          ...request.execution,
          controlGenerationId: helper ? "" : codexAppServerControlGeneration(normalizedTerminalEnv),
          ...(processProfile ? { resourceProfile: {
            key: helper ? "codex-helper" : "codex-app-server",
            environment: "development",
            compatibilityKey: createHash("sha256").update(JSON.stringify({
              command, helper: profileHelper, executionMode, runtimes: normalizedRuntimes, ...profile
            })).digest("hex")
          } } : {})
        },
        project: helper || options.project === undefined ? {} : options.project,
        purpose: "codex",
        runtimes: normalizedRuntimes,
        session: helper || options.session === undefined ? {} : options.session,
        shimDirs: helper ? [] : codexAppServerShimDirs(normalizedTerminalEnv),
        userKey: helper ? "" : normalizeAgentText(options.userKey)
      });
    }
  };
  const configuration = {
    clientInfo: { name: "vibe64", title: "Vibe64", version: CODEX_APP_SERVER_CLIENT_VERSION },
    historyClientInfo: { name: "vibe64-history-export", title: "Vibe64", version: CODEX_APP_SERVER_CLIENT_VERSION },
    controlEnvironmentPrefix: "VIBE64_",
    controlProbePrefix: "VIBE64_CONTROL_CHECK_",
    accountReader: { identityNamespace: "vibe64-codex-account-v1", secretNamespace: "vibe64-codex-auth-secret-v1" },
    commandHookCommand: [process.execPath, CODEX_APP_SERVER_SESSION_COMMAND_HOOK_PATH].map(shellQuote).join(" "),
    errorPrefix: "vibe64_",
    modelCatalogEnvironmentName: "VIBE64_CODEX_MODEL_CATALOG_SOURCE",
    processLabel: "vibe64-codex-app-server",
    processPath: CODEX_APP_SERVER_PROCESS_PATH,
    runtimeTokenEnvironmentName: CODEX_APP_SERVER_PROCESS_RUNTIME_TOKEN_ENV,
    commandHashEnvironmentName: CODEX_APP_SERVER_PROCESS_COMMAND_HASH_ENV,
    socketPathHelp: "Configure VIBE64_AGENT_RUNTIME_DIR or XDG_RUNTIME_DIR to a shorter host runtime directory.",
    umask: "0007"
  };
  const runtime = createCodexAppServerRuntime({ credentials, execution, configuration });
  const parameters = {
    accountIdentitySignature: options.accountIdentitySignature,
    authStateSignature: options.authStateSignature,
    codexCommand: options.codexCommand === undefined ? STUDIO_MANAGED_CODEX_COMMAND : options.codexCommand,
    env: options.env,
    executionRoot: options.executionRoot,
    executionMode: options.executionMode,
    killTimeoutMs: options.killTimeoutMs,
    processIdentityInspector: options.processIdentityInspector,
    processGroupIsAlive: options.processGroupIsAlive,
    readyTimeoutMs: options.readyTimeoutMs,
    livenessTimeoutMs: options.livenessTimeoutMs,
    timeoutMs: options.timeoutMs,
    signalProcessGroup: options.signalProcessGroup,
    stopExecution: options.stopExecution,
    terminalEnv: options.terminalEnv,
    termTimeoutMs: options.termTimeoutMs,
    toolHomeSource: options.toolHomeSource,
    WebSocketImpl: options.WebSocketImpl,
    workdir: options.workdir,
    runtimeDir: options.runtimeDir,
    runtimeMetadataWriter: options.runtimeMetadataWriter,
    socketOwnerDrained: options.socketOwnerDrained,
    preserveProcessExitProof: options.preserveProcessExitProof,
    expectedAccountIdentitySignature: options.expectedAccountIdentitySignature,
    ownedRuntime: options.ownedRuntime,
    verifyOwnerScope: options.verifyOwnerScope,
    reason: options.reason,
    ownerId: normalizeAgentText(options.runtimeInstanceId || options.session?.sessionId || options.session?.id),
    providerHome: Boolean(curatedCodexProvider(options.modelProviderId)),
    compatibility: {
      attachmentHostRoot: codexAttachmentHostRoot({ env: options.env }),
      executionContextHash: codexAppServerExecutionContextHash(effective),
      runtimesHash: codexAppServerEffectiveRuntimesHash(options)
    }
  };
  return {
    runtime, parameters, credentials, execution, configuration,
    log: (event, fields, { threadId, environment, connectionGeneration }) => logOperationalEvent(options.logger,
      event === "recovery_failed" ? "warn" : "info", {
        component: "vibe64.codex_controls", event: `vibe64.codex_controls.${event}`,
        threadId, sessionId: environment.VIBE64_AGENT_SESSION_COMMAND_SESSION_ID || "",
        generations: Object.fromEntries(Object.entries(environment).filter(([key, value]) =>
          key.endsWith("_COMMAND_GENERATION") && /^[0-9a-f-]{36}$/iu.test(value))),
        connectionGeneration, ...fields
      }, "Codex managed controls changed.")
  };
}

async function ensureCodexAppServerRuntime(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(options);
  return runtime.ensure({ ...parameters, runtimeDir: options.runtimeDir || codexAppServerRuntimeDir(options) });
}

async function startCodexAppServerProcess(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(options);
  return runtime.start({ ...parameters, runtimeDir: options.runtimeDir === undefined ? codexAppServerRuntimeDir({
    env: options.env, executionRoot: options.executionRoot,
    runtimeInstanceId: options.runtimeInstanceId, workdir: options.workdir
  }) : options.runtimeDir });
}

async function stopCodexAppServerRuntime(options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(options);
  return runtime.stop(parameters);
}

async function codexAppServerMetadataIsLive(metadata = {}, options = {}) {
  const { runtime, parameters } = codexAppServerRuntimeHost(options);
  return runtime.isLive(metadata, parameters);
}


class CodexAppServerAgentProvider extends SharedCodexAppServerAgentProvider {
  constructor(options = {}) {
    const host = codexAppServerRuntimeHost(options);
    host.parameters.runtimeDir ||= codexAppServerRuntimeDir(options);
    super(options, host);
  }
}

async function assertCodexAuthPreflightReady(options = {}, { reason = "codex-auth-preflight" } = {}) {
  const { execution, credentials, parameters } = codexAppServerRuntimeHost(options);
  return assertNativeCodexAuthPreflightReady({ ...options, codexCommand: parameters.codexCommand }, { reason, execution, credentials });
}

function codexCliResumeCommand(options = {}) {
  return nativeCodexCliResumeCommand({
    ...options,
    codexCommand: normalizeAgentText(options.codexCommand) || STUDIO_MANAGED_CODEX_COMMAND
  });
}

function createCodexAppServerAgentProvider(options = {}) {
  return new CodexAppServerAgentProvider(options);
}

export {
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_INVALID_REQUEST_CODE,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  CODEX_APP_SERVER_TRANSPORT,
  CodexAppServerAgentProvider,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerHelperHomeDir,
  codexAppServerHelperWorkspaceDir,
  codexAppServerMetadataIsLive,
  codexAppServerRequestIsInvalid,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost,
  currentCodexAccountIdentitySignature,
  readCodexSelectedAccountAccess,
  codexCliResumeCommand,
  codexTextInput,
  codexTurnInput,
  createCodexAppServerAgentProvider,
  ensureCodexAppServerRuntime,
  startCodexAppServerProcess,
  stopCodexAppServerRuntime
};
