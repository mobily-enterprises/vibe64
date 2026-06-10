import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  createVibe64AccountsChangedPublisher,
  vibe64AccountsChangedServiceEvent
} from "@local/vibe64-core/server/accountRealtimeEvents";
import {
  Vibe64AccountsProvider
} from "../../packages/vibe64-accounts/src/server/Vibe64AccountsProvider.js";

test("Vibe64 account service event describes a realtime account change", () => {
  const event = vibe64AccountsChangedServiceEvent();
  const entityId = event.entityId({
    args: [{
      accountId: "github"
    }],
    result: {
      account: {
        connected: true,
        id: "codex"
      },
      id: "auth-session-1",
      status: "connected"
    }
  });
  const payload = event.realtime.payload({
    args: [{
      accountId: "github"
    }],
    result: {
      account: {
        connected: true,
        id: "codex"
      },
      id: "auth-session-1",
      status: "connected"
    }
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "account");
  assert.equal(event.operation, "updated");
  assert.equal(event.realtime.event, VIBE64_ACCOUNTS_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(entityId, "codex");
  assert.deepEqual(payload, {
    accountId: "codex",
    authSessionId: "auth-session-1",
    connected: true,
    status: "connected"
  });
  assert.equal(event.entityId({
    args: [{
      accountId: "github"
    }],
    result: {
      account: {
        connected: false
      }
    }
  }), "github");
});

test("Vibe64 account change publisher emits service-scoped realtime domain events", async () => {
  const events = [];
  const publish = createVibe64AccountsChangedPublisher({
    domainEvents: {
      async publish(event) {
        events.push(event);
        return event;
      }
    },
    methodName: "readAuthSession",
    serviceToken: "feature.vibe64-accounts.service"
  });

  await publish("codex", {
    account: {
      connected: true,
      id: "codex",
      status: "connected"
    },
    authSessionId: "auth-session-1",
    reason: "exit"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].source, "vibe64");
  assert.equal(events[0].entity, "account");
  assert.equal(events[0].operation, "updated");
  assert.equal(events[0].entityId, "codex");
  assert.deepEqual(events[0].meta.service, {
    method: "readAuthSession",
    token: "feature.vibe64-accounts.service"
  });
  assert.deepEqual(events[0].meta.realtime, {
    event: VIBE64_ACCOUNTS_CHANGED_EVENT,
    payload: {
      accountId: "codex",
      authSessionId: "auth-session-1",
      connected: true,
      reason: "exit",
      status: "connected"
    }
  });
});

test("Vibe64 accounts provider publishes realtime changes for auth lifecycle methods", () => {
  const services = [];
  const provider = new Vibe64AccountsProvider();
  provider.register({
    actions() {},
    service(token, factory, metadata) {
      void factory;
      services.push({
        metadata,
        token
      });
    }
  });

  const accountsService = services.find((service) => service.token === "feature.vibe64-accounts.service");
  assert.ok(accountsService);
  assert.deepEqual(
    Object.keys(accountsService.metadata.events).sort(),
    ["logout", "readAuthSession", "startAuth"]
  );
  assert.equal(
    accountsService.metadata.events.readAuthSession[0].realtime.event,
    VIBE64_ACCOUNTS_CHANGED_EVENT
  );
  assert.equal(
    accountsService.metadata.events.logout[0].operation,
    "updated"
  );
});
