import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import {
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve
  };
}

test("session agent manager routes the canonical API through the selected product provider", async () => {
  const calls = [];
  const prepareHandoff = async (handoff) => handoff;
  const manager = createSessionAgentManager({
    adapters: [{
      id: "codex",
      transportId: "codex_app_server",
      async deliverPrompt(context, handoff) {
        calls.push({ context, handoff });
        return {
          ok: true,
          thread: { id: "thread-1" },
          turn: { id: "turn-1" }
        };
      }
    }]
  });

  const result = await manager.deliverPrompt("session-1", {
    handoffId: "handoff-1",
    terminalInput: "Test"
  }, {
    agentSettings: {
      providerId: "codex"
    },
    prepareHandoff
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.providerId, "codex");
  assert.equal(calls[0].context.prepareHandoff, prepareHandoff);
  assert.equal(calls[0].context.transportId, "codex_app_server");
  assert.equal(result.providerId, "codex");
  assert.equal(result.transportId, "codex_app_server");
  assert.equal(result.thread.id, "thread-1");
});

test("session agent manager coalesces duplicate handoff deliveries", async () => {
  const gate = deferred();
  let deliveryCount = 0;
  const manager = createSessionAgentManager({
    adapters: [{
      id: "codex",
      transportId: "codex_app_server",
      async deliverPrompt() {
        deliveryCount += 1;
        await gate.promise;
        return { ok: true };
      }
    }]
  });
  const handoff = {
    handoffId: "same-handoff"
  };

  const first = manager.deliverPrompt("session-1", handoff);
  const second = manager.deliverPrompt("session-1", handoff);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deliveryCount, 1);
  gate.resolve();
  assert.deepEqual(await first, await second);
});

test("session agent manager rejects unimplemented providers before Codex is called", async () => {
  let codexCalls = 0;
  const manager = createSessionAgentManager({
    adapters: [{
      id: "codex",
      transportId: "codex_app_server",
      async deliverPrompt() {
        codexCalls += 1;
        return { ok: true };
      }
    }]
  });

  await assert.rejects(
    manager.deliverPrompt("session-1", {
      handoffId: "handoff-opencode"
    }, {
      agentSettings: {
        providerId: "opencode"
      }
    }),
    (error) => error?.code === VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
  );
  assert.equal(codexCalls, 0);
});

test("session agent manager selects detached-chat providers from canonical input settings", async () => {
  let codexCalls = 0;
  const manager = createSessionAgentManager({
    adapters: [{
      id: "codex",
      transportId: "codex_app_server",
      async runDetachedChatTurn() {
        codexCalls += 1;
        return { ok: true };
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      agentSettings: {
        providerId: "claude"
      },
      prompt: "Explain this."
    }),
    (error) => error?.code === VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
  );
  assert.equal(codexCalls, 0);
});

test("session agent manager prevents one session from changing providers implicitly", async () => {
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async ensureSession() {
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    adapters: [adapter("codex"), adapter("opencode")]
  });

  await manager.ensureSession("session-1", {
    providerId: "codex"
  });
  await assert.rejects(
    manager.ensureSession("session-1", {
      providerId: "opencode"
    }),
    (error) => error?.code === SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE
  );
});

test("session agent manager reuses the bound provider when later operations omit settings", async () => {
  const calls = [];
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async ensureSession() {
      calls.push(`${id}:ensure`);
      return { ok: true };
    },
    async sessionState() {
      calls.push(`${id}:state`);
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    adapters: [adapter("codex"), adapter("opencode")]
  });

  await manager.ensureSession("session-1", {
    providerId: "opencode"
  });
  const state = await manager.sessionState("session-1");

  assert.equal(state.providerId, "opencode");
  assert.deepEqual(calls, ["opencode:ensure", "opencode:state"]);
});

test("session agent manager describes providers without binding a session", () => {
  const manager = createSessionAgentManager({
    adapters: [{
      id: "codex",
      transportId: "codex_app_server"
    }]
  });

  assert.deepEqual(manager.describeProvider({
    providerId: "codex"
  }), {
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(manager.binding("session-1"), "");
});
