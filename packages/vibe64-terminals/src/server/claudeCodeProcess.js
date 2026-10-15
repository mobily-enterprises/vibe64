import { fileURLToPath } from "node:url";
import { createVibe64ConversationExecution, shellQuote } from "@local/vibe64-execution/server";
import { logOperationalEvent, sanitizeOperationText, shouldRedactLogField } from "@local/vibe64-core/server/logging";
import { claudeCodeArguments as nativeClaudeArguments, claudeFlagSettings as nativeClaudeFlagSettings, createClaudeCodeProcess as startClaude } from "@jskit-ai/assistant-core/server/claude-process";

const CLAUDE_CODE_VERSION = "2.1.289";


function claudeFlagSettings({ toolFree = false, effort = "", providerEnv } = {}) {
  const commandHook = {
    timeout: 30,
    command: [process.execPath, fileURLToPath(import.meta.resolve("@local/vibe64-runtime/server/agentSessionCommandHook"))].map(shellQuote).join(" ")
  };
  return nativeClaudeFlagSettings({ effort, providerEnv,
    ...(!toolFree ? { commandHook } : {}) });
}

function claudeCodeArguments(options = {}) {
  return nativeClaudeArguments({ permissionMode: "bypassPermissions", settings: claudeFlagSettings(), ...options });
}

async function createClaudeCodeProcess({
  commandRunner, stopExecution, credentialHome, execution, shimDirs, onStarted, logger, ...options
} = {}) {
  const host = createVibe64ConversationExecution({ commandRunner, stopExecution, credentialHome,
    execution, shimDirs, onStarted, purpose: options.toolFree ? "account" : "assistant",
    operationId: "claude-code", label: "Claude Code assistant" });
  let starting = true;
  let native;
  let secrets = [];
  let stderr = "";
  let executionId;
  const startedAt = Date.now();
  function diagnostic(stage, failure) {
    try {
      logOperationalEvent(logger, failure ? "warn" : "info", {
        component: "vibe64.claude", event: "vibe64.claude.startup", stage,
        conversationId: options.sessionId, executionId, durationMs: Date.now() - startedAt,
        code: failure?.code, error: failure ? sanitizeOperationText(failure.message, secrets) : undefined,
        scopeEmpty: failure?.stopProof?.scopeEmpty,
        nativeStartupStderr: failure ? stderr : undefined
      }, failure ? "Claude startup failed." : "Claude startup progress.");
    } catch { /* Diagnostics must not prevent startup or verified cleanup. */ }
  }
  diagnostic("starting");
  try {
    const process = await startClaude({
      ...options, onStarted, permissionMode: "bypassPermissions", settings: claudeFlagSettings(),
      execution: {
        ...host,
        async start(input) {
          secrets = Object.entries(input.env || {}).filter(([name]) => shouldRedactLogField(name))
            .map(([, value]) => String(value ?? "")).filter(value => value.length >= 4);
          native = await host.start(input);
          executionId = native.id;
          diagnostic("stream_ready");
          return native;
        },
        async stop(id, ...args) {
          if (starting && native?.id === id) {
            // The original confirmed stop removes its temporary stderr file.
            // Reading diagnostics must never prevent that cleanup.
            try {
              const logs = native.readLogs();
              const newline = logs.stderr.indexOf("\n");
              const tail = logs.stderrTruncated
                ? (newline < 0 ? "" : logs.stderr.slice(newline + 1))
                : logs.stderr;
              stderr = sanitizeOperationText(tail, secrets).slice(-64 * 1024);
            }
            catch { /* Preserve the original startup error and stop proof. */ }
          }
          return host.stop(id, ...args);
        }
      }
    });
    diagnostic("initialized");
    starting = false;
    secrets = [];
    native = null;
    return process;
  } catch (error) {
    executionId ||= error.executionId;
    diagnostic("failed", error);
    starting = false;
    secrets = [];
    native = null;
    if (stderr) Object.defineProperty(error, "nativeStartupStderr", { value: stderr });
    throw error;
  }
}

export { CLAUDE_CODE_VERSION, claudeCodeArguments, claudeFlagSettings, createClaudeCodeProcess };
