import { rm } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import {
  managedSessionSourcePath,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import { toText } from "@local/vibe64-core/shared/toText";

import { GENESIS_SESSION_KIND, assertSupportedSession } from "./sessionRuntimeChecks.js";
import { VIBE64_SESSION_STATUS } from "./sessionStore.js";
import {
  commitRenewalSessionSourceStage,
  prepareRenewalSessionSource,
  restoreRenewalSessionSourceStage,
  stagePreparedRenewalSessionSource
} from "./sessionWorktreeArchive.js";

// The session runtime's renewal steps: creating or discarding the pending successor, and moving the predecessor's
// source through its renewal stages. Vibe64SessionRuntime exposes each as a method.

/** @typedef {import("./runtime.js").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * @typedef {object} RenewalSessionRequest
 * @property {string} [actorDisplayName]
 * @property {string} [actorId]
 * @property {string} [confirmedAt]
 * @property {object} [metadata]
 * @property {string} [renewalId]
 * @property {string} [renewedFrom]
 * @property {string} [sessionId]
 * @property {object} [sourceContext] what createSessionSource receives besides the session
 * @property {string} [startedAt]
 */

/**
 * A pending successor session for a renewal, with its own private source clone. A failed clone removes both.
 * @param {Vibe64SessionRuntime} runtime
 * @param {RenewalSessionRequest} request
 */
async function createRenewalSession(runtime, {
  actorDisplayName = "",
  actorId = "",
  confirmedAt = "",
  metadata = {},
  renewalId = "",
  renewedFrom = "",
  sessionId = "",
  sourceContext = {},
  startedAt = ""
}) {
  if (!runtime.projectSessionSourceRoot) {
    throw vibe64Error(
      "Renewal session creation requires projectSessionSourceRoot.",
      "vibe64_project_session_source_root_required"
    );
  }
  const predecessor = await runtime.store.readSessionForRenewal(renewedFrom);
  let session = await runtime.store.createRenewalPendingSession({
    actorDisplayName,
    actorId,
    confirmedAt,
    metadata: {
      ...metadata,
      ...(predecessor.metadata?.repository_branch
        ? { repository_branch: predecessor.metadata.repository_branch } : {}),
      ...(predecessor.metadata?.github_pull_request
        ? { github_pull_request: predecessor.metadata.github_pull_request } : {}),
      ...(predecessor.metadata?.connected_contribution
        ? { connected_contribution: predecessor.metadata.connected_contribution } : {}),
      ...(predecessor.metadata?.connected_submissions !== undefined
        ? { connected_submissions: predecessor.metadata.connected_submissions } : {}),
      ...(predecessor.metadata?.connected_sources !== undefined
        ? { connected_sources: predecessor.metadata.connected_sources } : {})
    },
    renewalId,
    renewedFrom,
    runtimeKind: GENESIS_SESSION_KIND,
    sessionId,
    startedAt
  });
  const expectedSourcePath = managedSessionSourcePath(
    runtime.projectSessionSourceRoot,
    session.sessionId
  );
  const recordedSourcePath = toText(session.metadata?.source_path);
  if (recordedSourcePath && path.resolve(recordedSourcePath) !== expectedSourcePath) {
    throw vibe64Error(
      "Renewal session source does not match its managed source path.",
      "vibe64_session_source_not_attached"
    );
  }
  try {
    const sourceRoot = sessionSourcePath(session);
    if (sourceRoot && sourceRoot !== expectedSourcePath) {
      throw vibe64Error(
        "Renewal session source does not match its managed source path.",
        "vibe64_session_source_not_attached"
      );
    }
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      if (!runtime.createSessionSource) {
        throw vibe64Error(
          "Renewal session creation requires a createSessionSource callback.",
          "vibe64_session_source_creator_required"
        );
      }
      if (!sourceRoot && await pathExists(expectedSourcePath)) {
        // A crash can leave the exact private successor clone in place before
        // its metadata is attached. It has never been usable or selected, so
        // remove only that managed namespace and materialize it again.
        await rm(path.dirname(expectedSourcePath), {
          force: true,
          recursive: true
        });
      }
      await runtime.store.mutateSessionForRenewal(session.sessionId, () => (
        runtime.createSessionSource({
          ...(sourceContext && typeof sourceContext === "object" ? sourceContext : {}),
          runtime,
          session,
          store: runtime.store
        })
      ));
      session = await runtime.store.readSessionForRenewal(session.sessionId);
    }
    const materializedSourceRoot = sessionSourcePath(session);
    if (
      materializedSourceRoot !== expectedSourcePath ||
      !await pathExists(materializedSourceRoot)
    ) {
      throw vibe64Error(
        "Renewal session source creation completed without attaching a source directory.",
        "vibe64_session_source_not_attached"
      );
    }
  } catch (error) {
    await rm(path.dirname(expectedSourcePath), {
      force: true,
      recursive: true
    });
    await runtime.store.removeRenewalPendingSession({
      renewalId,
      sessionId: session.sessionId
    });
    throw error;
  }
  return runtime.sessionViewForRenewal(session);
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {{ renewalId?: string }} options
 */
async function discardRenewalSession(runtime, sessionId, options) {
  const {
    renewalId = ""
  } = options;
  const session = await runtime.store.readSessionForRenewal(sessionId);
  if (
    session.status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
    toText(session.metadata?.renewal_id) !== toText(renewalId)
  ) {
    throw vibe64Error(
      `Session is not the pending successor for renewal ${toText(renewalId) || "(empty)"}: ${toText(sessionId)}`,
      "vibe64_session_renewal_transition_invalid"
    );
  }
  const expectedSourcePath = managedSessionSourcePath(
    runtime.projectSessionSourceRoot,
    session.sessionId
  );
  const sourceRoot = sessionSourcePath(session);
  if (sourceRoot && sourceRoot !== expectedSourcePath) {
    throw vibe64Error(
      "Renewal session source does not match its managed source path.",
      "vibe64_session_source_not_attached"
    );
  }
  await rm(path.dirname(expectedSourcePath), {
    force: true,
    recursive: true
  });
  return runtime.store.removeRenewalPendingSession({
    renewalId,
    sessionId: session.sessionId
  });
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {{ renewalId?: string }} options
 */
async function prepareSessionSourceForRenewal(runtime, sessionId, options) {
  const {
    renewalId = ""
  } = options;
  return runtime.store.mutateSessionForRenewal(sessionId, async () => {
    const session = assertSupportedSession(
      await runtime.store.readSessionForRenewal(sessionId)
    );
    if (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
      toText(session.metadata?.renewal_quiesced_id) !== toText(renewalId)
    ) {
      throw vibe64Error(
        `Only the exact quiesced session source can be prepared for renewal: ${toText(sessionId)}`,
        "vibe64_session_renewal_source_not_quiesced"
      );
    }
    return prepareRenewalSessionSource({
      renewalId,
      session,
      store: runtime.store
    });
  });
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {{ renewalId?: string }} options
 */
async function stagePreparedSessionSourceForRenewal(runtime, sessionId, options) {
  const {
    renewalId = ""
  } = options;
  return runtime.store.mutateSessionForRenewal(sessionId, async () => {
    const session = assertSupportedSession(
      await runtime.store.readSessionForRenewal(sessionId)
    );
    if (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
      toText(session.metadata?.renewal_quiesced_id) !== toText(renewalId)
    ) {
      throw vibe64Error(
        `Only the exact quiesced session source can enter its committed renewal stage: ${toText(sessionId)}`,
        "vibe64_session_renewal_source_not_quiesced"
      );
    }
    return stagePreparedRenewalSessionSource({
      renewalId,
      session
    });
  });
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {{ renewalId?: string }} options
 */
async function restoreSessionSourceAfterRenewalFailure(runtime, sessionId, options) {
  const {
    renewalId = ""
  } = options;
  return runtime.store.mutateSessionForRenewal(sessionId, async () => {
    const session = assertSupportedSession(
      await runtime.store.readSessionForRenewal(sessionId)
    );
    if (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
      toText(session.metadata?.renewal_quiesced_id) !== toText(renewalId)
    ) {
      throw vibe64Error(
        `Renewal source restoration requires the exact quiesced predecessor: ${toText(sessionId)}`,
        "vibe64_session_renewal_source_restore_status_invalid"
      );
    }
    return restoreRenewalSessionSourceStage({
      renewalId,
      session
    });
  });
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {{ renewalId?: string }} options
 */
async function commitRenewalSessionSourceRemoval(runtime, sessionId, options) {
  const {
    renewalId = ""
  } = options;
  return runtime.store.withPublishedRenewalSession(sessionId, async (publishedSession) => {
    const session = assertSupportedSession(publishedSession);
    if (session.status !== VIBE64_SESSION_STATUS.ARCHIVED) {
      throw vibe64Error(
        `Renewal source removal requires an archived predecessor: ${toText(sessionId)}`,
        "vibe64_session_renewal_source_commit_status_invalid"
      );
    }
    if (
      toText(session.metadata?.renewal_id) !== toText(renewalId) ||
      !toText(session.metadata?.renewed_to)
    ) {
      throw vibe64Error(
        `Archived predecessor does not belong to renewal ${toText(renewalId) || "(empty)"}: ${toText(sessionId)}`,
        "vibe64_session_renewal_link_mismatch"
      );
    }
    return commitRenewalSessionSourceStage({
      renewalId,
      session
    });
  });
}

export {
  commitRenewalSessionSourceRemoval,
  createRenewalSession,
  discardRenewalSession,
  prepareSessionSourceForRenewal,
  restoreSessionSourceAfterRenewalFailure,
  stagePreparedSessionSourceForRenewal
};
