import {
  aiStudioResult as sharedAiStudioResult,
  normalizePlainObject
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  dockerCommand,
  shellQuote,
  stableHash
} from "../../../../server/lib/shellCommands.js";

const CODEX_TERMINAL_NAMESPACE = "ai-studio-codex";
const CODEX_TERMINAL_NAMESPACE_PREFIX = `${CODEX_TERMINAL_NAMESPACE}:`;
const COMMAND_TERMINAL_NAMESPACE = "ai-studio-command";
const LAUNCH_TARGET_TERMINAL_NAMESPACE = "ai-studio-launch-target";

function aiStudioResult(operation) {
  return sharedAiStudioResult(operation, {
    fallbackCode: "ai_studio_terminal_request_failed",
    fallbackMessage: "AI Studio terminal request failed."
  });
}

function codexTerminalNamespace(sessionId) {
  return `${CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function commandTerminalNamespace(sessionId) {
  return `${COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function launchTargetTerminalNamespace(sessionId) {
  return `${LAUNCH_TARGET_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

export {
  CODEX_TERMINAL_NAMESPACE_PREFIX,
  aiStudioResult,
  codexTerminalNamespace,
  commandTerminalNamespace,
  launchTargetTerminalNamespace,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
