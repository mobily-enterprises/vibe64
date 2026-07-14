import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_MESSAGE_AGENT_RUN_ID,
  COMPOSER_MESSAGE_SETTLEMENTS,
  acceptComposerMessage,
  cancelComposerMessage,
  composerMessageBatch,
  composerMessageRequests,
  pendingComposerMessages,
  settleComposerMessage
} from "../../packages/vibe64-sessions/src/server/composer/messageState.js";

function testRuntime() {
  const session = {
    agentRuns: [],
    sessionId: "composer-message-test"
  };
  return {
    async getSession() {
      return session;
    },
    session,
    store: {
      async writeAgentRunEvent(_sessionId, runId, {
        event = {},
        patch = {}
      } = {}) {
        const previous = session.agentRuns.find((run) => run.id === runId) || {
          events: [],
          id: runId
        };
        const terminal = ["completed", "failed", "interrupted"].includes(patch.state);
        const next = {
          ...previous,
          ...patch,
          active: !terminal,
          events: [
            ...previous.events,
            {
              ...event,
              at: event.at || patch.updatedAt || new Date().toISOString()
            }
          ],
          id: runId
        };
        session.agentRuns = session.agentRuns.filter((run) => run.id !== runId).concat(next);
        return next;
      }
    }
  };
}

test("composer messages are durable without becoming active agent work", async () => {
  const runtime = testRuntime();
  const accepted = await acceptComposerMessage(runtime, runtime.session.sessionId, {
    afterSubmissionId: "initial-message",
    composerSubmissionId: "follow-up-message",
    displayFields: {
      conversationRequest: "Actually a girl"
    },
    fields: {
      conversationRequest: "Actually a girl"
    },
    message: "Actually a girl"
  });

  assert.equal(accepted.messageId, "follow-up-message");
  assert.equal(accepted.state, "accepted");
  assert.deepEqual(
    pendingComposerMessages(runtime.session).map((message) => message.messageId),
    ["follow-up-message"]
  );
  const run = runtime.session.agentRuns.find((candidate) => candidate.id === COMPOSER_MESSAGE_AGENT_RUN_ID);
  assert.equal(run.active, false);
  assert.equal(run.state, "completed");
});

test("composer message batches preserve each durable message while combining provider input", async () => {
  const runtime = testRuntime();
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-1",
    displayFields: {
      conversationRequest: "First visible message"
    },
    fields: {
      conversationRequest: "First provider message"
    },
    message: "First provider message"
  });
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-2",
    displayFields: {
      conversationRequest: "Second visible message"
    },
    fields: {
      conversationRequest: "Second provider message"
    },
    message: "Second provider message"
  });

  const batch = composerMessageBatch(pendingComposerMessages(runtime.session));
  assert.deepEqual(batch.messageIds, ["message-1", "message-2"]);
  assert.equal(batch.message, "First provider message\n\nSecond provider message");
  assert.equal(
    batch.displayFields.conversationRequest,
    "First visible message\n\nSecond visible message"
  );
});

test("composer message batches never combine messages owned by different users", async () => {
  const runtime = testRuntime();
  for (const [messageId, message, username] of [
    ["alice-1", "First from Alice", "alice"],
    ["bob-1", "Then from Bob", "bob"],
    ["alice-2", "Alice again", "alice"]
  ]) {
    await acceptComposerMessage(runtime, runtime.session.sessionId, {
      composerSubmissionId: messageId,
      message,
      vibe64User: {
        username
      }
    });
  }

  const batch = composerMessageBatch(pendingComposerMessages(runtime.session));
  assert.deepEqual(batch.messageIds, ["alice-1"]);
  assert.equal(batch.message, "First from Alice");
  assert.equal(batch.vibe64User.username, "alice");
});

test("composer messages retain the authenticated identity needed by background readiness", async () => {
  const runtime = testRuntime();
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-with-identity",
    message: "Continue",
    vibe64User: {
      displayName: "Alice",
      github: {
        avatarUrl: "https://example.test/alice.png",
        connectedAt: "2026-07-11T05:00:00.000Z",
        id: 42,
        login: "alice-github"
      },
      home: "/home/alice",
      role: "owner",
      username: "alice"
    }
  });

  const [message] = pendingComposerMessages(runtime.session);
  assert.deepEqual(message.vibe64User, {
    github: {
      avatarUrl: "https://example.test/alice.png",
      connectedAt: "2026-07-11T05:00:00.000Z",
      id: 42,
      login: "alice-github"
    },
    home: "/home/alice",
    username: "alice"
  });
  assert.equal("role" in message.vibe64User, false);
});

test("composer message retries preserve identity and choose delivery again", async () => {
  const runtime = testRuntime();
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-1",
    message: "Continue"
  });
  await settleComposerMessage(runtime, runtime.session.sessionId, "message-1", {
    error: "Provider unavailable",
    operationOutcome: "provider_unavailable",
    outcome: COMPOSER_MESSAGE_SETTLEMENTS.FAILED
  });

  let message = composerMessageRequests(runtime.session)[0];
  assert.equal(message.state, "failed");
  assert.equal(message.attempts, 1);

  message = await acceptComposerMessage(runtime, runtime.session.sessionId, {
    agentSettings: {
      providerId: "future-provider"
    },
    composerSubmissionId: "message-1",
    message: "Continue",
    originId: "browser-after-reload"
  });
  assert.equal(message.state, "accepted");
  assert.equal(message.error, "");
  assert.equal(message.agentSettings.providerId, "future-provider");
  assert.equal(message.attempts, 0);
  assert.equal(message.lastAttemptAt, "");
  assert.equal(message.originId, "browser-after-reload");

  await settleComposerMessage(runtime, runtime.session.sessionId, "message-1", {
    operationOutcome: "started_new_turn",
    outcome: COMPOSER_MESSAGE_SETTLEMENTS.DELIVERED,
    threadId: "thread-1",
    turnId: "turn-2"
  });
  message = composerMessageRequests(runtime.session)[0];
  assert.equal(message.state, "delivered");
  assert.equal(message.operationOutcome, "started_new_turn");
  assert.equal(message.attempts, 1);
  assert.equal(message.threadId, "thread-1");
  assert.equal(message.turnId, "turn-2");
});

test("composer message deferral remains pending for automatic retry", async () => {
  const runtime = testRuntime();
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-waiting",
    message: "Send this when ready"
  });
  await settleComposerMessage(runtime, runtime.session.sessionId, "message-waiting", {
    error: "Current provider turn cannot accept messages yet.",
    operationOutcome: "active_turn_not_ready",
    outcome: COMPOSER_MESSAGE_SETTLEMENTS.DEFERRED,
    threadId: "thread-1",
    turnId: "turn-1"
  });

  const message = pendingComposerMessages(runtime.session)[0];
  assert.equal(message.messageId, "message-waiting");
  assert.equal(message.retryable, true);
  assert.equal(message.attempts, 1);
});

test("failed composer messages can be durably cancelled but never retried afterwards", async () => {
  const runtime = testRuntime();
  await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-cancelled",
    message: "Do not send this"
  });
  await settleComposerMessage(runtime, runtime.session.sessionId, "message-cancelled", {
    error: "Provider unavailable",
    operationOutcome: "provider_unavailable",
    outcome: COMPOSER_MESSAGE_SETTLEMENTS.FAILED
  });

  const cancelled = await cancelComposerMessage(
    runtime,
    runtime.session.sessionId,
    "message-cancelled",
    {
      originId: "browser-1",
      vibe64User: {
        username: "alice"
      }
    }
  );
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.operationOutcome, "cancelled_by_user");
  assert.match(cancelled.cancelledAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(pendingComposerMessages(runtime.session), []);

  const eventCount = runtime.session.agentRuns[0].events.length;
  const cancelledAgain = await cancelComposerMessage(
    runtime,
    runtime.session.sessionId,
    "message-cancelled"
  );
  assert.equal(cancelledAgain.state, "cancelled");
  assert.equal(runtime.session.agentRuns[0].events.length, eventCount);

  const resend = await acceptComposerMessage(runtime, runtime.session.sessionId, {
    composerSubmissionId: "message-cancelled",
    message: "Do not send this"
  });
  assert.equal(resend.state, "cancelled");
  assert.deepEqual(pendingComposerMessages(runtime.session), []);
});
