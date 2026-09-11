import process from "node:process";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  managedSessionSourcePath,
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  assertGenesisPromptTask,
  renderGenesisPrompt
} from "@local/vibe64-genesis/server";
import {
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";

import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore,
  vibe64SessionStatusIsHidden
} from "./sessionStore.js";
import {
  assertSourceInspectionHealthy,
  sourceInspectionFailure
} from "./sessionSourceInspection.js";
import {
  inspectSessionSourceMergeState
} from "./sessionSourceGit.js";
import {
  VIBE64_SESSION_CLOSING_AT_METADATA,
  VIBE64_SESSION_CLOSING_REASON_METADATA,
  sessionClosingMetadata
} from "./sessionLifecycle.js";
import {
  archiveSessionSource as archiveStoredSessionSource,
  commitRenewalSessionSourceStage,
  prepareRenewalSessionSource,
  restoreRenewalSessionSourceStage,
  stagePreparedRenewalSessionSource
} from "./sessionWorktreeArchive.js";
import {
  publicSessionMetadata,
  workspaceSetupStateFromMetadata
} from "./workspaceSetupState.js";

const GENESIS_SESSION_KIND = "genesis";
const SESSION_RENEWAL_HANDOVER_HASH_PATTERN = /^[a-f0-9]{64}$/u;

function unsupportedSessionError(session = {}) {
  const sessionId = normalizeText(session.sessionId || session.id) || "(unknown)";
  return vibe64Error(
    `Session ${sessionId} uses an unsupported runtime format and cannot be opened.`,
    "vibe64_session_runtime_unsupported"
  );
}

function sessionIsSupported(session = {}) {
  return normalizeText(session.manifest?.runtimeKind) === GENESIS_SESSION_KIND;
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
      `Vibe64 session is reserved for an in-progress renewal: ${normalizeText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_private"
    );
  }
  return assertSupportedSession(session);
}

function requireSessionSourceRoot(session = {}) {
  const sourceRoot = sessionSourcePath(session);
  if (!sourceRoot) {
    const sessionId = normalizeText(session.sessionId || session.id) || "(unknown)";
    throw vibe64Error(
      `Session ${sessionId} has no usable source checkout. Create or select a session with source before using this operation.`,
      "vibe64_session_source_required"
    );
  }
  return sourceRoot;
}

function plainManifest(manifest = {}) {
  return {
    createdAt: normalizeText(manifest.createdAt),
    product: normalizeText(manifest.product) || "vibe64",
    revision: Number(manifest.revision) || 1,
    schemaVersion: Number(manifest.schemaVersion) || 1,
    sessionId: normalizeText(manifest.sessionId),
    updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
  };
}

function plainSessionView(session = {}, {
  sourceInspection = null
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const workspaceSetup = workspaceSetupStateFromMetadata(session.metadata);
  return {
    ...(session.archived === true
      ? {
          archiveMetadataPath: normalizeText(session.archiveMetadataPath),
          archivePath: normalizeText(session.archivePath),
          archived: true,
          archivedAt: normalizeText(session.archivedAt)
        }
      : {}),
    agentRuns: Array.isArray(session.agentRuns) ? session.agentRuns : [],
    assistantSelection: vibe64AssistantSelectionFromMetadata(session.metadata, {
      required: false
    }),
    backgroundTasks: Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [],
    companion: {
      id: GENESIS_SESSION_KIND,
      label: "Genesis"
    },
    conversationLogRoot: normalizeText(session.conversationLogRoot),
    manifest: plainManifest(session.manifest),
    metadata: publicSessionMetadata(session.metadata),
    revision: Number(session.revision) || 1,
    sessionId: normalizeText(session.sessionId),
    sessionName: normalizeText(session.sessionName),
    sessionRoot: normalizeText(session.sessionRoot),
    sourceInspection,
    sourcePath,
    sourceReady: Boolean(sourcePath),
    stateRoot: normalizeText(session.stateRoot),
    status: normalizeText(session.status) || VIBE64_SESSION_STATUS.ACTIVE,
    updatedAt: normalizeText(session.updatedAt),
    workspaceSetup
  };
}

function archivedSessionStatus(status = "") {
  return normalizeText(status) === VIBE64_SESSION_STATUS.ARCHIVED;
}

function sessionSourceCreationFailed(session = {}) {
  return normalizeText(session?.metadata?.source_creation_failed).toLowerCase() === "yes";
}

function sessionSourceRecoveryWasSaved(session = {}) {
  return normalizeText(session?.metadata?.source_recovery_saved).toLowerCase() === "yes";
}

function sessionHasRenewalHandover(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
  const acknowledged = normalizeText(metadata.agent_briefing_delivered).toLowerCase() === "yes" &&
    Boolean(normalizeText(metadata.agent_renewal_seed_acknowledged_at)) &&
    SESSION_RENEWAL_HANDOVER_HASH_PATTERN.test(
      normalizeText(metadata.agent_renewal_seed_handover_hash)
    ) &&
    Boolean(normalizeText(metadata.agent_renewal_seed_operation_id)) &&
    Boolean(normalizeText(metadata.agent_renewal_seed_thread_id)) &&
    Boolean(normalizeText(metadata.agent_renewal_seed_turn_id)) &&
    Boolean(normalizeText(metadata.renewal_id)) &&
    Boolean(normalizeText(metadata.renewed_from));
  const delivered = Boolean(normalizeText(metadata.renewal_handover_delivered_at)) &&
    Boolean(normalizeText(metadata.renewal_id)) &&
    Boolean(normalizeText(metadata.renewed_from));
  return acknowledged || delivered;
}

async function sessionIsListable(session = {}) {
  if (!sessionIsSupported(session)) {
    return false;
  }
  if (session.archived === true || archivedSessionStatus(session.status)) {
    return true;
  }
  if (sessionSourceCreationFailed(session)) {
    return true;
  }
  if (normalizeText(session.metadata?.session_archive_operation)) {
    return true;
  }
  const sourcePath = sessionSourcePath(session);
  return Boolean(sourcePath && await pathExists(sourcePath));
}

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

class Vibe64SessionRuntime {
  constructor({
    clock = undefined,
    createSessionSource = null,
    inspectSourceByDefault = true,
    projectContextRoot = process.cwd(),
    projectRuntimeRoot = "",
    projectSessionSourceRoot = "",
    promptEnvironment = process.env,
    promptRenderer = renderGenesisPrompt,
    sourceInspectionAvailable = true,
    sourceInspectionError = null,
    store = undefined
  } = {}) {
    this.inspectSourceByDefault = inspectSourceByDefault !== false;
    this.createSessionSource = typeof createSessionSource === "function"
      ? createSessionSource
      : null;
    this.projectSessionSourceRoot = normalizeText(projectSessionSourceRoot);
    this.promptEnvironment = promptEnvironment && ["object", "function"].includes(typeof promptEnvironment)
      ? promptEnvironment
      : process.env;
    this.promptRenderer = typeof promptRenderer === "function"
      ? promptRenderer
      : renderGenesisPrompt;
    this.sourceInspectionAvailable = sourceInspectionAvailable !== false;
    this.sourceInspectionError = sourceInspectionError || null;
    this.projectContextRoot = projectContextRoot;
    this.stateRoot = normalizeText(projectRuntimeRoot);
    if (!this.stateRoot && !store) {
      throw vibe64Error(
        "Vibe64 session runtime requires projectRuntimeRoot.",
        "vibe64_project_runtime_root_required"
      );
    }
    this.store = store || createVibe64SessionStore({
      clock,
      projectContextRoot,
      projectRuntimeRoot: this.stateRoot,
      projectSessionSourceRoot: this.projectSessionSourceRoot
    });
  }

  async createSession({
    metadata = {},
    sessionId = "",
    sourceContext = {},
    status = VIBE64_SESSION_STATUS.ACTIVE
  } = {}) {
    let session = await this.store.createSession({
      runtimeKind: GENESIS_SESSION_KIND,
      metadata,
      sessionId,
      status
    });
    try {
      if (this.createSessionSource) {
        await this.createSessionSource({
          ...(sourceContext && typeof sourceContext === "object" ? sourceContext : {}),
          runtime: this,
          session,
          store: this.store
        });
        session = await this.store.readSession(session.sessionId);
      }
      if (!sessionHasSource(session)) {
        throw vibe64Error(
          this.createSessionSource
            ? "Session source creation completed without attaching a source directory."
            : "Session creation requires an existing source or a createSessionSource callback.",
          this.createSessionSource
            ? "vibe64_session_source_not_attached"
            : "vibe64_session_source_creator_required"
        );
      }
    } catch (error) {
      await this.store.mutateSession(session.sessionId, async () => {
        await Promise.all([
          this.store.writeMetadataValue(session.sessionId, "source_creation_error", normalizeText(error?.message)),
          this.store.writeMetadataValue(session.sessionId, "source_creation_failed", "yes"),
          this.store.writeStatus(session.sessionId, VIBE64_SESSION_STATUS.BLOCKED)
        ]);
      });
      throw error;
    }
    return this.sessionView(session);
  }

  async createRenewalSession({
    actorDisplayName = "",
    actorId = "",
    confirmedAt = "",
    metadata = {},
    renewalId = "",
    renewedFrom = "",
    sessionId = "",
    sourceContext = {},
    startedAt = ""
  } = {}) {
    if (!this.projectSessionSourceRoot) {
      throw vibe64Error(
        "Renewal session creation requires projectSessionSourceRoot.",
        "vibe64_project_session_source_root_required"
      );
    }
    let session = await this.store.createRenewalPendingSession({
      actorDisplayName,
      actorId,
      confirmedAt,
      metadata,
      renewalId,
      renewedFrom,
      runtimeKind: GENESIS_SESSION_KIND,
      sessionId,
      startedAt
    });
    const expectedSourcePath = managedSessionSourcePath(
      this.projectSessionSourceRoot,
      session.sessionId
    );
    const recordedSourcePath = normalizeText(session.metadata?.source_path);
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
        if (!this.createSessionSource) {
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
        await this.store.mutateSessionForRenewal(session.sessionId, () => (
          this.createSessionSource({
            ...(sourceContext && typeof sourceContext === "object" ? sourceContext : {}),
            runtime: this,
            session,
            store: this.store
          })
        ));
        session = await this.store.readSessionForRenewal(session.sessionId);
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
      await this.store.removeRenewalPendingSession({
        renewalId,
        sessionId: session.sessionId
      });
      throw error;
    }
    return this.sessionViewForRenewal(session);
  }

  async discardRenewalSession(sessionId = "", {
    renewalId = ""
  } = {}) {
    const session = await this.store.readSessionForRenewal(sessionId);
    if (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
      normalizeText(session.metadata?.renewal_id) !== normalizeText(renewalId)
    ) {
      throw vibe64Error(
        `Session is not the pending successor for renewal ${normalizeText(renewalId) || "(empty)"}: ${normalizeText(sessionId)}`,
        "vibe64_session_renewal_transition_invalid"
      );
    }
    const expectedSourcePath = managedSessionSourcePath(
      this.projectSessionSourceRoot,
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
    return this.store.removeRenewalPendingSession({
      renewalId,
      sessionId: session.sessionId
    });
  }

  async resolvePromptEnvironment() {
    if (typeof this.promptEnvironment === "function") {
      this.promptEnvironment = Promise.resolve().then(this.promptEnvironment);
    }
    return this.promptEnvironment;
  }

  async getSession(sessionId, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    return this.sessionView(await this.store.readSession(sessionId), {
      inspectSource
    });
  }

  async getSessionForRenewal(sessionId, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    return this.sessionViewForRenewal(
      await this.store.readSessionForRenewal(sessionId),
      { inspectSource }
    );
  }

  async listSessions(options = {}) {
    const sessions = await this.store.listSessions(options);
    const listable = await Promise.all(sessions.map(sessionIsListable));
    return Promise.all(sessions
      .filter((_session, index) => listable[index])
      .map((session) => this.sessionView(session)));
  }

  async listSessionSummaries(options = {}) {
    const sessions = await this.store.listSessionSummaries(options);
    const listable = await Promise.all(sessions.map(sessionIsListable));
    return sessions
      .filter((_session, index) => listable[index])
      .map((session) => plainSessionView(session, {
        sourceInspection: null
      }));
  }

  async updateCurrentSession(sessionId = "") {
    if (sessionId) {
      assertSupportedSession(await this.store.readSession(sessionId));
    }
    return this.store.updateCurrentSession(sessionId);
  }

  async finalizeRenewalCurrentSession(options = {}) {
    return this.store.finalizeRenewalCurrentSession(options);
  }

  async activateRenewalSession(options = {}) {
    return this.store.activateRenewalSuccessor(options);
  }

  async quiesceSessionForRenewal(options = {}) {
    return this.store.quiesceSessionForRenewal(options);
  }

  async restoreSessionAfterRenewalCancellation(options = {}) {
    return this.store.restoreSessionAfterRenewalCancellation(options);
  }

  async sessionView(session = {}, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    assertUsableSession(session);
    const sourceInspection = inspectSource
      ? await this.inspectSourceForSession(session)
      : null;
    return plainSessionView(session, {
      sourceInspection
    });
  }

  async sessionViewForRenewal(session = {}, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    assertSupportedSession(session);
    const sourceInspection = inspectSource
      ? await inspectSessionSource(this, session)
      : null;
    return plainSessionView(session, {
      sourceInspection
    });
  }

  async inspectSourceForSession(session = {}) {
    assertUsableSession(session);
    return inspectSessionSource(this, session);
  }

  async assertSourceHealthy(sessionOrId = {}) {
    const session = typeof sessionOrId === "string"
      ? await this.store.readSession(sessionOrId)
      : sessionOrId;
    assertUsableSession(session);
    const inspection = await inspectSessionSource(this, session);
    assertSourceInspectionHealthy(inspection);
    return sessionSourcePath(session);
  }

  async renderPrompt(sessionId, {
    input = {},
    request = "",
    task = "work"
  } = {}) {
    const session = assertSupportedSession(await this.store.readSession(sessionId));
    const sourceRoot = requireSessionSourceRoot(session);
    let genesisTask = assertGenesisPromptTask(task, {
      required: true
    });
    if (genesisTask === "work") {
      const conversation = await this.store.readConversationLog(sessionId);
      const hasUserMessage = conversation.some((turn) => Boolean(turn?.user));
      if (!hasUserMessage && !sessionHasRenewalHandover(session)) {
        genesisTask = "start";
      }
    }
    return this.promptRenderer({
      action: {
        genesisTask,
        id: genesisTask,
        label: normalizeText(request) || genesisTask
      },
      environment: await this.resolvePromptEnvironment(),
      input: {
        ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
        ...(normalizeText(request) ? { request: normalizeText(request) } : {})
      },
      projectRoot: sourceRoot
    });
  }

  async archiveSessionSource(sessionOrId = {}, {
    reason = "archive"
  } = {}) {
    const sessionId = normalizeText(typeof sessionOrId === "string"
      ? sessionOrId
      : sessionOrId.sessionId || sessionOrId.id);
    return this.store.mutateSession(sessionId, async () => {
      const session = assertSupportedSession(await this.store.readSession(sessionId));
      if (!sessionSourceRecoveryWasSaved(session)) {
        await this.assertSourceHealthy(session);
      }
      return archiveStoredSessionSource({
        reason,
        session,
        store: this.store
      });
    });
  }

  async prepareSessionSourceForRenewal(sessionId = "", {
    renewalId = ""
  } = {}) {
    return this.store.mutateSessionForRenewal(sessionId, async () => {
      const session = assertSupportedSession(
        await this.store.readSessionForRenewal(sessionId)
      );
      if (
        session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        normalizeText(session.metadata?.renewal_quiesced_id) !== normalizeText(renewalId)
      ) {
        throw vibe64Error(
          `Only the exact quiesced session source can be prepared for renewal: ${normalizeText(sessionId)}`,
          "vibe64_session_renewal_source_not_quiesced"
        );
      }
      return prepareRenewalSessionSource({
        renewalId,
        session,
        store: this.store
      });
    });
  }

  async stagePreparedSessionSourceForRenewal(sessionId = "", {
    renewalId = ""
  } = {}) {
    return this.store.mutateSessionForRenewal(sessionId, async () => {
      const session = assertSupportedSession(
        await this.store.readSessionForRenewal(sessionId)
      );
      if (
        session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        normalizeText(session.metadata?.renewal_quiesced_id) !== normalizeText(renewalId)
      ) {
        throw vibe64Error(
          `Only the exact quiesced session source can enter its committed renewal stage: ${normalizeText(sessionId)}`,
          "vibe64_session_renewal_source_not_quiesced"
        );
      }
      return stagePreparedRenewalSessionSource({
        renewalId,
        session
      });
    });
  }

  async restoreSessionSourceAfterRenewalFailure(sessionId = "", {
    renewalId = ""
  } = {}) {
    return this.store.mutateSessionForRenewal(sessionId, async () => {
      const session = assertSupportedSession(
        await this.store.readSessionForRenewal(sessionId)
      );
      if (
        session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        normalizeText(session.metadata?.renewal_quiesced_id) !== normalizeText(renewalId)
      ) {
        throw vibe64Error(
          `Renewal source restoration requires the exact quiesced predecessor: ${normalizeText(sessionId)}`,
          "vibe64_session_renewal_source_restore_status_invalid"
        );
      }
      return restoreRenewalSessionSourceStage({
        renewalId,
        session
      });
    });
  }

  async commitRenewalSessionSourceRemoval(sessionId = "", {
    renewalId = ""
  } = {}) {
    return this.store.withPublishedRenewalSession(sessionId, async (publishedSession) => {
      const session = assertSupportedSession(publishedSession);
      if (session.status !== VIBE64_SESSION_STATUS.ARCHIVED) {
        throw vibe64Error(
          `Renewal source removal requires an archived predecessor: ${normalizeText(sessionId)}`,
          "vibe64_session_renewal_source_commit_status_invalid"
        );
      }
      if (
        normalizeText(session.metadata?.renewal_id) !== normalizeText(renewalId) ||
        !normalizeText(session.metadata?.renewed_to)
      ) {
        throw vibe64Error(
          `Archived predecessor does not belong to renewal ${normalizeText(renewalId) || "(empty)"}: ${normalizeText(sessionId)}`,
          "vibe64_session_renewal_link_mismatch"
        );
      }
      return commitRenewalSessionSourceStage({
        renewalId,
        session
      });
    });
  }

  async markSessionClosing(sessionId = "", {
    reason = "closing"
  } = {}) {
    return this.store.mutateSession(sessionId, async () => {
      assertSupportedSession(await this.store.readSession(sessionId));
      const metadata = sessionClosingMetadata(reason);
      await Promise.all(Object.entries(metadata).map(([name, value]) => (
        this.store.writeMetadataValue(sessionId, name, value)
      )));
      return this.getSession(sessionId);
    });
  }

  async clearSessionClosing(sessionId = "") {
    return this.store.mutateSession(sessionId, async () => {
      const session = assertSupportedSession(await this.store.readSession(sessionId));
      if (sessionSourceRecoveryWasSaved(session)) {
        return this.getSession(sessionId);
      }
      await this.store.deleteMetadataValues(sessionId, [
        VIBE64_SESSION_CLOSING_AT_METADATA,
        VIBE64_SESSION_CLOSING_REASON_METADATA
      ]);
      return this.getSession(sessionId);
    });
  }

  async archiveSession(sessionId = "", {
    reason = "archived"
  } = {}) {
    const session = assertSupportedSession(await this.store.readSession(sessionId));
    if (archivedSessionStatus(session.status)) {
      return this.getSession(sessionId);
    }
    await this.markSessionClosing(sessionId, {
      reason
    });
    try {
      if (sessionHasSource(session) || sessionSourceRecoveryWasSaved(session)) {
        await this.archiveSessionSource(sessionId, {
          reason
        });
      } else if (sessionSourceCreationFailed(session)) {
        const failedSourcePath = managedSessionSourcePath(this.projectSessionSourceRoot, sessionId);
        if (failedSourcePath) {
          await rm(failedSourcePath, {
            force: true,
            recursive: true
          });
        }
      } else {
        await this.assertSourceHealthy(session);
      }
      await this.store.writeStatus(sessionId, VIBE64_SESSION_STATUS.ARCHIVED);
      await this.store.publishSessionArchive(sessionId);
      return this.getSession(sessionId);
    } catch (error) {
      await this.clearSessionClosing(sessionId).catch(() => null);
      throw error;
    }
  }

  async readConversationLog(sessionId) {
    await this.store.readSession(sessionId);
    return this.store.readConversationLog(sessionId);
  }

  async readConversationLogPage(sessionId, options = {}) {
    await this.store.readSession(sessionId);
    return this.store.readConversationLogPage(sessionId, options);
  }

  async writeConversationUserMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeConversationUserMessage(sessionId, message);
  }

  async writeConversationAssistantMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeConversationAssistantMessage(sessionId, message);
  }

  async upsertConversationAssistantMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.upsertConversationAssistantMessage(sessionId, message);
  }

  async writeConversationCommentaryMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeConversationCommentaryMessage(sessionId, message);
  }

  async writeConversationThinkingMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeConversationThinkingMessage(sessionId, message);
  }

  async writeConversationSystemMessage(sessionId, message = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeConversationSystemMessage(sessionId, message);
  }

  async readAgentRun(sessionId, runId) {
    await this.store.readSession(sessionId);
    return this.store.readAgentRun(sessionId, runId);
  }

  async writeAgentRunEvent(sessionId, runId, event = {}) {
    await this.store.readSession(sessionId);
    return this.store.writeAgentRunEvent(sessionId, runId, event);
  }
}

export {
  GENESIS_SESSION_KIND,
  Vibe64SessionRuntime,
  assertSupportedSession,
  plainSessionView,
  sessionIsSupported
};
