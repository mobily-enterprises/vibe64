import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionHasSource, sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";

import { inspectSessionSourceMergeState } from "./sessionSourceGit.js";
import { sourceInspectionFailure } from "./sessionSourceInspection.js";
import { VIBE64_SESSION_STATUS, learningSessionBinding, vibe64SessionStatusIsHidden } from "./sessionStore.js";
import { publicSessionMetadata, workspaceSetupStateFromMetadata } from "./workspaceSetupState.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./runtime.js").Vibe64SessionRuntime} Vibe64SessionRuntime */

// What a session runtime checks and shows of a session: whether it is
// supported and usable, its plain view, its renewal handover and whether its
// source and learning directory are available.
const GENESIS_SESSION_KIND = "genesis";
const SESSION_RENEWAL_HANDOVER_HASH_PATTERN = /^[a-f0-9]{64}$/u;

function unsupportedSessionError(session = {}) {
  const sessionId = toText(session.sessionId) || "(unknown)";
  return vibe64Error(
    `Session ${sessionId} uses an unsupported runtime format and cannot be opened.`,
    "vibe64_session_runtime_unsupported"
  );
}

function sessionIsSupported(session = {}) {
  return toText(session.manifest?.runtimeKind) === GENESIS_SESSION_KIND;
}

function assertSupportedSession(session = {}) {
  if (!sessionIsSupported(session)) {
    throw unsupportedSessionError(session);
  }
  return session;
}

function assertUsableSession(session = {}) {
  if (vibe64SessionStatusIsHidden(session.status)) {
    throw vibe64Error(
      `Vibe64 session is reserved for an in-progress renewal: ${toText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_private"
    );
  }
  return assertSupportedSession(session);
}

function requireSessionSourceRoot(session = {}) {
  const sourceRoot = sessionSourcePath(session);
  if (!sourceRoot) {
    const sessionId = toText(session.sessionId) || "(unknown)";
    throw vibe64Error(
      `Session ${sessionId} has no usable source checkout. Create or select a session with source before using this operation.`,
      "vibe64_session_source_required"
    );
  }
  return sourceRoot;
}

function plainManifest(manifest = {}) {
  return {
    createdAt: toText(manifest.createdAt),
    product: toText(manifest.product) || "vibe64",
    revision: Number(manifest.revision) || 1,
    schemaVersion: Number(manifest.schemaVersion) || 1,
    sessionId: toText(manifest.sessionId),
    updatedAt: toText(manifest.updatedAt || manifest.createdAt)
  };
}

function plainSessionView(session = {}, options = {}) {
  const {
    sourceInspection = null,
    learningScope = null
  } = options;
  const learning = learningSessionBinding(session.metadata, learningScope, session.sessionId);
  const sourcePath = sessionSourcePath(session);
  const workspaceSetup = workspaceSetupStateFromMetadata(session.metadata);
  return {
    ...(session.archived === true
      ? {
          archiveMetadataPath: toText(session.archiveMetadataPath),
          archivePath: toText(session.archivePath),
          archived: true,
          archivedAt: toText(session.archivedAt)
        }
      : {}),
    agentRuns: Array.isArray(session.agentRuns) ? session.agentRuns : [],
    assistantSelection: vibe64AssistantSelectionFromMetadata(session.metadata, {
      required: false
    }),
    backgroundTasks: Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [],
    companion: learning ? { id: "learning", label: "Learning" } : {
      id: GENESIS_SESSION_KIND,
      label: "Genesis"
    },
    ...(learning ? {
      purpose: "learning",
      learning,
      nativeExecutionRoot: session.archived || archivedSessionStatus(session.status) ? ""
        : learning.noExercise ? learningNativeExecutionRoot(session) : sourcePath
    } : {}),
    conversationLogRoot: toText(session.conversationLogRoot),
    manifest: plainManifest(session.manifest),
    metadata: publicSessionMetadata(session.metadata),
    revision: Number(session.revision) || 1,
    sessionId: toText(session.sessionId),
    sessionName: toText(session.sessionName),
    pinnedSessionId: toText(session.pinnedSessionId),
    sessionRoot: toText(session.sessionRoot),
    sourceInspection,
    sourcePath,
    sourceReady: Boolean(sourcePath),
    stateRoot: toText(session.stateRoot),
    status: toText(session.status) || VIBE64_SESSION_STATUS.ACTIVE,
    updatedAt: toText(session.updatedAt),
    workspaceSetup
  };
}

function archivedSessionStatus(status = "") {
  return toText(status) === VIBE64_SESSION_STATUS.ARCHIVED;
}

function sessionSourceCreationFailed(session) {
  return toText(session?.metadata?.source_creation_failed).toLowerCase() === "yes";
}

function sessionSourceRecoveryWasSaved(session) {
  return toText(session?.metadata?.source_recovery_saved).toLowerCase() === "yes";
}

function sessionHasRenewalHandover(session = {}) {
  const metadata = session.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const acknowledged = toText(metadata.agent_briefing_delivered).toLowerCase() === "yes" &&
    Boolean(toText(metadata.agent_renewal_seed_acknowledged_at)) &&
    SESSION_RENEWAL_HANDOVER_HASH_PATTERN.test(
      toText(metadata.agent_renewal_seed_handover_hash)
    ) &&
    Boolean(toText(metadata.agent_renewal_seed_operation_id)) &&
    Boolean(toText(metadata.agent_renewal_seed_thread_id)) &&
    Boolean(toText(metadata.agent_renewal_seed_turn_id)) &&
    Boolean(toText(metadata.renewal_id)) &&
    Boolean(toText(metadata.renewed_from));
  const delivered = Boolean(toText(metadata.renewal_handover_delivered_at)) &&
    Boolean(toText(metadata.renewal_id)) &&
    Boolean(toText(metadata.renewed_from));
  return acknowledged || delivered;
}

function learningNativeExecutionRoot(session) {
  return path.join(session.stateRoot, "sessions", "active", session.sessionId, "native");
}

async function requireLearningNativeDirectory(session) {
  const directory = learningNativeExecutionRoot(session);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
      throw new Error("Not a private native directory.");
    }
  } catch {
    throw vibe64Error(
      "The learning execution directory is missing or aliased. Ask your administrator to restore the original session; reads do not recreate it.",
      "vibe64_learning_native_directory_unavailable"
    );
  }
  return directory;
}

async function sessionAvailabilityIssue(session = {}, learningScope = null) {
  if (!sessionIsSupported(session)) {
    return {
      code: "vibe64_session_runtime_unsupported",
      message: "This session uses an unsupported format. Ask your Vibe64 administrator to preserve its remaining files and retire the record. Start a new session to continue working."
    };
  }
  if (
    session.archived === true || archivedSessionStatus(session.status) ||
    sessionSourceCreationFailed(session) || toText(session.metadata?.session_archive_operation)
  ) {
    return null;
  }
  if (learningSessionBinding(session.metadata, learningScope, session.sessionId)?.noExercise) {
    try {
      await requireLearningNativeDirectory(session);
      return null;
    } catch (error) {
      return { code: error.code, message: error.message };
    }
  }
  const sourcePath = sessionSourcePath(session);
  if (sourcePath && await pathExists(sourcePath)) {
    return null;
  }
  return {
    code: "vibe64_session_source_required",
    message: "The source checkout is missing. Ask your Vibe64 administrator to restore it from a verified backup, then check again. A fresh checkout cannot recover missing unsaved work."
  };
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {object} [session]
 */
async function inspectSessionSource(runtime, session = {}) {
  assertSupportedSession(session);
  if (!sessionHasSource(session)) {
    return null;
  }
  if (!runtime.sourceInspectionAvailable || runtime.sourceInspectionError) {
    return {
      ...sourceInspectionFailure(),
      status: "error"
    };
  }
  try {
    const merge = await inspectSessionSourceMergeState(sessionSourcePath(session));
    if (merge.hasConflicts) {
      return {
        ...sourceInspectionFailure({
          merge
        }),
        status: "error"
      };
    }
    return null;
  } catch {
    return {
      ...sourceInspectionFailure(),
      status: "error"
    };
  }
}

export {
  archivedSessionStatus,
  assertSupportedSession,
  assertUsableSession,
  GENESIS_SESSION_KIND,
  inspectSessionSource,
  learningNativeExecutionRoot,
  plainManifest,
  plainSessionView,
  requireLearningNativeDirectory,
  requireSessionSourceRoot,
  SESSION_RENEWAL_HANDOVER_HASH_PATTERN,
  sessionAvailabilityIssue,
  sessionHasRenewalHandover,
  sessionIsSupported,
  sessionSourceCreationFailed,
  sessionSourceRecoveryWasSaved,
  unsupportedSessionError
};
