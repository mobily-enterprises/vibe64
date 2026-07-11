import {
  readFile
} from "node:fs/promises";

import {
  CODEX_APP_SERVER_PROVIDER_ID,
  codexAppServerRequestIsInvalid,
  codexCliResumeCommand
} from "./codexAppServerProvider.js";
import {
  normalizeAgentText
} from "./agentProviders.js";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  effectiveVibe64AgentExecutionSettings,
  effectiveVibe64AgentSettings
} from "../shared/agentSettings.js";

const CODEX_SESSION_AGENT_PROVIDER = "codex";
const CODEX_SESSION_MODEL = VIBE64_CODEX_DEFAULT_MODEL;
const CODEX_SESSION_REASONING_EFFORT = VIBE64_CODEX_DEFAULT_THINKING;
const CODEX_SESSION_REASONING_SUMMARY = "concise";
const CODEX_SESSION_APPROVAL_POLICY = "never";
const CODEX_SESSION_SANDBOX = "danger-full-access";
const CODEX_APP_SERVER_CONTEXT_TURN_TIMEOUT_MS = 60000;
const CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME = "vibe64_submit_workflow_result";
const CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT = "dynamic_tool_v1";
const CODEX_CONTEXT_RECOVERY_PROMPT_URL = new URL("./prompts/codex_context_recovery.txt", import.meta.url);
let codexContextRecoveryTemplatePromise = null;

function normalizeWorkdir(value = "") {
  return normalizeAgentText(value);
}

function codexEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
}

function codexEffectiveAgentExecutionSettings(agentSettings = {}) {
  return effectiveVibe64AgentExecutionSettings(agentSettings);
}

function codexAppServerThreadSettings({
  agentSettings = {},
  cwd = "",
  developerInstructions = "",
  model = ""
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw new Error("Codex app-server thread requires a working directory.");
  }
  const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
  return {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    developerInstructions: normalizeAgentText(developerInstructions) || null,
    model: normalizeAgentText(model) || effectiveSettings.model,
    sandbox: CODEX_SESSION_SANDBOX
  };
}

function codexAppServerWorkflowResultTool() {
  return {
    description: "Submit the outcome of the current routed Vibe64 workflow step. Use this only when the Vibe64 prompt requests a workflow result. Call it before replying normally to the user; never print the arguments as JSON in the final response.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        fields: {
          additionalProperties: {
            type: "string"
          },
          description: "Workflow values requested by the current Vibe64 prompt. Use an empty object while waiting for user input.",
          type: "object"
        },
        inputFields: {
          description: "Structured user inputs required before work can continue. Use an empty array when none are needed.",
          items: {
            additionalProperties: false,
            properties: {
              kind: {
                enum: ["text", "textarea", "password"],
                type: "string"
              },
              label: {
                type: "string"
              },
              name: {
                type: "string"
              },
              privacy: {
                enum: ["public", "private"],
                type: "string"
              },
              required: {
                type: "boolean"
              }
            },
            required: ["name", "label", "kind", "privacy", "required"],
            type: "object"
          },
          type: "array"
        },
        kind: {
          enum: ["ready", "waiting_for_input"],
          type: "string"
        },
        message: {
          description: "The exact user-facing question when waiting for input; otherwise an empty string.",
          type: "string"
        },
        stepId: {
          type: "string"
        },
        stepStatus: {
          type: "string"
        }
      },
      required: ["kind", "stepId", "stepStatus", "fields", "inputFields", "message"],
      type: "object"
    },
    name: CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME,
    type: "function"
  };
}

function codexAppServerThreadStartSettings(options = {}) {
  return {
    ...codexAppServerThreadSettings(options),
    dynamicTools: [codexAppServerWorkflowResultTool()]
  };
}

function codexAppServerTurnSettings({
  agentSettings = {},
  cwd = "",
  effort = "",
  model = ""
} = {}) {
  const normalizedCwd = normalizeWorkdir(cwd);
  if (!normalizedCwd) {
    throw new Error("Codex app-server turn requires a working directory.");
  }
  const effectiveSettings = codexEffectiveAgentExecutionSettings(agentSettings);
  const settings = {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    model: normalizeAgentText(model) || effectiveSettings.model,
    sandboxPolicy: {
      type: "dangerFullAccess"
    }
  };
  if (effectiveSettings.request.reasoning !== false) {
    settings.effort = normalizeAgentText(effort) || effectiveSettings.thinking;
    settings.summary = CODEX_SESSION_REASONING_SUMMARY;
  }
  return settings;
}

function codexAppServerContextRefreshInstruction({
  contextRefresh = "",
  continuation = "Apply this refresh as additional context for the real Vibe64 input above."
} = {}) {
  const normalizedRefresh = normalizeAgentText(contextRefresh);
  if (!normalizedRefresh) {
    return "";
  }
  return [
    "VIBE64_CONTEXT_REFRESH: refreshed session briefing after Codex context compaction.",
    "This section is developer/session context, not a user request.",
    "Apply it silently. Do not answer, summarize, or mention this refresh directly.",
    normalizeAgentText(continuation),
    "",
    "--- BEGIN FRESH VIBE64 SESSION BRIEFING ---",
    normalizedRefresh,
    "--- END FRESH VIBE64 SESSION BRIEFING ---"
  ].filter(Boolean).join("\n");
}

function codexAppServerPromptWithContextRefresh({
  contextRefresh = "",
  prompt = "",
  promptLabel = "Real Vibe64 routed turn"
} = {}) {
  const normalizedPrompt = String(prompt || "").trim();
  const refreshInstruction = codexAppServerContextRefreshInstruction({
    contextRefresh
  });
  if (!normalizedPrompt || !refreshInstruction) {
    return normalizedPrompt;
  }
  return [
    normalizedPrompt,
    "",
    `${normalizeAgentText(promptLabel) || "Real Vibe64 input"} context refresh:`,
    refreshInstruction
  ].join("\n");
}

function codexAppServerTurnPrompt({
  contextRefresh = "",
  prompt = "",
  promptLabel = ""
} = {}) {
  return codexAppServerPromptWithContextRefresh({
    contextRefresh,
    prompt,
    promptLabel: normalizeAgentText(promptLabel) || "Real Vibe64 routed turn"
  });
}

function codexContextRecoveryTemplate() {
  if (!codexContextRecoveryTemplatePromise) {
    codexContextRecoveryTemplatePromise = readFile(CODEX_CONTEXT_RECOVERY_PROMPT_URL, "utf8");
  }
  return codexContextRecoveryTemplatePromise;
}

function renderCodexContextRecoveryTemplate(template = "", values = {}) {
  return String(template || "").replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (_match, key) => {
    return Object.hasOwn(values, key) ? String(values[key] ?? "") : "";
  });
}

function conversationMessageLines(label = "", message = null) {
  const text = normalizeAgentText(message?.text);
  if (!text) {
    return [];
  }
  const at = normalizeAgentText(message?.at);
  return [
    `### ${label}${at ? ` (${at})` : ""}`,
    text
  ];
}

function formatCodexRecoveryConversationTurn(turn = {}, index = 0) {
  const lines = [`## Turn ${index + 1}`];
  lines.push(...conversationMessageLines("System", turn.system));
  lines.push(...conversationMessageLines("User", turn.user));
  for (const [thinkingIndex, thinking] of (Array.isArray(turn.thinking) ? turn.thinking : []).entries()) {
    lines.push(...conversationMessageLines(`Assistant Thinking ${thinkingIndex + 1}`, thinking));
  }
  lines.push(...conversationMessageLines("Assistant", turn.assistant));
  return lines.length > 1 ? lines.join("\n\n") : "";
}

function formatCodexRecoveryConversationLog(turns = []) {
  const formattedTurns = (Array.isArray(turns) ? turns : [])
    .map((turn, index) => formatCodexRecoveryConversationTurn(turn, index))
    .filter(Boolean);
  return formattedTurns.length
    ? formattedTurns.join("\n\n---\n\n")
    : "(No persisted Vibe64 UI conversation messages were available.)";
}

async function codexContextRecoveryPrompt({
  error,
  newThreadId = "",
  previousThreadId = "",
  runtime,
  sessionId = "",
  workdir = ""
} = {}) {
  const conversationLog = typeof runtime?.store?.readConversationLog === "function"
    ? await runtime.store.readConversationLog(sessionId)
    : [];
  return renderCodexContextRecoveryTemplate(await codexContextRecoveryTemplate(), {
    conversationLog: formatCodexRecoveryConversationLog(conversationLog),
    newThreadId: normalizeAgentText(newThreadId),
    previousThreadId: normalizeAgentText(previousThreadId),
    resumeError: normalizeAgentText(error?.message || String(error || "")),
    sessionId: normalizeAgentText(sessionId),
    workdir: normalizeWorkdir(workdir)
  }).trim();
}

function codexAppServerRuntimeMetadata(runtime = {}) {
  return {
    endpoint: normalizeAgentText(runtime.endpoint),
    runtimeDir: normalizeAgentText(runtime.runtimeDir),
    socketPath: normalizeAgentText(runtime.socketPath),
    transport: normalizeAgentText(runtime.transport)
  };
}

function codexAppServerIdentityMetadata({
  appServerRuntime = {},
  capturedAt = new Date().toISOString(),
  terminalSessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  const normalizedWorkdir = normalizeWorkdir(workdir);
  if (!normalizedThreadId || !normalizedWorkdir) {
    throw new Error("Codex app-server identity requires a thread id and workdir.");
  }
  const runtimeMetadata = codexAppServerRuntimeMetadata(appServerRuntime);
  const hostCli = runtimeMetadata.endpoint
    ? codexCliResumeCommand({
        endpoint: runtimeMetadata.endpoint,
        threadId: normalizedThreadId
      }).command
    : "";
  return {
    agent_workflow_result_transport: CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
    agent_identity_captured_at: capturedAt,
    agent_identity_conversation_id: normalizedThreadId,
    agent_identity_error: "",
    agent_identity_provider: CODEX_SESSION_AGENT_PROVIDER,
    agent_identity_resume_strategy: "provider-native",
    agent_identity_status: "ready",
    agent_identity_terminal_session_id: normalizeAgentText(terminalSessionId),
    agent_identity_updated_at: capturedAt,
    agent_identity_workdir: normalizedWorkdir,
    agent_resume_command: hostCli,
    agent_transport_endpoint: runtimeMetadata.endpoint,
    agent_transport_id: CODEX_APP_SERVER_PROVIDER_ID,
    agent_transport_kind: runtimeMetadata.transport,
    agent_transport_runtime_dir: runtimeMetadata.runtimeDir,
    agent_transport_socket_path: runtimeMetadata.socketPath
  };
}

async function writeCodexAppServerIdentityMetadata({
  appServerRuntime = {},
  runtime,
  sessionId = "",
  terminalSessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  const metadata = codexAppServerIdentityMetadata({
    appServerRuntime,
    terminalSessionId,
    threadId,
    workdir
  });
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      runtime.store.writeMetadataValue(sessionId, name, String(value || ""))
    )));
  });
  return metadata;
}

function codexAppServerThreadIdForSession(session = {}, workdir = "") {
  const metadata = session.metadata || {};
  if (metadata.agent_transport_id !== CODEX_APP_SERVER_PROVIDER_ID) {
    return "";
  }
  const recordedWorkdir = normalizeWorkdir(metadata.agent_identity_workdir);
  const expectedWorkdir = normalizeWorkdir(workdir);
  if (!recordedWorkdir || !expectedWorkdir || recordedWorkdir !== expectedWorkdir) {
    return "";
  }
  if (metadata.agent_identity_provider && metadata.agent_identity_provider !== CODEX_SESSION_AGENT_PROVIDER) {
    return "";
  }
  if (metadata.agent_identity_status && metadata.agent_identity_status !== "ready") {
    return "";
  }
  return normalizeAgentText(metadata.agent_identity_conversation_id);
}

async function codexAppServerThreadHasReadableHistory(provider = null, threadId = "") {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId || typeof provider?.readThread !== "function") {
    return false;
  }
  try {
    await provider.readThread(normalizedThreadId);
    return true;
  } catch (error) {
    if (codexAppServerRequestIsInvalid(error, "thread/read")) {
      return false;
    }
    throw error;
  }
}

function codexAppServerNotificationParams(notification = {}) {
  const params = notification?.params;
  return params && typeof params === "object" && !Array.isArray(params) ? params : {};
}

function codexAppServerNotificationThreadId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeAgentText(params.threadId || params.thread?.id);
}

function codexAppServerNotificationTurnId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeAgentText(params.turnId || params.turn?.id);
}

function codexAppServerNotificationTurnStatus(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const status = params.status && typeof params.status === "object" && !Array.isArray(params.status)
    ? params.status.type
    : params.status;
  return normalizeAgentText(params.turn?.status || status);
}

function codexAppServerTurnStatusIsComplete(status = "") {
  return ["completed", "interrupted", "failed", "idle"].includes(normalizeAgentText(status));
}

function codexAppServerNotificationCompletesTurn(notification = {}) {
  const method = normalizeAgentText(notification.method);
  if (method === "turn/completed") {
    return true;
  }
  return method === "thread/status/changed" &&
    codexAppServerTurnStatusIsComplete(codexAppServerNotificationTurnStatus(notification));
}

function createCodexAppServerTurnCompletionWatcher(provider, threadId = "", {
  timeoutMs = CODEX_APP_SERVER_CONTEXT_TURN_TIMEOUT_MS
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  const completedTurnIds = new Set();
  const waiters = new Map();
  const resolveWaiter = (waiter) => {
    clearTimeout(waiter.timeout);
    waiter.resolve();
  };
  const completeTurn = (turnId = "") => {
    const normalizedTurnId = normalizeAgentText(turnId);
    completedTurnIds.add(normalizedTurnId || "*");
    for (const [waiterTurnId, waiter] of waiters.entries()) {
      if (!normalizedTurnId || !waiterTurnId || normalizedTurnId === waiterTurnId) {
        waiters.delete(waiterTurnId);
        resolveWaiter(waiter);
      }
    }
  };
  const unsubscribe = typeof provider?.subscribe === "function"
    ? provider.subscribe((notification = {}) => {
        const notificationThreadId = codexAppServerNotificationThreadId(notification);
        if (notificationThreadId && notificationThreadId !== normalizedThreadId) {
          return;
        }
        if (codexAppServerNotificationCompletesTurn(notification)) {
          completeTurn(codexAppServerNotificationTurnId(notification));
        }
      })
    : null;

  return {
    dispose() {
      unsubscribe?.();
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timeout);
      }
      waiters.clear();
    },
    wait(turnId = "") {
      if (!unsubscribe) {
        return Promise.resolve();
      }
      const normalizedTurnId = normalizeAgentText(turnId);
      if (completedTurnIds.has("*") || (normalizedTurnId && completedTurnIds.has(normalizedTurnId))) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const waiterKey = normalizedTurnId || `waiter:${waiters.size + 1}`;
        const timeout = setTimeout(() => {
          waiters.delete(waiterKey);
          reject(new Error("Timed out waiting for the Codex context turn to complete."));
        }, timeoutMs);
        waiters.set(waiterKey, {
          resolve,
          timeout
        });
      });
    }
  };
}

async function sendCodexAppServerContextTurn({
  agentSettings = {},
  input = "",
  provider,
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw new Error("Codex app-server context delivery requires a thread id.");
  }
  if (!normalizeAgentText(input)) {
    throw new Error("Codex app-server context delivery requires input.");
  }
  const watcher = createCodexAppServerTurnCompletionWatcher(provider, normalizedThreadId);
  try {
    const turn = await provider.sendTurn(
      normalizedThreadId,
      input,
      codexAppServerTurnSettings({
        agentSettings,
        cwd: workdir
      })
    );
    if (!codexAppServerTurnStatusIsComplete(turn.status)) {
      await watcher.wait(turn.id);
    }
    return {
      input,
      turn
    };
  } finally {
    watcher.dispose();
  }
}

async function sendCodexAppServerContextRecoveryTurn({
  agentSettings = {},
  error,
  previousThreadId = "",
  provider,
  runtime,
  sessionId = "",
  threadId = "",
  workdir = ""
} = {}) {
  return sendCodexAppServerContextTurn({
    agentSettings,
    input: await codexContextRecoveryPrompt({
      error,
      newThreadId: threadId,
      previousThreadId,
      runtime,
      sessionId,
      workdir
    }),
    provider,
    threadId,
    workdir
  });
}

async function writeCodexAppServerReplacementMetadata({
  error,
  runtime,
  sessionId = "",
  threadId = ""
} = {}) {
  const previousThreadId = normalizeAgentText(threadId);
  if (!previousThreadId) {
    return;
  }
  const metadata = {
    codex_app_server_replaced_thread_at: new Date().toISOString(),
    codex_app_server_replaced_thread_error: normalizeAgentText(error?.message || String(error || "")),
    codex_app_server_replaced_thread_id: previousThreadId
  };
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      runtime.store.writeMetadataValue(sessionId, name, String(value || ""))
    )));
  });
}

async function ensureCodexAppServerThreadForSession({
  agentSettings = {},
  developerInstructions = "",
  provider,
  runtime,
  session = {},
  workdir = ""
} = {}) {
  const normalizedWorkdir = normalizeWorkdir(workdir);
  const appServerRuntime = await provider.ensureRuntime();
  const existingThreadId = codexAppServerThreadIdForSession(session, normalizedWorkdir);
  const threadSettings = codexAppServerThreadSettings({
    agentSettings,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  const threadStartSettings = codexAppServerThreadStartSettings({
    agentSettings,
    cwd: normalizedWorkdir,
    developerInstructions
  });
  let replacedThreadError = null;
  let thread = null;
  const existingThreadSupportsWorkflowResults = normalizeAgentText(
    session.metadata?.agent_workflow_result_transport
  ) === CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT;
  if (existingThreadId && existingThreadSupportsWorkflowResults) {
    try {
      thread = await provider.resumeThread(existingThreadId, threadSettings);
    } catch (error) {
      if (
        !codexAppServerRequestIsInvalid(error, "thread/resume") ||
        await codexAppServerThreadHasReadableHistory(provider, existingThreadId)
      ) {
        throw error;
      }
      replacedThreadError = error;
      thread = await provider.startThread(threadStartSettings);
    }
  } else if (existingThreadId) {
    replacedThreadError = new Error("The existing Codex thread does not provide the current Vibe64 workflow-result control.");
    thread = await provider.startThread(threadStartSettings);
  } else {
    thread = await provider.startThread(threadStartSettings);
  }
  const threadId = normalizeAgentText(thread.id || (replacedThreadError ? "" : existingThreadId));
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  const recovery = replacedThreadError
    ? await sendCodexAppServerContextRecoveryTurn({
        agentSettings,
        error: replacedThreadError,
        previousThreadId: existingThreadId,
        provider,
        runtime,
        sessionId: session.sessionId,
        threadId,
        workdir: normalizedWorkdir
      })
    : null;
  await writeCodexAppServerIdentityMetadata({
    appServerRuntime,
    runtime,
    sessionId: session.sessionId,
    threadId,
    workdir: normalizedWorkdir
  });
  if (replacedThreadError) {
    await writeCodexAppServerReplacementMetadata({
      error: replacedThreadError,
      runtime,
      sessionId: session.sessionId,
      threadId: existingThreadId
    });
  }
  return {
    appServerRuntime,
    recovery,
    replacedThreadError,
    replacedThreadId: replacedThreadError ? existingThreadId : "",
    thread,
    threadId
  };
}

async function sendCodexAppServerPromptForSession({
  agentSettings = {},
  clientUserMessageId = "",
  contextRefresh = "",
  provider,
  prompt = "",
  promptLabel = "",
  threadId = "",
  workdir = ""
} = {}) {
  const input = codexAppServerTurnPrompt({
    contextRefresh,
    prompt,
    promptLabel
  });
  if (!input) {
    throw new Error("Codex app-server prompt is empty.");
  }
  const turn = await provider.sendTurn(threadId, input, {
    ...codexAppServerTurnSettings({
      agentSettings,
      cwd: workdir
    }),
    ...(normalizeAgentText(clientUserMessageId)
      ? { clientUserMessageId: normalizeAgentText(clientUserMessageId) }
      : {})
  });
  return {
    input,
    turn
  };
}

export {
  CODEX_SESSION_AGENT_PROVIDER,
  CODEX_SESSION_APPROVAL_POLICY,
  CODEX_SESSION_MODEL,
  CODEX_SESSION_REASONING_EFFORT,
  CODEX_SESSION_REASONING_SUMMARY,
  CODEX_SESSION_SANDBOX,
  CODEX_APP_SERVER_WORKFLOW_RESULT_TOOL_NAME,
  CODEX_APP_SERVER_WORKFLOW_RESULT_TRANSPORT,
  codexAppServerIdentityMetadata,
  codexAppServerPromptWithContextRefresh,
  codexAppServerThreadHasReadableHistory,
  codexAppServerThreadIdForSession,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnPrompt,
  codexAppServerTurnSettings,
  codexAppServerWorkflowResultTool,
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession,
  writeCodexAppServerIdentityMetadata
};
