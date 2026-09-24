import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveVibe64AgentExecutionSettings,
  normalizeVibe64AgentSettings,
  resolveVibe64AssistantSelection,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_PROMPT_HINT_OUTPUT_SCHEMA
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  codexAppServerEconomyTurnSettings
} from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import {
  CODEX_ECONOMY_PROFILE_REVISION,
  CODEX_ECONOMY_WORKLOAD_LIMITS,
  createCodexSessionAgentProvider,
  resolveCodexEconomyExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";

test("Codex picker discovers new models and thinking levels and preserves the validated selection for execution", async () => {
  let model = "gpt-6-astra";
  let reads = 0;
  const provider = createCodexSessionAgentProvider({
    controller: {
      async modelCatalog() {
        reads += 1;
        return { data: [{
          model,
          displayName: "Current provider model",
          isDefault: true,
          defaultReasoningEffort: "ultra",
          supportedReasoningEfforts: [{ reasoningEffort: "ultra" }]
        }, { model: "hidden-model", hidden: true }] };
      }
    }
  });
  const configured = await provider.capabilities({}, { configuredOnly: "true" });
  assert.equal(resolveVibe64AssistantSelection(configured, { engineId: "codex" }).modelId, "gpt-5.6-sol");
  assert.equal(reads, 0);
  const catalog = await provider.capabilities({});
  assert.deepEqual(catalog.modelProviders[0].models.map((row) => row.id), [model]);
  const selected = resolveVibe64AssistantSelection(catalog, {
    engineId: "codex", modelProviderId: "openai", modelId: model, agentId: "codex", variantId: "ultra"
  });
  const settings = normalizeVibe64AgentSettings({ providerId: "codex", model: selected.modelId, thinking: selected.variantId });
  assert.equal(effectiveVibe64AgentExecutionSettings(settings).model, model);
  assert.equal(effectiveVibe64AgentExecutionSettings(settings).thinking, "ultra");
  model = "future-provider-model";
  const refreshed = await provider.capabilities({});
  assert.deepEqual(refreshed.modelProviders[0].models.map((row) => row.id), [model]);
  assert.notEqual(refreshed.revision, catalog.revision);
  assert.throws(() => resolveVibe64AssistantSelection(refreshed, selected));
});

test("Codex discovery failures stay visible and disconnected accounts do not discover models", async () => {
  const controller = { async modelCatalog() { throw new Error("Provider unavailable"); } };
  await assert.rejects(createCodexSessionAgentProvider({ controller }).capabilities({}), /Provider unavailable/u);
  const disconnected = await createCodexSessionAgentProvider({ controller, connectionStatus: async () => false }).capabilities({});
  assert.deepEqual(disconnected.modelProviders[0].models, []);
  assert.equal(disconnected.modelProviders[0].connected, false);
});

test("Codex adapter forwards trusted renewal operations without selecting an economy profile", async () => {
  const calls = [];
  const runtime = { stateRoot: "/runtime/project" };
  const session = { sessionId: "session-1" };
  const provider = createCodexSessionAgentProvider({
    controller: {
      async closeAllForSession(sessionId, options) {
        calls.push(["close", sessionId, options]);
        return { closed: true, ok: true };
      },
      async generateSessionRenewalHandover(sessionId, input, options) {
        calls.push(["generate", sessionId, input, options]);
        return { ok: true, turnId: "turn-old" };
      },
      async releaseRenewalPredecessorProcessExitProof(sessionId, options) {
        calls.push(["release-proof", sessionId, options]);
        return { ok: true, released: true };
      },
      async releaseRenewalPredecessorAttachments(sessionId, options) {
        calls.push(["release-attachments", sessionId, options]);
        return { ok: true, released: true };
      },
      async releaseRenewalSuccessorProcessExitProof(sessionId, options) {
        calls.push(["release-successor-proof", sessionId, options]);
        return { ok: true, released: true };
      },
      async seedSessionRenewalHandover(sessionId, input, options) {
        calls.push(["seed", sessionId, input, options]);
        return { ok: true, turnId: "turn-new" };
      }
    }
  });
  const context = {
    agentSettings: {
      model: "gpt-5.6-sol",
      thinking: "high"
    },
    runtime,
    preserveProcessExitProof: true,
    renewalCleanup: {
      renewalId: "renewal-1",
      sourceSessionId: "source-session"
    },
    session,
    sessionId: session.sessionId,
    vibe64User: { userId: "user-1" }
  };

  await provider.generateSessionRenewalHandover(context, {
    operationId: "renewal:generate"
  });
  await provider.seedSessionRenewalHandover(context, {
    operationId: "renewal:seed"
  });
  await provider.closeSession(context);
  await provider.releaseRenewalPredecessorAttachments(context, {
    renewalId: "renewal-1"
  });
  await provider.releaseRenewalPredecessorProcessExitProof(context, {
    renewalId: "renewal-1"
  });
  const successorAuthorization = {
    renewalId: "renewal-1",
    successorSessionId: session.sessionId
  };
  await provider.releaseRenewalSuccessorProcessExitProof(context, {
    authorization: successorAuthorization,
    renewalId: "renewal-1"
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "generate",
    "seed",
    "close",
    "release-attachments",
    "release-proof",
    "release-successor-proof"
  ]);
  for (const [, sessionId, input, options] of calls.slice(0, 2)) {
    assert.equal(sessionId, session.sessionId);
    assert.deepEqual(input.agentSettings, context.agentSettings);
    assert.equal(Object.hasOwn(input, "executionProfile"), false);
    assert.equal(options.runtime, runtime);
    assert.equal(options.session, session);
  }
  assert.equal(calls[2][1], session.sessionId);
  assert.equal(calls[2][2].runtime, runtime);
  assert.equal(calls[2][2].session, session);
  assert.equal(calls[2][2].renewalCleanup, context.renewalCleanup);
  assert.equal(calls[2][2].preserveProcessExitProof, true);
  assert.equal(calls[3][1], session.sessionId);
  assert.equal(calls[3][2].renewalId, "renewal-1");
  assert.equal(calls[3][2].runtime, runtime);
  assert.equal(calls[3][2].session, session);
  assert.equal(calls[4][1], session.sessionId);
  assert.equal(calls[4][2].renewalId, "renewal-1");
  assert.equal(calls[4][2].runtime, runtime);
  assert.equal(calls[4][2].session, session);
  assert.equal(calls[5][1], session.sessionId);
  assert.equal(calls[5][2].authorization, successorAuthorization);
  assert.equal(calls[5][2].renewalId, "renewal-1");
  assert.equal(calls[5][2].runtime, runtime);
  assert.equal(calls[5][2].session, session);
});

test("Codex adapter forwards the authenticated Vibe64 user to every human turn", async () => {
  const actor = { userId: "user-1" };
  const calls = [];
  const controller = {
    async runDetachedChatTurn(_sessionId, input) {
      calls.push(["detached", input]);
      return { ok: true, text: "done" };
    },
    async startConversationTurn(_sessionId, input) {
      calls.push(["temporary", input]);
      return { ok: true, runId: "turn-1" };
    },
    async streamDetachedChatTurn(_sessionId, input) {
      calls.push(["stream", input]);
      return { ok: true, text: "done" };
    },
    async writeTerminal(_sessionId, _terminalSessionId, _data, input) {
      calls.push(["terminal", input]);
      return { ok: true };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const context = { sessionId: "session-1", vibe64User: actor };

  await provider.runDetachedChatTurn(context, { prompt: "Detached" });
  await provider.streamDetachedChatTurn(context, { prompt: "Streamed" });
  await provider.startConversationTurn(context, { message: "Temporary" });
  await provider.writeTerminal(context, {
    data: "Native input",
    input: { trackGitActor: true },
    terminalSessionId: "terminal-1"
  });

  assert.deepEqual(calls.map(([kind]) => kind), [
    "detached",
    "stream",
    "temporary",
    "terminal"
  ]);
  for (const [, input] of calls) {
    assert.equal(input.vibe64User, actor);
  }
});

test("Codex adapter reports every active Temporary AI turn", async () => {
  const provider = createCodexSessionAgentProvider({
    controller: {
      hasActiveTemporaryConversation(sessionId) {
        assert.equal(sessionId, "session-1");
        return true;
      }
    }
  });

  assert.deepEqual(await provider.hasActiveTemporaryConversation({
    sessionId: "session-1"
  }), {
    active: true,
    ok: true
  });
});

test("Codex adapter never presents an unconfirmed delivery claim as active assistant work", async () => {
  const providerTurn = {
    active: true,
    state: "starting",
    status: "starting",
    threadId: "thread-1",
    turnId: ""
  };
  const provider = createCodexSessionAgentProvider({
    controller: {
      async terminalState() {
        return { codexAgentTurn: providerTurn, ok: true };
      }
    }
  });

  const unconfirmed = await provider.sessionState({ sessionId: "session-1" });
  assert.equal(unconfirmed.turn, null);

  providerTurn.state = "active";
  providerTurn.status = "inProgress";
  providerTurn.turnId = "turn-1";
  providerTurn.phase = "compacting";
  const confirmed = await provider.sessionState({ sessionId: "session-1" });
  assert.equal(confirmed.turn?.active, true);
  assert.equal(confirmed.turn?.id, "turn-1");
  assert.equal(confirmed.turn?.phase, "compacting");
  providerTurn.active = false;
  assert.equal((await provider.sessionState({ sessionId: "session-1" })).turn.phase, "");
});

test("Codex adapter preserves the hydrated session context when sending a message", async () => {
  const runtime = { stateRoot: "/runtime/project" };
  const session = { sessionId: "session-1" };
  const turnOwnership = { threadId: "thread-1", turnId: "turn-1" };
  let receivedOptions = null;
  const provider = createCodexSessionAgentProvider({
    controller: {
      async sendMessage(sessionId, _input, options) {
        assert.equal(sessionId, session.sessionId);
        receivedOptions = options;
        return { delivered: true, ok: true };
      }
    }
  });

  await provider.sendMessage({
    runtime,
    session,
    sessionId: session.sessionId,
    turnOwnership
  }, {
    message: "Hello"
  });

  assert.equal(receivedOptions.runtime, runtime);
  assert.equal(receivedOptions.session, session);
  assert.equal(receivedOptions.turnOwnership, turnOwnership);
});

function catalogModel({
  hidden = false,
  model = "gpt-5.6-luna",
  reasoning = ["low", "medium"],
  upgrade = null
} = {}) {
  return {
    hidden,
    model,
    supportedReasoningEfforts: reasoning.map((reasoningEffort) => ({
      description: reasoningEffort,
      reasoningEffort
    })),
    upgrade
  };
}

function economyRequest(workloadId = VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION) {
  return {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    workloadId
  };
}

async function flushPromiseQueue(iterations = 8) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function waitForArrayLength(values, expected) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (values.length >= expected) {
      return;
    }
    await flushPromiseQueue();
  }
  assert.fail(`Timed out waiting for ${expected} calls; received ${values.length}.`);
}

async function advanceMockTimers(t, milliseconds, values, expected) {
  t.mock.timers.tick(milliseconds);
  await waitForArrayLength(values, expected);
}

function writeAttachedTerminal(provider, context, input) {
  return provider.writeTerminal(context, { data: input.message, input, terminalSessionId: "terminal-a" });
}

function retainedAttachmentLease(ids = []) {
  return {
    busy: [],
    missing: [],
    ok: true,
    retained: [...new Set(ids)]
  };
}

test("Codex economy resolves Luna-low from the live catalog with bounded tool-free policy", () => {
  const result = resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel()]
  }, "gpt-5.6-luna");

  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(result.thinking, "low");
  assert.equal(result.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.deepEqual(result.request, {
    allowProviderModelFallback: false,
    reasoning: true,
    summary: false
  });
  assert.deepEqual(result.policy, {
    environmentAccess: false,
    networkAccess: false,
    repositoryWrite: false,
    tools: "none"
  });
  assert.deepEqual(
    result.limits,
    CODEX_ECONOMY_WORKLOAD_LIMITS[VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION]
  );

});

test("Codex prompt-hint profile can enforce its complete three-suggestion schema", () => {
  const profile = resolveCodexEconomyExecutionProfile({
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT
  }, {
    data: [catalogModel()]
  }, "gpt-5.6-luna");

  const settings = codexAppServerEconomyTurnSettings({
    cwd: "/workspace/session",
    executionProfile: profile,
    outputSchema: VIBE64_PROMPT_HINT_OUTPUT_SCHEMA
  });

  assert.equal(profile.limits.maxOutputCharacters, 2_500);
  assert.equal(settings.outputSchema, VIBE64_PROMPT_HINT_OUTPUT_SCHEMA);
});

test("Codex economy ignores catalog upgrade advice and never falls back to an interactive model", () => {
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({
      model: "gpt-5.6-sol",
      upgrade: "gpt-5.7-sol"
    })]
  }, "gpt-5.6-luna"), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE);
    assert.match(error.message, /No interactive-model fallback was attempted/u);
    assert.deepEqual(error.candidates, ["gpt-5.6-luna"]);
    return true;
  });
});

test("Codex economy fails closed when Luna-low is hidden or low reasoning is unavailable", () => {
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({ hidden: true })]
  }, "gpt-5.6-luna"), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE);
    return true;
  });

  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({ reasoning: ["medium", "high"] })]
  }, "gpt-5.6-luna"), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.REASONING_UNSUPPORTED);
    assert.equal(error.model, "gpt-5.6-luna");
    assert.equal(error.thinking, "low");
    return true;
  });
});

test("Codex declares one provider-owned economy capability with limits for every bounded workload", () => {
  const provider = createCodexSessionAgentProvider({
    controller: {
      executionProfileModelCatalog: async () => ({ data: [catalogModel()] })
    }
  });

  assert.deepEqual(provider.executionProfiles, [VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY]);
  assert.deepEqual(
    Object.keys(CODEX_ECONOMY_WORKLOAD_LIMITS).sort(),
    Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS).sort()
  );

});

test("Codex adapter resolves the live profile before a detached run and returns only its audit snapshot", async () => {
  const calls = [];
  const abortController = new AbortController();
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const controller = {
    async executionProfileModelCatalog(sessionId, options) {
      calls.push(["catalog", sessionId, options]);
      return {
        data: [catalogModel()]
      };
    },
    async runDetachedChatTurn(sessionId, input, options) {
      calls.push(["run", sessionId, input, options]);
      return {
        ok: true,
        text: "{\"answer\":\"Bounded answer\"}"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const resolution = await provider.resolveExecutionProfile({
    assistantSelection: { modelId: "gpt-5.6-luna" },
    runtime,
    session,
    sessionId: "session-a",
    signal: abortController.signal
  }, economyRequest());
  const result = await provider.runDetachedChatTurn({
    runtime,
    session,
    sessionId: "session-a"
  }, {
    executionProfile: resolution,
    prompt: "Explain this bounded excerpt."
  });

  assert.equal(calls[0][0], "catalog");
  assert.deepEqual(calls[0][2], {
    runtime,
    session,
    signal: abortController.signal,
    timeoutMs: 180_000
  });
  assert.equal(calls[1][0], "run");
  assert.equal(calls[1][2].executionProfile.model, "gpt-5.6-luna");
  assert.equal(calls[1][3].runtime, runtime);
  assert.equal(calls[1][3].session, session);
  assert.equal(result.executionProfile.model, "gpt-5.6-luna");
  assert.equal(result.executionProfile.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.equal(Object.hasOwn(result.executionProfile, "enforcement"), false);
});

test("Codex helper changes affect the next task while an already resolved task keeps its model", async () => {
  const provider = createCodexSessionAgentProvider({ controller: {
    executionProfileModelCatalog: async () => ({ data: [catalogModel(), catalogModel({ model: "chosen-helper" })] }),
    async runDetachedChatTurn(_sessionId, input) {
      assert.equal(input.executionProfile.model, "chosen-helper");
      return { ok: true, text: "Done" };
    }
  } });
  const context = { sessionId: "session-a", assistantSelection: { modelId: "chosen-helper" } };
  const first = await provider.resolveExecutionProfile(context, economyRequest());
  assert.equal(first.model, "chosen-helper");
  context.assistantSelection = { modelId: "gpt-5.6-luna" };
  const next = await provider.resolveExecutionProfile(context, economyRequest());
  assert.equal(next.model, "gpt-5.6-luna");
  const result = await provider.runDetachedChatTurn(context, { executionProfile: first, prompt: "Continue" });
  assert.equal(result.executionProfile.model, "chosen-helper");
});

test("Codex adapter publishes the resolved audit profile before a streamed detached turn", async () => {
  const events = [];
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const controller = {
    async streamDetachedChatTurn(_sessionId, input, options = {}) {
      assert.equal(input.executionProfile.model, "gpt-5.6-luna");
      assert.equal(options.runtime, runtime);
      assert.equal(options.session, session);
      options.onEvent({
        threadId: "economy-thread",
        type: "thread"
      });
      return {
        ok: true,
        text: "{\"answer\":\"Bounded answer\"}"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const resolution = resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel()]
  }, "gpt-5.6-luna");

  const result = await provider.streamDetachedChatTurn({
    onEvent(event) {
      events.push(event);
    },
    runtime,
    session,
    sessionId: "session-a"
  }, {
    executionProfile: resolution,
    prompt: "Explain this bounded excerpt."
  });

  assert.deepEqual(events.map((event) => event.type), [
    "execution-profile",
    "thread"
  ]);
  assert.equal(events[0].executionProfile.model, "gpt-5.6-luna");
  assert.equal(events[0].executionProfile.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.deepEqual(result.executionProfile, events[0].executionProfile);
});

test("Codex adapter keeps chat delivery independent of upload leases and renews terminal attachments", async () => {
  const attachmentIds = {
    main: "11111111-1111-4111-8111-111111111111",
    temporary: "22222222-2222-4222-8222-222222222222",
    terminal: "33333333-3333-4333-8333-333333333333"
  };
  const renewals = [];
  const controller = {
    async renewAttachments(sessionId, ids) {
      renewals.push({ ids, sessionId });
      return retainedAttachmentLease(ids);
    },
    async sendMessage(_sessionId, input) {
      if (input.message === "steered") {
        return {
          delivered: true,
          ok: true
        };
      }
      if (input.message === "not accepted") {
        return {
          delivered: false,
          newTurnRequired: true,
          ok: true
        };
      }
      if (input.message === "failed") {
        return { ok: false };
      }
      return {
        deliveryMode: "new_turn",
        ok: true,
        turnId: "main-turn"
      };
    },
    async startConversationTurn(_sessionId, input) {
      return input.message === "accepted"
        ? { ok: true, runId: "temporary-turn" }
        : { ok: false };
    },
    async writeTerminal(_sessionId, _terminalSessionId, _data, input) {
      return input.accepted ? { ok: true } : { ok: false };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const context = { sessionId: "session-a" };

  const main = await provider.sendMessage(context, {
    attachmentIds: [attachmentIds.main],
    message: "accepted"
  });
  const mainSteered = await provider.sendMessage(context, {
    attachmentIds: [attachmentIds.main],
    message: "steered"
  });
  const mainNotAccepted = await provider.sendMessage(context, {
    attachmentIds: [attachmentIds.main],
    message: "not accepted"
  });
  const mainFailed = await provider.sendMessage(context, {
    attachmentIds: [attachmentIds.main],
    message: "failed"
  });
  const temporary = await provider.startConversationTurn(context, {
    attachmentIds: [attachmentIds.temporary],
    message: "accepted"
  });
  const temporaryFailed = await provider.startConversationTurn(context, {
    attachmentIds: [attachmentIds.temporary],
    message: "failed"
  });
  const terminal = await provider.writeTerminal(context, {
    data: "[/tmp/file] ",
    input: {
      accepted: true,
      attachmentIds: [attachmentIds.terminal]
    },
    terminalSessionId: "terminal-a"
  });
  const terminalFailed = await provider.writeTerminal(context, {
    data: "[/tmp/file] ",
    input: {
      accepted: false,
      attachmentIds: [attachmentIds.terminal]
    },
    terminalSessionId: "terminal-a"
  });

  assert.equal(main.ok, true);
  assert.equal(mainSteered.delivered, true);
  assert.equal(mainNotAccepted.newTurnRequired, true);
  assert.equal(mainFailed.ok, false);
  assert.equal(temporary.ok, true);
  assert.equal(temporaryFailed.ok, false);
  assert.equal(terminal.ok, true);
  assert.equal(terminalFailed.ok, false);
  assert.deepEqual(renewals, [
    { ids: [attachmentIds.terminal], sessionId: "session-a" },
    { ids: [attachmentIds.terminal], sessionId: "session-a" },
    { ids: [attachmentIds.terminal], sessionId: "session-a" }
  ]);
});

test("Codex adapter rejects missing, busy, and unavailable terminal attachments", async () => {
  const attachmentId = "11111111-1111-4111-8111-111111111111";
  const deliveries = [];
  const scenarios = [
    {
      code: "vibe64_agent_attachment_missing",
      renewal: {
        busy: [],
        missing: [attachmentId],
        ok: true,
        retained: []
      },
      retryable: false
    },
    {
      code: "vibe64_agent_attachment_busy",
      renewal: {
        busy: [attachmentId],
        missing: [],
        ok: true,
        retained: []
      },
      retryable: true
    },
    {
      code: "vibe64_agent_attachment_unavailable",
      renewal: {
        busy: [],
        missing: [],
        ok: true,
        retained: []
      },
      retryable: true
    }
  ];

  for (const scenario of scenarios) {
    const controller = {
      async renewAttachments() {
        return scenario.renewal;
      },
      async sendMessage() {
        deliveries.push("main");
        return { ok: true, turnId: "main-turn" };
      },
      async startConversationTurn() {
        deliveries.push("temporary");
        return { ok: true, runId: "temporary-turn" };
      },
      async writeTerminal() {
        deliveries.push("terminal");
        return { ok: true };
      }
    };
    const provider = createCodexSessionAgentProvider({ controller });
    const context = { sessionId: "session-a" };
    const input = { attachmentIds: [attachmentId] };
    const results = [
      await provider.writeTerminal(context, {
        data: "[/tmp/file] ",
        input,
        terminalSessionId: "terminal-a"
      })
    ];
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.code, scenario.code);
      assert.equal(result.retryable, scenario.retryable);
    }
  }

  assert.deepEqual(deliveries, []);
});

test("Codex adapter fails closed before delivery when attachment validation cannot run", async () => {
  const attachmentId = "11111111-1111-4111-8111-111111111111";
  const deliveries = [];
  for (const failure of ["missing-controller", "result", "throw"]) {
    const controller = {
      async writeTerminal() {
        deliveries.push(failure);
        return { ok: true, turnId: "must-not-run" };
      },
      ...(failure === "missing-controller"
        ? {}
        : {
            async renewAttachments() {
              if (failure === "throw") {
                throw new Error("lease service unavailable");
              }
              return {
                code: "vibe64_agent_attachment_unavailable",
                error: "lease service unavailable",
                ok: false
              };
            }
          })
    };
    const provider = createCodexSessionAgentProvider({ controller });
    const result = await writeAttachedTerminal(provider, { sessionId: "session-a" }, {
      attachmentIds: [attachmentId],
      message: "must not be delivered"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_attachment_unavailable");
    assert.equal(result.retryable, true);
  }
  assert.deepEqual(deliveries, []);
});

test("Codex adapter retries only busy attachment leases after accepted delivery", async () => {
  const firstId = "11111111-1111-4111-8111-111111111111";
  const busyId = "22222222-2222-4222-8222-222222222222";
  const renewals = [];
  const controller = {
    async renewAttachments(sessionId, ids) {
      renewals.push({ ids, sessionId });
      if (renewals.length === 1) {
        return retainedAttachmentLease(ids);
      }
      if (renewals.length < 4) {
        return {
          busy: [busyId],
          missing: [],
          ok: true,
          retained: renewals.length === 2 ? [firstId] : []
        };
      }
      return {
        missing: [],
        ok: true,
        retained: [busyId]
      };
    },
    async writeTerminal() {
      return {
        ok: true,
        turnId: "accepted-turn"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });

  const result = await writeAttachedTerminal(provider, { sessionId: "session-a" }, {
    attachmentIds: [firstId, busyId],
    message: "accepted"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(renewals, [
    { ids: [firstId, busyId], sessionId: "session-a" },
    { ids: [firstId, busyId], sessionId: "session-a" },
    { ids: [busyId], sessionId: "session-a" },
    { ids: [busyId], sessionId: "session-a" }
  ]);
});

test("accepted delivery schedules lease-only recovery after foreground contention and transient failures", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  const firstId = "11111111-1111-4111-8111-111111111111";
  const busyId = "22222222-2222-4222-8222-222222222222";
  const deliveries = [];
  const renewals = [];
  const controller = {
    async renewAttachments(sessionId, ids) {
      renewals.push({ ids, sessionId });
      if (renewals.length === 1) {
        return retainedAttachmentLease(ids);
      }
      if (renewals.length <= 4) {
        return {
          busy: [busyId],
          missing: [],
          ok: true,
          retained: renewals.length === 2 ? [firstId] : []
        };
      }
      if (renewals.length === 5) {
        return {
          code: "temporary-renewal-failure",
          ok: false
        };
      }
      if (renewals.length === 6) {
        throw new Error("temporary renewal transport failure");
      }
      return {
        missing: [],
        ok: true,
        retained: [busyId]
      };
    },
    async writeTerminal(sessionId, _terminalId, _data, input) {
      deliveries.push({ input, sessionId });
      return {
        ok: true,
        turnId: "accepted-turn"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });

  try {
    const pending = writeAttachedTerminal(provider, { sessionId: "session-a" }, {
      attachmentIds: [firstId, busyId],
      message: "accepted once"
    });
    await waitForArrayLength(renewals, 1);
    await waitForArrayLength(renewals, 2);
    await advanceMockTimers(t, 100, renewals, 3);
    await advanceMockTimers(t, 250, renewals, 4);

    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(result.turnId, "accepted-turn");
    assert.equal(deliveries.length, 1);

    await advanceMockTimers(t, 500, renewals, 5);
    await advanceMockTimers(t, 1_000, renewals, 6);
    await advanceMockTimers(t, 2_000, renewals, 7);
    t.mock.timers.tick(10_000);
    await flushPromiseQueue();

    assert.equal(deliveries.length, 1);
    assert.deepEqual(renewals.map(({ ids }) => ids), [
      [firstId, busyId],
      [firstId, busyId],
      [busyId],
      [busyId],
      [busyId],
      [busyId],
      [busyId]
    ]);
  } finally {
    t.mock.timers.reset();
  }
});

test("accepted delivery survives foreground lease errors and retries only the lease", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  const attachmentId = "33333333-3333-4333-8333-333333333333";

  try {
    for (const failure of ["result", "throw"]) {
      const deliveries = [];
      const renewals = [];
      const controller = {
        async renewAttachments(sessionId, ids) {
          renewals.push({ ids, sessionId });
          if (renewals.length === 1) {
            return retainedAttachmentLease(ids);
          }
          if (renewals.length === 2) {
            if (failure === "throw") {
              throw new Error("temporary renewal transport failure");
            }
            return {
              code: "temporary-renewal-failure",
              ok: false
            };
          }
          return {
            missing: [],
            ok: true,
            retained: [attachmentId]
          };
        },
        async writeTerminal(sessionId, _terminalId, _data, input) {
          deliveries.push({ input, sessionId });
          return {
            ok: true,
            turnId: `accepted-${failure}`
          };
        }
      };
      const provider = createCodexSessionAgentProvider({ controller });

      const result = await writeAttachedTerminal(provider, { sessionId: "session-a" }, {
        attachmentIds: [attachmentId],
        message: `accepted despite ${failure}`
      });
      assert.equal(result.ok, true);
      assert.equal(result.turnId, `accepted-${failure}`);
      assert.equal(deliveries.length, 1);
      assert.equal(renewals.length, 2);

      await advanceMockTimers(t, 500, renewals, 3);
      assert.equal(deliveries.length, 1);
      assert.deepEqual(renewals, [
        { ids: [attachmentId], sessionId: "session-a" },
        { ids: [attachmentId], sessionId: "session-a" },
        { ids: [attachmentId], sessionId: "session-a" }
      ]);
    }
  } finally {
    t.mock.timers.reset();
  }
});

test("exhausted accepted-delivery lease recovery emits the established diagnostic", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  const previousDebug = process.env.VIBE64_SESSION_DEBUG;
  process.env.VIBE64_SESSION_DEBUG = "1";
  const info = t.mock.method(console, "info", () => {});
  const attachmentId = "44444444-4444-4444-8444-444444444444";
  const deliveries = [];
  const renewals = [];
  const controller = {
    async renewAttachments(sessionId, ids) {
      renewals.push({ ids, sessionId });
      if (renewals.length === 1) {
        return retainedAttachmentLease(ids);
      }
      return {
        busy: [attachmentId],
        missing: [],
        ok: true,
        retained: []
      };
    },
    async writeTerminal(sessionId, _terminalId, _data, input) {
      deliveries.push({ input, sessionId });
      return {
        ok: true,
        turnId: "accepted-exhausted"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });

  try {
    const pending = writeAttachedTerminal(provider, { sessionId: "session-a" }, {
      attachmentIds: [attachmentId],
      message: "accepted once despite lease contention"
    });
    await waitForArrayLength(renewals, 1);
    await waitForArrayLength(renewals, 2);
    await advanceMockTimers(t, 100, renewals, 3);
    await advanceMockTimers(t, 250, renewals, 4);
    const result = await pending;
    assert.equal(result.ok, true);

    await advanceMockTimers(t, 500, renewals, 5);
    await advanceMockTimers(t, 1_000, renewals, 6);
    await advanceMockTimers(t, 2_000, renewals, 7);
    await advanceMockTimers(t, 5_000, renewals, 8);
    await flushPromiseQueue();

    assert.equal(deliveries.length, 1);
    assert.equal(renewals.length, 8);
    assert.equal(info.mock.calls.some((call) => (
      call.arguments.some((argument) => String(argument).includes(
        "server.codexAttachments.acceptedRenewal.exhausted"
      ))
    )), true);
  } finally {
    if (previousDebug == null) {
      delete process.env.VIBE64_SESSION_DEBUG;
    } else {
      process.env.VIBE64_SESSION_DEBUG = previousDebug;
    }
    t.mock.timers.reset();
  }
});

test("Codex adapter accepts ten terminal attachments and rejects eleven", async () => {
  const calls = [];
  const controller = {
    async renewAttachments(_sessionId, ids) {
      return retainedAttachmentLease(ids);
    },
    async sendMessage(_sessionId, input) {
      calls.push(["main", input.attachmentIds.length]);
      return { ok: true, turnId: "main-turn" };
    },
    async startConversationTurn(_sessionId, input) {
      calls.push(["temporary", input.attachmentIds.length]);
      return { ok: true, runId: "temporary-turn" };
    },
    async writeTerminal(_sessionId, _terminalSessionId, _data, input) {
      calls.push(["terminal", input.attachmentIds.length]);
      return { ok: true };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const context = { sessionId: "session-a" };
  const ten = Array.from({ length: 10 }, (_value, index) => `attachment-${index}`);
  const eleven = [...ten, "attachment-10"];

  assert.equal((await provider.sendMessage(context, {
    attachmentIds: ten,
    message: "ten"
  })).ok, true);
  assert.equal((await provider.startConversationTurn(context, {
    attachmentIds: ten,
    message: "ten"
  })).ok, true);
  assert.equal((await provider.writeTerminal(context, {
    data: "ten",
    input: { attachmentIds: ten },
    terminalSessionId: "terminal-a"
  })).ok, true);

  for (const result of [
    await provider.writeTerminal(context, {
      data: "eleven",
      input: { attachmentIds: eleven },
      terminalSessionId: "terminal-a"
    })
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_attachment_limit_exceeded");
    assert.equal(result.error, "A message can include at most 10 attachments.");
  }
  assert.deepEqual(calls, [
    ["main", 10],
    ["temporary", 10],
    ["terminal", 10]
  ]);
});

test("Codex adapter rejects consumer-supplied model knobs", async () => {
  const provider = createCodexSessionAgentProvider({
    controller: {
      executionProfileModelCatalog: async () => ({ data: [catalogModel()] })
    }
  });

  await assert.rejects(provider.resolveExecutionProfile({
    sessionId: "session-a"
  }, {
    ...economyRequest(),
    model: "gpt-5.6-sol"
  }, "gpt-5.6-luna"), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID);
    assert.equal(error.field, "request.model");
    return true;
  });
});

test("Codex adapter fails closed when live model discovery is not wired", async () => {
  const provider = createCodexSessionAgentProvider({
    controller: {}
  });

  await assert.rejects(provider.resolveExecutionProfile({
    sessionId: "session-a"
  }, economyRequest()), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE);
    return true;
  });
});

test("Codex adapter delegates stable account description to the controller", async () => {
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const provider = createCodexSessionAgentProvider({
    controller: {
      async describeProvider(sessionId, options) {
        assert.equal(sessionId, "session-a");
        assert.equal(options.runtime, runtime);
        assert.equal(options.session, session);
        return {
          accountIdentitySignature: "sha256:account-a",
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }
  });

  assert.deepEqual(await provider.describeProvider({
    runtime,
    session,
    sessionId: "session-a"
  }), {
    accountIdentitySignature: "sha256:account-a",
    providerId: "codex",
    transportId: "codex_app_server"
  });
});

test("Codex adapter propagates explicit runtime and session through detached cleanup and interruption", async () => {
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const calls = [];
  const provider = createCodexSessionAgentProvider({
    controller: {
      async deleteDetachedChatThread(sessionId, input, options) {
        calls.push(["delete", sessionId, input, options]);
        return { ok: true, status: "deleted" };
      },
      async interruptDetachedChatTurn(sessionId, input, options) {
        calls.push(["interrupt", sessionId, input, options]);
        return { interrupted: true, ok: true };
      }
    }
  });
  const context = {
    runtime,
    session,
    sessionId: "session-a"
  };
  const deleteInput = { threadId: "economy-thread" };
  const interruptInput = {
    threadId: "economy-thread",
    turnId: "economy-turn"
  };

  await provider.deleteDetachedChatThread(context, deleteInput);
  await provider.interruptDetachedChatTurn(context, interruptInput);

  assert.deepEqual(calls.map(([operation]) => operation), ["delete", "interrupt"]);
  assert.equal(calls[0][1], "session-a");
  assert.equal(calls[0][2], deleteInput);
  assert.equal(calls[0][3].runtime, runtime);
  assert.equal(calls[0][3].session, session);
  assert.equal(calls[1][1], "session-a");
  assert.equal(calls[1][2], interruptInput);
  assert.equal(calls[1][3].runtime, runtime);
  assert.equal(calls[1][3].session, session);
});

test("Codex bounded profiles require the resolved model and never silently fall back", () => {
  const catalog = { data: [catalogModel(), { ...catalogModel(), model: "chosen-model" }] };
  assert.equal(resolveCodexEconomyExecutionProfile(economyRequest(), catalog, "chosen-model").model, "chosen-model");
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), catalog, ""), /not available/);
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), catalog, "missing-model"), /not available/);
});


test("a curated connection works without an OpenAI login or model discovery", async () => {
  for (const [id, modelId] of [["deepseek", "deepseek-flash"], ["zai-coding-plan", "glm-5.3"]]) {
    const provider = createCodexSessionAgentProvider({
      controller: { modelCatalog() { throw new Error("OpenAI discovery must not run"); } },
      connectionStatus: async () => false,
      listConnections: async () => [{ id, connected: true }]
    });
    const catalog = await provider.capabilities({}, { configuredOnly: "true" });
    assert.equal(catalog.health.status, "ready");
    const selected = resolveVibe64AssistantSelection(catalog, { engineId: "codex" });
    assert.equal(selected.modelProviderId, id);
    assert.equal(selected.modelId, modelId);
    assert.equal(catalog.modelProviders[0].connected, false);
  }
});
