import { appCredentialContext, runVibe64Command } from "@local/vibe64-execution/server";
import { STUDIO_MANAGED_CLAUDE_COMMAND } from "./studioRuntimeIdentity.js";

async function readClaudeCodeAuthStatus({ env = process.env, credentialHome = appCredentialContext(), commandRunner = runVibe64Command } = {}) {
  if (credentialHome?.ok === false) return { loggedIn: false, error: credentialHome.error };
  const result = await commandRunner({
    actor: "app", command: env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND,
    args: ["auth", "status", "--json"], baseEnv: env, inheritProcessEnv: false,
    credentialHome, cwd: credentialHome.home, allowedRoots: [credentialHome.home],
    mode: "capture", purpose: "account", envPolicy: "auth", runtimes: ["operator-clis", "node26"],
    timeout: 20_000, maxBuffer: 64 * 1024
  });
  const failure = { loggedIn: false, error: result.error || "Claude Code is not connected." };
  if (!result.ok && (result.exitCode !== 1 || result.timedOut || result.signal)) return failure;
  try {
    const status = JSON.parse(result.stdout || result.output);
    // Native auth status exits 1 for a normal signed-out JSON response.
    if (!result.ok && status?.loggedIn !== false) return failure;
    if (typeof status?.loggedIn !== "boolean") throw new Error("Invalid account status.");
    return { loggedIn: status.loggedIn === true, email: String(status.email || ""),
      authMethod: String(status.authMethod || ""), subscriptionType: String(status.subscriptionType || "") };
  } catch {
    return result.ok ? { loggedIn: false, error: "Claude Code returned an invalid account status." } : failure;
  }
}

export { readClaudeCodeAuthStatus };
