/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").OutputTargetTerminalController} OutputTargetTerminalController */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("./types.js").SessionNaming} SessionNaming */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */

function normalizeAgentProviderId(value = "") {
  return String(value || "").trim().toLowerCase();
}

/**
 * Stopping the service: its beginning, which tells every AI engine shutdown has begun before
 * anything stops, one stop of every AI runtime, shared by each feature that needs AI stopped first,
 * and the server's close after the work in flight.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {AssistantRouting} dependencies.assistantRouting
 * @param {ConversationRuntime} dependencies.mainConversations
 * @param {OutputTargetTerminalController} dependencies.outputTarget
 * @param {ProjectServices} dependencies.projectServices
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionConversations} dependencies.sessionConversations
 * @param {SessionNaming} dependencies.sessionNaming
 */
function createServiceShutdown({
  state,
  assistantRouting,
  mainConversations,
  outputTarget,
  projectServices,
  sessionAgent,
  sessionConversations,
  sessionNaming
}) {
  let shutdownStop = null;
  let shutdownBegun = null;

  /**
   * The server's shutdown begins before anything stops: each AI engine sets its closing fence and
   * leaves the end of each turn still running, and its checkpoint, to the next server. A turn that
   * ends while other work stops then makes no checkpoint that work could refuse. A host that
   * refuses new work as its shutdown begins calls this first; the stop calls it too. It stops
   * nothing, and an engine that cannot begin is reported by the stop.
   */
  function beginShutdown() {
    shutdownBegun ||= sessionAgent.beginShutdown();
    return shutdownBegun;
  }

  /**
   * The server's close refuses new work first: each AI engine leaves a turn's end to the next
   * server, and follow-up work and goal admission see `closing`. It then waits for the work
   * already writing a session (`shutdownWork`), and only then stops the AI runtimes and the rest.
   */
  async function close() {
    beginShutdown();
    state.lifecycle.closing = true;
    await Promise.allSettled(state.shutdownWork);
    const [agentClose, outputTargetClose] = await Promise.allSettled([
      Promise.resolve().then(() => invalidateAgentRuntimes({
        reason: "server-shutdown"
      })),
      Promise.resolve().then(() => outputTarget.close())
    ]);
    await Promise.allSettled([state.lifecycle.goalRecovery]);
    const failures = [];
    const agentResult = agentClose.status === "fulfilled"
      ? agentClose.value
      : null;
    if (agentClose.status === "rejected") {
      failures.push(agentClose.reason);
    } else if (agentResult?.ok === false) {
      const error = new Error("Assistant runtime shutdown did not complete successfully.");
      error.code = "vibe64_agent_runtime_shutdown_failed";
      error.details = agentResult;
      failures.push(error);
    }
    if (outputTargetClose.status === "rejected") {
      failures.push(outputTargetClose.reason);
    }
    try {
      await projectServices.closeAll();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Vibe64 terminal shutdown did not complete successfully.");
    }
    return {
      agentResult,
      ok: true
    };
  }

  async function invalidateAgentRuntimes(input = {}) {
    if (input.reason === "server-shutdown") {
      const begun = beginShutdown();
      shutdownStop ||= (async () => {
        state.lifecycle.closing = true;
        state.shutdownSignal.abort(Object.assign(new Error("Vibe64 is stopping."), { code: "vibe64_server_stopping" }));
        const routing = await Promise.allSettled([assistantRouting.close(), sessionConversations.close(), sessionNaming.close()]);
        await Promise.allSettled(state.shutdownWork);
        const [native] = await Promise.allSettled([sessionAgent.invalidateRuntimes(input, {
          providerId: normalizeAgentProviderId(input.provider)
        })]);
        const failures = [...routing, native].filter((result) => result.status === "rejected").map((result) => result.reason);
        if (begun.ok === false) {
          failures.unshift(Object.assign(new Error("Assistant runtime shutdown could not begin."), {
            code: "vibe64_agent_runtime_shutdown_begin_failed",
            details: begun
          }));
        }
        if (failures.length) throw new AggregateError(failures, "Assistant runtime shutdown did not complete successfully.");
        await mainConversations.close();
        return native.value;
      })();
      return shutdownStop;
    }
    return sessionAgent.invalidateRuntimes(input, {
      providerId: normalizeAgentProviderId(input.provider)
    });
  }

  return Object.freeze({
    beginShutdown,
    close,
    invalidateAgentRuntimes
  });
}

export {
  createServiceShutdown
};
