import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

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

/**
 * Reports a conversation whose instructions lack Genesis's project guidance because Genesis failed
 * or did not answer in time; the conversation goes on with Vibe64's own guidance.
 * @param {RuntimeLogger} logger
 * @param {{ engineId: string, sessionId: string }} fields
 * @returns {(error: Error) => void}
 */
function reportGenesisGuidanceUnavailable(logger, fields) {
  return (error) => logOperationalEvent(logger, "warn", {
    ...fields,
    code: error?.code || error?.name,
    component: "vibe64.agent_guidance",
    error: String(error?.message || error),
    event: "vibe64.agent_guidance.genesis_unavailable"
  }, "Genesis project guidance is unavailable; the conversation goes on with Vibe64's guidance alone.");
}

/**
 * Reports a conversation whose Vibe64 guidance Genesis cut to fit its limit (its HOST_CONTEXT_TRUNCATED warning, which
 * names the sizes): the conversation goes on with Genesis's guidance whole and Vibe64's up to the cut, which
 * genesisHostContextRegistry.unit.test.js keeps from happening.
 * @param {RuntimeLogger} logger
 * @param {{ engineId: string, sessionId: string }} fields
 * @returns {(warning: { code: string, message: string }) => void}
 */
function reportHostGuidanceCut(logger, fields) {
  return (warning) => logOperationalEvent(logger, "warn", {
    ...fields,
    code: warning.code,
    component: "vibe64.agent_guidance",
    error: String(warning.message || ""),
    event: "vibe64.agent_guidance.host_guidance_cut"
  }, "Genesis cut Vibe64's session guidance to fit its limit; the conversation has Genesis's guidance and Vibe64's up to the cut.");
}

export { reportGenesisGuidanceUnavailable, reportHostGuidanceCut, sessionGuidanceInput };
