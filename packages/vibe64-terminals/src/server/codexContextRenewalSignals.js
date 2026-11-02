import {
  codexContextUsageFromNotification, codexAppServerContextRefreshReason,
  codexAppServerNotificationEvent, codexAppServerNotificationItemId, codexAppServerNotificationTurnId
} from "@jskit-ai/assistant-core/server/codex-events";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { normalizeVibe64AgentRunState } from "@local/vibe64-runtime/server/sessionStore";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").CodexAppServerRunOwner} CodexAppServerRunOwner */
/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const CONTEXT_COMPACTION_REASON = "context_compacted";
const CODEX_CONTEXT_REFRESH_PENDING_METADATA = Object.freeze([
  "codex_context_refresh_pending",
  "codex_context_refresh_pending_at",
  "codex_context_refresh_reason",
  "codex_context_refresh_thread_id",
  "codex_context_refresh_turn_id"
]);

function nonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function sessionContextUsageFromMetadata(metadata, options = {}) {
  const {
    expectedThreadId = ""
  } = options;
  const providerId = toText(metadata?.agent_context_usage_provider);
  const threadId = toText(metadata?.agent_context_usage_thread_id);
  const currentThreadId = toText(expectedThreadId);
  const updatedAt = toText(metadata?.agent_context_usage_updated_at);
  const usedTokens = nonNegativeInteger(metadata?.agent_context_used_tokens);
  const windowTokens = nonNegativeInteger(metadata?.agent_context_window_tokens);
  if (
    !providerId ||
    !threadId ||
    !currentThreadId ||
    threadId !== currentThreadId ||
    !updatedAt ||
    !windowTokens ||
    usedTokens === null
  ) {
    return null;
  }
  return {
    exact: true,
    providerId,
    threadId,
    updatedAt,
    usedTokens,
    windowTokens
  };
}

function contextCompactionKey({
  eventId = "",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const fields = [reason, threadId, turnId, eventId].map(toText);
  return fields.slice(1).some(Boolean) ? fields.join(":") : "";
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [notification]
 * @param {object} [options]
 * @param {string} [options.at]
 * @param {string} [options.expectedThreadId]
 */
async function recordCodexContextUsageSignal(store, sessionId = "", notification = {}, options = {}) {
  const {
    at = new Date().toISOString(),
    expectedThreadId = ""
  } = options;
  const id = toText(sessionId);
  const usage = codexContextUsageFromNotification(notification);
  const threadId = toText(expectedThreadId);
  if (
    !id ||
    !usage ||
    !threadId ||
    usage.threadId !== threadId ||
    !store
  ) {
    return null;
  }
  const recordedAt = toText(at) || new Date().toISOString();
  return store.mutateSession(id, async () => {
    const currentThreadId = toText(
      await store.readMetadataValue(id, "agent_identity_conversation_id")
    );
    const previousThreadId = toText(
      await store.readMetadataValue(id, "agent_context_usage_thread_id")
    );
    const previousCumulativeTokens = nonNegativeInteger(
      await store.readMetadataValue(id, "agent_context_usage_cumulative_tokens")
    );
    if (currentThreadId !== usage.threadId) {
      return null;
    }
    if (
      previousThreadId === usage.threadId &&
      previousCumulativeTokens !== null &&
      usage.cumulativeTokens <= previousCumulativeTokens
    ) {
      return null;
    }
    await Promise.all([
      store.writeMetadataValue(
        id,
        "agent_context_usage_cumulative_tokens",
        String(usage.cumulativeTokens)
      ),
      store.writeMetadataValue(id, "agent_context_input_tokens", String(usage.inputTokens)),
      store.writeMetadataValue(id, "agent_context_usage_provider", "codex"),
      store.writeMetadataValue(id, "agent_context_usage_thread_id", usage.threadId),
      store.writeMetadataValue(id, "agent_context_usage_turn_id", usage.turnId),
      store.writeMetadataValue(id, "agent_context_usage_updated_at", recordedAt),
      store.writeMetadataValue(id, "agent_context_used_tokens", String(usage.usedTokens)),
      store.writeMetadataValue(id, "agent_context_window_tokens", String(usage.windowTokens))
    ]);
    return {
      ...usage,
      at: recordedAt,
      exact: true,
      providerId: "codex"
    };
  });
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [options]
 * @param {string} [options.at]
 * @param {string} [options.eventId]
 * @param {string} [options.reason]
 * @param {string} [options.threadId]
 * @param {string} [options.turnId]
 */
async function recordCodexContextRenewalSignal(store, sessionId = "", options = {}) {
  const {
    at = new Date().toISOString(),
    eventId = "",
    reason = "",
    threadId = "",
    turnId = ""
  } = options;
  const id = toText(sessionId);
  const normalizedReason = toText(reason);
  if (
    !id ||
    normalizedReason !== CONTEXT_COMPACTION_REASON ||
    !store
  ) {
    return null;
  }
  const key = contextCompactionKey({
    eventId,
    reason: normalizedReason,
    threadId,
    turnId
  });
  if (!key) {
    return null;
  }
  return store.mutateSession(id, async () => {
    const previousKey = toText(
      await store.readMetadataValue(id, "agent_context_compaction_last_key")
    );
    const previousCount = nonNegativeInteger(
      await store.readMetadataValue(id, "agent_context_compaction_count")
    );
    if (previousKey === key) {
      return {
        at: toText(await store.readMetadataValue(id, "agent_context_compaction_last_at")),
        count: previousCount,
        duplicate: true,
        key
      };
    }
    const count = Math.min(Number.MAX_SAFE_INTEGER, previousCount + 1);
    const recordedAt = toText(at) || new Date().toISOString();
    await Promise.all([
      store.writeMetadataValue(id, "agent_context_compaction_count", String(count)),
      store.writeMetadataValue(id, "agent_context_compaction_last_at", recordedAt),
      store.writeMetadataValue(id, "agent_context_compaction_last_key", key)
    ]);
    return {
      at: recordedAt,
      count,
      duplicate: false,
      key
    };
  });
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [options]
 * @param {string} [options.reason]
 * @param {string} [options.threadId]
 * @param {string} [options.turnId]
 */
async function writeCodexAppServerContextRefreshPending(store, sessionId = "", options = {}) {
  const {
    reason = "",
    threadId = "",
    turnId = ""
  } = options;
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return null;
  }
  const at = new Date().toISOString();
  await store.mutateSession(normalizedSessionId, async () => {
    await Promise.all([
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending", "yes"),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_pending_at", at),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_reason", reason),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_thread_id", threadId),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_turn_id", turnId)
    ]);
  });
  return {
    at,
    reason,
    threadId,
    turnId
  };
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} [sessionId]
 * @param {object} [options]
 * @param {string} [options.deliveredAt]
 * @param {string} [options.delivery]
 * @param {string} [options.reason]
 * @param {string} [options.threadId]
 * @param {string} [options.turnId]
 */
async function clearCodexAppServerContextRefreshPending(store, sessionId = "", options = {}) {
  const {
    deliveredAt = new Date().toISOString(),
    delivery = "prompt",
    reason = "",
    threadId = "",
    turnId = ""
  } = options;
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return false;
  }
  await store.mutateSession(normalizedSessionId, async () => {
    await Promise.all([
      store.deleteMetadataValues(normalizedSessionId, CODEX_CONTEXT_REFRESH_PENDING_METADATA),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_at", deliveredAt),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivery", delivery),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_reason", reason),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_thread_id", threadId),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_turn_id", turnId)
    ].filter(Boolean));
  });
  return true;
}

/**
 * The application's context-renewal receipt: a bounded read with a stale-thread fence.
 * Native event interpretation stays in the shared codecs.
 * @param {object} dependencies
 * @param {ProjectService} dependencies.project
 * @param {CodexAppServerRunOwner} dependencies.runOwner
 */
function createCodexContextRefreshMarker({ project, runOwner }) {
  const { readAgentRunForSession: readCodexAppServerAgentRunForSession } = runOwner;

  async function markCodexAppServerContextRefreshPending(sessionId = "", threadId = "", notification = {}, options = {}) {
    const {
      reason = codexAppServerContextRefreshReason(notification)
    } = options;
    const normalizedSessionId = toText(sessionId);
    const normalizedThreadId = toText(threadId);
    if (!reason || !normalizedSessionId || !normalizedThreadId) {
      return null;
    }

    const store = await project.createSessionStore({ sessionId: normalizedSessionId });
    const [
      run,
      briefingDelivered,
      currentThreadId
    ] = await Promise.all([
      readCodexAppServerAgentRunForSession(store, normalizedSessionId),
      store.readMetadataValue(normalizedSessionId, "agent_briefing_delivered"),
      store.readMetadataValue(normalizedSessionId, "agent_identity_conversation_id")
    ]);
    if (toText(briefingDelivered) !== "yes") {
      return null;
    }
    const normalizedCurrentThreadId = toText(currentThreadId);
    if (normalizedCurrentThreadId && normalizedCurrentThreadId !== normalizedThreadId) {
      vibe64SessionDebugLog("server.codexTerminal.appServerContextRefresh.staleThread", {
        currentThreadId: normalizedCurrentThreadId,
        reason,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId
      });
      return null;
    }

    const turn = codexAppServerTurnStateFromAgentRun(run || {}, normalizeVibe64AgentRunState);
    const turnId = toText(codexAppServerNotificationTurnId(notification) || turn.turnId);
    await recordCodexContextRenewalSignal(store, normalizedSessionId, {
      eventId: toText(
        codexAppServerNotificationItemId(notification) ||
        codexAppServerNotificationEvent(notification)?.id
      ),
      reason,
      threadId: normalizedThreadId,
      turnId
    });
    const pending = await writeCodexAppServerContextRefreshPending(store, normalizedSessionId, {
      reason,
      threadId: normalizedThreadId,
      turnId
    });
    vibe64SessionDebugLog("server.codexTerminal.appServerContextRefresh.pending", {
      reason,
      sessionId: normalizedSessionId,
      threadId: normalizedThreadId,
      turnId
    });
    return pending;
  }

  return markCodexAppServerContextRefreshPending;
}

export {
  createCodexContextRefreshMarker,
  clearCodexAppServerContextRefreshPending,
  recordCodexContextUsageSignal
};
