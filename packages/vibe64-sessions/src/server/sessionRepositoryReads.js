import { cachedRepositoryUpdateCheck } from "./sessionRepositoryUpdates.js";
import { sessionResult } from "./sessionResults.js";
import { trustedAssistantUser } from "./trustedAssistantUser.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

function requiredIncomingSessionId(value = "") {
  const sessionId = normalizeText(value);
  if (!sessionId) {
    const error = new Error("Select a session before reviewing incoming changes.");
    error.code = "vibe64_incoming_changes_session_required";
    throw error;
  }
  return sessionId;
}

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
 * and their files, and the Incoming contributions waiting to merge, with the
 * Merge or Discard of one.
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

  async function inspectIncomingContributions(sessionId, input) {
    return sessionResult(() => terminals.inspectIncomingContributions(requiredIncomingSessionId(sessionId), {
      ...input,
      vibe64User: trustedAssistantUser(input)
    }), "Incoming changes could not be read. Refresh before acting.");
  }

  /**
   * A review reads the same contributions with their diffs.
   */
  async function reviewIncomingContribution(sessionId, input) {
    return inspectIncomingContributions(sessionId, { ...input, includeDiff: true });
  }

  async function changeIncomingContribution(sessionId, input) {
    return sessionResult(async () => {
      const result = await terminals.changeIncomingContribution(requiredIncomingSessionId(sessionId), {
        ...input,
        vibe64User: trustedAssistantUser(input)
      });
      // The Git result is confirmed. A failed UI notification must not turn
      // that success into a retry of a remote write.
      if (result.status !== "repair-review") {
        try {
          await project.refreshGithub();
        } catch { /* The next read reconstructs state from Git. */ }
      }
      return result;
    }, "The contribution action was not confirmed. Refresh Incoming changes before retrying.");
  }

  return Object.freeze({
    changeIncomingContribution,
    inspectIncomingContributions,
    inspectRepositoryHistory,
    inspectRepositoryVersionFileDiff,
    inspectRepositoryVersionFiles,
    reviewIncomingContribution
  });
}

export { createSessionRepositoryReads };
