import { readClaudeCodeAuthStatus as readNativeStatus } from "@jskit-ai/assistant-core/server/claude-process";
import {
  appCredentialContext, operatorCliCommand, operatorCliStartFailed, runVibe64Command
} from "@local/vibe64-execution/server";

const runners = new WeakMap();
// Native status keeps the runner's error text; this prefix marks a Claude Code that could not be executed.
const CLAUDE_START_FAILED_ERROR = "Claude Code didn't start.";
// The account-wide sign-in read belongs to no project or session.
const CLAUDE_STATUS_EXECUTION = Object.freeze({ label: "Checking the Claude sign-in", operationId: "claude-auth-status" });

async function readClaudeCodeAuthStatus({ env = process.env, credentialHome = appCredentialContext(), commandRunner = runVibe64Command } = {}) {
  let capture = runners.get(commandRunner);
  if (!capture) {
    capture = async (input) => {
      const result = await commandRunner({
        ...input, actor: "app", inheritProcessEnv: false, allowedRoots: [input.cwd],
        purpose: "account", envPolicy: "auth", runtimes: ["operator-clis", "node26"],
        execution: CLAUDE_STATUS_EXECUTION
      });
      return operatorCliStartFailed(result)
        ? { ...result, error: [CLAUDE_START_FAILED_ERROR, result.error || result.output || ""].join("\n").trim() }
        : result;
    };
    runners.set(commandRunner, capture);
  }
  return readNativeStatus({ env, credentialHome, commandRunner: capture,
    command: operatorCliCommand("claude", { env }) });
}

/** True when the status read could not execute Claude Code at all. */
function claudeStatusStartFailed(status = {}) {
  return String(status?.error || "").startsWith(CLAUDE_START_FAILED_ERROR);
}

export { claudeStatusStartFailed, readClaudeCodeAuthStatus };
