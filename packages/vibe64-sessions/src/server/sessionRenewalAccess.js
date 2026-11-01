import { normalizeText } from "@local/vibe64-core/server/core";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * How renewal reaches its sessions: a runtime that can create a successor's
 * source, the private session reader, and best-effort change notices.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TerminalsService} dependencies.terminals
 */
function createRenewalSessionAccess({ project, publishSessionChanged, terminals }) {
  async function runtimeForRenewal() {
    return project.createRuntime({
      createSessionSource: (context) => terminals.createSessionSource(context),
      inspectSource: false
    });
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} [sessionId]
   */
  async function readInternalSession(runtime, sessionId = "") {
    return runtime.getSessionForRenewal(sessionId, { inspectSource: false });
  }

  async function publish(sessionId = "", reason = "session-renewal", originId = "") {
    try {
      const runtime = await runtimeForRenewal();
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: normalizeText(originId),
        reason,
        session: await readInternalSession(runtime, sessionId)
      });
    } catch {
      // Durable state and polling remain authoritative when realtime delivery
      // is temporarily unavailable.
    }
  }

  return Object.freeze({ runtimeForRenewal, readInternalSession, publish });
}

export { createRenewalSessionAccess };
