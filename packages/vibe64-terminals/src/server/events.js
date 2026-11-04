import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */

const VIBE64_CONVERSATION_TURN_STARTING_EVENT = "vibe64.conversation.turn-starting";
const VIBE64_CONVERSATION_TURN_SETTLED_EVENT = "vibe64.conversation.turn-settled";

/** @param {RuntimeEvents} events */
function createProjectRuntimeChangedPublisher(events) {
  const publishProjectChanged = createVibe64ProjectChangedPublisher({ events });
  return async function publishProjectRuntimeChanged(result, options = {}) {
    const { action = "", dormant = false } = options;
    const source = result || {};
    const projectSlug = String(source.projectSlug || "").trim();
    if (source.ok === false || !projectSlug || !source.runtime) {
      return null;
    }
    return publishProjectChanged({
      action,
      projectSlug,
      runtime: source.runtime,
      ...(action === "runtime-closed" && source.runtime.open === false ? {
        runtimeCloseReason: String(source.reason || "").trim().slice(0, 100),
        ...(dormant === true ? { runtimeDormantClose: true } : {})
      } : {})
    }, { reason: action });
  };
}

/**
 * The session changes the terminals service publishes, one publisher per kind
 * of change; they all share one session change publisher.
 * @param {RuntimeEvents} events
 */
function createTerminalSessionChangedPublishers(events) {
  const sessionChanged = createSessionChangedPublisher({ events });
  return Object.freeze({
    agentTerminal: sessionChanged,
    agentTerminalClosed: sessionChanged,
    outputTarget: sessionChanged,
    outputTargetClosed: sessionChanged,
    outputTargetStopped: sessionChanged
  });
}

/**
 * What other features learn about a turn. `starting` is awaited before a message is sent, so a
 * listener can refuse it by throwing. `settled` says a turn ended and carries no result: a listener
 * reads the conversation. `conversationId` is empty for Main; `failure` names a message that never reached the AI.
 * @param {RuntimeEvents} events
 */
function createConversationTurnPublishers(events) {
  function starting(sessionId, turn) {
    return events.publish({ type: VIBE64_CONVERSATION_TURN_STARTING_EVENT, sessionId, ...turn });
  }

  function settled(sessionId, conversationId, failure = null) {
    return events.publish({ type: VIBE64_CONVERSATION_TURN_SETTLED_EVENT, sessionId, conversationId, failure });
  }

  return Object.freeze({
    starting,
    settled
  });
}

export {
  VIBE64_CONVERSATION_TURN_SETTLED_EVENT,
  VIBE64_CONVERSATION_TURN_STARTING_EVENT,
  createConversationTurnPublishers,
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublishers
};
