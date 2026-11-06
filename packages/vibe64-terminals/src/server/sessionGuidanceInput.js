/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * The engine-neutral Vibe64 guidance input of a session conversation. Codex,
 * Claude and OpenCode all register this one description of the session's
 * managed commands, so every engine is told about the same commands.
 * @param {object} input
 * @param {"main" | "temporary"} input.conversationKind
 * @param {RuntimeEnv} [input.env] carries the host's own agent guidance, if any
 * @param {object} input.commands the session's managed command services; each is absent when unavailable
 */
function sessionGuidanceInput({ conversationKind, env, commands }) {
  return {
    scope: "session",
    conversationKind,
    ...(env?.VIBE64_HOST_AGENT_GUIDANCE ? { hostGuidance: env.VIBE64_HOST_AGENT_GUIDANCE } : {}),
    session: {
      managedDatabaseRefresh: Boolean(commands.agentDatabaseCommand),
      managedEnvironment: Boolean(commands.agentEnvCommand),
      managedGit: Boolean(commands.codexGitCommand),
      // Absent rather than false: guidance registered before pages existed stays valid.
      ...(commands.agentPagesCommand ? { managedPages: true } : {}),
      managedPreview: Boolean(commands.agentPreviewCommand)
    }
  };
}

export { sessionGuidanceInput };
