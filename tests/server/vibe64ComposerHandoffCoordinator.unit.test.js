import assert from "node:assert/strict";
import test from "node:test";

import {
  createComposerHandoffCoordinator
} from "../../packages/vibe64-sessions/src/server/composer/handoffCoordinator.js";
import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function handoff() {
  return {
    handoffId: "handoff-1",
    kind: "agent_prompt_handoff",
    terminalInput: "Please continue."
  };
}

test("composer handoff coordinator starts delivery out of the request stack and coalesces it", async () => {
  let deliveries = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const coordinator = createComposerHandoffCoordinator({
    async activate() {
      throw new Error("must not activate");
    },
    async deliver() {
      deliveries += 1;
      await gate;
      return { ok: true };
    }
  });
  const input = {
    handoff: handoff(),
    runtime: {},
    session: {
      sessionId: "session-1"
    }
  };

  const first = coordinator.schedule(input);
  const second = coordinator.schedule(input);
  assert.equal(first, second);
  assert.equal(deliveries, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveries, 1);
  release();
  await first;
});

test("composer handoff coordinators share one durable delivery claimant", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      projectLocalRoot: projectRuntimeRoot(targetRoot),
      targetRoot
    });
    const session = await store.createSession({
      sessionId: "shared-coordinator-session"
    });
    const runtime = {
      store
    };
    let deliveries = 0;
    let releaseDelivery = () => null;
    let markDeliveryStarted = () => null;
    const deliveryStarted = new Promise((resolve) => {
      markDeliveryStarted = resolve;
    });
    const deliveryGate = new Promise((resolve) => {
      releaseDelivery = resolve;
    });
    const coordinatorOptions = {
      async activate() {},
      async deliver() {
        deliveries += 1;
        markDeliveryStarted();
        await deliveryGate;
      }
    };
    const firstCoordinator = createComposerHandoffCoordinator(coordinatorOptions);
    const secondCoordinator = createComposerHandoffCoordinator(coordinatorOptions);
    const input = {
      handoff: handoff(),
      runtime,
      session
    };

    const first = firstCoordinator.schedule(input);
    await deliveryStarted;
    const second = secondCoordinator.schedule(input);
    assert.deepEqual(await second, {
      retry: true,
      waitingForExclusiveDelivery: true
    });
    assert.equal(deliveries, 1);
    releaseDelivery();
    await first;
  });
});

test("composer handoff coordinator resumes a persisted accepted handoff", async () => {
  let deliveredHandoff = null;
  let deliveredSettings = null;
  let deliveredVibe64User = null;
  const coordinator = createComposerHandoffCoordinator({
    async activate() {
      throw new Error("must not activate");
    },
    async deliver({ agentSettings, handoff: currentHandoff, vibe64User }) {
      deliveredHandoff = currentHandoff;
      deliveredSettings = agentSettings;
      deliveredVibe64User = vibe64User;
    }
  });
  const persistedHandoff = handoff();
  const session = {
    actionResults: [{
      agentPromptHandoff: persistedHandoff
    }],
    agentRuns: [{
      agentSettings: {
        providerId: "opencode"
      },
      handoffId: persistedHandoff.handoffId,
      id: "provider-run"
    }, {
      agentSettings: {
        providerId: "codex"
      },
      handoffId: persistedHandoff.handoffId,
      handoffState: "accepted",
      id: "composer_handoff",
      provider: "codex",
      state: "starting"
    }],
    metadata: {
      workflow_driver_username: "alice"
    },
    sessionId: "session-1"
  };

  const task = coordinator.resume({
    runtime: {},
    session
  });
  assert.ok(task);
  await task;
  assert.equal(deliveredHandoff.handoffId, persistedHandoff.handoffId);
  assert.equal(deliveredSettings.providerId, "codex");
  assert.deepEqual(deliveredVibe64User, {
    username: "alice"
  });
});

test("composer handoff coordinator activates a delivered handoff without redelivering it", async () => {
  let activated = null;
  const coordinator = createComposerHandoffCoordinator({
    async activate({ state }) {
      activated = state;
    },
    async deliver() {
      throw new Error("must not deliver");
    }
  });
  const task = coordinator.resume({
    runtime: {},
    session: {
      agentRuns: [{
        handoffId: "handoff-1",
        handoffState: "delivered",
        id: "composer_handoff",
        providerThreadId: "thread-1",
        providerTurnId: "turn-1",
        state: "starting"
      }],
      sessionId: "session-1"
    }
  });
  assert.ok(task);
  await task;
  assert.equal(activated.id, "handoff-1");
  assert.equal(activated.threadId, "thread-1");
  assert.equal(activated.turnId, "turn-1");
});

test("composer handoff coordinator never loses a control wake-up while draining", async () => {
  let drains = 0;
  let releaseFirstDrain;
  const firstDrain = new Promise((resolve) => {
    releaseFirstDrain = resolve;
  });
  const coordinator = createComposerHandoffCoordinator({
    async activate() {},
    async deliver() {},
    async drainControls() {
      drains += 1;
      if (drains === 1) {
        await firstDrain;
      }
    }
  });
  const input = {
    runtime: {},
    session: {
      sessionId: "session-1"
    }
  };

  const first = coordinator.drain(input);
  await new Promise((resolve) => setImmediate(resolve));
  const second = coordinator.drain(input);
  assert.equal(first, second);
  releaseFirstDrain();
  await first;
  assert.equal(drains, 2);
});
