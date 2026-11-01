import { sessionConnectedContribution } from "@local/vibe64-core/server/projectRepository";
import { inspectIncomingContributions as inspectManagedIncomingContributions } from "./sessionIncomingContributions.js";
import {
  checkSessionUpdates as checkManagedSessionUpdates,
  inspectSessionUpdateFailure as inspectManagedSessionUpdateFailure,
  readSessionAuthorityHeads as readManagedSessionAuthorityHeads
} from "./sessionWorkUpdate.js";
import {
  inspectSessionChangeDiff as inspectManagedSessionChangeDiff,
  inspectSessionChanges as inspectManagedSessionChanges,
  inspectSessionWork as inspectManagedSessionWork
} from "./sessionWorkSave.js";
import {
  inspectRepositoryHistory as inspectManagedRepositoryHistory,
  repositoryVersionFileDiff as inspectManagedRepositoryVersionFileDiff,
  repositoryVersionFiles as inspectManagedRepositoryVersionFiles
} from "./repositoryHistory.js";
import { GENESIS_DERIVED_ARTIFACT_PATHS } from "@local/vibe64-genesis/server";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {ReturnType<typeof import("./serviceSessionWork.js").createServiceSessionWork>} ServiceSessionWork */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */

/**
 * Reading a session's work without changing it: updates waiting, authority heads, the work and its
 * changes, update failures, incoming contributions, and the repository's history and versions.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceSessionWork} dependencies.sessionWork
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {ProjectService} dependencies.project
 */
function createServiceSessionWorkInspection({
  sessionAccess,
  sessionWork,
  codexGitCommand,
  project
}) {
  async function checkSessionUpdates(sessionId, input = {}) {
    // This refreshes canonical authority under the project source lock but
    // never changes the session worktree. Periodic checks must not occupy
    // assistant-write admission and reject a foreground chat message.
    const { execution, session } = await sessionWork.sessionWorkExecution(
      sessionId,
      input,
      "session-update-check"
    );
    return checkManagedSessionUpdates({
      commandOptions: execution.commandOptions,
      operationId: input.operationId,
      project: await project.readCurrentProject(),
      runCommand: execution.runCommand,
      runProjectSourceExclusive: project.runProjectSourceExclusive.bind(project),
      session
    });
  }

  /**
   * The update probe's head read for the current project's open sessions. It
   * uses each session's recorded Git actor as stored; it never records one,
   * because no person asked for this read.
   */
  async function readRepositoryAuthorityHeads({ sessions = [] } = {}) {
    return readManagedSessionAuthorityHeads({
      executionFor: (session) => codexGitCommand.sessionWorkSaveContext({ session }),
      project: await project.readCurrentProject(),
      sessions
    });
  }

  async function inspectSessionWork(sessionId, input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const { runtime, session } = await sessionAccess.sessionContext(normalizedSessionId, input);
    const execution = input.inspectContributionPublication === true
      ? (await sessionWork.sessionWorkExecution(sessionId, { runtime, session }, "connected-publication-inspection")).execution
      : null;
    const work = await inspectManagedSessionWork({
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      ...(execution ? {
        commandOptions: execution.commandOptions,
        runCommand: execution.runCommand,
        inspectContributionPublication: true,
        knownSubmittedCommit: input.knownSubmittedCommit || ""
      } : {}),
      project: await project.readCurrentProject(),
      session
    });
    return {
      ...work,
      publicationRequiresPullRequest: work.destination?.mode === "github" && !sessionConnectedContribution(session) &&
        (await project.readRepositoryWorkflow()).requirePullRequest
    };
  }

  /**
   * Read-only Git evidence on whether a failed Update still describes the
   * session's checkout; the sessions service decides and records the result.
   */
  async function inspectSessionUpdateFailure(sessionId, input = {}) {
    const { session } = await sessionAccess.sessionContext(String(sessionId || "").trim(), input);
    return inspectManagedSessionUpdateFailure({
      project: await project.readCurrentProject(),
      session,
      targetCommit: input.targetCommit
    });
  }

  async function inspectIncomingContributions(sessionId, input = {}) {
    const { project: projectRecord, actions } = await project.incomingRepository(input);
    const { execution, session } = await sessionWork.sessionWorkExecution(sessionId, input, "incoming-inspection");
    return {
      ...await inspectManagedIncomingContributions({
        project: projectRecord,
        session,
        id: input.id,
        state: input.state,
        offset: input.offset,
        limit: input.limit,
        includeDiff: input.includeDiff === true,
        commandOptions: execution.commandOptions,
        runCommand: execution.runCommand
      }),
      actions
    };
  }

  async function inspectSessionChanges(sessionId, input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const { session } = await sessionAccess.sessionContext(normalizedSessionId, input);
    const work = await inspectManagedSessionChanges({
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      limit: input.limit,
      offset: input.offset,
      project: await project.readCurrentProject(),
      session
    });
    return {
      ...work,
      publicationRequiresPullRequest: work.destination?.mode === "github" && !sessionConnectedContribution(session) &&
        (await project.readRepositoryWorkflow()).requirePullRequest
    };
  }

  async function inspectSessionChangeDiff(sessionId, input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const { session } = await sessionAccess.sessionContext(normalizedSessionId, input);
    return inspectManagedSessionChangeDiff({
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      lineLimit: input.lineLimit,
      path: input.path,
      project: await project.readCurrentProject(),
      session
    });
  }

  async function inspectRepositoryHistory(input = {}) {
    return inspectManagedRepositoryHistory({
      cursor: input.cursor,
      limit: input.limit,
      project: await project.readCurrentProject(),
      session: input.session || null
    });
  }

  async function inspectRepositoryVersionFiles(input = {}) {
    return inspectManagedRepositoryVersionFiles({
      commit: input.commit,
      historySnapshotCommit: input.historySnapshotCommit,
      limit: input.limit,
      offset: input.offset,
      project: await project.readCurrentProject(),
      session: input.session || null
    });
  }

  async function inspectRepositoryVersionFileDiff(input = {}) {
    return inspectManagedRepositoryVersionFileDiff({
      commit: input.commit,
      historySnapshotCommit: input.historySnapshotCommit,
      lineLimit: input.lineLimit,
      path: input.path,
      project: await project.readCurrentProject(),
      session: input.session || null
    });
  }

  return Object.freeze({
    checkSessionUpdates,
    inspectIncomingContributions,
    inspectRepositoryHistory,
    inspectRepositoryVersionFileDiff,
    inspectRepositoryVersionFiles,
    inspectSessionChangeDiff,
    inspectSessionChanges,
    inspectSessionUpdateFailure,
    inspectSessionWork,
    readRepositoryAuthorityHeads
  });
}

export {
  createServiceSessionWorkInspection
};
