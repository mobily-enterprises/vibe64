import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  createVibe64ConversationExecution,
  isolatedProcessEnv,
  runVibe64Command,
  stableHash,
  stopVibe64Execution,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "@local/vibe64-execution/server";

import {
  genesisCommandShimDirectory, genesisParserEnvironment, vibe64HostContextResolverPath
} from "@local/vibe64-genesis/server";
import { codexAppServerRuntimeBaseDir } from "@local/vibe64-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";
import { prepareOpenCodeSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { openCodeFingerprint, recordOpenCodeSessionIdentity } from "./openCodeConversationStorage.js";
import { normalizePlainObject as record, openCodeError, openCodeRuntimeFailure } from "./terminalShared.js";

import {
  OPENCODE_EXPECTED_VERSION, OPENCODE_HOST, OPENCODE_READY_TIMEOUT_MS,
  createOpenCodeServerProcess as startOpenCodeServer, openCodeProcessEnvironment, openCodeModel,
  openCodeConversationAgents, openCodeConversationAgent, openCodeApplicationToolSchemas,
  readOpenCodeCatalog as readNativeOpenCodeCatalog,
  readOpenCodeZenModelIds as readNativeOpenCodeZenModelIds,
  verifyOpenCodeApiKey as verifyNativeOpenCodeApiKey
} from "@jskit-ai/assistant-core/server/opencode-process";
const OPENCODE_HELPER_AGENT_ID = "vibe64-helper";
const OPENCODE_HELPER_SUBAGENT_PREFIX = "vibe64-helper-";
const OPENCODE_EPHEMERAL_AGENT_ID = "vibe64-ephemeral";
const OPENCODE_MANAGED_OUTPUT_TOKEN_MAX = 128 * 1024;
const OPENCODE_SESSION_ENVIRONMENT_PLUGIN_URL = new URL(
  "./opencodeSessionEnvironmentPlugin.js",
  import.meta.url
).href;
const OPENCODE_MANAGED_STARTUP_SCRIPT = [
  "set -eu",
  "log_path=\"$1\"",
  "shift",
  ": > \"$log_path\"",
  "chmod 600 \"$log_path\"",
  "export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$",
  "exec \"$@\" </dev/null >>\"$log_path\" 2>&1"
].join("\n");
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

function text(value = "") {
  return String(value ?? "").trim();
}

function connectionIdentity(connection = {}, apiKey = "") {
  const value = text(connection.fingerprint);
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${openCodeFingerprint(apiKey)}`;
}

function requireOpenCodeConnection(value = null, modelProviderId = "") {
  const connection = record(value);
  const apiKey = String(connection.apiKey || connection.key || "");
  const actualProviderId = text(
    connection.modelProviderId || connection.providerId || connection.id || modelProviderId
  );
  if (!apiKey || actualProviderId !== text(modelProviderId)) {
    throw openCodeError(
      "vibe64_assistant_connection_required",
      `Connect ${text(modelProviderId) || "this provider"} with an API key before using OpenCode.`,
      { modelProviderId: text(modelProviderId) }
    );
  }
  const canonicalUrl = text(connection.canonicalUrl);
  const endpointCode = text(connection.endpointCode);
  if (
    endpointCode &&
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(endpointCode)
  ) {
    throw openCodeError(
      "vibe64_assistant_connection_route_invalid",
      "The selected OpenCode connection has an invalid billing endpoint.",
      { modelProviderId: actualProviderId }
    );
  }
  return {
    apiKey,
    canonicalUrl,
    defaultModelId: text(connection.defaultModelId),
    endpointCode,
    fingerprint: connectionIdentity(connection, apiKey),
    modelProviderId: actualProviderId
  };
}

function createOpenCodeHostPreparation({
  agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
  codexGitCommand, command, createServerProcess, env, getAssistantManager,
  listConnections, prepareCommandEnvironment, projectService, resolveConnection,
  sharedRuntime
}) {
  const { processes, temporaryConversations } = sharedRuntime;
  const sessionEnvironments = new Map();

  function promptContext(conversationKind = "main", assistantScope = null) {
    if (assistantScope) {
      return {
        scope: "ephemeral",
        stableContext: assistantScope.stableContext
      };
    }
    return {
      conversationKind,
      scope: "session",
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  function storedUpstreamSessionId(context) {
    return text(context.session?.metadata?.opencode_conversation_id) ||
      text(processes.get(context.key)?.upstreamSessionId);
  }

  function sharedRoots() {
    const root = path.join(codexAppServerRuntimeBaseDir({ env }), "opencode");
    const serviceDataRoot = text(projectService.currentServiceDataRoot());
    if (!serviceDataRoot) {
      throw new TypeError("OpenCode requires a persistent service data root.");
    }
    return {
      cacheRoot: path.join(root, "cache"),
      dbPath: path.join(serviceDataRoot, "opencode", "opencode.db"),
      registryPath: path.join(root, "session-environments.json"),
      root,
      workdir: path.join(root, "workspace")
    };
  }

  async function writeSessionEnvironmentRegistry() {
    const { registryPath } = sharedRoots();
    const temporaryEnvironments = [...temporaryConversations.values()]
      .filter((entry) => entry.promptContext && text(entry.conversationId))
      .map((entry) => {
        const environment = sessionEnvironments.get(entry.target?.key);
        return environment
          ? {
              ...environment,
              promptContext: entry.promptContext,
              upstreamSessionId: entry.conversationId
            }
          : null;
      })
      .filter(Boolean);
    await sharedRuntime.writeBindings(registryPath, sessionEnvironments, [
      ...sessionEnvironments.values(),
      ...temporaryEnvironments
    ]);
  }

  async function configuredConnections(context = {}, options = {}, selected = null) {
    const listed = await listConnections({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      vibe64User: options.vibe64User || null
    });
    const providerIds = new Set((Array.isArray(listed) ? listed : [])
      .map((connection) => text(connection?.modelProviderId || connection?.id))
      .filter(Boolean));
    if (selected?.modelProviderId) {
      providerIds.add(selected.modelProviderId);
    }
    const resolved = await Promise.all([...providerIds].map(async (modelProviderId) => {
      try {
        return requireOpenCodeConnection(await resolveConnection({
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          modelProviderId,
          sessionId: context.sessionId,
          vibe64User: options.vibe64User || null
        }), modelProviderId);
      } catch (error) {
        if (modelProviderId === selected?.modelProviderId) {
          throw error;
        }
        return null;
      }
    }));
    return resolved.filter(Boolean);
  }

  async function prepareSharedProcess(context = {}, options = {}, selected = null, shimDirs = []) {
    const connections = await configuredConnections(context, options, selected);
    const roots = sharedRoots();
    await writeSessionEnvironmentRegistry();
    return { connections, create: createServerProcess, options: {
      cacheRoot: roots.cacheRoot,
      command,
      dbPath: roots.dbPath,
      env,
      execution: {
        label: "OpenCode assistant",
        operationId: "opencode-server",
        ownerId: "opencode"
      },
      privateRoot: path.join(roots.root, `private-${randomUUID()}`),
      hostContextResolver: vibe64HostContextResolverPath(),
      providerConnections: connections,
      sessionEnvironmentRegistry: roots.registryPath,
      shimDirs,
      workdir: roots.workdir
    } };
  }

  async function conversationHost({ connection }, options = {}) {
    if (sharedRuntime.closed) throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    const selected = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: connection.providerId, vibe64User: options.vibe64User || null
    }), connection.providerId);
    if (selected.apiKey !== connection.apiKey || (selected.canonicalUrl || "") !== (connection.baseURL || "")) {
      throw new Error("The selected OpenCode connection changed. Resolve the current authorized connection before continuing.");
    }
    const roots = sharedRoots();
    return { runtime: sharedRuntime, runtimeDirectory: roots.root, registryPath: roots.registryPath,
      databasePath: roots.dbPath, selected, prepareServer: () => prepareSharedProcess({}, options, selected, [genesisCommandShimDirectory()]) };
  }

  async function prepareProcess(context = {}, options = {}) {
    requireCompletedNativeConversationReplacement(context.session);
    if (sharedRuntime.closed) {
      throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    }
    const connection = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: context.selection.modelProviderId,
      sessionId: context.sessionId,
      vibe64User: options.vibe64User || null
    }), context.selection.modelProviderId);
    const learningRoot = await learningSessionExecutionRoot(context.runtime, context.sessionId);
    const projectContextRoot = learningRoot || path.resolve(context.runtime.projectContextRoot);
    const conversation = learningRoot && context.runtime.learningTeaching && options.applicationTools
      ? { systemPrompt: await context.runtime.getLearningInstructions(context.sessionId), nativeTools: false,
        tools: options.applicationTools } : null;
    // The original owner may already hold this shared-process target. Refresh
    // its exact private binding before Send rather than waiting for acquisition.
    if (conversation && sessionEnvironments.has(context.key)) {
      sessionEnvironments.get(context.key).conversation = conversation;
      await writeSessionEnvironmentRegistry();
    }
    return { key: context.key, connection, failure: openCodeRuntimeFailure, async configure() {
      let helperModelId = "";
      if (!context.assistantScope && getAssistantManager()) {
        const workflowEngineId = assistantRoutingFromMetadata(context.session.metadata)?.workflowEngineId || context.selection.engineId;
        const helper = await getAssistantManager().resolveAssistantPurpose({ purpose: "helper", workflowEngineId }, {
          ...context, vibe64User: options.vibe64User || null
        }).catch(() => null);
        if (helper?.available && helper.effectiveSelection.engineId === VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE &&
            helper.effectiveSelection.modelProviderId === context.selection.modelProviderId) {
          helperModelId = helper.effectiveSelection.modelId;
        }
      }
      const commands = await prepareOpenCodeSessionCommandEnvironment(context, {
        agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
        codexGitCommand, env, prepareCommandEnvironment, projectService
      });
      sessionEnvironments.set(context.key, {
        helperModelId,
        ...(conversation ? { conversation } : {}),
        modelProviderId: context.selection.modelProviderId,
        env: commands.env,
        pathEntries: commands.shimDirs,
        projectContextRoot,
        promptContext: learningRoot ? { scope: "learning",
          instructions: await context.runtime.getLearningInstructions(context.sessionId) }
          : promptContext("main", context.assistantScope),
        sessionId: context.sessionId,
        upstreamSessionId: storedUpstreamSessionId(context),
        workdir: context.workdir
      });
      await writeSessionEnvironmentRegistry();
      const shimDirs = [genesisCommandShimDirectory()];
      return {
        prepareServer: () => prepareSharedProcess(context, options, connection, shimDirs),
        target: {
          connection,
          helperModelId,
          projectContextRoot,
          get selection() { return context.selection; },
          get sessionId() { return context.sessionId; },
          get upstreamSessionId() { return storedUpstreamSessionId(context); },
          get workdir() { return context.workdir; }
        }
      };
    }, async onFailure() {
      sessionEnvironments.delete(context.key);
      await writeSessionEnvironmentRegistry().catch(() => null);
    } };
  }

  function upstreamSessionOptions(context, options = {}) {
    return {
      selection: context.runtime?.learningScope && context.runtime.learningTeaching && options.applicationTools
        ? { ...context.selection, agentId: openCodeConversationAgent({ tools: true }) } : context.selection,
      model: openCodeModel(context.selection), workdir: context.workdir,
      invalidIdentity: () => openCodeError("vibe64_opencode_session_id_invalid", "OpenCode did not return a native conversation ID."),
      identity: {
        write(nativeId) {
          return recordOpenCodeSessionIdentity(context, nativeId);
        },
        async publish(nativeId) {
          sessionEnvironments.get(context.key).upstreamSessionId = nativeId;
          await writeSessionEnvironmentRegistry();
        }
      }
    };
  }

  return {
    conversationHost, prepareProcess, prepareSharedProcess, promptContext,
    sessionEnvironments, sharedRoots, storedUpstreamSessionId,
    upstreamSessionOptions, writeSessionEnvironmentRegistry
  };
}

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
  const source = text(value);
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
    const providerId = text(connection?.modelProviderId);
    const helperModelId = text(connection?.defaultModelId);
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
  if (text(canonicalUrl)) {
    routes.set(text(modelProviderId), canonicalProviderUrl(canonicalUrl));
  }
  for (const connection of Array.isArray(providerConnections) ? providerConnections : []) {
    if (text(connection?.canonicalUrl)) {
      routes.set(text(connection?.modelProviderId), canonicalProviderUrl(connection.canonicalUrl));
    }
  }
  if ([...routes].some(([providerId]) => !providerId)) {
    throw new TypeError("OpenCode provider URL overrides require a provider id.");
  }
  const helperSubagents = openCodeHelperSubagents(providerConnections);
  const conversationAgents = text(sessionEnvironmentRegistry) ? openCodeConversationAgents({ sessionEnvironmentRegistry }) : {};
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
      ...(text(sessionEnvironmentRegistry) ? {
        // Preserve OpenCode's native tool definitions. The session plugin rejects
        // unauthorized calls before execution; "deny" removes the tools
        // from the provider request and Zen rejects that request on its free tier.
        [OPENCODE_EPHEMERAL_AGENT_ID]: {
          ...OPENCODE_INLINE_CONFIG_BASE.agent[OPENCODE_EPHEMERAL_AGENT_ID],
          permission: { "*": "ask" }
        },
        [OPENCODE_HELPER_AGENT_ID]: {
          ...OPENCODE_INLINE_CONFIG_BASE.agent[OPENCODE_HELPER_AGENT_ID],
          permission: { "*": "ask" }
        }
      } : {})
    },
    permission: {
      ...OPENCODE_INLINE_CONFIG_BASE.permission,
      ...(text(sessionEnvironmentRegistry) ? Object.fromEntries(openCodeApplicationToolSchemas.map(({ function: tool }) => [tool.name, "deny"])) : {})
    },
    ...(text(sessionEnvironmentRegistry)
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
  managedEnv = {},
  modelProviderId = "",
  outputTokenMax = 0,
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
        password
      }),
      ...(text(sessionEnvironmentRegistry)
        ? {
            ...(text(hostContextResolver)
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

async function createOpenCodeServerProcess({
  apiKey = "",
  cacheRoot = "",
  canonicalUrl = "",
  command = "opencode",
  commandRunner = runVibe64Command,
  dbPath = "",
  env = process.env,
  execution = {},
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  fetchImpl = globalThis.fetch,
  hostContextResolver = "",
  inspectExecution,
  managedEnv = {},
  modelProviderId = "",
  port = 0,
  privateRoot = "",
  providerConnections = [],
  readinessTimeoutMs = OPENCODE_READY_TIMEOUT_MS,
  sessionEnvironmentRegistry = "",
  shimDirs = [],
  stopExecution = stopVibe64Execution,
  workdir = ""
} = {}) {
  const normalizedDbPath = path.resolve(text(dbPath));
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(dbPath) || !text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode server processes require database, private, and working roots.");
  }
  await Promise.all([
    mkdir(path.dirname(normalizedDbPath), { mode: 0o700, recursive: true }),
    ...(text(cacheRoot) ? [mkdir(path.resolve(text(cacheRoot)), { mode: 0o700, recursive: true })] : []),
    mkdir(normalizedPrivateRoot, { mode: 0o700, recursive: true }),
    mkdir(normalizedWorkdir, { recursive: true })
  ]);
  const logPath = path.join(normalizedPrivateRoot, "opencode-server.log");
  const credentialHome = Object.freeze({
    cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : path.join(normalizedPrivateRoot, "cache"),
    configRoot: path.join(normalizedPrivateRoot, "config"),
    dataRoot: path.join(normalizedPrivateRoot, "data"),
    home: path.join(normalizedPrivateRoot, "home"),
    stateRoot: path.join(normalizedPrivateRoot, "state")
  });
  const native = await startOpenCodeServer({
    command, workdir: normalizedWorkdir, privateRoot: normalizedPrivateRoot, port: Number(port),
    fetchImpl, expectedVersion, readinessTimeoutMs, allowAttachmentDirectories: true,
    env: safeOpenCodeEnvironment(env, { cacheRoot, canonicalUrl, dbPath: normalizedDbPath,
      hostContextResolver, managedEnv, modelProviderId, privateRoot: normalizedPrivateRoot,
      providerConnections, sessionEnvironmentRegistry, shimDirs }),
    connections: [...(text(modelProviderId) || String(apiKey) ? [{ apiKey, modelProviderId }] : []),
      ...(Array.isArray(providerConnections) ? providerConnections : [])].map(connection => ({ providerId: text(connection?.modelProviderId), apiKey: String(connection?.apiKey || "") })),
    execution: createVibe64ConversationExecution({
      commandRunner: request => commandRunner({ ...request, command: "/bin/sh", runtimes: VIBE64_INTERACTIVE_RUNTIME_PACKS,
        args: ["-c", OPENCODE_MANAGED_STARTUP_SCRIPT, "vibe64-opencode-server", logPath, request.command, ...request.args] }),
      stopExecution, inspectExecution, credentialHome, logPath, shimDirs,
      label: text(execution.label) || "OpenCode assistant",
      operationId: text(execution.operationId) || "opencode-server",
      execution: {
        ...execution,
        resourceProfile: {
          key: text(execution.operationId) === "opencode-catalog" ? "opencode-catalog-service" : "opencode-server",
          environment: "development",
          compatibilityKey: createHash("sha256").update(JSON.stringify({
            command: text(command) || "opencode", version: OPENCODE_EXPECTED_VERSION,
            platform: process.platform, architecture: process.arch, startup: OPENCODE_MANAGED_STARTUP_SCRIPT
          })).digest("hex")
        },
        ownerId: text(execution.ownerId) || stableHash(`${normalizedDbPath}\0${normalizedWorkdir}`)
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

  return Object.freeze({
    canonicalUrl: canonicalProviderUrl(canonicalUrl),
    client,
    dbPath: normalizedDbPath,
    health: native.health,
    modelProviderId: text(modelProviderId),
    modelProviderIds: native.modelProviderIds,
    executionId: native.executionId,
    pid: native.pid,
    port: selectedPort,
    privateRoot: normalizedPrivateRoot,
    readLogs: native.readLogs,
    async startAttachedTerminal({
      metadata = {},
      namespace = "",
      session = {},
      upstreamSessionId = "",
      workdir: terminalWorkdir = ""
    } = {}) {
      const directory = path.resolve(text(terminalWorkdir));
      const attachedSessionId = text(upstreamSessionId);
      if (!text(terminalWorkdir) || !attachedSessionId || !text(namespace)) {
        throw new TypeError("OpenCode attached terminals require a directory, session, and namespace.");
      }
      return commandRunner({
        actor: "app",
        allowedRoots: [directory, normalizedWorkdir],
        args: native.attachArguments({ conversationId: attachedSessionId, directory }),
        baseEnv: processEnv,
        command: text(command) || "opencode",
        credentialHome,
        cwd: directory,
        envPolicy: "auth",
        execution: {
          kind: "terminal",
          label: "OpenCode terminal",
          lifecycle: "interactive",
          operationId: "opencode-terminal",
          ownerId: text(session?.sessionId || session?.id),
          sessionId: text(session?.sessionId || session?.id)
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
    },
    stop,
    workdir: normalizedWorkdir
  });
}

async function readOpenCodeCatalog({
  cacheRoot = "",
  command = "opencode",
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
          privateRoot: native.privateRoot,
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
  command = "opencode",
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
        return (native) => commandRunner({
          actor: "app",
          allowedRoots: [normalizedWorkdir],
          args: native.args,
          baseEnv: processEnv,
          command: text(command) || "opencode",
          credentialHome: {
            cacheRoot: text(cacheRoot)
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
                command: text(command) || "opencode", version: OPENCODE_EXPECTED_VERSION,
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
  openCodeRuntimeFailure,
  requireOpenCodeConnection,
  openCodeInlineConfig,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  safeOpenCodeEnvironment,
  verifyOpenCodeApiKey
};
