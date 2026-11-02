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
