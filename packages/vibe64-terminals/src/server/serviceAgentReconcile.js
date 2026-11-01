import { requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { directoryExists, ensureTerminalSessionSourceGitSelfContained } from "./terminalShared.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { sessionRecordId } from "./serviceSessionRecords.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */

function reconcileResultWithSourceFailures(result = {}, sourceFailures = []) {
  if (!sourceFailures.length) {
    return result;
  }
  return {
    ...(result || {}),
    failed: [
      ...(Array.isArray(result?.failed) ? result.failed : []),
      ...sourceFailures
    ],
    ok: false
  };
}

/**
 * Reconciling a project's agent sessions after a restart: one reset of the known agent sessions,
 * legacy assistant selections migrated, and reconciled session sources made self-contained.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.projectService
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionConversations} dependencies.sessionConversations
 */
function createServiceAgentReconcile({ projectService, sessionAgent, sessionConversations }) {
  let knownAgentSessionReset = null;

  async function resetKnownAgentSessionsOnce() {
    if (!knownAgentSessionReset) {
      knownAgentSessionReset = (async () => {
        const runtime = await projectService.createRuntime({
          inspectSource: false
        });
        const listOptions = {
          statusGroup: "all"
        };
        // readable-check: allow method-probe - optional operation: a runtime lists summaries, full sessions or none
        const sessions = typeof runtime?.listSessionSummaries === "function"
          ? await runtime.listSessionSummaries(listOptions)
          // readable-check: allow method-probe - optional operation: a runtime lists summaries, full sessions or none
          : typeof runtime?.listSessions === "function"
            ? await runtime.listSessions(listOptions)
            : [];
        return sessionAgent.unsubscribeSessions(sessions);
      })();
    }
    return knownAgentSessionReset;
  }

  async function resetKnownAgentSessionsBeforeReconcile() {
    const startedAtMs = Date.now();
    try {
      const result = await resetKnownAgentSessionsOnce();
      vibe64SessionDebugLog("server.terminals.agentSession.resetKnown.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        ok: result?.ok !== false,
        sessionCount: Number(result?.sessionCount || 0),
        skipped: result?.skipped === true
      });
      return result;
    } catch (error) {
      knownAgentSessionReset = null;
      vibe64SessionDebugLog("server.terminals.agentSession.resetKnown.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Vibe64 Codex app-server thread reset failed."),
        ok: false
      };
    }
  }

  async function sessionForSourceRepair(session = {}) {
    if (sessionSourcePath(session)) {
      return session;
    }
    const sessionId = sessionRecordId(session);
    // readable-check: allow method-probe - optional operation: a project service without runtimes keeps the session it was given
    if (!sessionId || typeof projectService.createRuntime !== "function") {
      return session;
    }
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    // readable-check: allow method-probe - optional operation: a runtime without a session reader keeps the session it was given
    if (typeof runtime?.getSession !== "function") {
      return session;
    }
    return runtime.getSession(sessionId, {
      inspectSource: false
    });
  }

  async function ensureReconciledSessionSourcesSelfContained(sessions = []) {
    const failed = [];
    for (const sessionEntry of Array.isArray(sessions) ? sessions : []) {
      const sessionId = sessionRecordId(sessionEntry);
      try {
        const session = await sessionForSourceRepair(sessionEntry);
        const workdir = sessionSourcePath(session);
        if (!workdir || !await directoryExists(workdir)) {
          continue;
        }
        const result = await ensureTerminalSessionSourceGitSelfContained({
          session,
          workdir
        });
        if (result.repaired === true) {
          vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.repaired", {
            sessionId: sessionRecordId(session) || sessionId,
            sourceRoot: result.sourceRoot
          });
        }
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_session_source_git_repair_failed",
          error: error instanceof Error ? error.message : String(error || "Session source Git repair failed."),
          sessionId
        });
        vibe64SessionDebugLog("server.terminals.codexAppServerThread.sourceGit.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
      }
    }
    return failed;
  }

  async function migrateLegacyAssistantSelections(sessions = [], options = {}) {
    const failed = [];
    const migrated = [];
    const legacy = [];
    for (const session of sessions) {
      const sessionId = sessionRecordId(session);
      if (!String(session?.metadata?.[VIBE64_ASSISTANT_SELECTION_METADATA] || "").trim()) {
        legacy.push(session);
        continue;
      }
      try {
        vibe64AssistantSelectionFromMetadata(session.metadata);
        migrated.push(session);
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_assistant_selection_migration_failed",
          error: error instanceof Error ? error.message : String(error || "Assistant selection is invalid."),
          sessionId
        });
      }
    }
    if (!legacy.length) {
      return { failed, sessions: migrated };
    }
    const capabilitiesResult = await sessionAgent.listCapabilities({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX
    }, options);
    const capabilities = capabilitiesResult.engines?.[0];
    const migrationCapabilities = {
      ...capabilities,
      modelProviders: capabilities.modelProviders.map((provider) => ({
        ...provider,
        connected: true
      }))
    };
    const runtime = await projectService.createRuntime({ inspectSource: false });
    for (const session of legacy) {
      const sessionId = sessionRecordId(session);
      try {
        const metadata = session.metadata || {};
        const selection = resolveVibe64AssistantSelection(migrationCapabilities, {
          agentId: "codex",
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
          modelProviderId: "openai",
          ...(String(metadata.agent_settings_model || "").trim()
            ? { modelId: String(metadata.agent_settings_model).trim() }
            : {}),
          ...(String(metadata.agent_settings_thinking || "").trim()
            ? { variantId: String(metadata.agent_settings_thinking).trim() }
            : {})
        });
        const serialized = serializeVibe64AssistantSelection(selection);
        await runtime.store.writeMetadataValue(
          sessionId,
          VIBE64_ASSISTANT_SELECTION_METADATA,
          serialized
        );
        migrated.push({
          ...session,
          metadata: {
            ...metadata,
            [VIBE64_ASSISTANT_SELECTION_METADATA]: serialized
          }
        });
      } catch (error) {
        failed.push({
          code: error?.code || "vibe64_assistant_selection_migration_failed",
          error: error instanceof Error ? error.message : String(error || "Assistant selection migration failed."),
          sessionId
        });
        migrated.push(session);
      }
    }
    return { failed, sessions: migrated };
  }

  async function reconcileAgentSessions(sessions = [], options = {}) {
    const replacementFailures = [];
    const admittedSessions = sessions.filter((session) => {
      if (String(session?.status || "").trim() === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED || sessionIsClosing(session)) {
        return false;
      }
      try {
        requireCompletedNativeConversationReplacement(session);
        return true;
      } catch (error) {
        replacementFailures.push({ sessionId: session.sessionId, code: error.code, error: error.message });
        return false;
      }
    });
    const migration = await migrateLegacyAssistantSelections(admittedSessions, options);
    const sourceFailures = await ensureReconciledSessionSourcesSelfContained(migration.sessions);
    await resetKnownAgentSessionsBeforeReconcile();
    const temporaryFailures = [];
    for (const session of migration.sessions) {
      try {
        const restored = await sessionConversations.listTemporaryConversations(session.sessionId, options);
        for (const conversation of restored.conversations) {
          if (conversation.state === "closing") {
            await sessionConversations.deleteTemporaryConversation(session.sessionId, { conversationId: conversation.conversationId }, options);
          } else if (conversation.readError) {
            throw new Error(conversation.error);
          }
        }
      } catch (error) {
        temporaryFailures.push({ sessionId: session.sessionId, error: error.message });
      }
    }
    const result = await sessionAgent.reconcileSessions(migration.sessions, options);
    return reconcileResultWithSourceFailures(result, [
      ...replacementFailures,
      ...temporaryFailures,
      ...migration.failed,
      ...sourceFailures
    ]);
  }

  return Object.freeze({
    reconcileAgentSessions
  });
}

export {
  createServiceAgentReconcile
};
