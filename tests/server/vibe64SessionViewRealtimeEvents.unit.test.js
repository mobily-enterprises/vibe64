import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  sessionViewRealtimePayload,
  vibe64SessionViewChangedServiceEvent
} from "@local/vibe64-core/server/sessionViewRealtimeEvents";

test("Vibe64 session view service event describes a realtime route change", () => {
  const event = vibe64SessionViewChangedServiceEvent();
  const result = {
    ok: true,
    viewState: {
      originId: "tab-1",
      projectPane: "dashboard",
      projectSlug: "beepollen",
      routeFullPath: "/app/project/beepollen/dashboard/diff",
      sessionId: "session-1",
      updatedAt: "2026-07-02T08:00:00.000Z"
    }
  };

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "session_view");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_SESSION_VIEW_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(event.entityId({ result }), "session-1:view");
  assert.deepEqual(event.realtime.payload({ result }), {
    originId: "tab-1",
    projectPane: "dashboard",
    projectSlug: "beepollen",
    routeFullPath: "/app/project/beepollen/dashboard/diff",
    sessionId: "session-1",
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("Vibe64 session view service event ignores invalid view-state results", () => {
  const event = vibe64SessionViewChangedServiceEvent();

  assert.equal(event.entityId({
    result: {
      error: "Invalid view state.",
      ok: false
    }
  }), null);
  assert.deepEqual(sessionViewRealtimePayload({
    result: {
      ok: true,
      viewState: {
        projectSlug: "beepollen",
        routeFullPath: "/app/project/beepollen/dashboard/env",
        sessionId: "session-1"
      }
    }
  }), {});
});
