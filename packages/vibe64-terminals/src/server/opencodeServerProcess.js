import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  createVibe64ConversationExecution,
  isolatedProcessEnv,
  operatorCliCommand,
  runtimePackRoot,
  runVibe64Command,
  stableHash,
  stopVibe64Execution,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";

import { genesisParserEnvironment } from "@local/vibe64-genesis/server";
import { openCodeFingerprint } from "./openCodeConversationStorage.js";
import { throwVibe64OpenCodeError } from "./terminalShared.js";

import {
  OPENCODE_EXPECTED_VERSION,
  OPENCODE_HOST,
  OPENCODE_READY_TIMEOUT_MS,
  createOpenCodeServerProcess as startOpenCodeServer,
  openCodeProcessEnvironment,
  openCodeConversationAgents,
  openCodeApplicationToolSchemas,
  readOpenCodeCatalog as readNativeOpenCodeCatalog,
  readOpenCodeZenModelIds as readNativeOpenCodeZenModelIds,
  verifyOpenCodeApiKey as verifyNativeOpenCodeApiKey
} from "@jskit-ai/assistant-core/server/opencode-process";
import { normalizeText } from "@local/vibe64-core/server/core";
import { createOpenCodeHostPreparation, requireOpenCodeConnection } from "./openCodeHostPreparation.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").OpenCodeSharedRuntime} OpenCodeSharedRuntime */
/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {typeof import("./opencodeServerProcess.js").createOpenCodeServerProcess} CreateOpenCodeServerProcess */
/** @typedef {typeof import("@local/vibe64-execution/server").inspectVibe64Service} InspectVibe64Service */
/** @typedef {typeof import("./agentCommandEnvironment.js").prepareAgentSessionCommandEnvironment} PrepareAgentSessionCommandEnvironment */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */

const OPENCODE_HELPER_AGENT_ID = "vibe64-helper";
const OPENCODE_HELPER_SUBAGENT_PREFIX = "vibe64-helper-";
const OPENCODE_EPHEMERAL_AGENT_ID = "vibe64-ephemeral";
const OPENCODE_MANAGED_OUTPUT_TOKEN_MAX = 128 * 1024;
const OPENCODE_SESSION_ENVIRONMENT_PLUGIN_URL = new URL(
  "./opencodeSessionEnvironmentPlugin.js",
  import.meta.url
).href;
const OPENCODE_STARTUP_PREAMBLE = [
  "set -eu",
  "log_path=\"$1\"",
  "shift",
  ": > \"$log_path\"",
  "chmod 600 \"$log_path\"",
  "export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$"
];
const OPENCODE_STARTUP_EXEC = "exec \"$@\" </dev/null >>\"$log_path\" 2>&1";
// A managed host names each detached execution's private directory, which ends
// with the execution's receipt. The server keeps its home, configuration, data
// and state there, so a stop without this server's handle (after a Vibe64
// restart) still removes them. Without one it keeps the supplied private roots.
const OPENCODE_MANAGED_STARTUP_SCRIPT = [
  ...OPENCODE_STARTUP_PREAMBLE,
  "private_dir=\"${VIBE64_EXECUTION_PRIVATE_DIR:-}\"",
  "if [ -n \"$private_dir\" ]; then",
  "  export HOME=\"$private_dir/home\" XDG_CONFIG_HOME=\"$private_dir/config\" " +
    "XDG_DATA_HOME=\"$private_dir/data\" XDG_STATE_HOME=\"$private_dir/state\"",
  "  mkdir -m 700 \"$HOME\" \"$XDG_CONFIG_HOME\" \"$XDG_DATA_HOME\" \"$XDG_STATE_HOME\"",
  "fi",
  OPENCODE_STARTUP_EXEC
].join("\n");
// A server whose private roots were prepared before start keeps them.
const OPENCODE_SEEDED_STARTUP_SCRIPT = [...OPENCODE_STARTUP_PREAMBLE, OPENCODE_STARTUP_EXEC].join("\n");
const OPENCODE_INLINE_CONFIG_BASE = Object.freeze({
  agent: {
    [OPENCODE_HELPER_AGENT_ID]: {
      description: "Vibe64 bounded helper turns without tools.",
      hidden: true,
      mode: "primary",
      permission: {
        "*": "deny"
      }
    },
    [OPENCODE_EPHEMERAL_AGENT_ID]: {
      description: "Vibe64 host-supplied ephemeral conversations without tools.",
      hidden: true,
      mode: "primary",
      permission: {
        "*": "deny"
      }
    }
  },
  permission: {
    doom_loop: "deny",
    external_directory: "deny",
    question: "deny",
    read: {
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow"
    }
  },
  snapshot: false
});

async function readOpenCodeZenModelIds(options = {}) {
  try {
    return await readNativeOpenCodeZenModelIds(options);
  } catch (error) {
    if (error?.code === "assistant_opencode_zen_catalog_unavailable") {
      error.code = "vibe64_opencode_zen_catalog_unavailable";
    }
    throw error;
  }
}

function canonicalProviderUrl(value = "") {
  const source = normalizeText(value);
  if (!source) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.toString().replace(/\/$/u, "") !== source.replace(/\/$/u, "")
  ) {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  return source;
}

function openCodeHelperSubagents(providerConnections = []) {
  const agents = {};
  for (const connection of Array.isArray(providerConnections) ? providerConnections : []) {
    const providerId = normalizeText(connection?.modelProviderId);
    const helperModelId = normalizeText(connection?.defaultModelId);
    if (providerId && helperModelId) {
      agents[`${OPENCODE_HELPER_SUBAGENT_PREFIX}${providerId}`] = {
        description: `Vibe64 low-cost helper on the ${providerId} connection for delegating simple, inexpensive work.`,
        mode: "subagent",
        model: `${providerId}/${helperModelId}`
      };
    }
  }
  return agents;
}

function openCodeInlineConfig({
  canonicalUrl = "",
  modelProviderId = "",
  providerConnections = [],
  sessionEnvironmentRegistry = ""
} = {}) {
  const routes = new Map();
  if (normalizeText(canonicalUrl)) {
    routes.set(normalizeText(modelProviderId), canonicalProviderUrl(canonicalUrl));
  }
  for (const connection of Array.isArray(providerConnections) ? providerConnections : []) {
    if (normalizeText(connection?.canonicalUrl)) {
      routes.set(normalizeText(connection?.modelProviderId), canonicalProviderUrl(connection.canonicalUrl));
    }
  }
  if ([...routes].some(([providerId]) => !providerId)) {
    throw new TypeError("OpenCode provider URL overrides require a provider id.");
  }
  const helperSubagents = openCodeHelperSubagents(providerConnections);
  const applicationToolDenials = Object.fromEntries(openCodeApplicationToolSchemas.map(({ function: tool }) => [tool.name, "deny"]));
  // OpenCode applies an agent's last matching rule, so "*": "ask" would override the
  // global denials: the plugin's application tools would be offered and refused, and
  // the repeated-call check would wait for an approval nobody can give.
  const guardedAgentPermission = { "*": "ask", ...applicationToolDenials, doom_loop: "deny" };
  const conversationAgents = normalizeText(sessionEnvironmentRegistry) ? openCodeConversationAgents({ sessionEnvironmentRegistry }) : {};
  for (const agent of Object.values(conversationAgents)) {
    if (agent.permission.read === "allow") {
      agent.permission.read = { "*": "allow", ...OPENCODE_INLINE_CONFIG_BASE.permission.read };
    }
  }
  return JSON.stringify({
    ...OPENCODE_INLINE_CONFIG_BASE,
    agent: {
      ...conversationAgents,
      ...OPENCODE_INLINE_CONFIG_BASE.agent,
      ...helperSubagents,
      ...(normalizeText(sessionEnvironmentRegistry) ? {
        // Preserve OpenCode's native tool definitions. The session plugin rejects
        // unauthorized calls before execution; "deny" removes the tools
        // from the provider request and Zen rejects that request on its free tier.
        [OPENCODE_EPHEMERAL_AGENT_ID]: {
          ...OPENCODE_INLINE_CONFIG_BASE.agent[OPENCODE_EPHEMERAL_AGENT_ID],
          permission: guardedAgentPermission
        },
        [OPENCODE_HELPER_AGENT_ID]: {
          ...OPENCODE_INLINE_CONFIG_BASE.agent[OPENCODE_HELPER_AGENT_ID],
          permission: guardedAgentPermission
        }
      } : {})
    },
    permission: {
      ...OPENCODE_INLINE_CONFIG_BASE.permission,
      ...(normalizeText(sessionEnvironmentRegistry) ? applicationToolDenials : {})
    },
    ...(normalizeText(sessionEnvironmentRegistry)
      ? { plugin: [OPENCODE_SESSION_ENVIRONMENT_PLUGIN_URL] }
      : {}),
    ...(routes.size > 0
      ? {
          provider: Object.fromEntries([...routes].map(([providerId, baseURL]) => [
            providerId,
            {
              options: { baseURL }
            }
          ]))
        }
      : {})
  });
}

function safeOpenCodeEnvironment(baseEnv = {}, {
  cacheRoot = "",
  canonicalUrl = "",
  dbPath = "",
  hostContextResolver = "",
  managedEnv,
  modelProviderId = "",
  outputTokenMax = 0,
  packageInstalls = true,
  password = "",
  privateRoot = "",
  providerConnections = [],
  sessionEnvironmentRegistry = "",
  shimDirs = []
} = {}) {
  const homeRoot = path.join(privateRoot, "home");
  const effectiveCacheRoot = cacheRoot || path.join(privateRoot, "cache");
  const managed = Object.fromEntries(Object.entries(managedEnv || {})
    .filter(([name, value]) => (
      /^VIBE64_[A-Z0-9_]+$/u.test(name) && value !== undefined && value !== null
    ))
    .map(([name, value]) => [name, String(value)]));
  return isolatedProcessEnv(baseEnv, {
    cacheRoot: effectiveCacheRoot,
    configRoot: path.join(privateRoot, "config"),
    dataRoot: path.join(privateRoot, "data"),
    extraEnv: {
      ...managed,
      ...genesisParserEnvironment({ environment: baseEnv }),
      ...openCodeProcessEnvironment(baseEnv, {
        cacheRoot: effectiveCacheRoot,
        dbPath,
        inlineConfig: openCodeInlineConfig({
          canonicalUrl,
          modelProviderId,
          providerConnections,
          sessionEnvironmentRegistry
        }),
        outputTokenMax,
        packageInstalls,
        password
      }),
      ...(normalizeText(sessionEnvironmentRegistry)
        ? {
            ...(normalizeText(hostContextResolver)
              ? {
                  GENESIS_HOST_CONTEXT_RESOLVER: path.resolve(hostContextResolver),
                  GENESIS_TURN_CONTEXT_ENABLED: "0",
                  GENESIS_HOST_CONTEXT_RESOLVER_DATA: JSON.stringify({
                    registryPath: path.resolve(sessionEnvironmentRegistry)
                  })
                }
              : {}),
            OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(OPENCODE_MANAGED_OUTPUT_TOKEN_MAX),
            VIBE64_OPENCODE_SESSION_ENV_REGISTRY: path.resolve(sessionEnvironmentRegistry),
            JSKIT_OPENCODE_TOOL_SCHEMAS: JSON.stringify(openCodeApplicationToolSchemas)
          }
        : {})
    },
    homeRoot,
    pathEntries: shimDirs,
    stateRoot: path.join(privateRoot, "state")
  });
}

/**
 * @param {object} dependencies
 * @param {string} [dependencies.apiKey]
 * @param {string} [dependencies.cacheRoot]
 * @param {string} [dependencies.canonicalUrl]
 * @param {string} [dependencies.command]
 * @param {typeof runVibe64Command} [dependencies.commandRunner]
 * @param {string} [dependencies.dbPath]
 * @param {RuntimeEnv} [dependencies.env]
 * @param {object} [dependencies.execution]
 * @param {string} [dependencies.expectedVersion]
 * @param {typeof fetch} [dependencies.fetchImpl]
 * @param {string} [dependencies.hostContextResolver]
 * @param {InspectVibe64Service} dependencies.inspectExecution
 * @param {object} [dependencies.managedEnv]
 * @param {string} [dependencies.modelProviderId]
 * @param {boolean} [dependencies.packageInstalls]
 * @param {number} [dependencies.port]
 * @param {string} [dependencies.privateRoot]
 * @param {object[]} [dependencies.providerConnections]
 * @param {typeof OPENCODE_READY_TIMEOUT_MS} [dependencies.readinessTimeoutMs]
 * @param {boolean} [dependencies.seededPrivateRoot]
 * @param {string} [dependencies.sessionEnvironmentRegistry]
 * @param {string[]} [dependencies.shimDirs]
 * @param {typeof stopVibe64Execution} [dependencies.stopExecution]
 * @param {string} [dependencies.workdir]
 */
async function createOpenCodeServerProcess({
  apiKey = "",
  cacheRoot = "",
  canonicalUrl = "",
  command = "",
  commandRunner = runVibe64Command,
  dbPath = "",
  env = process.env,
  execution = {},
  // A host with runtime packs pins opencode; a person's own installation runs as installed.
  expectedVersion = runtimePackRoot() ? OPENCODE_EXPECTED_VERSION : "",
  fetchImpl = globalThis.fetch,
  hostContextResolver = "",
  inspectExecution,
  managedEnv = {},
  modelProviderId = "",
  packageInstalls = true,
  port = 0,
  privateRoot = "",
  providerConnections = [],
  readinessTimeoutMs = OPENCODE_READY_TIMEOUT_MS,
  seededPrivateRoot = false,
  sessionEnvironmentRegistry = "",
  // readable-check: allow dependency-default - data: the command shim directories put first on PATH
  shimDirs = [],
  stopExecution = stopVibe64Execution,
  workdir = ""
}) {
  const startupScript = seededPrivateRoot ? OPENCODE_SEEDED_STARTUP_SCRIPT : OPENCODE_MANAGED_STARTUP_SCRIPT;
  const normalizedDbPath = path.resolve(normalizeText(dbPath));
  const normalizedPrivateRoot = path.resolve(normalizeText(privateRoot));
  const normalizedWorkdir = path.resolve(normalizeText(workdir));
  if (!normalizeText(dbPath) || !normalizeText(privateRoot) || !normalizeText(workdir)) {
    throw new TypeError("OpenCode server processes require database, private, and working roots.");
  }
  await Promise.all([
    mkdir(path.dirname(normalizedDbPath), { mode: 0o700, recursive: true }),
    ...(normalizeText(cacheRoot) ? [mkdir(path.resolve(normalizeText(cacheRoot)), { mode: 0o700, recursive: true })] : []),
    mkdir(normalizedPrivateRoot, { mode: 0o700, recursive: true }),
    mkdir(normalizedWorkdir, { recursive: true })
  ]);
  const logPath = path.join(normalizedPrivateRoot, "opencode-server.log");
  const executable = normalizeText(command) || operatorCliCommand("opencode", { env });
  const credentialHome = Object.freeze({
    cacheRoot: normalizeText(cacheRoot) ? path.resolve(normalizeText(cacheRoot)) : path.join(normalizedPrivateRoot, "cache"),
    configRoot: path.join(normalizedPrivateRoot, "config"),
    dataRoot: path.join(normalizedPrivateRoot, "data"),
    home: path.join(normalizedPrivateRoot, "home"),
    stateRoot: path.join(normalizedPrivateRoot, "state")
  });
  const native = await startOpenCodeServer({
    command: executable, workdir: normalizedWorkdir, privateRoot: normalizedPrivateRoot, port: Number(port),
    fetchImpl, expectedVersion, readinessTimeoutMs, allowAttachmentDirectories: true,
    env: safeOpenCodeEnvironment(env, { cacheRoot, canonicalUrl, dbPath: normalizedDbPath,
      hostContextResolver, managedEnv, modelProviderId, packageInstalls, privateRoot: normalizedPrivateRoot,
      providerConnections, sessionEnvironmentRegistry, shimDirs }),
    connections: [...(normalizeText(modelProviderId) || String(apiKey) ? [{ apiKey, modelProviderId }] : []),
      ...(Array.isArray(providerConnections) ? providerConnections : [])].map(connection => ({ providerId: normalizeText(connection?.modelProviderId), apiKey: String(connection?.apiKey || "") })),
    execution: createVibe64ConversationExecution({
      commandRunner: request => commandRunner({ ...request, command: "/bin/sh", runtimes: VIBE64_INTERACTIVE_RUNTIME_PACKS,
        args: ["-c", startupScript, "vibe64-opencode-server", logPath, request.command, ...request.args] }),
      stopExecution, inspectExecution, credentialHome, logPath, shimDirs,
      label: normalizeText(execution.label) || "OpenCode assistant",
      operationId: normalizeText(execution.operationId) || "opencode-server",
      execution: {
        ...execution,
        resourceProfile: {
          key: normalizeText(execution.operationId) === "opencode-catalog" ? "opencode-catalog-service" : "opencode-server",
          environment: "development",
          compatibilityKey: createHash("sha256").update(JSON.stringify({
            command: executable, version: OPENCODE_EXPECTED_VERSION,
            platform: process.platform, architecture: process.arch, startup: startupScript
          })).digest("hex")
        },
        ownerId: normalizeText(execution.ownerId) || stableHash(`${normalizedDbPath}\0${normalizedWorkdir}`)
      }
    })
  }).catch((error) => {
    if (typeof error.code === "string" && error.code.startsWith("assistant_opencode_")) {
      error.code = error.code.replace("assistant_opencode_", "vibe64_opencode_");
      error.message = error.message.replace("this host requires", "Vibe64 requires");
    }
    throw error;
  });
  const { client, port: selectedPort, environment: processEnv } = native;
  async function stop() {
    const proof = await native.stop();
    return { ...proof, exited: proof.scopeEmpty === true };
  }

  async function startAttachedTerminal({
    metadata = {},
    namespace = "",
    session = {},
    upstreamSessionId = "",
    workdir: terminalWorkdir = ""
  } = {}) {
    const directory = path.resolve(normalizeText(terminalWorkdir));
    const attachedSessionId = normalizeText(upstreamSessionId);
    if (!normalizeText(terminalWorkdir) || !attachedSessionId || !normalizeText(namespace)) {
      throw new TypeError("OpenCode attached terminals require a directory, session, and namespace.");
    }
    return commandRunner({
      actor: "app",
      allowedRoots: [directory, normalizedWorkdir],
      args: native.attachArguments({ conversationId: attachedSessionId, directory }),
      baseEnv: processEnv,
      command: executable,
      credentialHome,
      cwd: directory,
      envPolicy: "auth",
      execution: {
        kind: "terminal",
        label: "OpenCode terminal",
        lifecycle: "interactive",
        operationId: "opencode-terminal",
        ownerId: normalizeText(session.sessionId || session.id),
        sessionId: normalizeText(session.sessionId || session.id)
      },
      inheritProcessEnv: false,
      mode: "pty",
      project: {
        sourceRoot: directory
      },
      purpose: "assistant",
      session,
      terminal: {
        commandPreview: "opencode attach",
        maxRunning: 1,
        metadata: {
          ...metadata,
          upstreamSessionId: attachedSessionId
        },
        namespace,
        reuseRunning: true
      }
    });
  }

  return Object.freeze({
    canonicalUrl: canonicalProviderUrl(canonicalUrl),
    client,
    dbPath: normalizedDbPath,
    health: native.health,
    modelProviderId: normalizeText(modelProviderId),
    modelProviderIds: native.modelProviderIds,
    executionId: native.executionId,
    pid: native.pid,
    port: selectedPort,
    privateRoot: normalizedPrivateRoot,
    readLogs: native.readLogs,
    // The shared runtime stops a server that exits without being stopped.
    unexpectedExit: native.unexpectedExit,
    startAttachedTerminal,
    stop,
    workdir: normalizedWorkdir
  });
}

async function readOpenCodeCatalog({
  cacheRoot = "",
  command = "",
  commandRunner = runVibe64Command,
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  privateRoot = "",
  workdir = ""
} = {}) {
  try {
    return await readNativeOpenCodeCatalog({
      privateRoot,
      workdir,
      createServerProcess(native) {
        return createServerProcess({
          cacheRoot,
          command,
          commandRunner,
          dbPath: native.dbPath,
          env,
          execution: {
            label: "Reading OpenCode catalogue",
            operationId: "opencode-catalog",
            ownerId: "opencode-catalog"
          },
          // The read lasts seconds and uses no plugins. An unfinished plugin
          // install would hold the stopped process for the whole stop timeout.
          packageInstalls: false,
          privateRoot: native.privateRoot,
          // JSKIT writes the read's Zen identity into this root before start.
          seededPrivateRoot: true,
          providerConnections: native.providerConnections,
          workdir: native.workdir
        });
      }
    });
  } catch (error) {
    if (error?.code === "assistant_opencode_catalog_stop_failed") {
      error.code = "vibe64_opencode_catalog_stop_failed";
    }
    throw error;
  }
}

async function verifyOpenCodeApiKey({
  apiKey = "",
  cacheRoot = "",
  command = "",
  commandRunner = runVibe64Command,
  env = process.env,
  modelId = "",
  modelProviderId = "",
  privateRoot = "",
  workdir = ""
} = {}) {
  try {
    return await verifyNativeOpenCodeApiKey({
      apiKey,
      agentId: OPENCODE_HELPER_AGENT_ID,
      modelId,
      modelProviderId,
      privateRoot,
      workdir,
      prepareCommand({
        providerId,
        modelId: selectedModelId,
        privateRoot: normalizedPrivateRoot,
        workdir: normalizedWorkdir,
        outputTokenMax
      }) {
        const processEnv = safeOpenCodeEnvironment(env, {
          cacheRoot,
          dbPath: path.join(normalizedPrivateRoot, "opencode.db"),
          outputTokenMax,
          privateRoot: normalizedPrivateRoot
        });
        const executable = normalizeText(command) || operatorCliCommand("opencode", { env });
        return (native) => commandRunner({
          actor: "app",
          allowedRoots: [normalizedWorkdir],
          args: native.args,
          baseEnv: processEnv,
          command: executable,
          credentialHome: {
            cacheRoot: normalizeText(cacheRoot)
              ? path.resolve(cacheRoot)
              : path.join(normalizedPrivateRoot, "cache"),
            configRoot: path.join(normalizedPrivateRoot, "config"),
            dataRoot: path.join(normalizedPrivateRoot, "data"),
            home: path.join(normalizedPrivateRoot, "home"),
            stateRoot: path.join(normalizedPrivateRoot, "state")
          },
          cwd: normalizedWorkdir,
          envPolicy: "auth",
          execution: {
            kind: "assistant",
            label: "Verifying OpenCode API key",
            lifecycle: "finite",
            operationId: "opencode-catalog",
            resourceProfile: {
              key: "opencode-key-verification", environment: "development",
              compatibilityKey: createHash("sha256").update(JSON.stringify({
                command: executable, version: OPENCODE_EXPECTED_VERSION,
                platform: process.platform, architecture: process.arch,
                providerId, model: selectedModelId, outputTokenMax
              })).digest("hex")
            },
            ownerId: "opencode-catalog"
          },
          inheritProcessEnv: false,
          maxBuffer: native.maxBuffer,
          mode: native.mode,
          purpose: "assistant",
          timeout: native.timeout
        });
      }
    });
  } catch (error) {
    if (error?.code === "assistant_opencode_key_verification_unavailable") {
      error.code = "vibe64_opencode_key_verification_unavailable";
    } else if (error?.code === "assistant_opencode_key_verification_failed") {
      error.code = "vibe64_opencode_key_verification_failed";
    }
    throw error;
  }
}

export {
  OPENCODE_HELPER_AGENT_ID,
  OPENCODE_HELPER_SUBAGENT_PREFIX,
  OPENCODE_EPHEMERAL_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  OPENCODE_HOST,
  OPENCODE_READY_TIMEOUT_MS,
  canonicalProviderUrl,
  createOpenCodeServerProcess,
  createOpenCodeHostPreparation,
  openCodeFingerprint,
  throwVibe64OpenCodeError,
  requireOpenCodeConnection,
  openCodeInlineConfig,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  safeOpenCodeEnvironment,
  verifyOpenCodeApiKey
};
