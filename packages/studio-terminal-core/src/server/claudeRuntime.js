import { stat } from "node:fs/promises";
import path from "node:path";
import { appCredentialContext, runVibe64Command } from "@local/vibe64-execution/server";
import { STUDIO_MANAGED_CLAUDE_COMMAND } from "./studioRuntimeIdentity.js";

const statusReads = new WeakMap();

async function readClaudeCodeAuthStatus({ env = process.env, credentialHome = appCredentialContext(), commandRunner = runVibe64Command } = {}) {
  if (credentialHome?.ok === false) return { loggedIn: false, error: credentialHome.error };
  const configRoot = env.CLAUDE_CONFIG_DIR || path.join(credentialHome.home, ".claude");
  // Inspect file metadata only. Claude still owns reading and validating credentials.
  const revisions = await Promise.all([
    path.join(configRoot, ".credentials.json"), path.join(configRoot, ".claude.json"),
    path.join(credentialHome.home, ".claude.json")
  ].map(async (file) => {
    try {
      const value = await stat(file, { bigint: true });
      return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }));
  let reads = statusReads.get(commandRunner);
  if (!reads) statusReads.set(commandRunner, reads = new Map());
  const key = JSON.stringify([env, credentialHome]);
  const revision = JSON.stringify(revisions);
  const previous = reads.get(key);
  if (previous?.revision === revision && (previous.pending || previous.expiresAt > Date.now())) return previous.value;
  const entry = { revision, pending: true, expiresAt: 0 };
  reads.set(key, entry);
  entry.value = readNativeClaudeCodeAuthStatus({ env, credentialHome, commandRunner }).then((status) => {
    // Keychain changes cannot be observed with file metadata on macOS.
    if (!status.error && process.platform !== "darwin") entry.expiresAt = Date.now() + 30_000;
    return Object.freeze(status);
  }).finally(() => { entry.pending = false; });
  return entry.value;
}

async function readNativeClaudeCodeAuthStatus({ env, credentialHome, commandRunner }) {
  const result = await commandRunner({
    actor: "app", command: env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND,
    args: ["auth", "status", "--json"], baseEnv: env, inheritProcessEnv: false,
    credentialHome, cwd: credentialHome.home, allowedRoots: [credentialHome.home],
    mode: "capture", purpose: "account", envPolicy: "auth", runtimes: ["operator-clis", "node26"],
    timeout: 30_000, maxBuffer: 64 * 1024
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
