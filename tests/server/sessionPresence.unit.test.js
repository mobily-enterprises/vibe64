import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_PRESENCE_IDLE_MS,
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  assertPresenceInput,
  createSessionPresencePublisher,
  createSessionPresenceService,
  presenceActor
} from "../../packages/vibe64-sessions/src/server/sessionPresence.js";

function presenceInput(overrides = {}) {
  return {
    actorId: "merc",
    displayName: "Tony",
    originId: "tab-1",
    projectSlug: "beepollen",
    sequence: 1,
    sessionId: "session-1",
    typing: true,
    ...overrides
  };
}

function fakeClock(initialNow = Date.parse("2026-08-25T01:00:00.000Z")) {
  let current = initialNow;
  let nextId = 1;
  const timers = new Map();
  return {
    clearTimer(timer) {
      timers.delete(timer?.id);
    },
    now: () => current,
    pending: () => timers.size,
    setTimer(callback, delay) {
      const timer = {
        dueAt: current + delay,
        id: nextId,
        unref() {}
      };
      nextId += 1;
      timers.set(timer.id, { callback, timer });
      return timer;
    },
    async advance(milliseconds) {
      current += milliseconds;
      for (;;) {
        const ready = [...timers.values()]
          .filter(({ timer }) => timer.dueAt <= current)
          .sort((left, right) => left.timer.dueAt - right.timer.dueAt);
        if (!ready.length) {
          break;
        }
        for (const entry of ready) {
          if (timers.delete(entry.timer.id)) {
            entry.callback();
          }
        }
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  };
}

test("session presence derives the trusted actor and never needs a draft", () => {
  assert.deepEqual(presenceActor({
    preferredName: "  Tony  ",
    username: "merc"
  }), {
    actorId: "merc",
    displayName: "Tony"
  });
  assert.deepEqual(presenceActor({ username: "member" }), {
    actorId: "member",
    displayName: "Another user"
  });
  assert.equal(presenceActor(null), null);
  assert.deepEqual(Object.keys(assertPresenceInput(presenceInput())).sort(), [
    "actorId",
    "displayName",
    "originId",
    "projectSlug",
    "sequence",
    "sessionId",
    "typing"
  ]);
});

test("session presence validates origin and monotonic sequence", () => {
  assert.throws(() => assertPresenceInput(presenceInput({ originId: "" })), {
    code: "vibe64_session_presence_origin_invalid"
  });
  assert.throws(() => assertPresenceInput(presenceInput({ originId: "../tab" })), {
    code: "vibe64_session_presence_origin_invalid"
  });
  assert.throws(() => assertPresenceInput(presenceInput({ sequence: 0 })), {
    code: "vibe64_session_presence_sequence_invalid"
  });
});

test("session presence uses the authenticated-user audience without draft content", async () => {
  const events = [];
  const publish = createSessionPresencePublisher({
    async publish(event) {
      events.push(event);
      return event;
    }
  });
  await publish({
    ...presenceInput(),
    expiresAt: "2026-08-25T01:00:03.000Z",
    updatedAt: "2026-08-25T01:00:00.000Z"
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, VIBE64_SESSION_PRESENCE_CHANGED_EVENT);
  assert.equal(events[0].realtime.audience, "all_users");
  assert.equal(events[0].realtime.event, VIBE64_SESSION_PRESENCE_CHANGED_EVENT);
  assert.deepEqual(events[0].realtime.payload, {
    ...presenceInput(),
    expiresAt: "2026-08-25T01:00:03.000Z",
    updatedAt: "2026-08-25T01:00:00.000Z"
  });
  assert.equal(JSON.stringify(events[0]).includes("draft"), false);
});

test("heartbeats replace local expiry and stale updates cannot rewind presence", async () => {
  const clock = fakeClock();
  const published = [];
  const service = createSessionPresenceService({
    clearTimer: clock.clearTimer,
    now: clock.now,
    publishPresence: async (payload) => published.push(payload),
    setTimer: clock.setTimer
  });

  assert.equal((await service.update(presenceInput())).status, "typing");
  assert.equal(clock.pending(), 1);
  await clock.advance(1_000);
  assert.equal((await service.update(presenceInput({ sequence: 2 }))).status, "typing");
  assert.equal(clock.pending(), 1);
  assert.equal((await service.update(presenceInput({ sequence: 1 }))).status, "stale");
  assert.equal(published.length, 2);

  await clock.advance(SESSION_PRESENCE_IDLE_MS - 1);
  assert.equal(published.length, 2);
  await clock.advance(1);
  assert.equal(published.length, 3);
  assert.equal(published.at(-1).typing, false);
  assert.equal(published.at(-1).sequence, 2);
  assert.equal(service.size(), 0);
});

test("explicit idle retains a short sequence tombstone and origins remain independent", async () => {
  const clock = fakeClock();
  const published = [];
  const service = createSessionPresenceService({
    clearTimer: clock.clearTimer,
    now: clock.now,
    publishPresence: async (payload) => published.push(payload),
    setTimer: clock.setTimer
  });

  await service.update(presenceInput());
  await service.update(presenceInput({ originId: "tab-2" }));
  assert.equal(service.size(), 2);
  assert.equal((await service.update(presenceInput({
    sequence: 2,
    typing: false
  }))).status, "idle");
  assert.equal(service.size(), 2);
  assert.equal(published.at(-1).originId, "tab-1");
  assert.equal(published.at(-1).typing, false);
  assert.equal((await service.update(presenceInput({ sequence: 1 }))).status, "stale");
  assert.equal(published.at(-1).typing, false);
  assert.equal((await service.update(presenceInput({ sequence: 3 }))).status, "typing");
  assert.equal(published.at(-1).typing, true);
  await clock.advance(SESSION_PRESENCE_IDLE_MS);
  assert.equal(published.at(-1).typing, false);
  service.close();
  assert.equal(service.size(), 0);
  assert.equal(clock.pending(), 0);
});

test("presence storage is bounded and publication failure stays ephemeral", async () => {
  const clock = fakeClock();
  const errors = [];
  const published = [];
  const service = createSessionPresenceService({
    clearTimer: clock.clearTimer,
    maxEntries: 1,
    now: clock.now,
    onPublishError: (error) => errors.push(error.message),
    publishPresence: async (payload) => {
      published.push(payload);
      if (payload.originId === "tab-2" && payload.typing) {
        throw new Error("socket unavailable");
      }
    },
    setTimer: clock.setTimer
  });

  await service.update(presenceInput());
  await service.update(presenceInput({ originId: "tab-2" }));
  assert.equal(service.size(), 1);
  assert.deepEqual(errors, ["socket unavailable"]);
  assert.deepEqual(published.map(({ originId, typing }) => ({ originId, typing })), [
    { originId: "tab-1", typing: true },
    { originId: "tab-1", typing: false },
    { originId: "tab-2", typing: true }
  ]);
  service.close();
});

test("temporary chats have independent presence sequences and expiry within the same browser tab", async () => {
  const clock = fakeClock();
  const published = [];
  const service = createSessionPresenceService({
    clearTimer: clock.clearTimer,
    now: clock.now,
    publishPresence: async (payload) => published.push(payload),
    setTimer: clock.setTimer
  });
  try {
    for (const conversationId of ["", "temporary-one", "temporary-two"]) {
      assert.equal((await service.update(presenceInput({ conversationId }))).status, "typing");
    }
    assert.equal(service.size(), 3);
    await service.update(presenceInput({ conversationId: "temporary-one", sequence: 2, typing: false }));
    assert.equal(published.at(-1).conversationId, "temporary-one");
    assert.equal(published.at(-1).typing, false);
    assert.equal((await service.update(presenceInput({ conversationId: "temporary-one" }))).status, "stale");
    await clock.advance(SESSION_PRESENCE_IDLE_MS);
    assert.deepEqual(published.slice(-2).map(({ conversationId = "", typing }) => ({ conversationId, typing })), [
      { conversationId: "", typing: false },
      { conversationId: "temporary-two", typing: false }
    ]);
    assert.throws(() => assertPresenceInput(presenceInput({ conversationId: "../other-session" })), {
      code: "vibe64_session_presence_conversation_invalid"
    });
  } finally {
    service.close();
  }
});
