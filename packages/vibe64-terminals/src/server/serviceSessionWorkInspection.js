import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import {
  checkConnectedCopies,
  connectedCopyActorSession,
  connectedCopyWork,
  inspectConnectedCopies
} from "./sessionConnectedCopies.js";
import {
  checkSessionUpdates as checkManagedSessionUpdates,
  readSessionAuthorityHeads as readManagedSessionAuthorityHeads
} from "./sessionWorkUpdate.js";
import { inspectSessionUpdateFailure as inspectManagedSessionUpdateFailure } from "./sessionWorkUpdateRecovery.js";
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
import { connectedCopyExecution } from "./serviceSessionConnectedCopies.js";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceSessionWork} ServiceSessionWork */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

/**
 * Reading a session's work without changing it: updates waiting, authority heads, the work and its
 * changes with each connected copy's, update failures, and the repository's history and versions.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceSessionWork} dependencies.sessionWork
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {RuntimeEnv} dependencies.env
 * @param {ProjectService} dependencies.project
 */
function createServiceSessionWorkInspection({
  sessionAccess,
  sessionWork,
  codexGitCommand,
  env,
  project
}) {
  async function checkSessionUpdates(sessionId, input = {}) {
    // This refreshes canonical authority under the project source lock but
    // never changes the session worktree. Periodic checks must not occupy
    // assistant-write admission and reject a foreground chat message.
    const { execution, runtime, session } = await sessionWork.sessionWorkExecution(
      sessionId,
      input,
      "session-update-check"
    );
    const projectRecord = await project.readCurrentProject();
    const runProjectSourceExclusive = project.runProjectSourceExclusive.bind(project);
    const check = await checkManagedSessionUpdates({
      commandOptions: execution.commandOptions,
      operationId: input.operationId,
      project: projectRecord,
      runCommand: execution.runCommand,
      runProjectSourceExclusive,
      session
    });
    const copies = sessionConnectedCopies(session);
    if (!copies.length) return check;
    const connected = await checkConnectedCopies({
      copies,
      executionFor: (copy) => connectedCopyExecution({
        codexGitCommand,
        copy,
        env,
        reason: "session-update-check",
        runtime,
        session,
        vibe64User: input.vibe64User || null
      }),
      operationId: input.operationId,
      project: projectRecord,
      runProjectSourceExclusive,
      session
    });
    return { ...check, connected, updateAvailable: check.updateAvailable === true || connected.some(copy => copy.updateAvailable) };
  }

  /**
   * The update probe's head read for the current project's open sessions and
   * their connected copies: each session's own `head`, with `connected` naming
   * each copy's main head. It uses each session's recorded Git actor as stored;
   * it never records one, because no person asked for this read.
   */
  async function readRepositoryAuthorityHeads({ sessions = [] } = {}) {
    const projectRecord = await project.readCurrentProject();
    const results = await readManagedSessionAuthorityHeads({
      executionFor: (session) => codexGitCommand.sessionWorkSaveContext({ session }),
      project: projectRecord,
      sessions
    });
    const groups = new Map();
    for (const session of sessions) {
      if (!results.get(session.sessionId)?.head) continue;
      let copies;
      try {
        copies = sessionConnectedCopies(session);
      } catch (error) {
        results.set(session.sessionId, { code: error.code, error: error.message });
        continue;
      }
      for (const copy of copies) {
        const key = JSON.stringify([copy.repository, copy.branch]);
        groups.set(key, [...(groups.get(key) || []), { copy, session }]);
      }
    }
    for (const members of groups.values()) {
      const actors = new Map(members.map(({ copy, session }) => [session.sessionId, connectedCopyActorSession(session, copy)]));
      const views = members.map(({ copy, session }) => ({ copy, work: connectedCopyWork(session, projectRecord, copy) }));
      const heads = await readManagedSessionAuthorityHeads({
        executionFor: (view) => codexGitCommand.sessionWorkSaveContext({ session: actors.get(view.sessionId) }),
        project: views[0].work.project,
        sessions: views.map(({ work }) => work.session)
      });
      for (const { copy, work } of views) {
        const own = results.get(work.session.sessionId);
        const read = heads.get(work.session.sessionId);
        if (!own?.head || !read) continue;
        results.set(work.session.sessionId, read.head
          ? { ...own, connected: { ...(own.connected || {}), [copy.name]: read.head } }
          : { code: read.code, error: `Connected repository ${copy.name}: ${read.error}` });
      }
    }
    return results;
  }

  async function inspectSessionWork(sessionId, input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const { session } = await sessionAccess.sessionContext(normalizedSessionId, input);
    const projectRecord = await project.readCurrentProject();
    const work = await inspectManagedSessionWork({
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      project: projectRecord,
      session
    });
    const connected = await inspectConnectedCopies({
      copies: sessionConnectedCopies(session),
      derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
      project: projectRecord,
      session
    });
    return {
      ...work,
      connected,
      // The session's work includes its copies': unsaved or behind in any of them is the session's.
      unsaved: work.unsaved === true || connected.some(copy => copy.unsaved),
      updateAvailable: work.updateAvailable === true || connected.some(copy => copy.behind > 0),
      publicationRequiresPullRequest: work.destination?.mode === "github" &&
        (await project.readRepositoryWorkflow()).requirePullRequest
    };
  }

  /**
   * Read-only Git evidence on whether a failed Update still describes the
   * session's checkout, or the copy of `connectedRepository` when the failure
   * was that copy's; the sessions service decides and records the result.
   */
  async function inspectSessionUpdateFailure(sessionId, input = {}) {
    const { session } = await sessionAccess.sessionContext(String(sessionId || "").trim(), input);
    const projectRecord = await project.readCurrentProject();
    const name = String(input.connectedRepository || "").trim();
    if (!name) return inspectManagedSessionUpdateFailure({ project: projectRecord, session, targetCommit: input.targetCommit });
    const copy = sessionConnectedCopies(session).find(entry => entry.name === name);
    if (!copy) throw new Error(`This session has no copy of connected repository ${name}.`);
    const work = connectedCopyWork(session, projectRecord, copy);
    return inspectManagedSessionUpdateFailure({ project: work.project, session: work.session, targetCommit: input.targetCommit });
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
      publicationRequiresPullRequest: work.destination?.mode === "github" &&
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
