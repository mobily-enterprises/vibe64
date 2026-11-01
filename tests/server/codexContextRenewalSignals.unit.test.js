import assert from "node:assert/strict";
import test from "node:test";

import {
  recordCodexContextRenewalSignal,
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
    }
  };
}

test("context compaction signals accumulate once per stable provider event", async () => {
  const store = memoryStore();
  const input = {
    at: "2026-08-24T01:00:00.000Z",
    eventId: "item-1",
    reason: "context_compacted",
    threadId: "thread-1",
    turnId: "turn-1"
  };

  const first = await recordCodexContextRenewalSignal(store, "session-1", input);
  const duplicate = await recordCodexContextRenewalSignal(store, "session-1", input);
  const second = await recordCodexContextRenewalSignal(store, "session-1", {
    ...input,
    at: "2026-08-24T02:00:00.000Z",
    eventId: "item-2",
    turnId: "turn-2"
  });

  assert.deepEqual(first, {
    at: input.at,
    count: 1,
    duplicate: false,
    key: "context_compacted:thread-1:turn-1:item-1"
  });
  assert.equal(duplicate.count, 1);
  assert.equal(duplicate.duplicate, true);
  assert.equal(second.count, 2);
  assert.equal(second.duplicate, false);
});

test("non-compaction and unidentifiable signals do not affect renewal evidence", async () => {
  const store = memoryStore();
  assert.equal(await recordCodexContextRenewalSignal(store, "session-1", {
    reason: "context_refresh_required",
    threadId: "thread-1"
  }), null);
  assert.equal(await recordCodexContextRenewalSignal(store, "session-1", {
    reason: "context_compacted"
  }), null);
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
