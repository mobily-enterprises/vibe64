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
      currentStep: "review_and_validate",
      revision: 7,
      sessionId: "session-with-state",
      stepMachine: {
        status: "attempting_execution"
      },
      stepRevision: 3
    }
  });

  assert.deepEqual(payload, {
    currentStep: "review_and_validate",
    revision: 7,
    sessionId: "session-with-state",
    stepRevision: 3,
    stepStatus: "attempting_execution"
  });
});

test("Vibe64 session service event includes composer menu projection context when available", () => {
  const event = vibe64SessionChangedServiceEvent();
  const payload = event.realtime.payload({
    result: {
      presentation: {
        composerMenu: {
          itemCount: 7,
          signature: "composer-menu-signature"
        }
      },
      sessionId: "session-with-menu"
    }
  });

  assert.deepEqual(payload, {
    composerMenu: {
      itemCount: 7,
      signature: "composer-menu-signature"
    },
    sessionId: "session-with-menu"
  });
});

test("Vibe64 session service event can include a stable reason", () => {
  const event = vibe64SessionChangedServiceEvent({
    reason: "launch-target-started"
  });
  const payload = event.realtime.payload({
    result: {
      sessionId: "session-with-reason"
    }
  });

  assert.deepEqual(payload, {
    reason: "launch-target-started",
    sessionId: "session-with-reason"
  });
});

test("Vibe64 session service event includes list refresh hints from service results", () => {
  const event = vibe64SessionChangedServiceEvent({
    reason: "session-action-run"
  });
  const payload = event.realtime.payload({
    result: {
      clientRefresh: {
        includeList: true
      },
      sessionId: "session-with-refresh"
    }
  });

  assert.deepEqual(payload, {
    clientRefresh: {
      includeList: true
    },
    reason: "session-action-run",
    sessionId: "session-with-refresh"
  });
});

test("Vibe64 session service event includes a client origin when supplied by the service args", () => {
  const event = vibe64SessionChangedServiceEvent({
    reason: "session-action-run"
  });
  const payload = event.realtime.payload({
    args: [
      "session-from-args",
      "action-1",
      {
        originId: "tab-origin-1"
      }
    ],
    result: {
      sessionId: "session-from-result"
    }
  });

  assert.deepEqual(payload, {
    originId: "tab-origin-1",
    reason: "session-action-run",
    sessionId: "session-from-result"
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

test("Vibe64 session change publisher can include a client origin", async () => {
  const events = [];
  const publish = createVibe64SessionChangedPublisher({
    domainEvents: {
      async publish(event) {
        events.push(event);
      }
    },
    methodName: "startLaunchTargetTerminal",
    serviceToken: "feature.vibe64-terminals.service"
  });

  await publish("session-1", {
    originId: "tab-origin-2",
    reason: "launch-target-started"
  });

  assert.deepEqual(events[0].meta.realtime.payload, {
    originId: "tab-origin-2",
    reason: "launch-target-started",
    sessionId: "session-1"
  });
});

test("Vibe64 session change publisher can include an explicit realtime payload", async () => {
  const events = [];
  const publish = createVibe64SessionChangedPublisher({
    domainEvents: {
      async publish(event) {
        events.push(event);
      }
    },
    methodName: "startCodexTerminal",
    serviceToken: "feature.vibe64-terminals.service"
  });

  await publish("session-1", {
    payload: {
      conversationLogPatch: {
        type: "upsert-turn",
        turn: {
          turnId: "000014",
          thinking: [
            {
              role: "thinking",
              text: "Working"
            }
          ]
        }
      }
    },
    reason: "codex-app-server-reasoning-summary"
  });

  assert.deepEqual(events[0].meta.realtime.payload, {
    conversationLogPatch: {
      type: "upsert-turn",
      turn: {
        turnId: "000014",
        thinking: [
          {
            role: "thinking",
            text: "Working"
          }
        ]
      }
    },
    reason: "codex-app-server-reasoning-summary",
    sessionId: "session-1"
  });
});
