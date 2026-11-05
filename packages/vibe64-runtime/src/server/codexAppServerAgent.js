import {
  CodexAppServerAgentProvider as SharedCodexAppServerAgentProvider,
  assertCodexAuthPreflightReady as assertNativeCodexAuthPreflightReady,
  codexAppServerEndpointForTarget, codexCliResumeCommand as nativeCodexCliResumeCommand, shellQuote
} from "@jskit-ai/assistant-core/server/codex-provider";
import { createCodexAccountReader } from "@jskit-ai/assistant-core/server/codex-configuration";
import {
  CODEX_APP_SERVER_RUNTIME_DIR_NAME,
  codexAppServerExecutionMode,
  codexAppServerIsHelper,
  createCodexAppServerRuntime,
  normalizeCodexAppServerTerminalEnv
} from "@jskit-ai/assistant-core/server/codex-process";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { codexAppServerRuntimeBaseDir } from "./agentProviderRuntimePaths.js";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isPlainObject } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

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
  operatorCliCommand,
  runVibe64Command as defaultCommandRunner,
  stableHash,
  stopVibe64Execution,
  stopVibe64OwnedExecutions,
  vibe64ManagedExecutionProvider,
  vibe64ProcessUmask,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";
import { withGenesisCommandShim } from "@local/vibe64-genesis/server";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { AGENT_PROVIDER_IDS } from "./agentProviders.js";
import {
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "./codexAttachmentPaths.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

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

async function readCodexSelectedAccountAccess(options = {}) {
  const toolHomeSource = toText(options.toolHomeSource);
  if (!toolHomeSource || !path.isAbsolute(toolHomeSource)) {
    throw codexAppServerHelperAuthError(
      "vibe64_codex_helper_auth_unavailable",
      "The selected Codex account is unavailable. Reconnect Codex and retry.",
      { messageCode: "assistant.codex.accountUnavailable" }
    );
  }
  const auth = await readBoundedCodexAuthJson(path.join(toolHomeSource, ".codex", "auth.json"));
  const authMode = toText(auth.auth_mode).toLowerCase();
  if (!["chatgpt", "apikey", "api_key"].includes(authMode)) {
    throw codexAppServerHelperAuthError(
      "vibe64_codex_helper_auth_invalid",
      "The selected Codex authentication mode is unsupported. Reconnect Codex and retry.",
      { messageCode: "assistant.codex.authModeUnsupported" }
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

async function currentCodexAccountIdentitySignature(providerOptions = {}, options = {}) {
  const { includeInteractive = false } = options;
  if (providerOptions.modelProviderId && providerOptions.modelProviderId !== "openai") {
    const config = await readFile(path.join(providerOptions.toolHomeSource, ".codex", "config.toml"), "utf8");
    return `sha256:${createHash("sha256").update(config).digest("hex")}`;
  }
  const explicit = toText(providerOptions.accountIdentitySignature);
  if (explicit) {
    return explicit;
  }
  if (!codexAppServerIsHelper(providerOptions)) {
    if (!includeInteractive) {
      return "";
    }
    await assertCodexAuthGenerationCurrent("", providerOptions);
    const loginId = await readCodexLoginId(providerOptions.systemRoot);
    if (!loginId) {
      throw codexAppServerHelperAuthError(
        "vibe64_codex_login_identity_unavailable",
        "Codex login identity is unavailable. Run the Vibe64 state upgrades with the service stopped, or sign in again."
      );
    }
    // This identifies a Vibe64 login, never an OpenAI account or workspace.
    return codexAccountIdentitySignature("vibe64-login", loginId);
  }
  return (await readCodexSelectedAccountAuth(providerOptions)).identitySignature;
}

function codexAppServerRuntimeScope({
  executionRoot = "",
  workdir = ""
} = {}) {
  const normalizedExecutionRoot = toText(executionRoot);
  if (normalizedExecutionRoot) {
    return path.resolve(normalizedExecutionRoot);
  }
  const normalizedWorkdir = toText(workdir);
  return normalizedWorkdir ? path.resolve(normalizedWorkdir) : "";
}

function codexAppServerRuntimeIdentityScope(options = {}) {
  const scope = codexAppServerRuntimeScope(options);
  const loginGeneration = toText(options.codexLoginGeneration);
  if (!scope && !options.modelProviderId && !loginGeneration && !toText(process.env[VIBE64_RUNTIME_NAMESPACE_ENV])) {
    return "";
  }
  const namespace = runtimeNamespace({ env: process.env });
  const runtimeInstanceId = toText(options.runtimeInstanceId);
  const executionMode = codexAppServerExecutionMode(options);
  return [
    namespace ? `namespace:${namespace}` : "",
    `scope:${scope}`,
    options.modelProviderId ? `provider:${options.modelProviderId}` : "",
    runtimeInstanceId ? `instance:${runtimeInstanceId}` : "",
    // Each sign-in has its own runtime directory, so a previous account's
    // runtime can finish its turn while new work starts on the current one.
    loginGeneration ? `login:${loginGeneration}` : "",
    executionMode === CODEX_APP_SERVER_EXECUTION_MODES.HELPER
      ? `mode:${executionMode}`
      : ""
  ].filter(Boolean).join("\n");
}

/**
 * A Codex app-server runtime's own directory, named by its scope, below the agent runtime root.
 * @param {object} options the runtime's provider options
 * @param {string} options.runtimeRoot the agent runtime root the server's env names (codexAppServerRuntimeBaseDir)
 */
function codexAppServerRuntimeDir(options) {
  const scope = codexAppServerRuntimeIdentityScope(options);
  const dirName = scope
    ? `${CODEX_APP_SERVER_RUNTIME_DIR_NAME}-${stableHash(scope)}`
    : CODEX_APP_SERVER_RUNTIME_DIR_NAME;
  return path.join(options.runtimeRoot, dirName);
}

async function currentCodexAuthStateSignature(options = {}) {
  const signature = toText(options.authStateSignature);
  if (signature) {
    return signature;
  }
  return codexAuthStateSignature({
    systemRoot: options.systemRoot
  });
}

async function assertCodexAuthGenerationCurrent(capturedSignature = "", options = {}) {
  const systemRoot = toText(options.systemRoot);
  if (!systemRoot) {
    return toText(capturedSignature);
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
    toText(capturedSignature) &&
    toText(capturedSignature) !== currentSignature
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
  error.observed = provider ? "" : toText(observed);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

async function markCodexAppServerReconnectRequired(providerOptions = {}, options = {}) {
  const {
    reason = "codex-app-server",
    observed = ""
  } = options;
  await markCodexReconnectRequired(providerOptions.systemRoot, {
    reason
  });
  throw codexReconnectRequiredError({
    modelProviderId: providerOptions.modelProviderId,
    observed
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
  ].map(toText);
  return generations.every(Boolean)
    ? stableHash(JSON.stringify(generations))
    : "";
}

function codexAppServerShimDirs(terminalEnv = {}) {
  const normalizedTerminalEnv = normalizeCodexAppServerTerminalEnv(terminalEnv);
  return withGenesisCommandShim([
    normalizedTerminalEnv[VIBE64_CODEX_GIT_COMMAND_WRAPPER_DIR_ENV]
  ].map(toText).filter(Boolean));
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
    const normalized = toText(value);
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
    userKey: toText(userKey)
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
          observed: logTail,
          reason: "codex-app-server-start"
        });
      }
    }
  };
  const execution = {
    prepare: () => prepareCodexAttachmentRoot({ env: options.env }),
    stop: stopVibe64Execution,
    stopOwned: stopVibe64OwnedExecutions,
    get authoritative() {
      return Boolean(vibe64ManagedExecutionProvider());
    },
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
          ...(processProfile ? {
            resourceProfile: {
              key: helper ? "codex-helper" : "codex-app-server",
              environment: "development",
              compatibilityKey: createHash("sha256").update(JSON.stringify({
                command,
                helper: profileHelper,
                executionMode,
                runtimes: normalizedRuntimes,
                ...profile
              })).digest("hex")
            }
          } : {})
        },
        project: helper || options.project === undefined ? {} : options.project,
        purpose: "codex",
        runtimes: normalizedRuntimes,
        session: helper || options.session === undefined ? {} : options.session,
        shimDirs: helper ? [] : codexAppServerShimDirs(normalizedTerminalEnv),
        userKey: helper ? "" : toText(options.userKey)
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
    umask: vibe64ProcessUmask()
  };
  const runtime = createCodexAppServerRuntime({
    credentials,
    execution,
    configuration
  });
  const parameters = {
    accountIdentitySignature: options.accountIdentitySignature,
    authStateSignature: options.authStateSignature,
    codexCommand: options.codexCommand === undefined ? operatorCliCommand("codex", { env: process.env }) : options.codexCommand,
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
    ownerId: toText(options.runtimeInstanceId || options.session?.sessionId),
    providerHome: Boolean(curatedCodexProvider(options.modelProviderId)),
    compatibility: {
      attachmentHostRoot: codexAttachmentHostRoot({ env: options.env }),
      executionContextHash: codexAppServerExecutionContextHash(effective),
      runtimesHash: codexAppServerEffectiveRuntimesHash(options)
    }
  };
  return { runtime, parameters, credentials, execution, configuration };
}

/**
 * How a Codex native host records its managed control changes: a failed
 * recovery or settings change at warn, everything else at info.
 * @param {RuntimeLogger} logger
 */
function codexAppServerControlsLog(logger) {
  return (event, fields, { threadId, environment = {}, connectionGeneration }) => logOperationalEvent(
    logger,
    ["recovery_failed", "settings_failed"].includes(event) ? "warn" : "info",
    {
      component: "vibe64.codex_controls",
      event: `vibe64.codex_controls.${event}`,
      threadId,
      sessionId: environment.VIBE64_AGENT_SESSION_COMMAND_SESSION_ID || "",
      generations: Object.fromEntries(Object.entries(environment).filter(([key, value]) =>
        key.endsWith("_COMMAND_GENERATION") && /^[0-9a-f-]{36}$/iu.test(value))),
      connectionGeneration,
      ...fields
    },
    "Codex managed controls changed."
  );
}

class CodexAppServerAgentProvider extends SharedCodexAppServerAgentProvider {
  constructor(options = {}) {
    const host = codexAppServerRuntimeHost(options);
    host.parameters.runtimeDir ||= codexAppServerRuntimeDir(options);
    super(options, host);
  }
}

async function assertCodexAuthPreflightReady(providerOptions = {}, options = {}) {
  const { reason = "codex-auth-preflight" } = options;
  const { execution, credentials, parameters } = codexAppServerRuntimeHost(providerOptions);
  return assertNativeCodexAuthPreflightReady(
    { ...providerOptions, codexCommand: parameters.codexCommand },
    { reason, execution, credentials }
  );
}

function codexCliResumeCommand(options = {}) {
  return nativeCodexCliResumeCommand({
    ...options,
    codexCommand: toText(options.codexCommand) || operatorCliCommand("codex", { env: process.env })
  });
}

function createCodexAppServerAgentProvider(options = {}) {
  return new CodexAppServerAgentProvider(options);
}

const __testables = Object.freeze({ CODEX_APP_SERVER_MODEL_CATALOG_ERROR_CODE });

export {
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_PROVIDER_ID,
  CODEX_APP_SERVER_RUNTIME_BUSY_CODE,
  assertCodexAuthPreflightReady,
  codexAppServerEndpointForTarget,
  codexAppServerControlsLog,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost,
  readCodexSelectedAccountAccess,
  codexCliResumeCommand,
  createCodexAppServerAgentProvider,
  __testables
};
