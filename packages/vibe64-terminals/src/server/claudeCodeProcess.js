import { fileURLToPath } from "node:url";
import { createVibe64ConversationExecution, shellQuote } from "@local/vibe64-execution/server";
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
  commandRunner, stopExecution, credentialHome, execution, shimDirs, onStarted, ...options
} = {}) {
  return startClaude({
    ...options, permissionMode: "bypassPermissions", settings: claudeFlagSettings(),
    execution: createVibe64ConversationExecution({ commandRunner, stopExecution, credentialHome,
      execution, shimDirs, onStarted, purpose: options.toolFree ? "account" : "assistant",
      operationId: "claude-code", label: "Claude Code assistant" })
  });
}

export { CLAUDE_CODE_VERSION, claudeCodeArguments, claudeFlagSettings, createClaudeCodeProcess };
