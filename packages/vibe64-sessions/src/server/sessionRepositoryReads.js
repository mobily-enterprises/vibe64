import { cachedRepositoryUpdateCheck } from "./sessionRepositoryUpdates.js";
import { sessionResult } from "./sessionResults.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Project history is readable without a session; a given session pins it to that session's base.
 * @param {ProjectService} project
 * @param {string} [value]
 */
async function optionalRepositorySession(project, value = "") {
  const sessionId = normalizeText(value);
  if (!sessionId) {
    return null;
  }
  const runtime = await project.createRuntimeWithoutSource();
  return runtime.getSessionWithoutSource(sessionId);
}

/**
 * Reads of the project repository's history beside a session: its versions
 * and their files.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 */
function createSessionRepositoryReads({ project, terminals }) {
  async function inspectRepositoryHistory(input) {
    return sessionResult(async () => {
      const session = await optionalRepositorySession(project, input.sessionId);
      const history = await terminals.inspectRepositoryHistory({ ...input, session });
      const updateCheck = cachedRepositoryUpdateCheck(session);
      return {
        ...history,
        ...(updateCheck ? { updateCheck } : {})
      };
    }, "Vibe64 could not read project version history.");
  }

  async function inspectRepositoryVersionFiles(input) {
    return sessionResult(async () => {
      const session = await optionalRepositorySession(project, input.sessionId);
      return terminals.inspectRepositoryVersionFiles({ ...input, session });
    }, "Vibe64 could not read this project version.");
  }

  async function inspectRepositoryVersionFileDiff(input) {
    return sessionResult(async () => {
      const session = await optionalRepositorySession(project, input.sessionId);
      return terminals.inspectRepositoryVersionFileDiff({ ...input, session });
    }, "Vibe64 could not read this version's file change.");
  }

  return Object.freeze({
    inspectRepositoryHistory,
    inspectRepositoryVersionFileDiff,
    inspectRepositoryVersionFiles
  });
}

export { createSessionRepositoryReads };
