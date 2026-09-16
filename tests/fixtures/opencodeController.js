import { mkdir, mkdtemp } from "node:fs/promises";
import { createConversationStreams } from "@jskit-ai/assistant-core/server/conversation";
import os from "node:os";
import path from "node:path";
import { serializeVibe64AssistantSelection } from "../../packages/vibe64-runtime/src/shared/index.js";
import { startTerminalSession } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { openCodeAssistantCapabilities } from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";
import { createOpenCodeTerminalController } from "../../packages/vibe64-terminals/src/server/opencodeTerminal.js";

const providerDefinition = {
  id: "deepseek",
  models: {
    "deepseek-chat": {
      capabilities: {
        reasoning: true,
        toolcall: true
      },
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      status: "active",
      variants: {
        high: {},
        low: {}
      }
    }
  },
  name: "DeepSeek",
  source: "api"
};
const providerResult = {
  all: [providerDefinition],
  default: { deepseek: "deepseek-chat" }
};
const agents = [{
  description: "Make changes",
  hidden: false,
  mode: "primary",
  name: "build"
}];
const providerRevision = openCodeAssistantCapabilities({
  agents,
  providers: providerResult
}).modelProviders[0].definitionRevision;
async function controllerHarness({
  assistantParts = [],
  assistantResponses = [],
  assistantError = null,
  beforeMessages = null,
  beforePrompt = null,
  beforeReadSession = null,
  catalogProviders = providerResult,
  commandEnvironmentGate = null,
  gitActorFailure = null,
  helperResponse = '{"subject":"Add durable OpenCode sessions"}',
  interrupt = async () => true,
  messagesErrorAfterPrompt = null,
  messagesErrorAfterPromptCount = 1,
  providerEvents = [],
  events = null,
  sessionStatus = async () => ({ type: "idle" }),
  onSessionChanged = null,
  realAttachedTerminal = false,
  serverStartGate = null,
  serverClient = null,
  serverStartErrors = [],
  stop = async () => ({ exited: true, signal: "SIGTERM" }),
  withCommandBoundary = false,
  zenModelIds = null
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-controller-"));
  const streams = createConversationStreams();
  const sourceRoot = path.join(root, "sessions", "active", "session-1", "source");
  const sessionRoot = path.join(root, "session-state", "session-1");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(sessionRoot, { recursive: true })
  ]);
  const selection = {
    agentId: "build",
    catalogRevision: `sha256:${"a".repeat(64)}`,
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek",
    variantId: "high"
  };
  const session = {
    metadata: {
      assistant_selection: serializeVibe64AssistantSelection(selection),
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: "managed_session_source"
    },
    revision: 7,
    sessionId: "session-1",
    sessionRoot
  };
  const userMessages = [];
  const assistantMessages = [];
  const commentaryMessages = [];
  const thinkingMessages = [];
  const systemMessages = [];
  const metadataWrites = [];
  const agentRunEvents = [];
  const renderPromptCalls = [];
  let runStartedAt = "";
  let queuedMessagesErrorAfterPrompt = messagesErrorAfterPrompt;
  let queuedMessagesErrorCount = messagesErrorAfterPrompt
    ? Math.max(1, Number(messagesErrorAfterPromptCount) || 1)
    : 0;
  const runtime = {
    projectContextRoot: root,
    stateRoot: path.join(root, "runtime"),
    async getSession() {
      return session;
    },
    async renderPrompt(_sessionId, input = {}) {
      renderPromptCalls.push(input);
      return { prompt: `GENESIS ${input.task}: ${input.request}` };
    },
    store: {
      readConversationStream: streams.read,
      updateConversationStream: streams.update,
      completeConversationStreamMessage: streams.complete,
      clearConversationStream: streams.clear,
      async conversationMessageIdExists() {
        return false;
      },
      async mutateSession(_sessionId, operation) {
        return operation();
      },
      async readConversationLogPage() {
        return {
          conversationLog: userMessages.slice(-1).map((message) => ({ user: message })),
          pagination: {
            totalTurnCount: userMessages.length
          }
        };
      },
      async writeAgentRunEvent(_sessionId, id, input = {}) {
        const updatedAt = new Date().toISOString();
        runStartedAt ||= updatedAt;
        const state = input.patch?.state || input.event?.state || "active";
        const active = state === "active";
        const run = {
          ...input.patch,
          active,
          ...(active ? {} : { finishedAt: updatedAt }),
          id,
          startedAt: input.patch?.startedAt || runStartedAt,
          state,
          updatedAt
        };
        agentRunEvents.push({ input, run });
        return run;
      },
      async writeConversationAssistantMessage(_sessionId, input) {
        assistantMessages.push(input);
        return { id: input.messageId, text: input.text, type: "assistant" };
      },
      async writeConversationCommentaryMessage(_sessionId, input) {
        commentaryMessages.push(input);
        return { id: input.messageId, text: input.text, type: "commentary" };
      },
      async writeConversationThinkingMessage(_sessionId, input) {
        thinkingMessages.push(input);
        return { id: input.messageId, text: input.text, type: "thinking" };
      },
      async writeConversationSystemMessage(_sessionId, input) {
        systemMessages.push(input);
        return {
          system: { text: input.text },
          turnId: `system-${systemMessages.length}`
        };
      },
      async writeConversationUserMessage(_sessionId, input) {
        userMessages.push(input);
        return { id: input.messageId, text: input.text, type: "user" };
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadataWrites.push({ name, value });
        session.metadata[name] = value;
      }
    }
  };
  const connection = {
    apiKey: "deepseek-key-one",
    canonicalUrl: "https://api.deepseek.com",
    economyModelId: "deepseek-chat",
    endpointCode: "deepseek_api",
    fingerprint: `sha256:${"1".repeat(64)}`,
    modelProviderId: "deepseek",
    providerRevision
  };
  const processStarts = [];
  const serverStartCalls = [];
  const processStops = [];
  const terminalStarts = [];
  const commandEnvironmentCalls = [];
  const catalogReadCalls = [];
  const createdSessions = [];
  const createdSessionDirectories = [];
  const promptCalls = [];
  const promptDirectories = [];
  const publishedSessionChanges = [];
  const switchedAgents = [];
  const switchedModels = [];
  const verifyConnectionCalls = [];
  const upstreamSessions = new Map();
  const outputs = new Map();
  const queuedAssistantResponses = [...assistantResponses];
  const queuedServerStartErrors = [...serverStartErrors];
  let agentCatalogCalls = 0;
  let failNextHealth = false;
  let failNextPrompt = false;
  let listConnectionCalls = 0;
  let nextSession = 1;
  let providerCatalogCalls = 0;
  let readSessionCalls = 0;
  let runtimeCreateCalls = 0;

  function client(directory = "") {
    return {
      async *events(id, { onReady, signal } = {}) {
        if (events) {
          yield* events(id, { onReady, signal });
          return;
        }
        onReady?.();
        for (const event of providerEvents) {
          yield { ...event, data: { ...event.data, properties: { sessionID: id, ...event.data?.properties } } };
        }
        if (!signal?.aborted) {
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        }
      },
      async agents() {
        agentCatalogCalls += 1;
        return agents;
      },
      async createSession(input = {}) {
        const id = input.id || `ses_detached_${nextSession++}`;
        const created = { ...input, id };
        createdSessions.push(created);
        createdSessionDirectories.push({ directory, id });
        upstreamSessions.set(id, created);
        return created;
      },
      async deleteSession(id) {
        upstreamSessions.delete(id);
        return true;
      },
      async health() {
        if (failNextHealth) {
          failNextHealth = false;
          throw new Error("health failed");
        }
        return { healthy: true, version: "1.18.22" };
      },
      interrupt,
      sessionStatus,
      async messages(id, _input, options) {
        await beforeMessages?.(id, options);
        const output = outputs.get(id);
        const response = output && typeof output === "object" && !Array.isArray(output)
          ? output
          : { text: output };
        const promptCall = [...promptCalls].reverse().find((entry) => entry.id === id);
        if (promptCall && queuedMessagesErrorAfterPrompt && queuedMessagesErrorCount > 0) {
          const error = queuedMessagesErrorAfterPrompt;
          queuedMessagesErrorCount -= 1;
          if (queuedMessagesErrorCount === 0) {
            queuedMessagesErrorAfterPrompt = null;
          }
          throw error;
        }
        const created = Date.now();
        return {
          data: output === undefined ? [] : [
            {
              id: promptCall.input.id,
              text: promptCall.input.prompt.text,
              time: { created },
              type: "user"
            },
            {
              ...(response.error || assistantError
                ? { error: response.error || assistantError }
                : { text: response.text }),
              ...((response.content || assistantParts).length
                ? { content: response.content || assistantParts }
                : {}),
              id: "msg_assistant",
              time: {
                ...(response.pending ? {} : { completed: created + 1 }),
                created: created + 1
              },
              type: "assistant"
            }
          ]
        };
      },
      async prompt(id, input = {}) {
        promptCalls.push({ id, input });
        promptDirectories.push({ directory, id });
        if (failNextPrompt) {
          const error = failNextPrompt;
          failNextPrompt = false;
          throw error;
        }
        await beforePrompt?.({ directory, id, input });
        outputs.set(id, id.startsWith("ses_detached_")
          ? helperResponse
          : queuedAssistantResponses.shift() || "Main turn complete");
        return { admittedSeq: promptCalls.length, id: input.id };
      },
      async providers() {
        providerCatalogCalls += 1;
        return catalogProviders;
      },
      forDirectory(nextDirectory = "") {
        return client(path.resolve(nextDirectory));
      },
      async readSession(id) {
        readSessionCalls += 1;
        await beforeReadSession?.(id);
        if (!upstreamSessions.has(id)) {
          throw Object.assign(new Error("missing"), { statusCode: 404 });
        }
        return upstreamSessions.get(id);
      },
      async switchAgent(id, agent) {
        switchedAgents.push({ agent, id });
      },
      async switchModel(id, model) {
        switchedModels.push({ id, model });
      },
      async wait() {
        return true;
      }
    };
  }

  const controllerOptions = {
    env: {
      ...process.env,
      VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-providers")
    },
    ...(withCommandBoundary ? {
      agentDatabaseCommand: { id: "database" },
      agentEnvCommand: { id: "environment" },
      agentPreviewCommand: { id: "preview" },
      codexGitCommand: { id: "git" },
      async prepareCommandEnvironment(input) {
        commandEnvironmentCalls.push(input);
        await commandEnvironmentGate?.(input);
        return {
          env: {
            VIBE64_AGENT_DATABASE_COMMAND_SOCKET: "/managed/database.sock",
            VIBE64_AGENT_ENV_COMMAND_SOCKET: "/managed/environment.sock",
            VIBE64_AGENT_PREVIEW_COMMAND_SOCKET: "/managed/preview.sock",
            VIBE64_CODEX_GIT_COMMAND_SOCKET: "/managed/git.sock"
          },
          hostWrapperDir: "/managed/wrappers",
          ok: true,
          shimDirs: ["/managed/wrappers"]
        };
      }
    } : {}),
    async createServerProcess(options) {
      serverStartCalls.push(options);
      await serverStartGate?.(options);
      const startError = queuedServerStartErrors.shift();
      if (startError) {
        throw startError;
      }
      const started = {
        client: serverClient || client(),
        options,
        workdir: options.workdir,
        async startAttachedTerminal(input) {
          terminalStarts.push(input);
          if (realAttachedTerminal) {
            return startTerminalSession({
              args: ["-e", "setInterval(() => {}, 1000)"],
              command: process.execPath,
              commandPreview: "opencode attach",
              cwd: sourceRoot,
              maxRunning: 1,
              namespace: input.namespace,
              reuseRunning: true
            });
          }
          return {
            commandPreview: "opencode attach",
            id: `opencode-terminal-${terminalStarts.length}`,
            ok: true,
            status: "running"
          };
        },
        async stop() {
          processStops.push(options);
          return stop();
        }
      };
      processStarts.push(started);
      return started;
    },
    async readZenModelsCommand() {
      const zen = catalogProviders.all.find((provider) => provider.id === "opencode");
      return Array.isArray(zenModelIds) ? zenModelIds : Object.keys(zen?.models || {});
    },
    async listConnections() {
      listConnectionCalls += 1;
      return [{
        accessLabel: "Workspace use",
        billingLabel: "Usage-based API billing",
        connected: true,
        economyModelId: connection.economyModelId,
        fingerprint: connection.fingerprint,
        modelProviderId: connection.modelProviderId,
        productLabel: "DeepSeek",
        providerRevision: connection.providerRevision
      }];
    },
    projectService: {
      async createRuntime() {
        runtimeCreateCalls += 1;
        return runtime;
      },
      async readPromptHints() {
        return { ok: true, promptHints: true };
      }
    },
    async readCatalogCommand(options) {
      catalogReadCalls.push(options);
      return {
        agents,
        providers: catalogProviders
      };
    },
    async publishSessionChanged(...args) {
      publishedSessionChanges.push(args);
      await onSessionChanged?.(...args);
    },
    async recordGitActor(input) {
      return gitActorFailure || { ok: true, session: input.session };
    },
    async resolveConnection() {
      return { ...connection };
    },
    async verifyConnectionCommand(input) {
      verifyConnectionCalls.push(input);
      return { ok: true };
    }
  };
  const createController = () => createOpenCodeTerminalController(controllerOptions);
  const controller = createController();

  return {
    createController,
    controllerOptions,
    agentCatalogCalls: () => agentCatalogCalls,
    agentRunEvents,
    assistantMessages,
    catalogReadCalls,
    commentaryMessages,
    connection,
    commandEnvironmentCalls,
    controller,
    createdSessionDirectories,
    createdSessions,
    failHealth() {
      failNextHealth = true;
    },
    failPrompt(error = Object.assign(new Error("admission failed"), { statusCode: 503 })) {
      failNextPrompt = error;
    },
    listConnectionCalls: () => listConnectionCalls,
    metadataWrites,
    processStarts,
    processStops,
    providerCatalogCalls: () => providerCatalogCalls,
    promptDirectories,
    promptCalls,
    publishedSessionChanges,
    root,
    readSessionCalls: () => readSessionCalls,
    renderPromptCalls,
    runtime,
    runtimeCreateCalls: () => runtimeCreateCalls,
    selection,
    serverStartCalls,
    session,
    switchedAgents,
    switchedModels,
    systemMessages,
    terminalStarts,
    thinkingMessages,
    upstreamSessions,
    userMessages,
    verifyConnectionCalls
  };
}

export { agents, controllerHarness, providerDefinition };
