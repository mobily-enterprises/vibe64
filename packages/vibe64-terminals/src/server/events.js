import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */

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
  const sessionChanged = createSessionChangedPublisher(events);
  return {
    agentTerminal: sessionChanged,
    agentTerminalClosed: sessionChanged,
    outputTarget: sessionChanged,
    outputTargetClosed: sessionChanged,
    outputTargetStopped: sessionChanged
  };
}

export {
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublishers
};
