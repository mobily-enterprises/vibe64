import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import {
  isRemoteStudioRuntime,
  studioRuntimeLocation
} from "@local/vibe64-core/server/studioRuntimeLocation";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSessionText
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  prepareCurrentStepInputHelper
} from "@local/vibe64-runtime/server/currentStepInputHelperServer";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  AGENT_TERMINAL_RESUME_STRATEGY,
  agentTerminalIdentityForWorkdir,
  agentTerminalIdentityState,
  writeAgentTerminalIdentityReady
} from "./agentTerminalIdentity.js";
import {
  directoryExists,
  opencodeTerminalNamespace,
  pathInsideOrEqual,
  terminalTargetRoot,
  terminalWorktreePath
} from "./terminalShared.js";

const OPENCODE_AGENT_PROVIDER = "opencode";
const OPENCODE_HOSTNAME = "127.0.0.1";
const OPENCODE_SERVER_START_TIMEOUT_MS = 30_000;
const OPENCODE_REQUEST_TIMEOUT_MS = 60_000;
const OPENCODE_PROMPT_TIMEOUT_MS = 90_000;
const OPENCODE_ACTIVITY_TIMEOUT_MS = 5_000;
const OPENCODE_ACTIVITY_POLL_MS = 250;
const OPENCODE_PROVIDER_STATUS_TIMEOUT_MS = 20_000;
const OPENCODE_TERMINAL_REPLAY_LIMIT = 30;
const OPENCODE_AUTH_TYPES = new Set(["api", "oauth", "wellknown"]);
const MAX_OPEN_OPENCODE_TERMINALS = 1;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function serverKey(workdir = "") {
  return path.resolve(workdir);
}

function basicAuthHeader(username = "", password = "") {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function outputBufferLine(buffer = "", chunk = "") {
  return `${buffer}${chunk}`.slice(-16_000);
}

function envFingerprint(env = {}) {
  return Object.entries(env && typeof env === "object" && !Array.isArray(env) ? env : {})
    .map(([name, value]) => [String(name), String(value)])
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
}

function listenOnRandomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, OPENCODE_HOSTNAME, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (!port) {
          reject(new Error("Unable to allocate an OpenCode server port."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function opencodeSessionId(value = null) {
  const source = isPlainObject(value?.data) ? value.data : value;
  return normalizeText(source?.id || source?.sessionID || source?.sessionId);
}

function providerId(provider = {}) {
  return normalizeText(provider.id || provider.providerID || provider.providerId);
}

function providerLabel(provider = {}) {
  return normalizeText(provider.name || provider.label) || providerId(provider);
}

function modelRows(models = {}) {
  if (Array.isArray(models)) {
    return models
      .map((model) => {
        const id = normalizeText(model?.id || model?.modelID || model?.modelId);
        return id
          ? {
              id,
              label: normalizeText(model?.name || model?.label) || id
            }
          : null;
      })
      .filter(Boolean);
  }
  if (!isPlainObject(models)) {
    return [];
  }
  return Object.entries(models)
    .map(([id, model]) => ({
      id,
      label: normalizeText(model?.name || model?.label) || id
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function normalizeAuthType(value = "") {
  const type = normalizeText(value).toLowerCase();
  return OPENCODE_AUTH_TYPES.has(type) ? type : "";
}

function opencodeAuthFilePath(env = process.env) {
  const dataHome = normalizeText(env?.XDG_DATA_HOME);
  if (dataHome) {
    return path.join(dataHome, "opencode", "auth.json");
  }
  const home = normalizeText(env?.HOME || env?.USERPROFILE);
  return home ? path.join(home, ".local", "share", "opencode", "auth.json") : "";
}

function opencodeAuthTypes(authPayload = {}) {
  const payload = isPlainObject(authPayload?.data) ? authPayload.data : authPayload;
  if (!isPlainObject(payload)) {
    return {};
  }
  return Object.fromEntries(Object.entries(payload)
    .map(([id, credential]) => {
      const authType = normalizeAuthType(credential?.type || credential?.authType);
      return authType ? [normalizeText(id), authType] : null;
    })
    .filter(Boolean));
}

async function readOpenCodeAuthTypes({
  env = process.env,
  readFileImplementation = readFile
} = {}) {
  const authFilePath = opencodeAuthFilePath(env);
  if (!authFilePath) {
    return {};
  }
  try {
    return opencodeAuthTypes(JSON.parse(await readFileImplementation(authFilePath, "utf8")));
  } catch {
    return {};
  }
}

function normalizeProviderStatus({
  authCredentialTypes = {},
  authMethods = {},
  configProviders = {},
  providerStatus = {}
} = {}) {
  const providerPayload = isPlainObject(providerStatus?.data) ? providerStatus.data : providerStatus;
  const configPayload = isPlainObject(configProviders?.data) ? configProviders.data : configProviders;
  const allProviders = Array.isArray(providerPayload?.all)
    ? providerPayload.all
    : Array.isArray(configPayload?.providers) ? configPayload.providers : [];
  const connected = new Set((Array.isArray(providerPayload?.connected) ? providerPayload.connected : [])
    .map((id) => normalizeText(id))
    .filter(Boolean));
  const defaults = isPlainObject(providerPayload?.default)
    ? providerPayload.default
    : isPlainObject(configPayload?.default) ? configPayload.default : {};
  return allProviders
    .map((provider) => {
      const id = providerId(provider);
      if (!id) {
        return null;
      }
      const defaultModelId = normalizeText(defaults[id]);
      return {
        authMethods: Array.isArray(authMethods?.[id]) ? authMethods[id] : [],
        authType: normalizeAuthType(authCredentialTypes?.[id]),
        connected: connected.has(id),
        defaultModelId,
        id,
        label: providerLabel(provider),
        models: modelRows(provider.models),
        modelCount: modelRows(provider.models).length
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function opencodeRuntimeResponse({
  error = "",
  health = null,
  providers = [],
  server = null
} = {}) {
  const connectedProviders = providers.filter((provider) => provider.connected);
  const runtimeLocation = studioRuntimeLocation();
  return {
    connectedProviderCount: connectedProviders.length,
    connectedProviders: connectedProviders.map((provider) => provider.id),
    error,
    healthy: Boolean(health?.healthy),
    ok: !error,
    providers,
    ready: !error,
    remote: isRemoteStudioRuntime(),
    runtimeLocation,
    server: server
      ? {
          hostname: server.hostname,
          port: server.port,
          url: server.url,
          workdir: server.workdir
        }
      : null,
    version: normalizeText(health?.version)
  };
}

function oauthMethodIndex(input = {}) {
  const raw = input.methodIndex ?? input.method;
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function normalizeOAuthAuthorization(payload = {}) {
  const source = isPlainObject(payload?.data) ? payload.data : payload;
  return {
    instructions: Array.isArray(source?.instructions)
      ? source.instructions.map((line) => normalizeText(line)).filter(Boolean)
      : [],
    method: normalizeText(source?.method),
    url: normalizeText(source?.url)
  };
}

function opencodeTerminalCommandPreview(server = {}, conversationId = "") {
  return `opencode run --interactive --attach ${server.url || "(server)"} --session ${conversationId} --replay --replay-limit ${OPENCODE_TERMINAL_REPLAY_LIMIT}`;
}

function activeOpenCodeTerminal(sessionId = "") {
  return listTerminalSessions({
    namespace: opencodeTerminalNamespace(sessionId),
    runningOnly: true
  })[0] || null;
}

function requestError(response, text = "") {
  return new Error(`OpenCode HTTP ${response.status}: ${text || response.statusText || "request failed"}`);
}

function opencodePromptModel(handoff = {}) {
  const providerID = normalizeText(handoff.providerId || handoff.providerID);
  const modelID = normalizeText(handoff.modelId || handoff.modelID);
  return providerID && modelID
    ? {
        modelID,
        providerID
      }
    : null;
}

function opencodePromptText(handoff = {}) {
  return normalizeText(handoff.terminalInput) || normalizeText(handoff.prompt);
}

function validOpenCodeHandoff(handoff = null) {
  return Boolean(
    handoff &&
    typeof handoff === "object" &&
    !Array.isArray(handoff) &&
    normalizeText(handoff.kind) === "agent_prompt_handoff" &&
    normalizeText(handoff.runtimeId) === OPENCODE_AGENT_PROVIDER &&
    opencodePromptText(handoff)
  );
}

function createOpenCodeController({
  activityTimeoutMs = OPENCODE_ACTIVITY_TIMEOUT_MS,
  fetchImplementation = globalThis.fetch,
  projectService,
  publishSessionChanged = null,
  startTerminalSessionImplementation = startTerminalSession,
  spawnProcess = spawn
} = {}) {
  if (!projectService) {
    throw new TypeError("createOpenCodeController requires feature.vibe64-project.service.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("createOpenCodeController requires a fetch implementation.");
  }

  const servers = new Map();

  async function currentTargetRoot() {
    const targetRoot = terminalTargetRoot({}, projectService);
    if (targetRoot) {
      return targetRoot;
    }
    if (typeof projectService.currentTargetRoot === "function") {
      return terminalTargetRoot({
        targetRoot: projectService.currentTargetRoot()
      });
    }
    return "";
  }

  async function readServerHealth(server) {
    return opencodeRequest(server, "/global/health", {
      timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
    });
  }

  async function opencodeRequest(server, pathname, {
    body = undefined,
    method = "GET",
    timeout = OPENCODE_REQUEST_TIMEOUT_MS
  } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImplementation(new URL(pathname, server.url), {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Authorization: basicAuthHeader(server.username, server.password),
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        method,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw requestError(response, text);
      }
      if (!text) {
        return null;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function waitForServerReady(server) {
    const startedAtMs = Date.now();
    while (Date.now() - startedAtMs < OPENCODE_SERVER_START_TIMEOUT_MS) {
      if (server.exited) {
        throw new Error(server.errorOutput || server.output || "OpenCode server exited before becoming ready.");
      }
      try {
        await readServerHealth(server);
        server.ready = true;
        return server;
      } catch {
        await delay(120);
      }
    }
    throw new Error(server.errorOutput || "OpenCode server did not become ready.");
  }

  async function ensureServer({
    env = {},
    workdir = ""
  } = {}) {
    const resolvedWorkdir = path.resolve(workdir || await currentTargetRoot() || process.cwd());
    const key = serverKey(resolvedWorkdir);
    const existing = servers.get(key);
    const requestedEnvFingerprint = envFingerprint(env);
    if (existing?.child && existing.child.exitCode === null && !existing.exited) {
      if (requestedEnvFingerprint && existing.envFingerprint !== requestedEnvFingerprint) {
        existing.child.kill();
        servers.delete(key);
      } else if (existing.ready === true) {
        return existing;
      } else {
        if (existing.startPromise) {
          return existing.startPromise;
        }
        existing.startPromise = waitForServerReady(existing).finally(() => {
          existing.startPromise = null;
        });
        return existing.startPromise;
      }
    }

    const port = await listenOnRandomPort();
    const username = "opencode";
    const password = crypto.randomUUID();
    const childEnv = {
      ...process.env,
      ...env,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: username
    };
    const server = {
      child: null,
      envFingerprint: requestedEnvFingerprint,
      errorOutput: "",
      exited: false,
      hostname: OPENCODE_HOSTNAME,
      output: "",
      password,
      port,
      ready: false,
      startPromise: null,
      url: `http://${OPENCODE_HOSTNAME}:${port}`,
      username,
      workdir: resolvedWorkdir
    };
    const child = spawnProcess("opencode", [
      "serve",
      "--hostname",
      OPENCODE_HOSTNAME,
      "--port",
      String(port)
    ], {
      cwd: resolvedWorkdir,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.child = child;
    child.stdout?.on("data", (chunk) => {
      server.output = outputBufferLine(server.output, String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      server.errorOutput = outputBufferLine(server.errorOutput, String(chunk));
    });
    child.on("error", (error) => {
      server.errorOutput = outputBufferLine(server.errorOutput, String(error?.message || error));
      server.exited = true;
    });
    child.on("exit", () => {
      server.exited = true;
    });
    servers.set(key, server);

    server.startPromise = waitForServerReady(server).finally(() => {
      server.startPromise = null;
    });
    return server.startPromise;
  }

  async function readProviderStatus(server) {
    const [health, providerStatus, authMethods, configProviders, authCredentialTypes] = await Promise.all([
      readServerHealth(server),
      opencodeRequest(server, "/provider", {
        timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
      }).catch(() => ({})),
      opencodeRequest(server, "/provider/auth", {
        timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
      }).catch(() => ({})),
      opencodeRequest(server, "/config/providers", {
        timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
      }).catch(() => ({})),
      readOpenCodeAuthTypes().catch(() => ({}))
    ]);
    return opencodeRuntimeResponse({
      health,
      providers: normalizeProviderStatus({
        authCredentialTypes,
        authMethods,
        configProviders,
        providerStatus
      }),
      server
    });
  }

  async function readSessionMessages(server, conversationId = "") {
    const messages = await opencodeRequest(server, `/session/${encodeURIComponent(conversationId)}/message`, {
      timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
    });
    if (Array.isArray(messages)) {
      return messages;
    }
    if (Array.isArray(messages?.items)) {
      return messages.items;
    }
    if (Array.isArray(messages?.messages)) {
      return messages.messages;
    }
    return [];
  }

  async function sessionMessageCount(server, conversationId = "") {
    return (await readSessionMessages(server, conversationId)).length;
  }

  function sessionStillAwaitingAgentResult(session = {}) {
    const status = normalizeText(session?.stepMachine?.status);
    return status === "awaiting_agent_result" || status === "attempting_execution";
  }

  async function waitForPromptActivity(server, conversationId = "", {
    initialMessageCount = 0,
    runtime = null,
    sessionId = "",
    timeout = OPENCODE_ACTIVITY_TIMEOUT_MS
  } = {}) {
    const startedAtMs = Date.now();
    while (Date.now() - startedAtMs < timeout) {
      if (runtime && sessionId) {
        const session = await runtime.getSession(sessionId).catch(() => null);
        if (session && !sessionStillAwaitingAgentResult(session)) {
          return {
            completed: true,
            messageCount: initialMessageCount,
            ok: true
          };
        }
      }
      const messageCount = await sessionMessageCount(server, conversationId);
      if (messageCount > initialMessageCount) {
        return {
          messageCount,
          ok: true
        };
      }
      await delay(OPENCODE_ACTIVITY_POLL_MS);
    }
    return {
      error: `OpenCode accepted the prompt but showed no session activity within ${Math.round(timeout / 1000)} seconds.`,
      messageCount: initialMessageCount,
      ok: false
    };
  }

  function currentStepInputHelperChangedPublisher(reason = "opencode-current-step-input-helper") {
    return async (changedSessionId) => {
      await publishSessionChanged?.(changedSessionId, {
        reason
      });
    };
  }

  async function ensureSession(runtime, session = {}, server) {
    const workdir = server.workdir;
    const existingIdentity = agentTerminalIdentityForWorkdir(session, {
      provider: OPENCODE_AGENT_PROVIDER,
      workdir
    });
    if (existingIdentity?.conversationId) {
      return existingIdentity.conversationId;
    }
    const created = await opencodeRequest(server, "/session", {
      body: {
        title: `Vibe64 ${session.sessionId || "session"}`
      },
      method: "POST"
    });
    const conversationId = opencodeSessionId(created);
    if (!conversationId) {
      throw new Error("OpenCode did not return a session id.");
    }
    await writeAgentTerminalIdentityReady({
      identity: {
        conversationId,
        provider: OPENCODE_AGENT_PROVIDER,
        resumeStrategy: AGENT_TERMINAL_RESUME_STRATEGY.PROVIDER_NATIVE,
        terminalSessionId: "",
        workdir
      },
      legacyMetadata: {
        opencode_session_id: conversationId
      },
      runtime,
      sessionId: session.sessionId
    });
    return conversationId;
  }

  async function promptBody(handoff = {}) {
    const model = opencodePromptModel(handoff);
    return {
      ...(model ? { model } : {}),
      parts: [
        {
          text: opencodePromptText(handoff),
          type: "text"
        }
      ]
    };
  }

  async function injectPrompt(sessionId, handoff = {}) {
    const startedAtMs = Date.now();
    if (!validOpenCodeHandoff(handoff)) {
      return {
        error: "OpenCode prompt handoff is invalid.",
        ok: false
      };
    }
    try {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(sessionId);
      const targetRoot = terminalTargetRoot(session, projectService);
      const workdir = terminalWorktreePath(session);
      if (!workdir) {
        return {
          error: "Create the session worktree before asking OpenCode.",
          ok: false
        };
      }
      if (!await directoryExists(workdir)) {
        return {
          error: `OpenCode worktree directory does not exist: ${workdir}`,
          ok: false
        };
      }
      const currentStepInputHelper = await prepareCurrentStepInputHelper({
        onSessionChanged: currentStepInputHelperChangedPublisher(),
        projectService,
        session,
        socketMode: "host",
        targetRoot
      });
      const server = await ensureServer({
        env: currentStepInputHelper.env,
        workdir
      });
      const conversationId = await ensureSession(runtime, session, server);
      const initialMessageCount = await sessionMessageCount(server, conversationId);
      await opencodeRequest(server, `/session/${encodeURIComponent(conversationId)}/prompt_async`, {
        body: await promptBody(handoff),
        method: "POST",
        timeout: OPENCODE_PROMPT_TIMEOUT_MS
      });
      const activity = await waitForPromptActivity(server, conversationId, {
        initialMessageCount,
        runtime,
        sessionId,
        timeout: activityTimeoutMs
      });
      if (activity?.ok === false) {
        return {
          agentConversationId: conversationId,
          agentRuntimeId: OPENCODE_AGENT_PROVIDER,
          error: activity.error,
          ok: false,
          opencodeSessionId: conversationId,
          server: {
            url: server.url,
            workdir: server.workdir
          }
        };
      }
      vibe64SessionDebugLog("server.opencode.injectPrompt.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        messageCount: activity.messageCount,
        opencodeSessionId: conversationId,
        sessionId
      });
      return {
        agentConversationId: conversationId,
        agentPromptDelivered: true,
        agentRuntimeId: OPENCODE_AGENT_PROVIDER,
        ok: true,
        opencodeSessionId: conversationId,
        server: {
          url: server.url,
          workdir: server.workdir
        }
      };
    } catch (error) {
      vibe64SessionDebugLog("server.opencode.injectPrompt.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        handoffId: normalizeText(handoff.handoffId),
        sessionId
      });
      return {
        error: normalizeText(error?.message || error) || "OpenCode prompt delivery failed.",
        ok: false
      };
    }
  }

  async function runtimeStatus() {
    try {
      const targetRoot = await currentTargetRoot();
      if (!targetRoot) {
        return opencodeRuntimeResponse({
          error: "OpenCode target root is not available."
        });
      }
      const server = await ensureServer({
        workdir: targetRoot
      });
      return readProviderStatus(server);
    } catch (error) {
      return opencodeRuntimeResponse({
        error: normalizeText(error?.message || error) || "OpenCode status could not be read."
      });
    }
  }

  async function setProviderAuth(providerId, input = {}) {
    const normalizedProviderId = normalizeText(providerId);
    const key = normalizeText(input.apiKey || input.key);
    if (!normalizedProviderId) {
      return {
        error: "OpenCode provider is required.",
        ok: false
      };
    }
    if (!key) {
      return {
        error: "OpenCode API key is required.",
        ok: false
      };
    }
    try {
      const targetRoot = await currentTargetRoot();
      const server = await ensureServer({
        workdir: targetRoot
      });
      await opencodeRequest(server, `/auth/${encodeURIComponent(normalizedProviderId)}`, {
        body: {
          key,
          type: "api"
        },
        method: "PUT"
      });
      return {
        ok: true,
        providerId: normalizedProviderId
      };
    } catch (error) {
      return {
        error: normalizeText(error?.message || error) || "OpenCode provider authentication failed.",
        ok: false,
        providerId: normalizedProviderId
      };
    }
  }

  async function startTerminal(sessionId) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return {
        error: "Vibe64 session is required.",
        ok: false
      };
    }
    try {
      const runtime = await projectService.createRuntime();
      const session = await runtime.getSession(normalizedSessionId);
      const targetRoot = terminalTargetRoot(session, projectService);
      if (!targetRoot) {
        return {
          error: "OpenCode target root is not available.",
          ok: false
        };
      }
      const workdir = terminalWorktreePath(session);
      if (!workdir) {
        return {
          error: "Create the session worktree before opening OpenCode.",
          ok: false
        };
      }
      if (!pathInsideOrEqual(targetRoot, workdir)) {
        return {
          error: "OpenCode worktree is outside the target root.",
          ok: false
        };
      }
      if (!await directoryExists(workdir)) {
        return {
          error: `Session worktree directory does not exist: ${workdir}`,
          ok: false
        };
      }

      const currentStepInputHelper = await prepareCurrentStepInputHelper({
        onSessionChanged: currentStepInputHelperChangedPublisher(),
        projectService,
        session,
        socketMode: "host",
        targetRoot
      });
      const server = await ensureServer({
        env: currentStepInputHelper.env,
        workdir
      });
      const conversationId = await ensureSession(runtime, session, server);
      const namespace = opencodeTerminalNamespace(normalizedSessionId);
      return startTerminalSessionImplementation({
        args: [
          "run",
          "--interactive",
          "--attach",
          server.url,
          "--session",
          conversationId,
          "--replay",
          "--replay-limit",
          String(OPENCODE_TERMINAL_REPLAY_LIMIT)
        ],
        command: "opencode",
        commandPreview: opencodeTerminalCommandPreview(server, conversationId),
        cwd: workdir,
        env: {
          ...currentStepInputHelper.env,
          OPENCODE_SERVER_PASSWORD: server.password,
          OPENCODE_SERVER_USERNAME: server.username
        },
        maxRunning: MAX_OPEN_OPENCODE_TERMINALS,
        metadata: {
          agentConversationId: conversationId,
          provider: OPENCODE_AGENT_PROVIDER,
          sessionId: normalizedSessionId,
          targetRoot,
          workdir
        },
        namespace,
        namespaceLimitPrefix: namespace,
        reuseRunning: (terminalSession) => {
          return terminalSession.metadata?.agentConversationId === conversationId &&
            terminalSession.metadata?.workdir === workdir;
        }
      });
    } catch (error) {
      return {
        error: normalizeText(error?.message || error) || "OpenCode terminal failed to start.",
        ok: false
      };
    }
  }

  async function startProviderOAuth(providerId, input = {}) {
    const normalizedProviderId = normalizeText(providerId || input.providerId);
    if (!normalizedProviderId) {
      return {
        error: "OpenCode provider is required.",
        ok: false
      };
    }
    if (isRemoteStudioRuntime()) {
      return {
        code: "opencode_oauth_remote_disabled",
        error: "OpenCode OAuth login changes are disabled when Vibe64 runs with --remote.",
        ok: false,
        providerId: normalizedProviderId
      };
    }
    const methodIndex = oauthMethodIndex(input);
    if (methodIndex < 0) {
      return {
        error: "OpenCode OAuth method is required.",
        ok: false,
        providerId: normalizedProviderId
      };
    }
    try {
      const targetRoot = await currentTargetRoot();
      const server = await ensureServer({
        workdir: targetRoot
      });
      const authorization = normalizeOAuthAuthorization(await opencodeRequest(
        server,
        `/provider/${encodeURIComponent(normalizedProviderId)}/oauth/authorize`,
        {
          body: {
            method: methodIndex
          },
          method: "POST",
          timeout: OPENCODE_PROVIDER_STATUS_TIMEOUT_MS
        }
      ));
      return {
        authorization,
        methodIndex,
        ok: true,
        providerId: normalizedProviderId
      };
    } catch (error) {
      return {
        error: normalizeText(error?.message || error) || "OpenCode OAuth login could not start.",
        ok: false,
        providerId: normalizedProviderId
      };
    }
  }

  async function state(sessionId) {
    const runtime = await projectService.createRuntime();
    const session = await runtime.getSession(sessionId);
    const workdir = terminalWorktreePath(session);
    const identity = agentTerminalIdentityState(session, {
      provider: OPENCODE_AGENT_PROVIDER,
      workdir
    });
    return {
      agentConversationId: identity?.conversationId || "",
      agentIdentity: identity,
      agentIdentityProvider: identity?.provider || OPENCODE_AGENT_PROVIDER,
      agentIdentityStatus: identity?.status || "",
      agentResumeStrategy: identity?.resumeStrategy || "",
      agentRuntimeId: OPENCODE_AGENT_PROVIDER,
      agentWorkdir: identity?.workdir || workdir,
      ok: true,
      opencodeSessionId: identity?.conversationId || "",
      opencodeTerminal: activeOpenCodeTerminal(sessionId),
      sessionId
    };
  }

  function closeAll() {
    for (const server of servers.values()) {
      server.child?.kill();
    }
    servers.clear();
  }

  return Object.freeze({
    closeAll,
    closeTerminalSessionsForSession(sessionId) {
      return closeTerminalSessionsForNamespace(opencodeTerminalNamespace(sessionId));
    },
    injectPrompt,
    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
    },
    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
    },
    runtimeStatus,
    setProviderAuth,
    startTerminal,
    startProviderOAuth,
    state,
    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
    },
    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSessionText(terminalSessionId, data, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
    },
    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: opencodeTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  OPENCODE_AGENT_PROVIDER,
  createOpenCodeController,
  normalizeProviderStatus,
  opencodeAuthTypes,
  opencodePromptModel,
  validOpenCodeHandoff
};
