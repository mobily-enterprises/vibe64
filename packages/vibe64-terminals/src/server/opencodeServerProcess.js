import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync
} from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import {
  isolatedProcessEnv,
  runVibe64Command,
  stableHash,
  stopVibe64Execution
} from "@local/vibe64-execution/server";

import {
  createOpenCodeServerClient,
  readBoundedResponse
} from "@jskit-ai/assistant-core/server/opencode-client";

import { genesisParserEnvironment } from "@local/vibe64-genesis/server";

const OPENCODE_EXPECTED_VERSION = "1.18.31";
const OPENCODE_ECONOMY_AGENT_ID = "vibe64-economy";
const OPENCODE_INTERN_SUBAGENT_PREFIX = "vibe64-intern-";
const OPENCODE_EPHEMERAL_AGENT_ID = "vibe64-ephemeral";
const OPENCODE_HOST = "127.0.0.1";
const OPENCODE_LOG_LIMIT_BYTES = 64 * 1024;
const OPENCODE_MANAGED_OUTPUT_TOKEN_MAX = 128 * 1024;
const OPENCODE_VERIFY_LIMIT_BYTES = 256 * 1024;
const OPENCODE_VERIFY_OUTPUT_TOKEN_MAX = 16;
const OPENCODE_VERIFY_TIMEOUT_MS = 30_000;
const OPENCODE_READY_TIMEOUT_MS = 30_000;
const OPENCODE_STOP_TIMEOUT_MS = 3_000;
const OPENCODE_ZEN_CATALOG_LIMIT_BYTES = 2 * 1024 * 1024;
const OPENCODE_ZEN_CATALOG_TIMEOUT_MS = 5_000;
const OPENCODE_ZEN_MODELS_URL = "https://opencode.ai/zen/v1/models";
const OPENCODE_ZEN_PROVIDER_ID = "opencode";
const OPENCODE_ZEN_PUBLIC_API_KEY = "public";
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
    [OPENCODE_ECONOMY_AGENT_ID]: {
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

function openCodeZenCatalogError(cause = null) {
  const error = new Error("OpenCode Zen's current model list could not be read. Try again.", {
    cause
  });
  error.code = "vibe64_opencode_zen_catalog_unavailable";
  error.retryable = true;
  error.statusCode = 503;
  return error;
}

async function readOpenCodeZenModelIds({
  fetchImpl = globalThis.fetch,
  timeoutMs = OPENCODE_ZEN_CATALOG_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OpenCode Zen catalogue reads require fetch().");
  }
  try {
    const response = await fetchImpl(OPENCODE_ZEN_MODELS_URL, {
      headers: { accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(Math.max(100, Math.min(30_000, Number(timeoutMs) || 0)))
    });
    if (!response?.ok) {
      throw new Error(`OpenCode Zen returned HTTP ${Number(response?.status) || 0}.`);
    }
    const payload = JSON.parse(await readBoundedResponse(
      response,
      OPENCODE_ZEN_CATALOG_LIMIT_BYTES
    ));
    if (!Array.isArray(payload?.data) || payload.data.length === 0) {
      throw new Error("OpenCode Zen returned an empty model list.");
    }
    const ids = payload.data.map((model) => text(model?.id));
    const uniqueIds = new Set(ids);
    if (ids.some((id) => !id) || uniqueIds.size !== ids.length) {
      throw new Error("OpenCode Zen returned an invalid model list.");
    }
    return Object.freeze([...uniqueIds].sort((left, right) => left.localeCompare(right)));
  } catch (error) {
    if (error?.code === "vibe64_opencode_zen_catalog_unavailable") {
      throw error;
    }
    throw openCodeZenCatalogError(error);
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

function openCodeInternSubagents(providerConnections = []) {
  const agents = {};
  for (const connection of Array.isArray(providerConnections) ? providerConnections : []) {
    const providerId = text(connection?.modelProviderId);
    const internModelId = text(connection?.economyModelId);
    if (providerId && internModelId) {
      agents[`${OPENCODE_INTERN_SUBAGENT_PREFIX}${providerId}`] = {
        description: `Vibe64 low-cost helper on the ${providerId} connection for delegating simple, inexpensive work.`,
        mode: "subagent",
        model: `${providerId}/${internModelId}`
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
  const internSubagents = openCodeInternSubagents(providerConnections);
  return JSON.stringify({
    ...OPENCODE_INLINE_CONFIG_BASE,
    agent: {
      ...OPENCODE_INLINE_CONFIG_BASE.agent,
      ...internSubagents,
      ...(text(sessionEnvironmentRegistry) ? {
        // Preserve OpenCode's native tool definitions. The session plugin rejects
        // every ephemeral tool call before execution; "deny" removes the tools
        // from the provider request and Zen rejects that request on its free tier.
        [OPENCODE_EPHEMERAL_AGENT_ID]: {
          ...OPENCODE_INLINE_CONFIG_BASE.agent[OPENCODE_EPHEMERAL_AGENT_ID],
          permission: { "*": "ask" }
        }
      } : {})
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

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      // OpenCode installs plugin dependencies through npm, which ignores XDG_CACHE_HOME.
      npm_config_cache: path.join(effectiveCacheRoot, "npm"),
      npm_config_prefer_offline: "true",
      NO_PROXY: [text(baseEnv.NO_PROXY), OPENCODE_HOST, "localhost", "::1"]
        .filter(Boolean)
        .join(","),
      OPENCODE_DB: dbPath,
      OPENCODE_CONFIG_CONTENT: openCodeInlineConfig({
        canonicalUrl,
        modelProviderId,
        providerConnections,
        sessionEnvironmentRegistry
      }),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      OPENCODE_PRINT_LOGS: "0",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: "opencode",
      ...(Number.isSafeInteger(outputTokenMax) && outputTokenMax > 0
        ? { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(outputTokenMax) }
        : {}),
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
            VIBE64_OPENCODE_SESSION_ENV_REGISTRY: path.resolve(sessionEnvironmentRegistry)
          }
        : {})
    },
    homeRoot,
    pathEntries: shimDirs,
    stateRoot: path.join(privateRoot, "state")
  });
}

async function availableLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, OPENCODE_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForOpenCodeReady({
  client,
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  processHandle,
  timeoutMs = OPENCODE_READY_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processHandle.exited) {
      throw new Error("OpenCode exited before its server became ready.");
    }
    try {
      const health = await client.health({
        signal: AbortSignal.timeout(Math.max(100, Math.min(2_000, deadline - Date.now())))
      });
      if (health?.healthy === true) {
        if (expectedVersion && text(health.version) !== expectedVersion) {
          const error = new Error(
            `OpenCode ${text(health.version) || "(unknown)"} is installed; Vibe64 requires ${expectedVersion}.`
          );
          error.code = "vibe64_opencode_version_mismatch";
          throw error;
        }
        return health;
      }
    } catch (error) {
      if (error?.code === "vibe64_opencode_version_mismatch") {
        throw error;
      }
      lastError = error;
    }
    await wait(100);
  }
  const error = new Error("OpenCode did not become ready before the startup deadline.");
  error.cause = lastError;
  error.code = "vibe64_opencode_start_timeout";
  throw error;
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
  const selectedPort = Number(port) || await availableLoopbackPort();
  const password = randomBytes(32).toString("base64url");
  const client = createOpenCodeServerClient({
    allowAttachmentDirectories: true,
    baseUrl: `http://${OPENCODE_HOST}:${selectedPort}`,
    fetchImpl,
    password
  });
  let processHandle = null;
  let stopPromise = null;
  let processEnv = null;

  const logPath = path.join(normalizedPrivateRoot, "opencode-server.log");
  const credentialHome = Object.freeze({
    cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : path.join(normalizedPrivateRoot, "cache"),
    configRoot: path.join(normalizedPrivateRoot, "config"),
    dataRoot: path.join(normalizedPrivateRoot, "data"),
    home: path.join(normalizedPrivateRoot, "home"),
    stateRoot: path.join(normalizedPrivateRoot, "state")
  });

  function readLogs() {
    let descriptor = null;
    try {
      descriptor = openSync(logPath, "r");
      const size = Number(fstatSync(descriptor).size) || 0;
      const length = Math.min(size, OPENCODE_LOG_LIMIT_BYTES);
      const output = Buffer.alloc(length);
      if (length > 0) {
        readSync(descriptor, output, 0, length, Math.max(0, size - length));
      }
      return {
        stderr: output.toString("utf8").trim(),
        stdout: ""
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { stderr: "", stdout: "" };
      }
      throw error;
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    const stopping = Promise.resolve().then(async () => {
      const exitProof = processHandle
        ? await processHandle.stop()
        : { code: null, exited: true, signal: "" };
      if (exitProof.exited === true) {
        await rm(normalizedPrivateRoot, { force: true, recursive: true });
      }
      return exitProof;
    });
    stopPromise = stopping;
    void stopping.then((proof) => {
      if (proof?.exited !== true && stopPromise === stopping) stopPromise = null;
    }, () => {
      if (stopPromise === stopping) stopPromise = null;
    });
    return stopPromise;
  }

  async function readStorageResponse(route, { signal, maxBytes = 4 * 1024 * 1024 } = {}) {
    // The first storage request can initialize the saved directory after the
    // global health endpoint is ready. Allow the normal startup deadline.
    const deadline = AbortSignal.timeout(OPENCODE_READY_TIMEOUT_MS);
    const boundedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    boundedSignal.throwIfAborted();
    const response = await fetchImpl(`http://${OPENCODE_HOST}:${selectedPort}${route}`, {
      method: "GET", signal: boundedSignal,
      headers: { accept: "application/json", authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    });
    try {
      if (!response.ok) throw Object.assign(new Error(`OpenCode storage request returned HTTP ${response.status}.`), { statusCode: response.status });
      const result = JSON.parse(await readBoundedResponse(response, maxBytes));
      boundedSignal.throwIfAborted();
      return { data: result, headers: response.headers };
    } finally { await response.body?.cancel().catch(() => {}); }
  }

  async function storageInventory(route, options) {
    const { data: rows } = await readStorageResponse(route, options);
    if (!Array.isArray(rows) || rows.length > 1000 || rows.some((row) => !/^ses_[a-zA-Z0-9]+$/u.test(row?.id))) {
      throw new Error("OpenCode returned an incomplete or invalid storage inventory.");
    }
    return rows;
  }

  function storageConversationPath(conversationId) {
    if (!/^ses_[a-zA-Z0-9]+$/u.test(conversationId)) throw new TypeError("Invalid OpenCode conversation id.");
    return `/session/${encodeURIComponent(conversationId)}`;
  }

  try {
    processEnv = safeOpenCodeEnvironment(env, {
      cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : "",
      canonicalUrl,
      dbPath: normalizedDbPath,
      hostContextResolver,
      managedEnv,
      modelProviderId,
      password,
      privateRoot: normalizedPrivateRoot,
      providerConnections,
      sessionEnvironmentRegistry,
      shimDirs
    });
    const startResult = await commandRunner({
      actor: "app",
      allowedRoots: [normalizedWorkdir],
      args: [
        "-c",
        OPENCODE_MANAGED_STARTUP_SCRIPT,
        "vibe64-opencode-server",
        logPath,
        text(command) || "opencode",
        "serve",
        "--hostname",
        OPENCODE_HOST,
        "--port",
        String(selectedPort),
        "--mdns=false"
      ],
      baseEnv: processEnv,
      command: "/bin/sh",
      credentialHome,
      cwd: normalizedWorkdir,
      envPolicy: "auth",
      execution: {
        kind: "assistant",
        label: text(execution.label) || "OpenCode assistant",
        lifecycle: "service",
        operationId: text(execution.operationId) || "opencode-server",
        resourceProfile: {
          key: text(execution.operationId) === "opencode-catalog" ? "opencode-catalog-service" : "opencode-server",
          environment: "development",
          compatibilityKey: createHash("sha256").update(JSON.stringify({
            command: text(command) || "opencode", version: OPENCODE_EXPECTED_VERSION,
            platform: process.platform, architecture: process.arch, startup: OPENCODE_MANAGED_STARTUP_SCRIPT
          })).digest("hex")
        },
        ownerId: text(execution.ownerId) || stableHash(`${normalizedDbPath}\0${normalizedWorkdir}`),
        projectSlug: text(execution.projectSlug),
        sessionId: text(execution.sessionId)
      },
      inheritProcessEnv: false,
      mode: "detached",
      purpose: "assistant",
      shimDirs
    });
    if (startResult?.ok !== true || !text(startResult?.execution?.id)) {
      const error = new Error(
        text(startResult?.error || startResult?.output) || "OpenCode failed to start."
      );
      error.code = text(startResult?.code) || "vibe64_opencode_start_failed";
      error.execution = startResult?.execution;
      error.retryable = startResult?.retryable === true;
      throw error;
    }
    let stopped = false;
    processHandle = Object.freeze({
      get exited() {
        return stopped;
      },
      executionId: startResult.execution.id,
      pid: startResult.pid,
      readLogs,
      async stop() {
        const proof = await stopExecution(startResult.execution.id, {
          allowMissingRecordScopeRecovery: true,
          reason: "opencode-server-stop",
          termTimeoutMs: OPENCODE_STOP_TIMEOUT_MS
        });
        stopped = proof?.scopeEmpty === true;
        return {
          ...(proof && typeof proof === "object" ? proof : {}),
          exited: stopped
        };
      }
    });
    const health = await waitForOpenCodeReady({
      client,
      expectedVersion,
      processHandle,
      timeoutMs: readinessTimeoutMs
    });
    const connections = [
      ...(text(modelProviderId) || String(apiKey)
        ? [{ apiKey, canonicalUrl, modelProviderId }]
        : []),
      ...(Array.isArray(providerConnections) ? providerConnections : [])
    ];
    const authenticated = new Set();
    for (const connection of connections) {
      const providerId = text(connection?.modelProviderId);
      const key = String(connection?.apiKey || "");
      if (!providerId || !key || authenticated.has(providerId)) {
        continue;
      }
      await client.authenticateApiKey(providerId, key);
      authenticated.add(providerId);
    }
    return Object.freeze({
      canonicalUrl: canonicalProviderUrl(canonicalUrl),
      client,
      dbPath: normalizedDbPath,
      health: Object.freeze({ ...health }),
      modelProviderId: text(modelProviderId),
      modelProviderIds: Object.freeze([...authenticated]),
      executionId: processHandle.executionId,
      pid: processHandle.pid,
      port: selectedPort,
      privateRoot: normalizedPrivateRoot,
      async listConversationChildren(conversationId, { signal } = {}) {
        const children = await storageInventory(`${storageConversationPath(conversationId)}/children`, { signal });
        if (children.some((child) => child.parentID !== conversationId)) {
          throw new Error("OpenCode returned an incomplete or invalid child inventory.");
        }
        return children;
      },
      async listConversationsForDirectory(directory, { signal } = {}) {
        if (!path.isAbsolute(directory || "")) throw new TypeError("OpenCode inventory requires an absolute native directory.");
        // Use the global persisted inventory: the project-scoped /session
        // listing loses its Git project identity once archived source is gone.
        // Request one beyond our limit to detect a truncated inventory.
        const rows = await storageInventory(`/experimental/session?${new URLSearchParams({ directory, limit: "1001" })}`, { signal });
        if (rows.some((row) => typeof row.directory !== "string")) throw new Error("OpenCode inventory has no native directory.");
        return rows.filter((row) => row.directory === directory);
      },
      async readConversationStorage(conversationId, { signal } = {}) {
        // The native storage record does not resolve a live source workspace.
        const { data } = await readStorageResponse(storageConversationPath(conversationId), { signal });
        if (data?.id !== conversationId || !path.isAbsolute(data.directory || "")) {
          throw new Error("OpenCode returned an invalid native conversation record.");
        }
        return data;
      },
      async readConversationStoragePage(conversationId, { before = "", signal } = {}) {
        const route = `${storageConversationPath(conversationId)}/message`;
        if (typeof before !== "string" || before.length > 8192) throw new TypeError("Invalid OpenCode storage cursor.");
        const query = new URLSearchParams({ limit: "1", ...(before ? { before } : {}) });
        const { data, headers } = await readStorageResponse(`${route}?${query}`, {
          signal, maxBytes: 64 * 1024 * 1024
        });
        const nextCursor = headers.get("x-next-cursor");
        if (!nextCursor && /rel="next"/u.test(headers.get("link") || "")) {
          throw new Error("OpenCode omitted its native history continuation cursor.");
        }
        return { data, nextCursor };
      },
      readLogs() {
        return readLogs();
      },
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
          args: [
            "attach",
            `http://${OPENCODE_HOST}:${selectedPort}`,
            "--dir",
            directory,
            "--session",
            attachedSessionId,
            "--pure"
          ],
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
  } catch (error) {
    const logs = processHandle?.readLogs?.() || { stderr: "", stdout: "" };
    await stop().catch(() => null);
    error.code ||= "vibe64_opencode_start_failed";
    error.details = logs;
    throw error;
  }
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
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode catalogue reads require private and working roots.");
  }
  const authRoot = path.join(normalizedPrivateRoot, "data", "opencode");
  await mkdir(authRoot, { mode: 0o700, recursive: true });
  await writeFile(
    path.join(authRoot, "auth.json"),
    `${JSON.stringify({
      [OPENCODE_ZEN_PROVIDER_ID]: {
        key: OPENCODE_ZEN_PUBLIC_API_KEY,
        type: "api"
      }
    })}\n`,
    { mode: 0o600 }
  );
  const server = await createServerProcess({
    cacheRoot,
    command,
    commandRunner,
    dbPath: path.join(normalizedPrivateRoot, "opencode.db"),
    env,
    execution: {
      label: "Reading OpenCode catalogue",
      operationId: "opencode-catalog",
      ownerId: "opencode-catalog"
    },
    privateRoot: normalizedPrivateRoot,
    providerConnections: [],
    workdir: normalizedWorkdir
  });
  let catalog;
  let readError;
  try {
    const [providers, agents] = await Promise.all([
      server.client.providers({ directory: server.workdir }),
      server.client.agents({ directory: server.workdir })
    ]);
    catalog = { agents, providers };
  } catch (error) {
    readError = error;
  }
  const stopped = await server.stop();
  if (stopped?.exited !== true) {
    const error = new Error("The temporary OpenCode catalogue process did not stop cleanly.");
    error.code = "vibe64_opencode_catalog_stop_failed";
    throw error;
  }
  if (readError) {
    throw readError;
  }
  return catalog;
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
  const key = String(apiKey || "");
  const providerId = text(modelProviderId);
  const selectedModelId = text(modelId);
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!key || !providerId || !selectedModelId || !text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode API-key verification requires a key, provider, model, and isolated roots.");
  }
  try {
    await Promise.all([
      mkdir(path.join(normalizedPrivateRoot, "data", "opencode"), {
        mode: 0o700,
        recursive: true
      }),
      mkdir(normalizedWorkdir, { recursive: true })
    ]);
    await writeFile(
      path.join(normalizedPrivateRoot, "data", "opencode", "auth.json"),
      `${JSON.stringify({ [providerId]: { key, type: "api" } })}\n`,
      { mode: 0o600 }
    );
    const processEnv = safeOpenCodeEnvironment(env, {
      cacheRoot,
      dbPath: path.join(normalizedPrivateRoot, "opencode.db"),
      outputTokenMax: OPENCODE_VERIFY_OUTPUT_TOKEN_MAX,
      privateRoot: normalizedPrivateRoot
    });
    let result;
    try {
      result = await commandRunner({
        actor: "app",
        allowedRoots: [normalizedWorkdir],
        args: [
          "run",
          "--pure",
          "--agent",
          OPENCODE_ECONOMY_AGENT_ID,
          "--model",
          `${providerId}/${selectedModelId}`,
          "--format",
          "json",
          "Reply only OK."
        ],
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
              providerId, model: selectedModelId, outputTokenMax: OPENCODE_VERIFY_OUTPUT_TOKEN_MAX
            })).digest("hex")
          },
          ownerId: "opencode-catalog"
        },
        inheritProcessEnv: false,
        maxBuffer: OPENCODE_VERIFY_LIMIT_BYTES,
        mode: "capture",
        purpose: "assistant",
        timeout: OPENCODE_VERIFY_TIMEOUT_MS
      });
    } catch {
      const error = new Error("OpenCode API-key verification could not run.");
      error.code = "vibe64_opencode_key_verification_unavailable";
      error.retryable = true;
      error.statusCode = 503;
      throw error;
    }
    if (result?.ok !== true) {
      const exitCode = Number(result?.exitCode);
      const unavailable = result?.timedOut === true ||
        result?.retryable === true ||
        Boolean(text(result?.code)) ||
        (Number.isSafeInteger(exitCode) && exitCode !== 1);
      const error = new Error(unavailable
        ? "OpenCode API-key verification could not run."
        : "OpenCode rejected the API-key verification request.");
      error.code = unavailable
        ? "vibe64_opencode_key_verification_unavailable"
        : "vibe64_opencode_key_verification_failed";
      error.retryable = unavailable;
      error.statusCode = unavailable ? 503 : 422;
      throw error;
    }
    return Object.freeze({ ok: true });
  } finally {
    await rm(normalizedPrivateRoot, { force: true, recursive: true });
  }
}

export {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_INTERN_SUBAGENT_PREFIX,
  OPENCODE_EPHEMERAL_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  OPENCODE_HOST,
  OPENCODE_READY_TIMEOUT_MS,
  OPENCODE_STOP_TIMEOUT_MS,
  availableLoopbackPort,
  canonicalProviderUrl,
  createOpenCodeServerProcess,
  openCodeInlineConfig,
  readOpenCodeCatalog,
  readOpenCodeZenModelIds,
  safeOpenCodeEnvironment,
  verifyOpenCodeApiKey
};
