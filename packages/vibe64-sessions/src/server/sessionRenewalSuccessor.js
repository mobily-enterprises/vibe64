import path from "node:path";
import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  mutateSessionRenewalState,
  readSessionRenewalState
} from "./sessionRenewalState.js";
import {
  SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE,
  SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
  renewalError,
  sourceEnvelopesMatch,
  statePatch,
  timestamp
} from "./sessionRenewalRules.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").RenewalSessionAccess} RenewalSessionAccess */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

const SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT =
  "renewal/successor-process-exit-proof-release.json";

const SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND =
  "vibe64.session_renewal_successor_process_exit_proof_release";

function successorProcessExitProofReleaseAuthorization(state = {}, successor = {}) {
  return {
    authorizedAt: timestamp(),
    kind: SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND,
    renewalId: toText(state.renewalId),
    runtimeDir: toText(successor.metadata?.agent_transport_runtime_dir),
    schemaVersion: 1,
    sourceSessionId: toText(state.sessionId),
    successorSessionId: toText(successor.sessionId)
  };
}

function assertSuccessorProcessExitProofReleaseAuthorization(
  value = {},
  state = {},
  successor = {}
) {
  const authorization = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const authorizedAt = toText(authorization.authorizedAt);
  const authorizedAtMs = Date.parse(authorizedAt);
  if (
    toText(authorization.kind) !==
      SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND ||
    Number(authorization.schemaVersion) !== 1 ||
    toText(authorization.renewalId) !== toText(state.renewalId) ||
    toText(authorization.sourceSessionId) !== toText(state.sessionId) ||
    toText(authorization.successorSessionId) !== toText(successor.sessionId) ||
    toText(authorization.runtimeDir) !==
      toText(successor.metadata?.agent_transport_runtime_dir) ||
    !Number.isFinite(authorizedAtMs) ||
    new Date(authorizedAtMs).toISOString() !== authorizedAt
  ) {
    throw renewalError(
      "The successor process-exit proof release authorization is invalid.",
      "vibe64_session_renewal_process_exit_proof_release_authorization_invalid",
      { retryable: false, statusCode: 500 }
    );
  }
  return authorization;
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {object} state
 * @param {object} successor
 */
async function readSuccessorProcessExitProofReleaseAuthorization(runtime, state, successor) {
  const text = await runtime.store.readArtifactForRenewal(
    successor.sessionId,
    SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT
  );
  if (!toText(text)) {
    return null;
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  return assertSuccessorProcessExitProofReleaseAuthorization(value, state, successor);
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {object} state
 * @param {object} successor
 */
async function authorizeSuccessorProcessExitProofRelease(runtime, state, successor) {
  const authorization = successorProcessExitProofReleaseAuthorization(state, successor);
  await runtime.store.writeJsonArtifactForRenewal(
    successor.sessionId,
    SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT,
    authorization
  );
  return authorization;
}

function successorDiscardError(message, code, cause, phase) {
  const error = renewalError(message, code, {
    retryable: true,
    statusCode: 500
  });
  error.renewalDiagnostic = {
    causeCode: toText(cause?.code) || "vibe64_session_renewal_unknown_failure",
    phase
  };
  return error;
}

async function runSuccessorDiscardPhase(phase, operation) {
  try {
    return await operation();
  } catch (error) {
    throw successorDiscardError(
      "The invalid renewed session could not be discarded safely yet.",
      "vibe64_session_renewal_successor_discard_failed",
      error,
      phase
    );
  }
}

async function ensureSuccessorDiscarding(runtime, state, seedError) {
  const expectedRenewalId = toText(state.renewalId);
  const expectedSuccessorId = toText(state.successor?.sessionId);
  const ownsExpectedSuccessor = (current) => (
    toText(current?.renewalId) === expectedRenewalId &&
    toText(current?.successor?.sessionId) === expectedSuccessorId
  );
  try {
    return await mutateSessionRenewalState(runtime, state.sessionId, (current) => {
      if (!ownsExpectedSuccessor(current)) {
        throw renewalError(
          "The invalid renewed session no longer belongs to this renewal.",
          "vibe64_session_renewal_link_mismatch",
          { retryable: true, statusCode: 500 }
        );
      }
      if (
        current.status === SESSION_RENEWAL_STATUS.RUNNING &&
        current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING
      ) {
        return undefined;
      }
      if (
        current.status !== SESSION_RENEWAL_STATUS.RUNNING ||
        current.stage !== SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING
      ) {
        throw renewalError(
          "The invalid renewed session is no longer awaiting disposal.",
          "vibe64_session_renewal_state_invalid",
          { retryable: true, statusCode: 500 }
        );
      }
      return statePatch(current, {
        error: {
          code: toText(seedError?.code) || "vibe64_session_renewal_acknowledgement_invalid",
          message: toText(seedError?.message) || "The fresh assistant did not accept the handover.",
          retryable: true
        },
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING,
        status: SESSION_RENEWAL_STATUS.RUNNING
      });
    });
  } catch (error) {
    const observed = await readSessionRenewalState(runtime, state.sessionId).catch(() => null);
    if (
      ownsExpectedSuccessor(observed) &&
      observed?.status === SESSION_RENEWAL_STATUS.RUNNING &&
      observed?.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING
    ) {
      return observed;
    }
    throw successorDiscardError(
      "The invalid renewed session could not be marked for safe disposal.",
      "vibe64_session_renewal_successor_discard_transition_failed",
      error,
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.TRANSITION
    );
  }
}

function assertSuccessorSource(state, successor = {}) {
  const metadata = successor.metadata || {};
  const expectedCommit = toText(state.basis?.source?.commit).toLowerCase();
  const actualBaseCommit = toText(metadata.base_commit).toLowerCase();
  const actualCanonicalCommit = toText(metadata.canonical_commit).toLowerCase();
  const repository = toText(metadata.source_remote_url);
  const actualSource = {
    authority: toText(metadata.repository_mode),
    commit: actualBaseCommit,
    ref: `refs/heads/${toText(metadata.source_default_branch)}`,
    ...(metadata.repository_mode !== "local_source" && repository ? { repository } : {})
  };
  const commitMismatch = actualBaseCommit !== expectedCommit || actualCanonicalCommit !== expectedCommit;
  if (
    !expectedCommit ||
    commitMismatch ||
    !sourceEnvelopesMatch(actualSource, state.basis?.source)
  ) {
    throw renewalError(
      commitMismatch
        ? "The renewed session was not created from the exact approved source commit."
        : "The renewed session's source authority, repository, or branch does not match the approved handover.",
      SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
      {
        details: {
          actualCommit: actualBaseCommit,
          expectedCommit,
          phase: "source_envelope"
        },
        retryable: true,
        statusCode: 500
      }
    );
  }
  return successor;
}

/**
 * The renewed session: its exact canonical source, and the safe disposal of
 * one that cannot go live.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {TerminalsService} dependencies.terminals
 */
function createRenewalSuccessorSession({
  project,
  renewalAccess,
  terminals
}) {
  async function releaseSuccessorProcessExitProof(runtime, state, successor, authorization) {
    return terminals.releaseRenewalSuccessorProcessExitProof(successor, {
      authorization,
      renewalId: state.renewalId,
      runtime
    });
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   */
  async function cleanupRenewalSuccessor(runtime, state) {
    const nextSessionId = toText(state.successor?.sessionId);
    if (!nextSessionId) {
      return false;
    }
    const successor = await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.SUCCESSOR_READ,
      () => renewalAccess.readInternalSession(runtime, nextSessionId).catch((error) => {
        if (error?.code === "vibe64_session_not_found") {
          return null;
        }
        throw error;
      })
    );
    if (!successor) {
      return false;
    }
    let releaseAuthorization = await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_AUTHORIZATION,
      () => readSuccessorProcessExitProofReleaseAuthorization(
        runtime,
        state,
        successor
      )
    );
    if (!releaseAuthorization) {
      await runSuccessorDiscardPhase(
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.TERMINAL_CLOSE,
        () => terminals.closeRenewalSuccessorSessionTerminals(successor, {
          renewalId: state.renewalId,
          runtime
        })
      );
      await runSuccessorDiscardPhase(
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.RESOURCE_RELEASE,
        () => project.releaseSessionResources({
          runtime,
          session: successor,
          sessionId: nextSessionId
        })
      );
      releaseAuthorization = await runSuccessorDiscardPhase(
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_AUTHORIZATION,
        () => authorizeSuccessorProcessExitProofRelease(
          runtime,
          state,
          successor
        )
      );
    }
    await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_RELEASE,
      () => releaseSuccessorProcessExitProof(
        runtime,
        state,
        successor,
        releaseAuthorization
      )
    );
    await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.DISCARD,
      async () => {
        // A discarded successor never goes live, so this is its final close.
        // Its helpers go first: once its record is gone a retry cannot find it.
        await terminals.removeSessionCommandHelpers(nextSessionId, { runtime });
        return runtime.discardRenewalSession(nextSessionId, {
          renewalId: state.renewalId
        });
      }
    );
    return true;
  }

  async function assertSuccessorCanonicalState(runtime, state, options = {}) {
    const {
      phase = "verification"
    } = options;
    const successorSessionId = toText(state.successor?.sessionId);
    if (!successorSessionId) {
      throw renewalError(
        "The renewed session has no exact private successor.",
        "vibe64_session_renewal_link_mismatch",
        { statusCode: 500 }
      );
    }
    const successor = assertSuccessorSource(
      state,
      await renewalAccess.readInternalSession(runtime, successorSessionId)
    );
    const expectedCommit = toText(state.basis?.source?.commit).toLowerCase();
    const work = await terminals.inspectSessionWork(successorSessionId, {
      runtime,
      session: successor
    });
    const changedPaths = Array.isArray(work?.changedPaths)
      ? work.changedPaths
      : [];
    const actualBaseCommit = toText(work?.baseCommit).toLowerCase();
    const actualCanonicalCommit = toText(work?.canonicalCommit).toLowerCase();
    const actualHead = toText(work?.sessionHead).toLowerCase();
    const expectedWorktreePath = toText(
      successor?.sourcePath || successor?.metadata?.source_path
    );
    const actualWorktreeTopLevel = toText(work?.worktreeTopLevel);
    if (
      !expectedCommit ||
      actualBaseCommit !== expectedCommit ||
      actualCanonicalCommit !== expectedCommit ||
      actualHead !== expectedCommit ||
      work?.dirty === true ||
      work?.unsaved === true ||
      work?.worktreeClean !== true ||
      work?.sessionMatchesCanonical !== true ||
      changedPaths.length > 0 ||
      toText(work?.relationship) !== "current" ||
      !expectedWorktreePath ||
      !actualWorktreeTopLevel ||
      path.resolve(actualWorktreeTopLevel) !== path.resolve(expectedWorktreePath)
    ) {
      throw renewalError(
        "The renewed session changed while its private workspace was being prepared.",
        SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
        {
          details: {
            actualBaseCommit,
            actualCanonicalCommit,
            actualHead,
            actualWorktreeTopLevel,
            changedPaths,
            expectedCommit,
            expectedWorktreePath,
            phase,
            worktreeClean: work?.worktreeClean === true
          },
          retryable: true,
          statusCode: 500
        }
      );
    }
    return successor;
  }

  return Object.freeze({
    assertSuccessorCanonicalState,
    cleanupRenewalSuccessor
  });
}

export { assertSuccessorSource, createRenewalSuccessorSession, ensureSuccessorDiscarding };
