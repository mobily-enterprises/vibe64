import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createHeldWork } from "./heldWork.js";
import { currentProjectScopeKey } from "./projectRequestContext.js";

/**
 * Requests a page names (`requestId`) and repeats (`repeat: true`) until their work's outcome, which a hosted
 * workspace's edge would otherwise cut after about a minute. A request answers with its work's result when that
 * comes within two seconds, and otherwise `{ ok: true, [heldAs]: true, requestId, waitingFor }` while the work goes
 * on. A repeat joins the work, or reads its outcome for fifteen minutes after it ended, and never starts it: one this
 * editor does not hold (it restarted, or the first request never arrived) answers `notFollowed`. `close`, at
 * shutdown, resolves once every work has ended.
 * @param {object} options
 * @param {string} options.component the held work's log component
 * @param {string} options.heldAs the held answer's flag, such as `creating`
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} options.logger
 * @param {{ code: string, error: string }} options.notFollowed
 */
function createHeldRequests({ component, heldAs, logger, notFollowed }) {
  const held = createHeldWork({ component, logger });

  /**
   * @param {string[]} scope what the request id is unique within, besides the project (a session's id)
   * @param {{ requestId: string, repeat?: boolean }} input the request, given to `work` without these two
   * @param {(request: object, controls: { stage: (name: string) => void, signal: AbortSignal }) => Promise<object>} work
   */
  async function run(scope, input, work) {
    const { requestId, repeat = false, ...request } = input;
    const key = [currentProjectScopeKey(), ...scope.map(normalizeText), normalizeText(requestId)].join("\0");
    const operation = held.inspect(key);
    if (operation?.settled) {
      if (operation.error) throw operation.error;
      return operation.result;
    }
    if (!operation && repeat === true) return { ...notFollowed, ok: false };
    const answer = await held.run(key, controls => work(request, controls));
    if (answer.settled) return answer.result;
    return { ok: true, [heldAs]: true, requestId, waitingFor: answer.waitingFor };
  }

  return Object.freeze({
    close: held.close,
    run
  });
}

export { createHeldRequests };
