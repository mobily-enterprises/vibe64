import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_TURN_OUTCOME,
  codexTurnOutcomeNoticeMessage,
  codexTurnOutcomeNoticeMessageId,
  writeCodexTurnOutcomeNotice
} from "../../packages/vibe64-terminals/src/server/codexTurnOutcomeNotice.js";

test("Codex turn outcome notices distinguish terminal outcomes", () => {
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.USER_CANCELLED),
    /^You stopped Codex/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.SERVICE_RESTART),
    /Vibe64 restart/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.PROVIDER_FAILURE),
    /provider failed/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE),
    /could not recover its final response/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(
      CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
      "You've hit your usage limit. Try again tomorrow."
    ),
    /^Codex could not finish: You've hit your usage limit\. Try again tomorrow\. Saved file changes remain\.$/u
  );
  assert.equal(
    codexTurnOutcomeNoticeMessage(
      CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
      "You've hit your usage limit. Try again tomorrow.",
      { usageLimitExceeded: true }
    ),
    "Codex could not finish: You've hit your usage limit. Try again tomorrow. Saved file changes remain. " +
      "[View Codex usage & billing](https://chatgpt.com/codex/settings/usage)"
  );
});

test("Codex turn outcome notice ids are stable per provider thread and turn", () => {
  const first = codexTurnOutcomeNoticeMessageId("thread-1", "turn-1");
  assert.equal(first, codexTurnOutcomeNoticeMessageId("thread-1", "turn-1"));
  assert.notEqual(first, codexTurnOutcomeNoticeMessageId("thread-1", "turn-2"));
  assert.notEqual(first, codexTurnOutcomeNoticeMessageId("thread-2", "turn-1"));
  assert.equal(codexTurnOutcomeNoticeMessageId("", "turn-1"), "");
});

test("Codex turn outcome notices publish only newly persisted entries", async () => {
  const writes = [];
  const published = [];
  const storedTurn = {
    system: {
      text: "Codex was interrupted."
    },
    turnId: "000002"
  };
  const store = {
    async writeConversationSystemMessage(sessionId, message) {
      writes.push({ message, sessionId });
      return writes.length === 1 ? storedTurn : null;
    }
  };
  const input = {
    detail: "Provider quota exhausted.",
    outcome: CODEX_TURN_OUTCOME.SERVICE_RESTART,
    publishSessionChanged: async (...args) => published.push(args),
    sessionId: "session-1",
    store,
    threadId: "thread-1",
    turnId: "turn-1",
    usageLimitExceeded: true
  };

  const first = await writeCodexTurnOutcomeNotice(input);
  const duplicate = await writeCodexTurnOutcomeNotice(input);

  assert.equal(first.written, true);
  assert.equal(duplicate.reason, "already_written");
  assert.equal(writes[0].message.messageId, writes[1].message.messageId);
  assert.match(writes[0].message.text, /Vibe64 restart/u);
  assert.match(writes[0].message.text, /Provider quota exhausted/u);
  assert.match(writes[0].message.text, /chatgpt\.com\/codex\/settings\/usage/u);
  assert.deepEqual(published, [["session-1", {
    payload: {
      conversationLogPatch: {
        turn: storedTurn,
        type: "upsert-turn"
      }
    },
    reason: "codex-turn-outcome"
  }]]);
});

test("known control recovery and unknown interruptions never claim a provider failure", () => {
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.CONTROL_RECONFIGURATION), /while Vibe64 restored its controls/u);
  assert.equal(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.INTERRUPTED),
    "Codex was interrupted before it finished. Saved file changes remain; send a message to continue.");
  for (const outcome of ["", "unknown-native-cause"]) {
    assert.equal(codexTurnOutcomeNoticeMessage(outcome),
      "Codex could not finish. Saved file changes remain; send a message to continue.");
    assert.doesNotMatch(codexTurnOutcomeNoticeMessage(outcome), /was interrupted/u);
  }
  for (const outcome of ["", "unknown-native-cause", CODEX_TURN_OUTCOME.INTERRUPTED, CODEX_TURN_OUTCOME.CONTROL_RECONFIGURATION]) {
    assert.doesNotMatch(codexTurnOutcomeNoticeMessage(outcome), /provider failed|You stopped|Vibe64 restart/u);
  }
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.CONTROL_RECONFIGURATION, "Managed controls changed."),
    /restored its controls.*Details: Managed controls changed\./u);
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.PROVIDER_FAILURE), /provider failed/u);
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.USER_CANCELLED), /^You stopped/u);
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.SERVICE_RESTART), /Vibe64 restart/u);
  assert.match(codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE), /could not recover its final response/u);
});
