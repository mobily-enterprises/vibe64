import {
  codexContextUsageFromNotification, codexAppServerContextRefreshReason,
  codexAppServerNotificationEvent, codexAppServerNotificationItemId, codexAppServerNotificationTurnId
} from "@jskit-ai/assistant-core/server/codex-events";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { normalizeVibe64AgentRunState } from "@local/vibe64-runtime/server/sessionStore";
import { vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

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

function contextCompactionKey({
  eventId = "",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const fields = [reason, threadId, turnId, eventId].map(normalizeText);
  return fields.slice(1).some(Boolean) ? fields.join(":") : "";
}

async function recordCodexContextUsageSignal(store, sessionId = "", notification = {}, {
  at = new Date().toISOString(),
  expectedThreadId = ""
} = {}) {
  const id = normalizeText(sessionId);
  const usage = codexContextUsageFromNotification(notification);
  const threadId = normalizeText(expectedThreadId);
  if (
    !id ||
    !usage ||
    !threadId ||
    usage.threadId !== threadId ||
    typeof store?.mutateSession !== "function"
  ) {
    return null;
  }
  const recordedAt = normalizeText(at) || new Date().toISOString();
  return store.mutateSession(id, async () => {
    const currentThreadId = normalizeText(
      await store.readMetadataValue(id, "agent_identity_conversation_id")
    );
    const previousThreadId = normalizeText(
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

async function recordCodexContextRenewalSignal(store, sessionId = "", {
  at = new Date().toISOString(),
  eventId = "",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const id = normalizeText(sessionId);
  const normalizedReason = normalizeText(reason);
  if (
    !id ||
    normalizedReason !== CONTEXT_COMPACTION_REASON ||
    typeof store?.mutateSession !== "function"
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
    const previousKey = normalizeText(
      await store.readMetadataValue(id, "agent_context_compaction_last_key")
    );
    const previousCount = nonNegativeInteger(
      await store.readMetadataValue(id, "agent_context_compaction_count")
    );
    if (previousKey === key) {
      return {
        at: normalizeText(await store.readMetadataValue(id, "agent_context_compaction_last_at")),
        count: previousCount,
        duplicate: true,
        key
      };
    }
    const count = Math.min(Number.MAX_SAFE_INTEGER, previousCount + 1);
    const recordedAt = normalizeText(at) || new Date().toISOString();
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

async function writeCodexAppServerContextRefreshPending(store, sessionId = "", {
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || typeof store?.writeMetadataValue !== "function") {
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

async function clearCodexAppServerContextRefreshPending(store, sessionId = "", {
  deliveredAt = new Date().toISOString(),
  delivery = "prompt",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId || !store) {
    return false;
  }
  await store.mutateSession(normalizedSessionId, async () => {
    await Promise.all([
      ...(typeof store.deleteMetadataValues === "function"
        ? [store.deleteMetadataValues(normalizedSessionId, CODEX_CONTEXT_REFRESH_PENDING_METADATA)]
        : CODEX_CONTEXT_REFRESH_PENDING_METADATA.map((name) => store.deleteMetadataValue?.(normalizedSessionId, name))),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_at", deliveredAt),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivery", delivery),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_reason", reason),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_thread_id", threadId),
      store.writeMetadataValue(normalizedSessionId, "codex_context_refresh_delivered_turn_id", turnId)
    ].filter(Boolean));
  });
  return true;
}

// This application receipt keeps the original bounded read and stale-thread fence.
// Native event interpretation remains in the existing shared codecs.
function createCodexContextRefreshMarker({ projectService, runOwner }) {
  const { readAgentRunForSession: readCodexAppServerAgentRunForSession } = runOwner;
  function normalizeText(value) {
    return String(value || "").trim();
  }

  async function markCodexAppServerContextRefreshPending(sessionId = "", threadId = "", notification = {}, {
    reason = codexAppServerContextRefreshReason(notification)
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    if (!reason || !normalizedSessionId || !normalizedThreadId) {
      return null;
    }

    const store = await projectService.createSessionStore({ sessionId: normalizedSessionId });
    const [
      run,
      briefingDelivered,
      currentThreadId
    ] = await Promise.all([
      readCodexAppServerAgentRunForSession(store, normalizedSessionId),
      store.readMetadataValue(normalizedSessionId, "agent_briefing_delivered"),
      store.readMetadataValue(normalizedSessionId, "agent_identity_conversation_id")
    ]);
    if (normalizeText(briefingDelivered) !== "yes") {
      return null;
    }
    const normalizedCurrentThreadId = normalizeText(currentThreadId);
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
    const turnId = normalizeText(codexAppServerNotificationTurnId(notification) || turn.turnId);
    await recordCodexContextRenewalSignal(store, normalizedSessionId, {
      eventId: normalizeText(
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
  writeCodexAppServerContextRefreshPending,
  CONTEXT_COMPACTION_REASON,
  codexContextUsageFromNotification,
  contextCompactionKey,
  recordCodexContextRenewalSignal,
  recordCodexContextUsageSignal
};
