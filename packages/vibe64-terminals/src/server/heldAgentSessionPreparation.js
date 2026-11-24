import { createHeldWork } from "@local/vibe64-core/server/heldWork";
import { currentProjectRequestContext, currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

/**
 * The page's `POST .../agent-session`: `ensureAgentSession` as held work. The page prepares a session's assistant when
 * it opens it, and a cold one (its provider starting, or setup holding the session's write lock) can outlast the
 * hosted edge's minute, so the request answers within two seconds, as preparing while it goes on. A repeat joins it,
 * and one after it ended prepares again, which an assistant already prepared answers at once. Turn recovery calls
 * `ensureAgentSession` itself and waits for it.
 * @param {object} dependencies
 * @param {(sessionId: string, options?: object) => Promise<object>} dependencies.ensureAgentSession
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 */
function createHeldAgentSessionPreparation({ ensureAgentSession, logger }) {
  const held = createHeldWork({ component: "vibe64.agent_session_prepare", logger });

  /**
   * @param {string} sessionId
   * @param {object} [options]
   */
  return async function prepareAgentSession(sessionId, options = {}) {
    const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || "";
    const key = [currentProjectScopeKey(), sessionId, username].join("\0");
    const answer = await held.run(key, ({ stage }) => {
      stage("preparing");
      return ensureAgentSession(sessionId, options);
    });
    if (answer.settled) return answer.result;
    return { ok: true, preparing: true, sessionId, waitingFor: answer.waitingFor };
  };
}

export { createHeldAgentSessionPreparation };
