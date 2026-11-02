import assert from "node:assert/strict";
import test from "node:test";

import {
  createCodexContextRefreshMarker,
  recordCodexContextUsageSignal
} from "../../packages/vibe64-terminals/src/server/codexContextRenewalSignals.js";
import { codexContextUsageFromNotification } from "@jskit-ai/assistant-core/server/codex-events";

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async mutateSession(_sessionId, operation) {
      return operation();
    },
    async readMetadataValue(_sessionId, name) {
      return values.get(name) || "";
    },
    async writeMetadataValue(_sessionId, name, value) {
      values.set(name, String(value));
    },
    value(name) {
      return values.get(name) || "";
    }
  };
}

/** The marker Codex registration calls when a native event asks for a context refresh. */
function contextRefreshMarker(store) {
  return createCodexContextRefreshMarker({
    project: { createSessionStore: async () => store },
    runOwner: { readAgentRunForSession: async () => null }
  });
}

function compactionItem(itemId, turnId) {
  return { method: "item/completed", params: { item: { id: itemId, type: "contextCompaction" }, turnId } };
}

function compactionEvidence(store) {
  return {
    count: store.value("agent_context_compaction_count"),
    key: store.value("agent_context_compaction_last_key")
  };
}

test("context compaction signals accumulate once per stable provider event", async () => {
  const store = memoryStore({ agent_briefing_delivered: "yes" });
  const markContextRefresh = contextRefreshMarker(store);
  const compacted = { reason: "context_compacted" };

  await markContextRefresh("session-1", "thread-1", compactionItem("item-1", "turn-1"), compacted);
  assert.deepEqual(compactionEvidence(store), { count: "1", key: "context_compacted:thread-1:turn-1:item-1" });
  assert.ok(!Number.isNaN(Date.parse(store.value("agent_context_compaction_last_at"))));
  await markContextRefresh("session-1", "thread-1", compactionItem("item-1", "turn-1"), compacted);
  assert.deepEqual(compactionEvidence(store), { count: "1", key: "context_compacted:thread-1:turn-1:item-1" });
  await markContextRefresh("session-1", "thread-1", compactionItem("item-2", "turn-2"), compacted);
  assert.deepEqual(compactionEvidence(store), { count: "2", key: "context_compacted:thread-1:turn-2:item-2" });
});

test("non-compaction and unidentifiable signals do not affect renewal evidence", async () => {
  const store = memoryStore({ agent_briefing_delivered: "yes" });
  const markContextRefresh = contextRefreshMarker(store);
  await markContextRefresh("session-1", "thread-1", compactionItem("item-1", "turn-1"), { reason: "context_refresh_required" });
  assert.deepEqual(compactionEvidence(store), { count: "", key: "" });
  assert.equal(await markContextRefresh("session-1", "", compactionItem("item-2", "turn-2"), { reason: "context_compacted" }), null);
  assert.deepEqual(compactionEvidence(store), { count: "", key: "" });
});

test("Codex main-thread token usage persists last-turn context pressure, not cumulative spend", async () => {
  const store = memoryStore({ agent_identity_conversation_id: "thread-1" });
  const notification = {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: {
        last: {
          inputTokens: 16805,
          outputTokens: 5,
          totalTokens: 16810
        },
        modelContextWindow: 258400,
        total: {
          inputTokens: 33587,
          outputTokens: 10,
          totalTokens: 33597
        }
      },
      turnId: "turn-2"
    }
  };

  assert.deepEqual(codexContextUsageFromNotification(notification), {
    cumulativeTokens: 33597,
    inputTokens: 16805,
    threadId: "thread-1",
    turnId: "turn-2",
    usedTokens: 16810,
    windowTokens: 258400
  });
  assert.deepEqual(await recordCodexContextUsageSignal(store, "session-1", notification, {
    at: "2026-08-24T02:00:00.000Z",
    expectedThreadId: "thread-1"
  }), {
    at: "2026-08-24T02:00:00.000Z",
    cumulativeTokens: 33597,
    exact: true,
    inputTokens: 16805,
    providerId: "codex",
    threadId: "thread-1",
    turnId: "turn-2",
    usedTokens: 16810,
    windowTokens: 258400
  });
  assert.equal(await recordCodexContextUsageSignal(store, "session-1", notification, {
    expectedThreadId: "other-thread"
  }), null);
});

test("Codex context usage rejects malformed evidence and stale or replayed thread events", async () => {
  const notification = {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread-1",
      tokenUsage: {
        last: { inputTokens: 80, totalTokens: 90 },
        modelContextWindow: 100,
        total: { totalTokens: 120 }
      },
      turnId: "turn-2"
    }
  };
  assert.equal(codexContextUsageFromNotification({
    ...notification,
    params: {
      ...notification.params,
      tokenUsage: {
        ...notification.params.tokenUsage,
        last: { inputTokens: -1, totalTokens: 90 }
      }
    }
  }), null);
  assert.equal(codexContextUsageFromNotification({
    ...notification,
    params: {
      ...notification.params,
      tokenUsage: {
        ...notification.params.tokenUsage,
        modelContextWindow: null
      }
    }
  }), null);

  const store = memoryStore({ agent_identity_conversation_id: "thread-1" });
  assert.ok(await recordCodexContextUsageSignal(store, "session-1", notification, {
    expectedThreadId: "thread-1"
  }));
  const replay = structuredClone(notification);
  replay.params.turnId = "turn-1";
  replay.params.tokenUsage.total.totalTokens = 110;
  assert.equal(await recordCodexContextUsageSignal(store, "session-1", replay, {
    expectedThreadId: "thread-1"
  }), null);

  await store.writeMetadataValue("session-1", "agent_identity_conversation_id", "thread-2");
  notification.params.tokenUsage.total.totalTokens = 130;
  assert.equal(await recordCodexContextUsageSignal(store, "session-1", notification, {
    expectedThreadId: "thread-1"
  }), null);
});
