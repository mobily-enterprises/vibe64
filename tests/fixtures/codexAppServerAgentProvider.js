import {
  codexAppServerRuntimeBaseDir,
  createCodexAppServerAgentProvider as createProvider
} from "@local/vibe64-runtime/server/codexAppServerAgent";

// A Codex app-server provider a test builds directly. The session registration's
// native owner gives every provider its env and the agent runtime root the
// server's env names; a test that names neither runs its provider in the test
// process's own env, below the root that env names.
export function createCodexAppServerAgentProvider(options = {}) {
  const env = options.env ?? process.env;
  return createProvider({ env, runtimeRoot: codexAppServerRuntimeBaseDir({ env }), ...options });
}

/** A fake provider's part for a worktree with no project hooks: trusting it succeeds and its hook inventory is empty. */
export const hooklessWorktree = Object.freeze({
  async trustProject() {},
  async listHooks() {
    return { data: [] };
  }
});

/**
 * A fake provider's part for threads without managed command controls: there is nothing to bind, no turn is a control
 * probe and no turn was interrupted to reconfigure controls.
 */
export const controllessThreads = Object.freeze({
  async ensureThreadControls() {},
  isControlProbeTurn() {
    return false;
  },
  interruptionOutcome() {
    return "";
  }
});

/** A fake provider's part for a connection that is available without naming its runtime, so callers ask ensureRuntime. */
export const availableConnection = Object.freeze({
  async ensureAvailable() {
    return { ok: true };
  }
});
