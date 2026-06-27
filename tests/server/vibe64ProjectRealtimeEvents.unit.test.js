import assert from "node:assert/strict";
import test from "node:test";
import {
  createRealtimeEntityChangePublisher
} from "@jskit-ai/kernel/server/runtime/entityChangeEvents";

import {
  VIBE64_PROJECT_CHANGED_EVENT,
  vibe64ProjectChangedServiceEvent
} from "@local/vibe64-core/server/projectRealtimeEvents";

test("Vibe64 project service event describes a realtime project change", () => {
  const event = vibe64ProjectChangedServiceEvent({
    operation: "selected"
  });
  const entityId = event.entityId({
    args: [{
      slug: "from-input"
    }],
    result: {
      currentProject: {
        projectRoot: "/tmp/beepollen",
        slug: "beepollen"
      },
      hasSelection: true,
      targetRoot: "/tmp/beepollen"
    }
  });
  const payload = event.realtime.payload({
    result: {
      currentProject: {
        projectRoot: "/tmp/beepollen",
        slug: "beepollen"
      },
      hasSelection: true,
      targetRoot: "/tmp/beepollen"
    }
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "project");
  assert.equal(event.operation, "selected");
  assert.equal(event.realtime.event, VIBE64_PROJECT_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(entityId, "beepollen");
  assert.deepEqual(payload, {
    hasSelection: true,
    projectRoot: "/tmp/beepollen",
    projectSlug: "beepollen",
    targetRoot: "/tmp/beepollen"
  });
});

test("Vibe64 project service event falls back to request input for entity ids", () => {
  const event = vibe64ProjectChangedServiceEvent();

  assert.equal(event.entityId({
    args: [{
      name: "new-app"
    }],
    result: {}
  }), "new-app");
});

test("JSKIT realtime entity publisher includes Vibe64 runtime close metadata", async () => {
  const published = [];
  const publishProjectChanged = createRealtimeEntityChangePublisher({
    domainEvents: {
      async publish(event) {
        published.push(event);
        return {
          ok: true
        };
      }
    },
    entity: "project",
    event: VIBE64_PROJECT_CHANGED_EVENT,
    methodName: "projectRuntime",
    serviceToken: "feature.vibe64-terminals.service",
    source: "vibe64"
  });

  await publishProjectChanged("updated", "alpha", {
    action: "runtime-closed",
    payload: {
      message: "Project is closed.",
      projectSlug: "alpha",
      targetRoot: "/tmp/alpha",
      runtime: {
        open: false
      }
    },
    reason: "user-close-project"
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].entityId, "alpha");
  assert.equal(published[0].operation, "updated");
  assert.equal(published[0].scope.kind, "global");
  assert.equal(published[0].meta.action, "runtime-closed");
  assert.equal(published[0].meta.reason, "user-close-project");
  assert.deepEqual(published[0].meta.realtime, {
    event: VIBE64_PROJECT_CHANGED_EVENT,
    payload: {
      message: "Project is closed.",
      projectSlug: "alpha",
      runtime: {
        open: false
      },
      targetRoot: "/tmp/alpha"
    }
  });
});
