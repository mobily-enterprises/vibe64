import {
  readFile
} from "node:fs/promises";

import {
  CODEX_APP_SERVER_PROVIDER_ID,
  codexCliResumeCommand
} from "./codexAppServerProvider.js";
import {
  normalizeAgentText
} from "./agentProviders.js";
import {
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  effectiveVibe64AgentSettings
} from "../shared/agentSettings.js";

const CODEX_SESSION_AGENT_PROVIDER = "codex";
const CODEX_SESSION_MODEL = VIBE64_CODEX_DEFAULT_MODEL;
const CODEX_SESSION_REASONING_EFFORT = VIBE64_CODEX_DEFAULT_THINKING;
const CODEX_SESSION_REASONING_SUMMARY = "concise";
const CODEX_SESSION_APPROVAL_POLICY = "never";
const CODEX_SESSION_SANDBOX = "danger-full-access";
const CODEX_APP_SERVER_BOOTSTRAP_TIMEOUT_MS = 60000;
const CODEX_APP_SERVER_BOOTSTRAP_PROMPT = [
  "VIBE64_SESSION_BOOTSTRAP: create a resumable Codex session for Vibe64.",
  "Do not inspect files, run commands, or submit workflow results.",
  "Reply exactly: Vibe64 Codex session ready."
].join("\n");
const CODEX_CONTEXT_RECOVERY_PROMPT_URL = new URL("./prompts/codex_context_recovery.txt", import.meta.url);
let codexContextRecoveryTemplatePromise = null;

function normalizeWorkdir(value = "") {
  return normalizeAgentText(value);
}

function codexEffectiveAgentSettings(agentSettings = {}) {
  return effectiveVibe64AgentSettings(agentSettings);
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
  const effectiveSettings = codexEffectiveAgentSettings(agentSettings);
  return {
    approvalPolicy: CODEX_SESSION_APPROVAL_POLICY,
    cwd: normalizedCwd,
    effort: normalizeAgentText(effort) || effectiveSettings.thinking,
    model: normalizeAgentText(model) || effectiveSettings.model,
    sandboxPolicy: {
      type: "dangerFullAccess"
    },
    summary: CODEX_SESSION_REASONING_SUMMARY
  };
}

function codexAppServerPromptWithContextRefresh({
  contextRefresh = "",
  prompt = "",
  promptLabel = "Real Vibe64 routed turn"
} = {}) {
  const normalizedPrompt = String(prompt || "").trim();
  const normalizedRefresh = normalizeAgentText(contextRefresh);
  if (!normalizedPrompt || !normalizedRefresh) {
    return normalizedPrompt;
  }
  return [
    "VIBE64_CONTEXT_REFRESH: refreshed session briefing after Codex context compaction.",
    "This section is developer/session context, not a user request.",
    "Apply it silently. Do not answer, summarize, or mention this refresh directly.",
    "After applying the refresh, continue with the real Vibe64 input below.",
    "",
    "--- BEGIN FRESH VIBE64 SESSION BRIEFING ---",
    normalizedRefresh,
    "--- END FRESH VIBE64 SESSION BRIEFING ---",
    "",
    `${normalizeAgentText(promptLabel) || "Real Vibe64 input"}:`,
    "--- BEGIN VIBE64 INPUT ---",
    normalizedPrompt,
    "--- END VIBE64 INPUT ---"
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
    containerEndpoint: normalizeAgentText(runtime.containerEndpoint || runtime.endpoint),
    containerRuntimeDir: normalizeAgentText(runtime.containerRuntimeDir),
    containerSocketPath: normalizeAgentText(runtime.containerSocketPath),
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
  const containerCli = runtimeMetadata.containerEndpoint
    ? codexCliResumeCommand({
        endpoint: runtimeMetadata.containerEndpoint,
        target: "container",
        threadId: normalizedThreadId
      }).command
    : "";
  return {
    agent_identity_captured_at: capturedAt,
    agent_identity_conversation_id: normalizedThreadId,
    agent_identity_error: "",
    agent_identity_provider: CODEX_SESSION_AGENT_PROVIDER,
    agent_identity_resume_strategy: "provider-native",
    agent_identity_status: "ready",
    agent_identity_terminal_session_id: normalizeAgentText(terminalSessionId),
    agent_identity_updated_at: capturedAt,
    agent_identity_workdir: normalizedWorkdir,
    codex_app_server_container_endpoint: runtimeMetadata.containerEndpoint,
    codex_app_server_container_runtime_dir: runtimeMetadata.containerRuntimeDir,
    codex_app_server_container_socket_path: runtimeMetadata.containerSocketPath,
    codex_app_server_endpoint: runtimeMetadata.endpoint,
    codex_app_server_provider: CODEX_APP_SERVER_PROVIDER_ID,
    codex_app_server_runtime_dir: runtimeMetadata.runtimeDir,
    codex_app_server_socket_path: runtimeMetadata.socketPath,
    codex_app_server_transport: runtimeMetadata.transport,
    codex_cli_resume_command: hostCli,
    codex_container_cli_resume_command: containerCli,
    codex_thread_id: normalizedThreadId,
    codex_workdir: normalizedWorkdir
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
  if (metadata.codex_app_server_provider !== CODEX_APP_SERVER_PROVIDER_ID) {
    return "";
  }
  const recordedWorkdir = normalizeWorkdir(metadata.agent_identity_workdir || metadata.codex_workdir);
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
  return normalizeAgentText(metadata.agent_identity_conversation_id || metadata.codex_thread_id);
}

function codexAppServerResumeErrorIsMissingThread(error) {
  const message = normalizeAgentText(error?.message || String(error || "")).toLowerCase();
  return message.includes("no rollout found for thread id")
    || (message.includes("thread") && message.includes("not found"));
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
  timeoutMs = CODEX_APP_SERVER_BOOTSTRAP_TIMEOUT_MS
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
          reject(new Error("Timed out waiting for Codex app-server bootstrap turn to complete."));
        }, timeoutMs);
        waiters.set(waiterKey, {
          resolve,
          timeout
        });
      });
    }
  };
}

async function sendCodexAppServerBootstrapTurn({
  agentSettings = {},
  input = CODEX_APP_SERVER_BOOTSTRAP_PROMPT,
  provider,
  threadId = "",
  workdir = ""
} = {}) {
  const normalizedThreadId = normalizeAgentText(threadId);
  if (!normalizedThreadId) {
    throw new Error("Codex app-server bootstrap requires a thread id.");
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
  return sendCodexAppServerBootstrapTurn({
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
  let replacedThreadError = null;
  let startedNewThread = false;
  let thread = null;
  if (existingThreadId) {
    try {
      thread = await provider.resumeThread(existingThreadId, threadSettings);
    } catch (error) {
      if (!codexAppServerResumeErrorIsMissingThread(error)) {
        throw error;
      }
      replacedThreadError = error;
      thread = await provider.startThread(threadSettings);
      startedNewThread = true;
    }
  } else {
    thread = await provider.startThread(threadSettings);
    startedNewThread = true;
  }
  const threadId = normalizeAgentText(thread.id || (replacedThreadError ? "" : existingThreadId));
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  const bootstrap = startedNewThread
    ? await sendCodexAppServerBootstrapTurn({
        agentSettings,
        provider,
        threadId,
        workdir: normalizedWorkdir
      })
    : null;
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
    bootstrap,
    recovery,
    replacedThreadError,
    replacedThreadId: replacedThreadError ? existingThreadId : "",
    thread,
    threadId
  };
}

async function sendCodexAppServerPromptForSession({
  agentSettings = {},
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
  const turn = await provider.sendTurn(threadId, input, codexAppServerTurnSettings({
    agentSettings,
    cwd: workdir
  }));
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
  codexAppServerIdentityMetadata,
  codexAppServerPromptWithContextRefresh,
  codexAppServerThreadIdForSession,
  codexAppServerThreadSettings,
  codexAppServerTurnPrompt,
  codexAppServerTurnSettings,
  sendCodexAppServerBootstrapTurn,
  ensureCodexAppServerThreadForSession,
  sendCodexAppServerPromptForSession,
  writeCodexAppServerIdentityMetadata
};
