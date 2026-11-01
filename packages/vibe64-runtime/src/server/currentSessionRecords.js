import path from "node:path";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { readProjectRuntimeOpenState } from "@local/vibe64-core/server/projectRuntimeOpenState";
import { assertRenewalId } from "./sessionRenewalIds.js";
import { readVibe64CurrentSessionAlias, updateVibe64CurrentSessionAlias } from "./currentSessionAlias.js";
import {
  assertValidVibe64SessionId,
  genuineLearningBinding,
  HIDDEN_VIBE64_SESSION_STATUSES,
  LEARNING_SESSION_METADATA,
  OPEN_VIBE64_SESSION_STATUSES,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import { metadataFilePath, readTextIfExists } from "./sessionStoreLayout.js";
import { enqueueSessionMutation } from "./sessionStoreLocks.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveAccess} SessionArchiveAccess */
/** @typedef {import("./types.js").SessionRecords} SessionRecords */
/** @typedef {import("./types.js").SessionRenewalArchives} SessionRenewalArchives */

/**
 * The project's current and pinned session, and their handover in a renewal.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveAccess} dependencies.archiveAccess
 * @param {SessionRecords} dependencies.sessionRecords
 * @param {SessionRenewalArchives} dependencies.renewalArchives
 */
function createCurrentSessionRecords({
  state,
  storePaths,
  recordFiles,
  archiveAccess,
  sessionRecords,
  renewalArchives
}) {
  async function withUnpinnedProject(operation) {
    const rootPaths = storePaths.paths();
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath || state.normalizedStateRoot, async () => {
      const pinned = await recordFiles.readPinnedSessionId();
      if (pinned) throw vibe64Error(`Unpin session ${pinned} before closing this project.`, "vibe64_project_pinned");
      return operation();
    });
  }

  async function updatePinnedSession(sessionId, pinned) {
    const rootPaths = storePaths.paths();
    if (!rootPaths.currentSessionAliasPath || state.admittedLearningScope) {
      throw vibe64Error("Only a project source session can be pinned.", "vibe64_session_pin_unavailable");
    }
    const id = assertValidVibe64SessionId(sessionId);
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      if (pinned && !(await readProjectRuntimeOpenState({ projectRuntimeRoot: state.normalizedStateRoot })).open) {
        throw vibe64Error("Open the project before pinning its session.", "vibe64_project_closed");
      }
      const session = await sessionRecords.readSession(id);
      if (session.status !== VIBE64_SESSION_STATUS.ACTIVE || session.metadata.session_closing_reason) {
        throw vibe64Error("Only an active session outside closing or renewal can be pinned.", "vibe64_session_pin_unavailable");
      }
      const existing = await recordFiles.readPinnedSessionId();
      if (existing && existing !== id) {
        throw vibe64Error("Unpin the project's pinned session first.", "vibe64_session_already_pinned");
      }
      const pinnedAlias = path.join(path.dirname(rootPaths.currentSessionAliasPath), "pinned");
      if (pinned) {
        await updateVibe64CurrentSessionAlias({ aliasPath: rootPaths.currentSessionAliasPath, sessionId: id });
      }
      await updateVibe64CurrentSessionAlias({ aliasPath: pinnedAlias, sessionId: pinned ? id : "" });
      return { pinnedSessionId: pinned ? id : "" };
    });
  }

  async function updateCurrentSession(sessionId = "") {
    const requestedSessionId = toText(sessionId);
    const rootPaths = storePaths.paths();
    if (!rootPaths.currentSessionAliasPath) {
      throw vibe64Error(
        "Updating the current Vibe64 session requires projectSessionSourceRoot.",
        "vibe64_project_session_source_root_required"
      );
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      const selectedSessionId = await recordFiles.readPinnedSessionId() || requestedSessionId;
      if (selectedSessionId) {
        const selectedSession = await sessionRecords.readSessionForRenewal(selectedSessionId);
        if (!OPEN_VIBE64_SESSION_STATUSES.has(selectedSession.status)) {
          throw vibe64Error(
            `Vibe64 session cannot be selected while it is ${selectedSession.status}: ${selectedSessionId}`,
            HIDDEN_VIBE64_SESSION_STATUSES.has(selectedSession.status)
              ? "vibe64_session_renewal_private"
              : "vibe64_session_not_selectable"
          );
        }
      }
      await updateVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath,
        sessionId: selectedSessionId
      });
      return {
        sessionId: selectedSessionId
      };
    });
  }

  async function finalizeRenewalCurrentSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const ownership = await archiveAccess.withPreparedRenewalSession(
      normalizedSourceSessionId,
      async (publishedSession) => renewalArchives.assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    );
    const rootPaths = storePaths.paths();
    if (!rootPaths.currentSessionAliasPath) {
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: ""
      };
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      const successor = await sessionRecords.readSessionForRenewal(normalizedSuccessorSessionId);
      if (
        successor.status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING ||
        toText(successor.metadata.renewal_id) !== normalizedRenewalId ||
        toText(successor.metadata.renewed_from) !== normalizedSourceSessionId
      ) {
        throw vibe64Error(
          `Renewal successor is not prepared for renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
          "vibe64_session_renewal_link_mismatch"
        );
      }
      const selectedSessionId = await readVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath
      });
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: selectedSessionId,
        successorWillBeSelected:
          ownership.selectedBeforeArchive === normalizedSourceSessionId &&
          (!selectedSessionId || selectedSessionId === normalizedSourceSessionId)
      };
    });
  }

  async function commitRenewalCurrentSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const ownership = await archiveAccess.withPublishedRenewalSession(
      normalizedSourceSessionId,
      async (publishedSession) => renewalArchives.assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    );
    const rootPaths = storePaths.paths();
    if (!rootPaths.currentSessionAliasPath) {
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: ""
      };
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      const successor = await sessionRecords.readSessionForRenewal(normalizedSuccessorSessionId);
      if (
        successor.status !== VIBE64_SESSION_STATUS.ACTIVE ||
        toText(successor.metadata.renewal_id) !== normalizedRenewalId ||
        toText(successor.metadata.renewed_from) !== normalizedSourceSessionId ||
        !toText(successor.metadata.renewal_activated_at)
      ) {
        throw vibe64Error(
          `Renewal successor is not committed for renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
          "vibe64_session_renewal_link_mismatch"
        );
      }
      const selectedSessionId = await readVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath
      });
      if (
        ownership.selectedBeforeArchive !== normalizedSourceSessionId ||
        (
          selectedSessionId &&
          selectedSessionId !== normalizedSourceSessionId &&
          selectedSessionId !== normalizedSuccessorSessionId
        )
      ) {
        return {
          changed: false,
          selectedBeforeArchive: ownership.selectedBeforeArchive,
          sessionId: selectedSessionId
        };
      }
      if (selectedSessionId === normalizedSuccessorSessionId) {
        return {
          changed: false,
          selectedBeforeArchive: ownership.selectedBeforeArchive,
          sessionId: selectedSessionId
        };
      }
      await updateVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath,
        sessionId: normalizedSuccessorSessionId
      });
      return {
        changed: true,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: normalizedSuccessorSessionId
      };
    });
  }

  async function hasGenuineLearningBinding(sessionId) {
    const raw = toText(await readTextIfExists(metadataFilePath(storePaths.paths(sessionId), LEARNING_SESSION_METADATA)));
    return genuineLearningBinding(raw, sessionId);
  }

  async function readCurrentSession() {
    const rootPaths = storePaths.paths();
    if (!rootPaths.currentSessionAliasPath) {
      return null;
    }
    const sessionId = await readVibe64CurrentSessionAlias({
      aliasPath: rootPaths.currentSessionAliasPath
    });
    if (!sessionId || !state.admittedLearningScope && await hasGenuineLearningBinding(assertValidVibe64SessionId(sessionId))) {
      return null;
    }
    const session = await sessionRecords.readSessionForRenewal(assertValidVibe64SessionId(sessionId));
    return OPEN_VIBE64_SESSION_STATUSES.has(session.status) ? session : null;
  }

  return Object.freeze({
    commitRenewalCurrentSession,
    finalizeRenewalCurrentSession,
    hasGenuineLearningBinding,
    readCurrentSession,
    updateCurrentSession,
    updatePinnedSession,
    withUnpinnedProject
  });
}

export {
  createCurrentSessionRecords
};
