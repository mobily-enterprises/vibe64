import { readClaudeCodeAuthStatus as readNativeStatus } from "@jskit-ai/assistant-core/server/claude-process";
import { appCredentialContext, runVibe64Command } from "@local/vibe64-execution/server";
import { STUDIO_MANAGED_CLAUDE_COMMAND } from "./studioRuntimeIdentity.js";

const runners = new WeakMap();

async function readClaudeCodeAuthStatus({ env = process.env, credentialHome = appCredentialContext(), commandRunner = runVibe64Command } = {}) {
  let capture = runners.get(commandRunner);
  if (!capture) {
    capture = (input) => commandRunner({
      ...input, actor: "app", inheritProcessEnv: false, allowedRoots: [input.cwd],
      purpose: "account", envPolicy: "auth", runtimes: ["operator-clis", "node26"]
    });
    runners.set(commandRunner, capture);
  }
  return readNativeStatus({ env, credentialHome, commandRunner: capture,
    command: env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND });
}

export { readClaudeCodeAuthStatus };
