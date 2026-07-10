import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_COMPOSER_CHANGED_EVENT,
  composerRealtimePayload,
  vibe64ComposerChangedServiceEvent,
  normalizeComposerFields
} from "@local/vibe64-core/server/composerRealtimeEvents";

test("Vibe64 composer service event describes a realtime composer draft change", () => {
  const event = vibe64ComposerChangedServiceEvent();
  const result = {
    draft: {
      baseRevision: 2,
      controlId: "talk_to_codex",
      fieldName: "conversationRequest",
      fields: {
        conversationRequest: "Hello"
      },
      kind: "submission_start",
      originId: "origin-1",
      projectSlug: "beepollen",
      revision: 3,
      sessionId: "2026-06-14_08-07-41",
      text: "Hello",
      updatedAt: "2026-06-16T01:02:03.000Z"
    },
    ok: true
  };

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "composer");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_COMPOSER_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(event.entityId({ result }), "2026-06-14_08-07-41:talk_to_codex");
  assert.deepEqual(event.realtime.payload({ result }), {
    baseRevision: 2,
    controlId: "talk_to_codex",
    fieldName: "conversationRequest",
    fields: {
      conversationRequest: "Hello"
    },
    kind: "submission_start",
    originId: "origin-1",
    projectSlug: "beepollen",
    revision: 3,
    sessionId: "2026-06-14_08-07-41",
    submissionId: "",
    text: "Hello",
    updatedAt: "2026-06-16T01:02:03.000Z"
  });
});

test("Vibe64 composer service event ignores failed draft results", () => {
  const event = vibe64ComposerChangedServiceEvent();

  assert.equal(event.entityId({
    result: {
      error: "Invalid draft.",
      ok: false
    }
  }), null);
  assert.deepEqual(composerRealtimePayload({
    result: {
      error: "Invalid draft.",
      ok: false
    }
  }), {});
});

test("Vibe64 composer field normalization keeps draft values plain", () => {
  assert.deepEqual(normalizeComposerFields({
    "": "ignored",
    count: 12,
    message: "Hello"
  }), {
    count: "12",
    message: "Hello"
  });
});
