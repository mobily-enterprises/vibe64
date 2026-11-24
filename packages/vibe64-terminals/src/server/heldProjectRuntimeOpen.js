import { createHeldWork } from "@local/vibe64-core/server/heldWork";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

/**
 * The page's `POST .../project-runtime/open`: `openProjectRuntime` as held work. An open that arrives while idle
 * cleanup closes the project waits for that Close (every session's processes stopping), which can outlast the hosted
 * edge's minute, so the request answers within two seconds, as opening while it waits. A repeat joins it, and one
 * after it ended opens again, which an open project answers at once. A chat message that reopens the project calls
 * `openProjectRuntime` itself and waits for it.
 * @param {object} dependencies
 * @param {(input?: object) => Promise<object>} dependencies.openProjectRuntime
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 */
function createHeldProjectRuntimeOpen({ openProjectRuntime, logger }) {
  const held = createHeldWork({ component: "vibe64.project_runtime_open", logger });

  /**
   * @param {object} [input]
   */
  return async function openProjectRuntimeForPage(input = {}) {
    const answer = await held.run(currentProjectScopeKey(), ({ stage }) => {
      stage("project-close");
      return openProjectRuntime(input);
    });
    if (answer.settled) return answer.result;
    return { ok: true, opening: true, waitingFor: answer.waitingFor };
  };
}

export { createHeldProjectRuntimeOpen };
