import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_RENEWAL_THRESHOLDS,
  contextUsageSignal,
  sessionContextUsageFromMetadata,
  sessionRenewalAdvisory
} from "../../packages/vibe64-sessions/src/server/sessionRenewalAdvisory.js";

const NOW = new Date("2026-08-24T00:00:00.000Z");

function session({ createdAt = "2026-08-23T00:00:00.000Z", compactions = 0 } = {}) {
  return {
    manifest: { createdAt },
    metadata: {
      agent_context_compaction_count: String(compactions)
    }
  };
}

test("renewal is always available without inventing provider context usage", () => {
  const advisory = sessionRenewalAdvisory({
    conversationTurnCount: 3,
    now: NOW,
    session: session()
  });

  assert.equal(advisory.available, true);
  assert.equal(advisory.recommended, false);
  assert.equal(advisory.severity, "none");
  assert.equal(advisory.signals.contextUsage, null);
  assert.equal(advisory.signals.conversationTurnCount, 3);
});

test("renewal recommends conservative fallbacks from real durable history signals", () => {
  const turns = sessionRenewalAdvisory({
    conversationTurnCount: SESSION_RENEWAL_THRESHOLDS.conversationConsiderTurns,
    now: NOW,
    session: session()
  });
  const compacted = sessionRenewalAdvisory({
    conversationTurnCount: 5,
    now: NOW,
    session: session({ compactions: SESSION_RENEWAL_THRESHOLDS.compactionSoonCount })
  });
  const established = sessionRenewalAdvisory({
    conversationTurnCount: SESSION_RENEWAL_THRESHOLDS.establishedConversationTurns,
    now: NOW,
    session: session({ createdAt: "2026-07-01T00:00:00.000Z" })
  });

  assert.equal(turns.primarySignal, "conversation-turns");
  assert.equal(turns.severity, "consider");
  assert.equal(compacted.primarySignal, "context-compactions");
  assert.equal(compacted.severity, "soon");
  assert.equal(established.primarySignal, "established-history");
  assert.equal(established.recommended, true);
});

test("a high-volume incident warns from compactions even while exact current context looks modest", () => {
  // Aggregate evidence from the approved production inspection: the third
  // compaction arrived after 18 user turns with 81,926 of 258,400 current
  // context tokens. Cumulative spend was enormous, but it is deliberately not
  // used as a context-pressure percentage.
  const advisory = sessionRenewalAdvisory({
    contextUsage: {
      exact: true,
      updatedAt: "2026-08-23T14:52:55.499Z",
      usedTokens: 81_926,
      windowTokens: 258_400
    },
    conversationTurnCount: 18,
    now: new Date("2026-08-23T14:52:55.499Z"),
    session: session({
      compactions: 3,
      createdAt: "2026-08-21T13:40:55.511Z"
    })
  });

  assert.equal(advisory.signals.contextUsage.ratio < 0.75, true);
  assert.equal(advisory.primarySignal, "context-compactions");
  assert.equal(advisory.recommended, true);
  assert.equal(advisory.severity, "soon");
});

test("only protocol-proven exact context usage may drive a percentage advisory", () => {
  assert.equal(contextUsageSignal({ usedTokens: 80, windowTokens: 100 })?.exact, false);
  assert.equal(contextUsageSignal({ usedTokens: 101, windowTokens: 100 }), null);
  const advisory = sessionRenewalAdvisory({
    contextUsage: {
      exact: true,
      updatedAt: "2026-08-24T00:00:00.000Z",
      usedTokens: 91,
      windowTokens: 100
    },
    now: NOW,
    session: session()
  });

  assert.equal(advisory.primarySignal, "provider-context");
  assert.equal(advisory.severity, "soon");
  assert.equal(advisory.signals.contextUsage.ratio, 0.91);
});

test("persisted provider usage is accepted only with its exact provenance", () => {
  assert.equal(sessionContextUsageFromMetadata({
    agent_context_used_tokens: "100",
    agent_context_window_tokens: "1000"
  }, { expectedThreadId: "thread-1" }), null);
  assert.equal(sessionContextUsageFromMetadata({
    agent_context_usage_provider: "codex",
    agent_context_usage_thread_id: "old-thread",
    agent_context_usage_updated_at: "2026-08-24T01:00:00.000Z",
    agent_context_used_tokens: "250000",
    agent_context_window_tokens: "258400"
  }, { expectedThreadId: "new-thread" }), null);
  assert.deepEqual(sessionContextUsageFromMetadata({
    agent_context_usage_provider: "codex",
    agent_context_usage_thread_id: "thread-1",
    agent_context_usage_updated_at: "2026-08-24T01:00:00.000Z",
    agent_context_used_tokens: "16787",
    agent_context_window_tokens: "258400"
  }, { expectedThreadId: "thread-1" }), {
    exact: true,
    providerId: "codex",
    threadId: "thread-1",
    updatedAt: "2026-08-24T01:00:00.000Z",
    usedTokens: 16787,
    windowTokens: 258400
  });
});


test("persisted context usage never converts missing or malformed token counts to an empty context", () => {
  const metadata = { agent_context_usage_provider: "codex", agent_context_usage_thread_id: "thread",
    agent_context_usage_updated_at: NOW, agent_context_used_tokens: "120", agent_context_window_tokens: "258400" };
  for (const value of [undefined, null, "", "120junk", "-1", "1.5", "Infinity"]) {
    assert.equal(sessionContextUsageFromMetadata({ ...metadata, agent_context_used_tokens: value }, { expectedThreadId: "thread" }), null);
    assert.equal(sessionContextUsageFromMetadata({ ...metadata, agent_context_window_tokens: value }, { expectedThreadId: "thread" }), null);
  }
  assert.equal(sessionContextUsageFromMetadata({ ...metadata, agent_context_used_tokens: "0" }, { expectedThreadId: "thread" }).usedTokens, 0);
});
