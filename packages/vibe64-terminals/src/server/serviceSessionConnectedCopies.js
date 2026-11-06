import {
  recordSessionConnectedCopyCommits,
  serializeSessionConnectedCopies,
  sessionConnectedCopies
} from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { GENESIS_DERIVED_ARTIFACT_PATHS } from "@local/vibe64-genesis/server";
import {
  connectedCopyActorSession,
  inspectConnectedCopies,
  prepareConnectedCopies,
  recoverConnectedCopyUpdate
} from "./sessionConnectedCopies.js";
import { recordSessionGitCommandActor } from "./sessionGitCommandActor.js";
import { githubSourceCommandOptions } from "./sessionSource.js";
import { saveError } from "./sessionWorkCommands.js";
import { inspectSessionWork } from "./sessionWorkSave.js";
import { checkSessionUpdates } from "./sessionWorkUpdate.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */

/**
 * Workspace preparation's connected step. `prepare` makes the copies this session is missing and
 * writes the Sources file that points at its copies, returning one line per repository; `inspect`
 * reads that file back for a run.
 * @param {object} input
 * @param {RuntimeEnv} input.env
 * @param {"inspect" | "prepare"} input.mode
 * @param {ProjectService} input.project
 * @param {object} input.runtime
 * @param {object} input.session
 * @param {object | null} [input.vibe64User]
 */
async function prepareConnectedRepositories({ env, mode, project, runtime, session, vibe64User = null }) {
  if (mode === "inspect") return project.inspectConnectedDevelopmentInputs({ session });
  const connections = await project.readSessionConnectedRepositories(session);
  const recorded = sessionConnectedCopies(session);
  let lines = [];
  if (connections.length || recorded.length) {
    const missing = connections.some(connection => !recorded.some(copy => copy.repository === connection.fullName));
    const current = await project.readCurrentProject();
    const listed = missing ? (await project.listProjects())?.projects || [] : [];
    const prepared = await prepareConnectedCopies({
      commandOptions: missing
        ? { ...await githubSourceCommandOptions(vibe64User, env), runCommand: runVibe64Command }
        : {},
      connections,
      async mirrorFor(fullName) {
        const match = listed.find(candidate => candidate.githubMirrorPath &&
          String(candidate.githubRepository?.fullName || "").toLowerCase() === fullName);
        return match ? { mirrorPath: match.githubMirrorPath, remoteUrl: match.githubRepository.cloneUrl } : null;
      },
      ownRepository: String(current.githubRepository?.fullName || current.repository?.github?.fullName || "").toLowerCase(),
      session,
      writeCopies: (copies) => runtime.store.writeMetadataValue(
        session.sessionId,
        "connected_copies",
        serializeSessionConnectedCopies(copies)
      )
    });
    lines = prepared.lines;
  }
  const inputs = await project.prepareConnectedDevelopmentInputs({
    session: await runtime.getSessionWithoutSource(session.sessionId)
  });
  return { ...inputs, lines };
}

/**
 * The Git commands for one connected copy: the session's Git actor, as a GitHub session of that
 * repository. With a runtime, a write records that actor first when the session has none yet.
 * @param {object} input
 * @param {CodexGitCommandService} input.codexGitCommand
 * @param {object} input.copy
 * @param {boolean} [input.createsCommits]
 * @param {RuntimeEnv} input.env
 * @param {string} [input.reason]
 * @param {object | null} [input.runtime]
 * @param {object} input.session
 * @param {object | null} [input.vibe64User]
 */
async function connectedCopyExecution({
  codexGitCommand,
  copy,
  createsCommits = false,
  env,
  reason = "connected-repository",
  runtime = null,
  session,
  vibe64User = null
}) {
  const sessionId = String(session.sessionId || "").trim();
  let execution = await codexGitCommand.sessionWorkSaveContext({
    createsCommits,
    session: connectedCopyActorSession(session, copy),
    sessionId,
    vibe64User
  });
  const sourceRoot = sessionSourcePath(session);
  if (execution?.ok === false && runtime && sourceRoot) {
    const recorded = await recordSessionGitCommandActor({
      env,
      reason,
      runtime,
      session: connectedCopyActorSession(session, copy),
      sourceRoot,
      threadId: session.metadata?.agent_identity_conversation_id || "",
      vibe64User,
      workdir: sourceRoot
    });
    if (recorded && recorded.ok !== false) {
      execution = await codexGitCommand.sessionWorkSaveContext({
        createsCommits,
        session: connectedCopyActorSession(recorded.session || await runtime.getSessionWithoutSource(sessionId), copy),
        sessionId,
        vibe64User
      });
    }
  }
  // The copy engine names the repository when it reports this.
  if (execution?.ok === false) {
    throw Object.assign(new Error(execution.error || "Its Git actor is not available."), {
      code: execution.code || "vibe64_session_work_actor_unavailable"
    });
  }
  return execution;
}

/**
 * What the copy engine needs for one session's Save, Update or Save recovery: each copy's Git
 * commands and the record of the commits it leaves in each copy.
 * @param {{ codexGitCommand: CodexGitCommandService, env: RuntimeEnv, runtime: object, session: object }} service
 * @param {object} [executionOptions] each copy's `connectedCopyExecution` options
 */
function connectedCopyOperations({ codexGitCommand, env, runtime, session }, executionOptions = {}) {
  return {
    executionFor: (copy) => connectedCopyExecution({ ...executionOptions, codexGitCommand, copy, env, session }),
    recordCommits: (commits) => recordSessionConnectedCopyCommits(runtime.store, session.sessionId, commits)
  };
}

/**
 * Save's check of the session's own repository before a copy pushes. It refuses as Save itself
 * would, so a session behind its main pushes no copy either.
 * @param {object} input `checkSessionUpdates`' input for the session's own repository
 */
async function refuseBehindSessionSave(input) {
  const check = await checkSessionUpdates(input);
  if (check.updateAvailable !== true) return;
  throw saveError(
    "The saved branch has changed. Update this session before saving its work.",
    "vibe64_session_save_update_required",
    { canonicalCommit: check.canonicalCommit, reconciledCommit: check.baseCommit, updateRequired: true },
    { messageCode: "vibe64_session_save_branch_changed" }
  );
}

/**
 * Update's conflict review belongs to one repository: the copy its recovery names
 * (`connectedRepository`), or else the session's own. The other gets none.
 * @param {{ conflictRecovery?: object | null, reviewedConflictId?: string }} input
 */
function conflictReviewFor({ conflictRecovery = null, reviewedConflictId = "" } = {}) {
  const review = { conflictRecovery, reviewedConflictId };
  const none = { conflictRecovery: null, reviewedConflictId: "" };
  return conflictRecovery?.connectedRepository ? { connected: review, own: none } : { connected: none, own: review };
}

/**
 * The copy an interrupted Update was applying, recovered when its prepared update was reported.
 * @param {object} input `recoverConnectedCopyUpdate`'s input, with the Update's `recovery` record
 * @param {CodexGitCommandService} input.codexGitCommand
 * @param {RuntimeEnv} input.env
 * @param {object} input.recovery
 * @param {object} input.runtime
 * @param {object} input.session
 */
function recoverConnectedUpdate({ codexGitCommand, env, recovery, runtime, session, ...input }) {
  if (!recovery.connectedUpdate) return null;
  return recoverConnectedCopyUpdate({
    ...input,
    connectedUpdate: recovery.connectedUpdate,
    copies: sessionConnectedCopies(session),
    ...connectedCopyOperations({ codexGitCommand, env, runtime, session }, {
      createsCommits: true,
      reason: "session-update-recovery",
      runtime
    }),
    session
  });
}

/**
 * Whether an interrupted Save whose own recovery found nothing prepared was a Save of copies alone
 * that is complete: the session has copies, and neither its own repository nor any copy holds unsaved
 * work, so every copy that Save pushed is recorded.
 * @param {unknown} error the own recovery's error
 * @param {{ project: object, runtime: object, session: object }} input
 */
async function copiesOnlySaveRecovered(error, { project, runtime, session }) {
  if (error?.code !== "vibe64_session_save_interrupted_retryable" || !sessionConnectedCopies(session).length) return false;
  const current = await runtime.getSessionWithoutSource(session.sessionId);
  const own = await inspectSessionWork({ derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS, project, session: current });
  if (own.unsaved === true) return false;
  const copies = await inspectConnectedCopies({
    copies: sessionConnectedCopies(current),
    derivedArtifactPaths: GENESIS_DERIVED_ARTIFACT_PATHS,
    project,
    session: current
  });
  return !copies.some(copy => copy.unsaved);
}

export {
  conflictReviewFor,
  connectedCopyExecution,
  connectedCopyOperations,
  copiesOnlySaveRecovered,
  prepareConnectedRepositories,
  recoverConnectedUpdate,
  refuseBehindSessionSave
};
