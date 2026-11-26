import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { createVibe64SessionStore } from "./sessionStore.js";

/**
 * The folder each project's sessions are in (active, closing, archived and prepared renewal archives): all a
 * session-wide state upgrade's preparation reads of the state, so its inputs (Core's stateUpgradeFiles.js).
 * @param {string} systemRoot
 * @returns {Promise<string[]>}
 */
async function projectSessionRoots(systemRoot) {
  return (await listProjectRuntimeRoots(systemRoot)).map((projectRuntimeRoot) =>
    createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot }).paths().sessionsRoot);
}

export { projectSessionRoots };
