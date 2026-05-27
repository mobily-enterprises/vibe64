import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SESSION_CHANGED_EVENT,
  vibe64SessionChangedServiceEvent,
  createVibe64SessionChangedPublisher
} from "@local/vibe64-core/server/sessionRealtimeEvents";

test("Vibe64 session service event describes a realtime session change", () => {
  const event = vibe64SessionChangedServiceEvent();
  const entityId = event.entityId({
    args: ["session-from-args"],
    result: {
      sessionId: "session-from-result"
    }
  });
  const payload = event.realtime.payload({
    args: ["session-from-args"],
    result: {
      sessionId: "session-from-result"
    }
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "session");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_SESSION_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(entityId, "session-from-result");
  assert.deepEqual(payload, {
    sessionId: "session-from-result"
  });
});

test("Vibe64 session service event includes session revision context when available", () => {
  const event = vibe64SessionChangedServiceEvent();
  const payload = event.realtime.payload({
    result: {
      currentStep: "project_validated",
      revision: 7,
      sessionId: "session-with-state",
      stepMachine: {
        status: "attempting_execution"
      },
      stepRevision: 3
    }
  });

  assert.deepEqual(payload, {
    currentStep: "project_validated",
    revision: 7,
    sessionId: "session-with-state",
    stepRevision: 3,
    stepStatus: "attempting_execution"
  });
});

test("Vibe64 session change publisher emits service-scoped domain events", async () => {
  const events = [];
  const publish = createVibe64SessionChangedPublisher({
    domainEvents: {
      async publish(event) {
        events.push(event);
      }
    },
    methodName: "startCommandTerminal",
    serviceToken: "feature.vibe64-terminals.service"
  });

  await publish("session-1", {
    reason: "command-terminal-closed"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].source, "vibe64");
  assert.equal(events[0].entity, "session");
  assert.equal(events[0].entityId, "session-1");
  assert.deepEqual(events[0].meta.service, {
    method: "startCommandTerminal",
    token: "feature.vibe64-terminals.service"
  });
  assert.deepEqual(events[0].meta.realtime, {
    event: VIBE64_SESSION_CHANGED_EVENT,
    payload: {
      reason: "command-terminal-closed",
      sessionId: "session-1"
    }
  });
});
