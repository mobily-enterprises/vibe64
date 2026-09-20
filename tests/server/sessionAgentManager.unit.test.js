import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";

const catalogRevision = `sha256:${"a".repeat(64)}`;

function providerCapabilities(engineId, transportId, {
  connected = true
} = {}) {
  return {
    agents: [{ id: engineId, mode: "primary" }],
    authentication: { modes: [engineId === "codex" ? "oauth" : "api-key"] },
    defaults: {
      agentId: engineId,
      modelId: "model-1",
      modelProviderId: engineId === "codex" ? "openai" : "deepseek",
      variantId: "high"
    },
    engineId,
    health: { status: "ready" },
    label: engineId,
    modelProviders: [{
      connected,
      id: engineId === "codex" ? "openai" : "deepseek",
      models: [{
        id: "model-1",
        variants: [{ id: "high" }]
      }]
    }],
    revision: catalogRevision,
    transportId
  };
}

test("session agent manager gates admission inspection with assistant access", async () => {
  for (const [engineId, transportId] of [
    ["codex", "codex_app_server"], ["opencode", "opencode_server"], ["claude", "claude_stream_json"]
  ]) {
    const calls = [];
    const manager = createSessionAgentManager({
      readAssistantAccess: async () => ({ ownerOnly: true }),
      providers: [{ id: engineId, transportId,
        async inspectMessageAdmission(context, input) {
          calls.push({ context, input });
          return { ok: true, admission: "unknown" };
        }
      }]
    });
    const input = { messageId: "continuation", threadId: "original-thread" };
    const options = { agentSettings: { providerId: engineId }, vibe64User: { role: "user", username: "member" } };
    await assert.rejects(manager.inspectMessageAdmission("session-1", input, options));
    assert.equal(calls.length, 0);
    const result = await manager.inspectMessageAdmission("session-1", input, {
      ...options, vibe64User: { role: "owner", username: "owner" }
    });
    assert.equal(result.admission, "unknown");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, input);
    assert.equal(calls[0].context.vibe64User.role, "owner");
    assert.equal(calls[0].context.sessionId, "session-1");
  }
});

test("session agent manager sends a message through the selected provider", async () => {
  let received = null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async sendMessage(context, input) {
        received = { context, input };
        return {
          delivered: true,
          ok: true
        };
      }
    }]
  });
  const turnOwnership = {
    threadId: "thread-1",
    turnId: "turn-1"
  };

  const result = await manager.sendMessage("session-1", {
    message: "Continue"
  }, {
    agentSettings: {
      providerId: "codex"
    },
    turnOwnership
  });

  assert.equal(received.input.message, "Continue");
  assert.deepEqual(received.context.turnOwnership, turnOwnership);
  assert.equal(result.delivered, true);
  assert.equal(result.providerId, "codex");
  assert.equal(result.transportId, "codex_app_server");
});

test("session agent manager exposes provider-owned renewal primitives with trusted context", async () => {
  const calls = [];
  const runtime = { stateRoot: "/runtime/project" };
  const session = { sessionId: "session-1" };
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async generateSessionRenewalHandover(context, input) {
        calls.push(["generate", context, input]);
        return { ok: true, turnId: "turn-old" };
      },
      async releaseRenewalPredecessorProcessExitProof(context, input) {
        calls.push(["release-proof", context, input]);
        return { ok: true, released: true };
      },
      async releaseRenewalPredecessorAttachments(context, input) {
        calls.push(["release-attachments", context, input]);
        return { ok: true, released: true };
      },
      async releaseRenewalSuccessorProcessExitProof(context, input) {
        calls.push(["release-successor-proof", context, input]);
        return { ok: true, released: true };
      },
      async seedSessionRenewalHandover(context, input) {
        calls.push(["seed", context, input]);
        return { ok: true, turnId: "turn-new" };
      }
    }]
  });
  const options = { runtime, session };

  const generated = await manager.generateSessionRenewalHandover(
    session.sessionId,
    { operationId: "renewal:generate" },
    options
  );
  const seeded = await manager.seedSessionRenewalHandover(
    session.sessionId,
    { operationId: "renewal:seed" },
    options
  );
  const attachmentsReleased = await manager.releaseRenewalPredecessorAttachments(
    session.sessionId,
    { renewalId: "renewal-1" },
    options
  );
  const released = await manager.releaseRenewalPredecessorProcessExitProof(
    session.sessionId,
    { renewalId: "renewal-1" },
    options
  );
  const successorAuthorization = { renewalId: "renewal-1", successorSessionId: session.sessionId };
  const successorReleased = await manager.releaseRenewalSuccessorProcessExitProof(
    session.sessionId,
    {
      authorization: successorAuthorization,
      renewalId: "renewal-1"
    },
    options
  );

  assert.equal(generated.turnId, "turn-old");
  assert.equal(seeded.turnId, "turn-new");
  assert.equal(attachmentsReleased.released, true);
  assert.equal(released.released, true);
  assert.equal(successorReleased.released, true);
  assert.deepEqual(calls.map(([name]) => name), [
    "generate",
    "seed",
    "release-attachments",
    "release-proof",
    "release-successor-proof"
  ]);
  assert.equal(calls[0][1].runtime, runtime);
  assert.equal(calls[0][1].session, session);
  assert.equal(calls[1][1].runtime, runtime);
  assert.equal(calls[1][1].session, session);
  assert.equal(calls[2][1].runtime, runtime);
  assert.equal(calls[2][1].session, session);
  assert.equal(calls[2][2].renewalId, "renewal-1");
  assert.equal(calls[3][1].runtime, runtime);
  assert.equal(calls[3][1].session, session);
  assert.equal(calls[3][2].renewalId, "renewal-1");
  assert.equal(calls[4][1].runtime, runtime);
  assert.equal(calls[4][1].session, session);
  assert.equal(calls[4][2].authorization, successorAuthorization);
  assert.equal(calls[4][2].renewalId, "renewal-1");
  assert.equal(manager.binding(session.sessionId), "");
});

test("session agent manager exposes focused provider conversations", async () => {
  const calls = [];
  const onEvent = () => null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async createConversation(context, input) {
        calls.push(["create", context, input]);
        return {
          conversationId: "conversation-1",
          ok: true
        };
      },
      async startConversationTurn(context, input) {
        calls.push(["start", context, input]);
        return {
          ok: true,
          runId: "run-1"
        };
      },
      async waitForConversationTurn(context, input) {
        calls.push(["wait", context, input]);
        return {
          message: "Done",
          ok: true
        };
      }
    }]
  });
  const options = {
    onEvent
  };

  const created = await manager.createConversation("session-1", {}, options);
  const started = await manager.startConversationTurn("session-1", {
    conversationId: created.conversationId,
    message: "Do the task."
  }, options);
  const result = await manager.waitForConversationTurn("session-1", {
    conversationId: created.conversationId,
    runId: started.runId
  }, options);

  assert.equal(result.message, "Done");
  assert.deepEqual(calls.map(([name]) => name), ["create", "start", "wait"]);
  assert.equal(calls[2][1].onEvent, onEvent);
});

test("session agent manager exposes active Temporary AI conversation state", async () => {
  let receivedContext = null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async hasActiveTemporaryConversation(context) {
        receivedContext = context;
        return {
          active: true,
          ok: true
        };
      }
    }]
  });

  const state = await manager.hasActiveTemporaryConversation("session-1", {}, {
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" }
  });

  assert.equal(state.active, true);
  assert.equal(state.providerId, "codex");
  assert.equal(receivedContext.session.sessionId, "session-1");
});

test("session agent manager rejects unavailable providers", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async sendMessage() {
        throw new Error("Codex must not be called.");
      }
    }]
  });

  await assert.rejects(
    manager.sendMessage("session-1", {
      message: "Hello"
    }, {
      providerId: "opencode"
    }),
    (error) => error?.code === VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
  );
});

test("shared assistant verification authorizes every caller before joining provider work", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const callers = [];
  let checks = 0;
  const manager = createSessionAgentManager({
    async readAssistantAccess(context) {
      callers.push(context.vibe64User.username);
      return { ownerOnly: true };
    },
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async ensureSession() {
        checks += 1;
        entered.resolve();
        await release.promise;
        return { ok: true };
      }
    }]
  });
  const owner = { vibe64User: { role: "owner", username: "owner" } };
  const first = manager.ensureSession("session-1", owner);
  await entered.promise;
  const second = manager.ensureSession("session-1", owner);
  try {
    await assert.rejects(manager.ensureSession("session-1", {
      vibe64User: { role: "user", username: "member" }
    }), { code: "vibe64_assistant_owner_required" });
  } finally {
    release.resolve();
  }
  assert.ok((await Promise.all([first, second])).every((result) => result.ok));
  assert.equal(checks, 1);
  assert.deepEqual(callers, ["owner", "owner", "member"]);
});

test("session agent manager keeps one provider bound to a session", async () => {
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async ensureSession() {
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    providers: [adapter("codex"), adapter("opencode")]
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

test("session agent manager treats durable engine metadata as authoritative", async () => {
  const calls = [];
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async sendMessage(context) {
      calls.push([id, context.assistantSelection]);
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    providers: [adapter("codex"), adapter("opencode")]
  });
  const selection = {
    agentId: "build",
    catalogRevision,
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek",
    schema: "vibe64.assistant-selection.v1",
    variantId: "high"
  };
  const session = {
    metadata: {
      [VIBE64_ASSISTANT_SELECTION_METADATA]: JSON.stringify(selection)
    },
    sessionId: "session-1"
  };

  const result = await manager.sendMessage(session.sessionId, { message: "Hello" }, {
    agentSettings: { providerId: "codex" },
    session
  });

  assert.equal(result.engineId, "opencode");
  assert.deepEqual(calls, [["opencode", selection]]);
  await assert.rejects(
    manager.sendMessage(session.sessionId, { message: "No" }, {
      engineId: "codex",
      session
    }),
    (error) => error.code === SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE
  );
});

test("session agent manager replaces a provisional binding with durable engine metadata", async () => {
  const calls = [];
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async ensureSession() {
      calls.push(id);
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    providers: [adapter("codex"), adapter("opencode")]
  });

  await manager.ensureSession("session-1");
  const session = {
    metadata: {
      [VIBE64_ASSISTANT_SELECTION_METADATA]: JSON.stringify({
        agentId: "build",
        catalogRevision,
        engineId: "opencode",
        modelId: "deepseek-chat",
        modelProviderId: "deepseek",
        schema: "vibe64.assistant-selection.v1",
        variantId: "high"
      })
    },
    sessionId: "session-1"
  };
  const result = await manager.ensureSession(session.sessionId, {
    session
  });

  assert.deepEqual(calls, ["codex", "opencode"]);
  assert.equal(result.engineId, "opencode");
  assert.equal(manager.binding(session.sessionId), "opencode");
});

test("session agent manager resolves live engine capabilities without fallback", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async capabilities() {
        return providerCapabilities("codex", "codex_app_server");
      }
    }, {
      id: "opencode",
      transportId: "opencode_server",
      async capabilities() {
        return providerCapabilities("opencode", "opencode_server");
      }
    }]
  });

  const catalog = await manager.listCapabilities();
  assert.deepEqual(catalog.engines.map((engine) => engine.engineId), ["codex", "opencode"]);
  assert.deepEqual(await manager.resolveSelection({
    engineId: "opencode",
    modelId: "model-1",
    modelProviderId: "deepseek"
  }), {
    agentId: "opencode",
    catalogRevision,
    engineId: "opencode",
    modelId: "model-1",
    modelProviderId: "deepseek",
    schema: "vibe64.assistant-selection.v1",
    variantId: "high"
  });
  await assert.rejects(
    manager.resolveSelection({
      engineId: "opencode",
      modelId: "made-up",
      modelProviderId: "deepseek"
    }),
    (error) => error.code === "vibe64_assistant_selection_unavailable"
  );
});

test("session agent manager reconciles each durable engine separately", async () => {
  const calls = [];
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async reconcileSessions(_context, sessions) {
      calls.push([id, sessions.map((session) => session.sessionId)]);
      return { count: sessions.length, ok: true };
    }
  });
  const selectionMetadata = (engineId) => ({
    [VIBE64_ASSISTANT_SELECTION_METADATA]: JSON.stringify({
      agentId: engineId,
      catalogRevision,
      engineId,
      modelId: "model-1",
      modelProviderId: engineId === "codex" ? "openai" : "deepseek",
      schema: "vibe64.assistant-selection.v1",
      variantId: "high"
    })
  });
  const manager = createSessionAgentManager({
    providers: [adapter("codex"), adapter("opencode")]
  });

  const result = await manager.reconcileSessions([
    { metadata: selectionMetadata("opencode"), sessionId: "open-1" },
    { metadata: selectionMetadata("codex"), sessionId: "codex-1" },
    { metadata: selectionMetadata("opencode"), sessionId: "open-2" }
  ]);

  assert.deepEqual(calls, [
    ["opencode", ["open-1", "open-2"]],
    ["codex", ["codex-1"]]
  ]);
  assert.equal(result.results.length, 2);
});

test("session agent manager describes providers without binding a session", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server"
    }]
  });

  assert.deepEqual(await manager.describeProvider(), {
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(manager.binding("session-1"), "");
});

test("session agent manager binds and delegates authoritative provider descriptions", async () => {
  let received = null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async describeProvider(context) {
        received = context;
        return {
          accountIdentitySignature: `sha256:${"a".repeat(64)}`,
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }, {
      id: "other",
      transportId: "other_transport"
    }]
  });
  const session = { sessionId: "session-1" };
  const description = await manager.describeProvider({
    providerId: "codex",
    runtime: { stateRoot: "/runtime" },
    session
  });

  assert.deepEqual(description, {
    accountIdentitySignature: `sha256:${"a".repeat(64)}`,
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(Object.isFrozen(description), true);
  assert.equal(received.session, session);
  assert.equal(manager.binding("session-1"), "codex");
  await assert.rejects(
    manager.describeProvider({ providerId: "other", session }),
    (error) => error.code === SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE
  );
});

test("session agent manager rejects non-fingerprint account descriptions", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async describeProvider() {
        return {
          accountIdentitySignature: "credential-shaped-account-identity",
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }]
  });

  await assert.rejects(
    manager.describeProvider({ session: { sessionId: "session-1" } }),
    /did not return a stable account identity/u
  );
});

test("session agent manager never resolves a live model profile before economy cleanup", async () => {
  let deletes = 0;
  let resolutions = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async deleteDetachedChatThread(_context, input) {
        deletes += 1;
        assert.deepEqual(input.executionProfile, {
          profileId: "economy",
          workloadId: "source_explanation"
        });
        return { ok: true };
      },
      async resolveExecutionProfile() {
        resolutions += 1;
        throw new Error("Cleanup must not consult the live model catalog.");
      }
    }]
  });

  const result = await manager.deleteDetachedChatThread("session-1", {
    executionProfile: {
      profileId: "economy",
      workloadId: "source_explanation"
    },
    threadId: "thread-1"
  });
  assert.equal(result.ok, true);
  assert.equal(deletes, 1);
  assert.equal(resolutions, 0);
});

test("session agent manager rejects malformed economy cleanup markers before provider work", async () => {
  let deletes = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async deleteDetachedChatThread() {
        deletes += 1;
        throw new Error("Malformed cleanup must not reach the provider.");
      }
    }]
  });

  await assert.rejects(
    manager.deleteDetachedChatThread("session-1", {
      executionProfile: "economy",
      threadId: "thread-1"
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "request"
    )
  );
  assert.equal(deletes, 0);
});

test("session agent manager resolves semantic execution profiles before provider work", async () => {
  const calls = [];
  const abortController = new AbortController();
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(context, request) {
        calls.push(["resolve", context, request]);
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: false,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "codex",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      },
      async runDetachedChatTurn(context, input) {
        calls.push(["run", context, input]);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Done"
        };
      }
    }]
  });

  const result = await manager.runDetachedChatTurn("session-1", {
    executionProfile: {
      profileId: "economy",
      workloadId: "source_explanation"
    },
    prompt: "Explain this source."
  }, {
    signal: abortController.signal
  });

  assert.deepEqual(calls.map(([operation]) => operation), ["resolve", "run"]);
  assert.deepEqual(calls[0][2], {
    profileId: "economy",
    workloadId: "source_explanation"
  });
  assert.equal(calls[0][1].signal, abortController.signal);
  assert.equal(calls[1][1].signal, abortController.signal);
  assert.equal(calls[1][2].executionProfile.model, "provider-owned-model");
  assert.equal(result.executionProfile.revision, "codex-economy-v1");
});

test("session agent manager executes its exact pre-resolved profile without resolving again", async () => {
  let resolutions = 0;
  const detachedProfiles = [];
  const providerResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        resolutions += 1;
        return providerResolution;
      },
      async runDetachedChatTurn(_context, input) {
        detachedProfiles.push(input.executionProfile);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Done"
        };
      },
      async streamDetachedChatTurn(_context, input) {
        detachedProfiles.push(input.executionProfile);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Streamed"
        };
      }
    }]
  });

  const resolved = await manager.resolveExecutionProfile("session-1", {
    profileId: "economy",
    workloadId: "source_explanation"
  });
  const result = await manager.runDetachedChatTurn("session-1", {
    executionProfile: resolved,
    prompt: "Explain this source."
  });
  const streamed = await manager.streamDetachedChatTurn("session-1", {
    executionProfile: resolved,
    prompt: "Explain this source again."
  });

  assert.equal(resolutions, 1);
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(detachedProfiles, [providerResolution, providerResolution]);
  assert.deepEqual(result.executionProfile, providerResolution);
  assert.deepEqual(streamed.executionProfile, providerResolution);
});

test("session agent manager rejects copied, forged, and cross-session pre-resolved profiles", async () => {
  let detachedTurns = 0;
  const providerResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        return providerResolution;
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        return { ok: true };
      }
    }]
  });
  const resolved = await manager.resolveExecutionProfile("session-1", {
    profileId: "economy",
    workloadId: "source_explanation"
  });

  for (const [sessionId, executionProfile] of [
    ["session-1", providerResolution],
    ["session-1", { ...resolved }],
    ["session-2", resolved]
  ]) {
    await assert.rejects(
      manager.runDetachedChatTurn(sessionId, {
        executionProfile,
        prompt: "Explain this source."
      }),
      (error) => (
        error.code === "vibe64_agent_execution_profile_invalid" &&
        error.field === "executionProfile"
      )
    );
  }
  await manager.closeSession("session-1");
  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: resolved,
      prompt: "Do not reuse a profile from a closed session binding."
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "executionProfile"
    )
  );
  assert.equal(detachedTurns, 0);
});

test("session agent manager forwards an exact renewal cleanup context only when explicitly supplied", async () => {
  const closeContexts = [];
  const manager = createSessionAgentManager({
    providers: [{
      async closeSession(context) {
        closeContexts.push(context);
        return { closed: true, ok: true };
      },
      id: "codex",
      transportId: "codex_app_server"
    }]
  });
  const runtime = { id: "runtime" };
  const session = {
    metadata: {
      renewal_id: "renewal-1",
      renewed_from: "source-session"
    },
    sessionId: "renewal-successor",
    status: "renewal_pending"
  };
  const renewalCleanup = {
    renewalId: "renewal-1",
    sourceSessionId: "source-session"
  };

  await manager.closeSession("ordinary-session");
  await manager.closeSession(session.sessionId, {
    preserveProcessExitProof: true,
    renewalCleanup,
    runtime,
    session
  });

  assert.equal(closeContexts[0].runtime, null);
  assert.equal(closeContexts[0].session, null);
  assert.equal(closeContexts[0].renewalCleanup, null);
  assert.equal(closeContexts[0].preserveProcessExitProof, false);
  assert.equal(closeContexts[1].runtime, runtime);
  assert.equal(closeContexts[1].session, session);
  assert.equal(closeContexts[1].renewalCleanup, renewalCleanup);
  assert.equal(closeContexts[1].preserveProcessExitProof, true);
});

test("session agent manager rejects malformed provider resolutions before provider work", async () => {
  let detachedTurns = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(_context, request) {
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: true,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "codex",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        throw new Error("Malformed provider resolutions must not reach detached work.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_unsafe" &&
      error.field === "policy.networkAccess"
    )
  );
  assert.equal(detachedTurns, 0);
});

test("session agent manager rejects provider resolution identity mismatches before detached work", async () => {
  const validResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };

  for (const mismatch of [
    {
      field: "profileId",
      value: "interactive",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_unknown" &&
          error.profileId === "interactive";
      }
    },
    {
      field: "providerId",
      value: "other",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_invalid" &&
          error.field === "resolution.providerId" &&
          error.expected === "codex" &&
          error.actual === "other";
      }
    },
    {
      field: "workloadId",
      value: "prompt_hint",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_invalid" &&
          error.field === "resolution.workloadId" &&
          error.expected === "source_explanation" &&
          error.actual === "prompt_hint";
      }
    }
  ]) {
    let detachedTurns = 0;
    const manager = createSessionAgentManager({
      providers: [{
        id: "codex",
        transportId: "codex_app_server",
        async resolveExecutionProfile() {
          return {
            ...validResolution,
            [mismatch.field]: mismatch.value
          };
        },
        async runDetachedChatTurn() {
          detachedTurns += 1;
          throw new Error("Mismatched provider resolutions must not reach detached work.");
        }
      }]
    });

    await assert.rejects(
      manager.runDetachedChatTurn("session-1", {
        executionProfile: {
          profileId: "economy",
          workloadId: "source_explanation"
        },
        prompt: "Explain this source."
      }),
      mismatch.verify
    );
    assert.equal(detachedTurns, 0);
  }
});

test("session agent manager validates direct provider resolution identity before attribution", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(requestContext, request) {
        assert.equal(requestContext.providerId, "codex");
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: false,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "other",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      }
    }]
  });

  await assert.rejects(
    manager.resolveExecutionProfile("session-1", {
      profileId: "economy",
      workloadId: "source_explanation"
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "resolution.providerId" &&
      error.expected === "codex" &&
      error.actual === "other"
    )
  );
});

test("session agent manager rejects consumer-owned execution details before provider resolution", async () => {
  let providerCalls = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        providerCalls += 1;
        throw new Error("Malformed semantic requests must not reach the provider.");
      },
      async runDetachedChatTurn() {
        providerCalls += 1;
        throw new Error("Detached work must not start.");
      }
    }]
  });

  await assert.rejects(manager.runDetachedChatTurn("session-1", {
    executionProfile: {
      model: "consumer-must-not-control-this",
      profileId: "economy",
      workloadId: "source_explanation"
    },
    prompt: "Explain this source."
  }), (error) => (
    error.code === "vibe64_agent_execution_profile_invalid" &&
    error.field === "request.model"
  ));
  assert.equal(providerCalls, 0);
});

test("session agent manager fails closed when a provider cannot resolve a requested profile", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async runDetachedChatTurn() {
        throw new Error("Detached work must not start.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    /does not implement resolveExecutionProfile/u
  );
});

test("session agent manager surfaces required Codex authentication before economy work starts", async () => {
  let detachedTurns = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        const error = new Error(
          "Codex could not activate the selected account for isolated economy work. Reconnect Codex and retry."
        );
        error.code = "vibe64_codex_economy_auth_unavailable";
        throw error;
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        throw new Error("Unauthenticated economy work must not start.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    (error) => (
      error.code === "vibe64_codex_economy_auth_unavailable" &&
      /Reconnect Codex and retry/u.test(error.message)
    )
  );
  assert.equal(detachedTurns, 0);
});

test("session agent manager gates AI work with only the current connection's ownerOnly flag", async () => {
  async function run({ ownerOnly, role }) {
    let descriptions = 0;
    let sends = 0;
    const manager = createSessionAgentManager({
      readAssistantAccess: async () => ({ ownerOnly }),
      providers: [{
        id: "codex",
        transportId: "codex_app_server",
        async describeProvider() {
          descriptions += 1;
          return {};
        },
        async sendMessage() {
          sends += 1;
          return { delivered: true, ok: true };
        }
      }]
    });
    const options = { vibe64User: { role, username: role } };
    return {
      access: await manager.assistantAccess("session-1", options),
      descriptions: () => descriptions,
      manager,
      options,
      sends: () => sends
    };
  }

  for (const example of [
    { allowed: true, ownerOnly: false, role: "owner" },
    { allowed: true, ownerOnly: false, role: "user" },
    { allowed: true, ownerOnly: true, role: "owner" },
    { allowed: false, ownerOnly: true, role: "user" }
  ]) {
    const harness = await run(example);
    assert.equal(harness.access.canUse, example.allowed);
    assert.equal(
      harness.access.canRequestMessage,
      example.ownerOnly && example.role !== "owner"
    );
    if (example.allowed) {
      await harness.manager.sendMessage("session-1", { message: "Hello" }, harness.options);
      assert.equal(harness.sends(), 1);
    } else {
      await assert.rejects(
        harness.manager.describeProvider({
          ...harness.options,
          session: { sessionId: "session-1" }
        }),
        (error) => error.code === "vibe64_assistant_owner_required"
      );
      await assert.rejects(
        harness.manager.sendMessage("session-1", { message: "Hello" }, harness.options),
        (error) => error.code === "vibe64_assistant_owner_required"
      );
      assert.equal(harness.descriptions(), 0);
      assert.equal(harness.sends(), 0);
    }
  }
});

test("session agent manager leaves non-AI reads and cleanup available on personal connections", async () => {
  const calls = [];
  const manager = createSessionAgentManager({
    readAssistantAccess: async () => ({ ownerOnly: true }),
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async closeSession() {
        calls.push("close");
        return { closed: true, ok: true };
      },
      async readConversation() {
        calls.push("read");
        return { messages: [], ok: true };
      }
    }]
  });
  const options = { vibe64User: { role: "user", username: "member" } };

  await manager.readConversation("session-1", {}, options);
  await manager.closeSession("session-1", options);

  assert.deepEqual(calls, ["read", "close"]);
});

test("session agent manager treats input to an authorized terminal as bound transport", async () => {
  const accessReads = [];
  const terminalWrites = [];
  const session = {
    metadata: {
      [VIBE64_ASSISTANT_SELECTION_METADATA]: JSON.stringify({
        agentId: "build",
        catalogRevision,
        engineId: "opencode",
        modelId: "model-1",
        modelProviderId: "deepseek",
        schema: "vibe64.assistant-selection.v1",
        variantId: "high"
      })
    },
    sessionId: "session-1"
  };
  const manager = createSessionAgentManager({
    readAssistantAccess: async (context) => {
      accessReads.push(context);
      return { available: true, ownerOnly: false };
    },
    providers: [{
      id: "codex",
      transportId: "codex_app_server"
    }, {
      id: "opencode",
      transportId: "opencode_server",
      async startTerminal() {
        return { id: "terminal-1", ok: true, status: "running" };
      },
      async writeTerminal(context, input) {
        terminalWrites.push({ context, input });
        return { ok: true, written: true };
      }
    }]
  });

  await manager.startTerminal(session.sessionId, {}, {
    session,
    vibe64User: { role: "owner", username: "owner" }
  });
  const result = await manager.writeTerminal(
    session.sessionId,
    "terminal-1",
    "\u0003"
  );

  assert.equal(accessReads.length, 1);
  assert.equal(accessReads[0].modelProviderId, "deepseek");
  assert.equal(manager.binding(session.sessionId), "opencode");
  assert.equal(terminalWrites.length, 1);
  assert.equal(terminalWrites[0].context.providerId, "opencode");
  assert.equal(terminalWrites[0].context.assistantAccess, null);
  assert.equal(terminalWrites[0].input.data, "\u0003");
  assert.equal(result.providerId, "opencode");
});

test("plan allowance is private to authorized native plan users", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    for (const ownerOnly of [true, false]) {
      for (const role of ["owner", "user"]) {
        let reads = 0;
        const manager = createSessionAgentManager({
          readAssistantAccess: async () => ({ ownerOnly }),
          providers: [{ id: engineId, transportId: engineId === "codex" ? "codex_app_server" : engineId === "claude" ? "claude_stream_json" : "opencode_server",
            readPlanUsage: engineId === "opencode" ? undefined : async () => { reads += 1; return { status: "available", windows: [] }; }
          }]
        });
        const result = await manager.readPlanUsage("session-1", {
          agentSettings: { providerId: engineId }, vibe64User: { role }
        });
        const allowed = engineId !== "opencode" && ownerOnly && role === "owner";
        assert.equal(reads, allowed ? 1 : 0);
        assert.equal(result.status, allowed ? "available" : "unsupported");
      }
    }
  }
});

test("goal status and controls require the selected assistant account's assistant access", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    for (const role of ["owner", "user"]) {
      let reads = 0;
      let writes = 0;
      const manager = createSessionAgentManager({
        readAssistantAccess: async () => ({ ownerOnly: true }),
        providers: [{ id: engineId, transportId: engineId === "codex" ? "codex_app_server" : engineId === "claude" ? "claude_stream_json" : "opencode_server",
          readGoal: engineId === "opencode" ? undefined : async () => { reads += 1; return { status: "available", goal: null }; },
          updateGoal: engineId === "opencode" ? undefined : async () => { writes += 1; return { ok: true }; }
        }]
      });
      const options = { agentSettings: { providerId: engineId }, vibe64User: { role } };
      const allowed = engineId !== "opencode" && role === "owner";
      await manager.readGoal("session-1", options);
      if (allowed) await manager.updateGoal("session-1", { action: "pause" }, options);
      else await assert.rejects(manager.updateGoal("session-1", { action: "pause" }, options));
      assert.equal(reads, allowed ? 1 : 0);
      assert.equal(writes, allowed ? 1 : 0);
    }
  }
});
