import assert from "node:assert/strict";
import test from "node:test";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";

const catalogRevision = `sha256:${"a".repeat(64)}`;

test("native replacement blocks terminal and goal bypass while permitting ordinary chat admission after preparation", async () => {
  const calls = [];
  const manager = createSessionAgentManager({ providers: [{ id: "codex", transportId: "codex_app_server",
    async sendMessage() { calls.push("send"); return { ok: true }; },
    async startTerminal() { calls.push("terminal"); return { ok: true }; },
    async updateGoal() { calls.push("goal"); return { ok: true }; }
  }] });
  const options = { session: { metadata: { assistant_changeover: JSON.stringify({ replacement: { status: "preparing" } }) } } };
  await assert.rejects(manager.sendMessage("one", {}, options), { code: "vibe64_conversation_replacement_pending" });
  options.session.metadata.assistant_changeover = JSON.stringify({ replacement: { status: "ready" } });
  await assert.rejects(manager.startTerminal("one", {}, options), { code: "vibe64_conversation_replacement_briefing_pending" });
  await assert.rejects(manager.updateGoal("one", { action: "resume" }, options), { code: "vibe64_conversation_replacement_briefing_pending" });
  await manager.sendMessage("one", {}, options);
  assert.deepEqual(calls, ["send"]);
});

function routingManagerFixture({ resolveAssistantUser, disconnected = [] } = {}) {
  const selection = (engineId, modelProviderId, modelId) => ({ schema: "vibe64.assistant-selection.v1",
    engineId, agentId: engineId, modelProviderId, modelId, variantId: "", catalogRevision });
  const senior = selection("codex", "openai", "gpt-6-astra");
  const junior = selection("codex", "deepseek", "deepseek-flash");
  const backup = selection("opencode", "opencode", "big-pickle");
  const intern = selection("opencode", "deepseek", "deepseek-v4-flash");
  const configuration = { schemaVersion: 3, revision: 7, orchestrators: { codex: {
    senior, junior, sharedBackup: backup, intern, router: junior
  } } };
  const facts = new Map([senior, junior, backup, intern].map((value) => [value.modelId, {
    available: true, ownerOnly: value === senior, connectionIdentity: `connection:${value.modelId}`
  }]));
  const calls = [];
  const manager = createSessionAgentManager({
    resolveAssistantUser,
    readRoutingConfiguration: async () => configuration,
    readAssistantAccess: async (context) => {
      calls.push({ type: "access", ...context });
      return facts.get(context.assistantSelection.modelId);
    },
    providers: ["codex", "opencode"].map((id) => ({ id, transportId: `${id}_server`,
      async capabilities(context, input) {
        calls.push({ type: "catalog", context, input });
        const choices = [senior, junior, backup, intern].filter((value) => value.engineId === id &&
          (!input.modelProviderId || input.modelProviderId === value.modelProviderId) &&
          (!input.modelId || input.modelId === value.modelId));
        return { engineId: id, transportId: `${id}_server`, revision: catalogRevision,
          agents: [{ id, mode: "primary" }],
          modelProviders: [...new Set(choices.map((value) => value.modelProviderId))].map((providerId) => ({
            id: providerId, connected: !disconnected.includes(id), models: choices.filter((value) => value.modelProviderId === providerId)
              .map((value) => ({ id: value.modelId, status: "available", variants: [], capabilities: { toolcall: true } }))
          })) };
      }
    }))
  });
  const session = { sessionId: "main", metadata: { assistant_selection: JSON.stringify(senior) } };
  const options = { session, vibe64User: { role: "user", username: "member" } };
  return { manager, configuration, facts, calls, options, senior, junior, backup, intern };
}

test("routing configuration omits unconnected orchestrators and preserves saved disconnected workflows", async () => {
  const disconnected = ["codex"];
  const f = routingManagerFixture({ disconnected });
  const saved = await f.manager.inspectRoutingConfiguration(f.configuration, f.options);
  assert.deepEqual(saved.engines.map(({ engineId }) => engineId).sort(), ["codex", "opencode"]);
  assert.equal(saved.engines.find(({ engineId }) => engineId === "codex").connected, false);
  assert.equal(saved.engines.find(({ engineId }) => engineId === "opencode").connected, true);
  assert.ok(saved.engines.find(({ engineId }) => engineId === "codex").roles.senior.error);
  f.configuration.orchestrators.codex = {};
  const connected = await f.manager.inspectRoutingConfiguration(f.configuration, f.options);
  assert.deepEqual(connected.engines.map(({ engineId }) => engineId), ["opencode"]);
  assert.ok(connected.engines[0].roles.intern.choices.length, "cross-orchestrator helper choices do not create extra workflows");
  disconnected.push("opencode");
  assert.deepEqual((await f.manager.inspectRoutingConfiguration(f.configuration, f.options)).engines, []);
});

test("purpose resolution uses the current user role instead of its saved role", async () => {
  const current = { username: "changed-user", role: "member" };
  const f = routingManagerFixture({ resolveAssistantUser: async (actor) => {
    assert.equal(actor.username, current.username);
    return current;
  } });
  const decision = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "codex" }, {
    ...f.options, vibe64User: { username: current.username, role: "owner" }
  });
  assert.equal(decision.available, true);
  assert.equal(decision.seniorJuniorPair.senior.effectiveSelection.modelId, "big-pickle");
  assert.equal(decision.seniorJuniorPair.junior.effectiveSelection.modelId, "big-pickle");
  assert.equal(f.calls.filter(({ type }) => type === "access").every(({ vibe64User }) => vibe64User.role === "member"), true);
});

test("native AI admission refreshes the actor and revocation leaves Stop available", async () => {
  let current = { username: "member", role: "member", home: "/current-home" };
  const calls = [];
  const manager = createSessionAgentManager({
    resolveAssistantUser: async (actor) => {
      if (!actor?.username || !current) throw Object.assign(new Error("Actor is no longer available."), { code: "actor_unavailable" });
      return current;
    },
    readAssistantAccess: async () => ({ available: true, ownerOnly: false }),
    providers: [{ id: "codex", transportId: "codex_app_server",
      async sendMessage(context) { calls.push(context.vibe64User); return { ok: true }; },
      async stopConversation() { calls.push("stop"); return { ok: true }; }
    }]
  });
  const options = { vibe64User: { username: "member", role: "owner", home: "/stale-home" } };
  await manager.sendMessage("one", { message: "Code" }, options);
  assert.deepEqual(calls, [current]);
  const access = await manager.assistantAccess("one", options);
  assert.equal(Object.hasOwn(access, "vibe64User"), false);
  current = null;
  await assert.rejects(manager.sendMessage("one", { message: "More" }, options), { code: "actor_unavailable" });
  await manager.stopConversation("one", { conversationId: "native" }, options);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], "stop");
  await runWithProjectRequestContext({ vibe64User: { username: "owner", role: "owner" } }, async () => {
    await assert.rejects(manager.sendMessage("one", { message: "Missing actor" }, { vibe64User: null }), { code: "actor_unavailable" });
  });
  assert.equal(calls.length, 2);
});

test("routing configuration preview shares admission decisions and exposes no connection identities", async () => {
  const f = routingManagerFixture();
  const view = await f.manager.inspectRoutingConfiguration(f.configuration, {
    vibe64User: { role: "owner" }, includeCollaboratorPreview: true
  });
  const workflow = view.engines.find(({ engineId }) => engineId === "codex");
  assert.equal(workflow.preview.owner.senior.effectiveSelection.modelId, "gpt-6-astra");
  assert.equal(workflow.preview.collaborator.senior.effectiveSelection.modelId, "big-pickle");
  assert.equal(workflow.preview.collaborator.junior.effectiveSelection.modelId, "big-pickle");
  assert.equal(workflow.preview.collaborator.junior.backupReason, "keep_workflow_together");
  assert.equal(workflow.preview.collaborator.review.effectiveSelection.modelId, "big-pickle");
  assert.equal(workflow.preview.collaborator.auto.available, true);
  assert.equal(workflow.roles.senior.choices.every(({ engineId }) => engineId === "codex"), true);
  assert.equal(workflow.roles.router.choices.some(({ engineId }) => engineId === "opencode"), true);
  assert.equal(workflow.roles.sharedBackup.choices.some(({ ownerOnly }) => ownerOnly), false);
  assert.doesNotMatch(JSON.stringify(view), /connectionIdentity|connection:big-pickle/);
  const member = await f.manager.inspectRoutingConfiguration(f.configuration, f.options);
  const memberView = member.engines.find(({ engineId }) => engineId === "codex").preview;
  assert.equal(memberView.owner, undefined);
  assert.equal(memberView.collaborator, undefined);
  assert.equal(memberView.viewer.senior.effectiveSelection.modelId, "big-pickle");
  assert.equal(f.manager.binding("main"), "");
});

test("workflow choices read saved pairs without model discovery and preserve collaborator backup decisions", async () => {
  const f = routingManagerFixture();
  f.configuration.orchestrators.opencode = { senior: f.backup, junior: f.intern };
  for (const [actor, model, backupUsed] of [
    [{ role: "owner" }, "Codex · gpt-6-astra", false],
    [f.options.vibe64User, "OpenCode · big-pickle", true]
  ]) {
    const result = await f.manager.inspectRoutingConfiguration(f.configuration, { vibe64User: actor, workflowsOnly: true });
    const choice = result.workflows.find(({ engineId }) => engineId === "codex");
    assert.equal(choice.available, true, choice.error);
    assert.equal(choice.seniorLabel, model);
    assert.equal(choice.backupUsed, backupUsed);
    if (backupUsed) assert.equal(choice.juniorLabel, model);
    assert.doesNotMatch(JSON.stringify(result), /connectionIdentity|connection:/);
  }
  assert.equal(f.calls.some(({ type }) => type === "catalog"), false);
  assert.equal(f.calls.some(({ assistantSelection }) => assistantSelection?.modelId === f.intern.modelId), true);
  assert.equal(f.manager.binding("main"), "");
  f.facts.get(f.backup.modelId).available = false;
  const disconnected = await f.manager.inspectRoutingConfiguration(f.configuration, { ...f.options, workflowsOnly: true });
  assert.equal(disconnected.workflows[0].available, false);
  assert.match(disconnected.workflows[0].error, /unavailable/);
  f.configuration.orchestrators.codex.senior = null;
  const disabled = await f.manager.inspectRoutingConfiguration(f.configuration, { ...f.options, workflowsOnly: true });
  assert.equal(disabled.workflows[0].available, false);
  assert.equal(disabled.workflows[0].seniorLabel, "Not configured");
  assert.equal(f.calls.some(({ type }) => type === "catalog"), false, "explicitly disabled roles do not initiate discovery");
});

test("workflow choices offer first-use connections without live discovery or saved changes", async () => {
  const f = routingManagerFixture();
  f.configuration.orchestrators = {};
  const before = structuredClone(f.configuration);
  const result = await f.manager.inspectRoutingConfiguration(f.configuration, { ...f.options, workflowsOnly: true });
  assert.deepEqual(f.configuration, before);
  assert.equal(result.workflows.length, 2);
  for (const choice of result.workflows) {
    assert.equal(choice.available, true, choice.error);
    assert.equal(choice.seniorLabel, "Recommended on creation");
    assert.equal(choice.juniorLabel, "Recommended on creation");
  }
  assert.ok(f.calls.filter(({ type }) => type === "catalog").every(({ input }) => input.configuredOnly === "true"));
  assert.equal(f.calls.filter(({ type }) => type === "catalog").length, 2);
});

test("the lightweight workflow preview cannot bypass model validation at dispatch", async () => {
  const f = routingManagerFixture();
  f.configuration.orchestrators.opencode = { senior: f.backup, junior: f.intern };
  f.configuration.orchestrators.codex.junior = { ...f.junior, modelId: "removed-model" };
  f.facts.set("removed-model", { ...f.facts.get(f.junior.modelId) });
  const options = { vibe64User: { role: "owner" }, workflowsOnly: true };
  const preview = await f.manager.inspectRoutingConfiguration(f.configuration, options);
  assert.equal(preview.workflows[0].available, true, "the picker checks connections, not live model availability");
  const admitted = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "codex", validateModels: false }, options);
  assert.equal(admitted.available, false, "request input and preview options cannot disable dispatch validation");
  assert.match(admitted.message, /available/);
});

test("routing preview loads every connected OpenCode model page and refuses mixed catalogue revisions", async () => {
  const calls = [];
  let changed = false;
  const manager = createSessionAgentManager({ readAssistantAccess: async () => ({ available: true, ownerOnly: false, connectionIdentity: "shared-connection" }),
    providers: [{ id: "opencode", transportId: "opencode_server", async capabilities(_context, input) {
      calls.push(input);
      const providerId = input.modelProviderId || "opencode";
      const models = input.modelProviderId ? [{ id: input.cursor ? "later-model" : "first-model", status: "available", variants: [] }] : [];
      return { engineId: "opencode", transportId: "opencode_server", revision: input.cursor && changed ? `sha256:${"b".repeat(64)}` : catalogRevision,
        agents: [{ id: "build", mode: "primary" }], modelProviders: input.modelProviderId
          ? [{ id: providerId, connected: true, models }]
          : ["opencode", "deepseek"].map((id) => ({ id, connected: true, models: [] })),
        page: { hasMore: Boolean(input.modelProviderId && !input.cursor), nextCursor: input.modelProviderId && !input.cursor ? "second" : "" } };
    } }] });
  const configuration = { schemaVersion: 3, revision: 1, orchestrators: {} };
  const view = await manager.inspectRoutingConfiguration(configuration);
  const choices = view.engines[0].roles.junior.choices;
  assert.equal(choices.length, 4);
  assert.deepEqual(choices.filter(({ modelId }) => modelId === "later-model").map(({ modelProviderId }) => modelProviderId), ["opencode", "deepseek"]);
  assert.equal(calls.length, 5);
  changed = true;
  const invalid = await manager.inspectRoutingConfiguration(configuration);
  assert.equal(invalid.engines[0].engineId, "opencode", "a new connection's catalogue failure remains visible before it has routing settings");
  assert.match(invalid.engines[0].error, /catalogue changed/);
  assert.deepEqual(invalid.engines[0].roles.junior.choices, []);
});

test("purpose resolution uses the effective pair before authorizing the last personal selection", async () => {
  const f = routingManagerFixture();
  for (const reviewEnabled of [false, true]) {
    const result = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "codex", reviewEnabled }, f.options);
    assert.equal(result.available, true, result.message);
    assert.equal(result.settingsRevision, 7);
    assert.equal(result.seniorJuniorPair.senior.effectiveSelection.engineId, "opencode");
    assert.equal(result.seniorJuniorPair.junior.effectiveSelection.engineId, "opencode");
    assert.equal(result.seniorJuniorPair.junior.backupReason, "keep_workflow_together");
    assert.equal(result.connectionIdentity, "connection:big-pickle");
  }
  assert.equal(f.manager.binding("main"), "", "preview never binds the main conversation");
  const access = await f.manager.requireAssistantAccessForSelection(f.backup, f.options);
  assert.equal(access.engineId, "opencode");
  assert.equal(access.connectionIdentity, "connection:big-pickle");
  await assert.rejects(f.manager.requireAssistantAccessForSelection(f.senior, f.options), { code: "vibe64_assistant_owner_required" });
});

test("captured member and preview actors do not inherit an ambient owner's access", async () => {
  const f = routingManagerFixture();
  await runWithProjectRequestContext({ vibe64User: { role: "owner" } }, async () => {
    const result = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "codex", actor: { role: "owner" } }, f.options);
    assert.equal(result.backupUsed, true);
    assert.ok(f.calls.filter(({ type }) => type === "access").every(({ vibe64User }) => vibe64User.username === "member"));
    assert.ok(f.calls.filter(({ type }) => type === "catalog").every(({ context }) => context.vibe64User.username === "member"));
    await assert.rejects(f.manager.requireAssistantAccessForSelection(f.senior, f.options), { code: "vibe64_assistant_owner_required" });
  });
  const owner = await f.manager.resolveAssistantPurpose({ purpose: "senior", workflowEngineId: "codex" }, {
    ...f.options, vibe64User: { role: "owner" }
  });
  assert.equal(owner.effectiveSelection.modelId, "gpt-6-astra");
  await runWithProjectRequestContext({ vibe64User: f.options.vibe64User }, async () => {
    const member = await f.manager.resolveAssistantPurpose({ purpose: "senior", workflowEngineId: "codex", actor: { role: "owner" } }, {
      session: f.options.session, vibe64User: null
    });
    assert.equal(member.effectiveSelection.modelId, "big-pickle", "empty optional user does not erase authenticated context");
  });
});

test("purpose resolution merges exact OpenCode models without consulting its first catalogue page", async () => {
  const f = routingManagerFixture();
  f.configuration.orchestrators.opencode = { senior: f.backup, junior: f.intern };
  const result = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "opencode" }, f.options);
  assert.equal(result.available, true, result.message);
  assert.equal(result.seniorJuniorPair.senior.effectiveSelection.modelId, "big-pickle");
  assert.equal(result.seniorJuniorPair.junior.effectiveSelection.modelId, "deepseek-v4-flash");
  assert.deepEqual(f.calls.filter(({ type }) => type === "catalog").map(({ input }) => input.modelId), ["big-pickle", "deepseek-v4-flash"]);
});

test("independent Router and Intern resolve exact destinations without reading unrelated roles", async () => {
  const f = routingManagerFixture();
  const helper = await f.manager.resolveAssistantPurpose({ purpose: "prompt_hint", workflowEngineId: "codex" }, f.options);
  assert.equal(helper.available, true, helper.message);
  assert.equal(helper.effectiveSelection.modelId, f.intern.modelId);
  assert.deepEqual(helper.executionProfileRequest, { profileId: "economy", workloadId: "prompt_hint" });
  assert.deepEqual(f.calls.filter(({ type }) => type === "catalog").map(({ input }) => input), [{
    modelProviderId: "deepseek", modelId: "deepseek-v4-flash", limit: "1"
  }]);
  assert.deepEqual(f.calls.filter(({ type }) => type === "access").map(({ assistantSelection }) => assistantSelection.modelId), [f.intern.modelId]);
  f.calls.length = 0;
  const router = await f.manager.resolveAssistantPurpose({ purpose: "request_routing", workflowEngineId: "codex" }, f.options);
  assert.equal(router.effectiveSelection.modelId, f.junior.modelId);
  assert.deepEqual(f.calls.filter(({ type }) => type === "access").map(({ assistantSelection }) => assistantSelection.modelId), [f.junior.modelId]);
  assert.equal(f.manager.binding("main"), "");
});

test("runtime resolution uses Auto fallback and preserves unsaved preview and non-failover semantics", async () => {
  const f = routingManagerFixture();
  const input = { purpose: "auto", workflowEngineId: "codex" };
  const automatic = await f.manager.resolveAssistantPurpose(input, f.options);
  assert.equal(automatic.available, true, automatic.message);
  assert.equal(automatic.seniorJuniorPair.senior.effectiveSelection.modelId, f.backup.modelId);
  const draft = structuredClone(f.configuration);
  draft.orchestrators.codex.senior = f.junior;
  const preview = await f.manager.resolveAssistantPurpose(input, { ...f.options, configuration: draft });
  assert.equal(preview.available, true, preview.message);
  assert.equal(f.configuration.orchestrators.codex.senior.modelId, "gpt-6-astra");
  f.facts.get(f.junior.modelId).available = false;
  const unavailable = await f.manager.resolveAssistantPurpose({ purpose: "junior", workflowEngineId: "codex" }, {
    ...f.options, vibe64User: { role: "owner" }
  });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reasonCode, "vibe64_assistant_connection_unavailable");
  assert.equal(unavailable.backupUsed, false);
});

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

test("session agent manager keeps receipt inspection available after personal inference access is lost", async () => {
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
    const result = await manager.inspectMessageAdmission("session-1", input, options);
    assert.equal(result.admission, "unknown");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, input);
    assert.equal(calls[0].context.vibe64User.role, "user");
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

test("session agent manager authorizes terminal input against its captured connection without session hydration", async () => {
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

  assert.equal(accessReads.length, 2);
  assert.equal(accessReads[0].modelProviderId, "deepseek");
  assert.equal(accessReads[1].modelProviderId, "deepseek");
  assert.equal(accessReads[1].session, null);
  assert.equal(manager.binding(session.sessionId), "opencode");
  assert.equal(terminalWrites.length, 1);
  assert.equal(terminalWrites[0].context.providerId, "opencode");
  assert.equal(terminalWrites[0].context.assistantAccess.canUse, true);
  assert.equal(terminalWrites[0].input.data, "\u0003");
  assert.equal(result.providerId, "opencode");
});

test("native terminal input never adopts another actor's access, replacement key or routed destination", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    const owner = { role: "owner", username: "owner" };
    const member = { role: "user", username: "member" };
    const selection = { schema: "vibe64.assistant-selection.v1", engineId,
      modelProviderId: "deepseek", modelId: "model-1", agentId: "build", variantId: "high", catalogRevision };
    let access = { available: true, ownerOnly: false, connectionIdentity: "key-1" };
    let writes = 0;
    let closes = 0;
    let starts = 0;
    const manager = createSessionAgentManager({ defaultProviderId: engineId,
      readAssistantAccess: async ({ assistantSelection }) => {
        assert.equal(assistantSelection.modelProviderId, "deepseek");
        return access;
      },
      providers: [{ id: engineId, transportId: `${engineId}_test`,
        async startTerminal() { starts++; return { ok: true, id: `terminal-${engineId}` }; },
        async writeTerminal() { writes++; return { ok: true }; },
        async closeTerminal() { closes++; return { ok: true }; },
        async readConversation() { return { ok: true }; }
      }]
    });
    const terminalId = `terminal-${engineId}`;
    await manager.startTerminal("session-1", {}, { assistantSelection: selection, vibe64User: owner });
    const input = (actor = member) => manager.writeTerminal("session-1", terminalId, "hello\n", {}, { vibe64User: actor });
    await input();
    assert.equal(writes, 1);
    access = { ...access, ownerOnly: true };
    await assert.rejects(input(), { code: "vibe64_assistant_owner_required" });
    await input(owner);
    access = { ...access, available: false };
    await assert.rejects(input(owner), { code: "vibe64_assistant_connection_unavailable" });
    access = { available: true, ownerOnly: false, connectionIdentity: "key-2" };
    await assert.rejects(input(owner), { code: "vibe64_assistant_connection_changed" });
    await assert.rejects(manager.writeTerminal("other-session", terminalId, "hello\n", {}, { vibe64User: owner }),
      { code: "vibe64_assistant_terminal_reopen_required" });
    access.connectionIdentity = "key-1";
    await manager.readConversation("session-1", {}, { assistantSelection: { ...selection, modelProviderId: "personal" } });
    await assert.rejects(input(), { code: "vibe64_assistant_terminal_reopen_required" });
    // Reusing a live PTY cannot overwrite the original connection or revive it.
    await manager.startTerminal("session-1", {}, { assistantSelection: selection, vibe64User: owner });
    await assert.rejects(input(), { code: "vibe64_assistant_terminal_reopen_required" });
    access.available = false;
    await manager.closeTerminal("session-1", { terminalSessionId: terminalId }, { vibe64User: member });
    assert.equal(closes, 1);
    access.available = true;
    await manager.startTerminal("session-1", {}, { assistantSelection: selection, vibe64User: owner });
    await input();
    assert.equal(writes, 3);
    assert.equal(starts, 3);
  }
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

test("goal reads and stopping remain available while starting and resuming require model access", async () => {
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
      const supported = engineId !== "opencode";
      await manager.readGoal("session-1", options);
      for (const action of ["pause", "cancel"]) {
        if (supported) await manager.updateGoal("session-1", { action }, options);
        else await assert.rejects(manager.updateGoal("session-1", { action }, options));
      }
      for (const action of ["set", "resume"]) {
        if (supported && role === "owner") await manager.updateGoal("session-1", { action }, options);
        else await assert.rejects(manager.updateGoal("session-1", { action }, options));
      }
      assert.equal(reads, supported ? 1 : 0);
      assert.equal(writes, supported ? (role === "owner" ? 4 : 2) : 0);
    }
  }
});

test("goal status and Stop target the retained goal selection without rebinding the visible chat", async () => {
  const selection = { schema: "vibe64.assistant-selection.v1", engineId: "codex", modelProviderId: "openai",
    modelId: "model-1", agentId: "build", variantId: "high", catalogRevision };
  const contexts = [];
  const manager = createSessionAgentManager({
    readAssistantAccess: async () => { throw new Error("Inference is unavailable."); },
    providers: [{ id: "codex", transportId: "codex_app_server",
      async readGoal(context) { contexts.push(context); return { status: "available", goal: { status: "active" } }; },
      async updateGoal(context) { contexts.push(context); return { ok: true }; }
    }, { id: "opencode", transportId: "opencode_server", async readConversation() { return { ok: true }; } }]
  });
  const session = { sessionId: "session-1", metadata: {
    [VIBE64_ASSISTANT_SELECTION_METADATA]: JSON.stringify({ ...selection, engineId: "opencode", modelProviderId: "deepseek" }),
    assistant_routing_goal: JSON.stringify({ status: "paused", selection })
  } };
  const options = { session, vibe64User: { role: "member", username: "member" } };
  await manager.readConversation(session.sessionId, {}, options);
  await manager.readGoal(session.sessionId, options);
  await manager.updateGoal(session.sessionId, { action: "pause" }, options);
  assert.equal(contexts.length, 2);
  for (const context of contexts) {
    assert.equal(context.assistantSelection.engineId, "codex");
    assert.equal(context.vibe64User, options.vibe64User);
    assert.equal(JSON.parse(context.session.metadata.assistant_selection).engineId, "codex");
  }
  assert.equal(manager.binding(session.sessionId), "opencode");
  assert.equal(JSON.parse(session.metadata.assistant_selection).engineId, "opencode");
});

test("purpose availability shares one response's facts and preserves member-specific destinations", async () => {
  const f = routingManagerFixture();
  const purposes = await f.manager.inspectAssistantPurposes({ workflowEngineId: "codex", mode: "junior", review: true }, f.options);
  for (const purpose of ["senior", "junior", "review"]) {
    assert.equal(purposes[purpose].available, true);
    assert.equal(purposes[purpose].effectiveSelection.engineId, "opencode");
    assert.equal(purposes[purpose].effectiveSelection.modelId, f.backup.modelId);
    assert.equal(purposes[purpose].settingsRevision, 7);
  }
  assert.equal(purposes.auto.available, true, purposes.auto.message);
  assert.equal(purposes.prompt_hint.effectiveSelection.modelId, f.intern.modelId);
  assert.equal(purposes.source_explanation.effectiveSelection.modelId, f.intern.modelId);
  assert.equal(purposes.request_routing.effectiveSelection.modelId, f.junior.modelId);
  assert.equal(f.calls.filter(({ type }) => type === "access").length, 4, "each connection/model is inspected once per response");
  assert.equal(f.manager.binding("main"), "", "availability never binds the main chat");
  f.facts.get(f.intern.modelId).available = false;
  const refreshed = await f.manager.inspectAssistantPurposes({ workflowEngineId: "codex" }, f.options);
  assert.equal(refreshed.prompt_hint.available, false, "a later response reads fresh connection facts");
  assert.equal(refreshed.junior.available, true, "independent role failure does not disable chat");
});

test("purpose availability applies an explicit mode override without modifying other modes", async () => {
  const f = routingManagerFixture();
  const purposes = await f.manager.inspectAssistantPurposes({ workflowEngineId: "codex", mode: "junior", override: f.senior }, {
    ...f.options, vibe64User: { role: "owner" }
  });
  assert.equal(purposes.junior.effectiveSelection.modelId, f.senior.modelId);
  assert.equal(purposes.review.seniorJuniorPair.junior.effectiveSelection.modelId, f.junior.modelId);
  assert.equal(purposes.senior.seniorJuniorPair.junior.effectiveSelection.modelId, f.junior.modelId);
  assert.equal(purposes.auto.seniorJuniorPair.junior.effectiveSelection.modelId, f.junior.modelId);
  assert.equal(purposes.prompt_hint.effectiveSelection.modelId, f.intern.modelId);
  assert.equal(f.configuration.orchestrators.codex.junior.modelId, f.junior.modelId);
});

test("Auto and helper discovery reads only the permitted fallback catalogue for a member", async () => {
  const f = routingManagerFixture();
  Object.assign(f.configuration.orchestrators.codex, {
    senior: f.senior, junior: f.senior, intern: f.senior, router: f.senior, sharedBackup: f.intern
  });
  const purposes = await f.manager.inspectAssistantPurposes({ workflowEngineId: "codex", mode: "auto", review: true }, f.options);
  for (const [purpose, decision] of Object.entries(purposes)) {
    assert.equal(decision.available, true, `${purpose}: ${decision.message}`);
    if (purpose === "auto") {
      assert.equal(decision.router.modelId, f.intern.modelId);
      assert.equal(decision.seniorJuniorPair.senior.effectiveSelection.modelId, f.intern.modelId);
    } else assert.equal(decision.effectiveSelection.modelId, f.intern.modelId);
  }
  const catalogs = f.calls.filter(({ type }) => type === "catalog");
  assert.equal(catalogs.length, 1);
  assert.equal(catalogs[0].input.modelId, f.intern.modelId);
  assert.equal(catalogs[0].context.vibe64User.username, "member");
  await assert.rejects(f.manager.requireAssistantAccessForSelection(f.senior, f.options), { code: "vibe64_assistant_owner_required" });
});
