import { readClaudeCodeAuthStatus as readNativeStatus } from "@jskit-ai/assistant-core/server/claude-process";
import { appCredentialContext, operatorCliCommand, runVibe64Command } from "@local/vibe64-execution/server";

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
    command: operatorCliCommand("claude", { env }) });
}

export { readClaudeCodeAuthStatus };
