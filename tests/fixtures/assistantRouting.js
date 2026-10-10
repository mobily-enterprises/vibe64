import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWorkPlan, workPlanPath, planProgressUpgradeChanges } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { validateConversationOutputSchema } from "@jskit-ai/assistant-core/server/conversation";
import { createAssistantRouting } from "../../packages/vibe64-terminals/src/server/assistantRouting.js";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { VIBE64_AGENT_HELPER_WORKLOAD_LIMITS, defineVibe64AgentExecutionProfileRequest } from "@local/vibe64-runtime/shared";
import { recommendedRoutingAssignments } from "@local/vibe64-runtime/shared/assistantRouting";

async function publishPlanFixture(context, text) {
  const root = path.dirname(workPlanPath(context));
  for (const { name, text: contents } of planProgressUpgradeChanges([{ name: "current.md", text }])) {
    const filename = path.join(root, name);
    if (contents === null) await rm(filename, { force: true });
    else {
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await writeFile(filename, contents, { mode: 0o600 });
    }
  }
}

function planDocument(status = "active") {
  return `# Required-field validation
Status: ${status}

` + [
    ["Outcome and scope", "Validate the required name in the existing form only."],
    ["Findings", "The agreed required-field rule is missing from src/form.js and tests/form.test.js."],
    ["Proposed changes", "Reject a blank name before submitting; keep other validation unchanged."],
    ["Decisions", "Use the existing form error presentation; no unresolved decisions."],
    ["Implementation steps", "1. Add the name check. 2. Add empty and populated form cases."],
    ["Verification", "Run the form tests and verify submission is prevented only for empty names."],
    ["Progress and blockers", "Implementation has not started."]
  ].map(([heading, body]) => `## ${heading}
${body}
`).join("\n");
}

async function fixture(t, preferences = { mode: "auto", review: true }, { resolveAssistantUser, beforeExclusive, readyPlan = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-routing-lifecycle-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const catalog = { engineId: "codex", revision: `sha256:${"a".repeat(64)}`, transportId: "codex_app_server", label: "Codex",
    defaults: { agentId: "codex", modelProviderId: "openai", modelId: "gpt-6-astra", variantId: "high" },
    agents: [{ id: "codex", mode: "primary" }], modelProviders: [
      { id: "openai", label: "GPT", connected: true, models: ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"].map((id) => ({
        id, label: id, status: "available", variants: [{ id: "low" }, { id: "high" }]
      })) }, { id: "deepseek", label: "DeepSeek", connected: true, models: [{ id: "deepseek-flash", label: "DeepSeek Flash",
        status: "available", variants: [{ id: "low" }, { id: "high" }] }] }
    ] };
  const assignments = recommendedRoutingAssignments(catalog);
  // Preserve the original explicit lifecycle routes independently of recommendation policy.
  assignments.junior = { ...assignments.junior, modelProviderId: "deepseek", modelId: "deepseek-flash", selectionSource: "explicit" };
  assignments.helper = { ...assignments.junior, variantId: "low" };
  // Keep a distinct, explicit classifier so lifecycle checks do not depend on recommendation rankings.
  assignments.router = { ...assignments.router, modelProviderId: "openai", modelId: "gpt-6-luna", selectionSource: "explicit" };
  const configuration = createAssistantRoutingStore({ systemRoot: root });
  await configuration.write({ codex: assignments }, 0);
  const metadata = { assistant_selection: JSON.stringify(assignments.senior),
    ...(preferences ? { assistant_routing: JSON.stringify({ workflowEngineId: "codex", ...preferences }) } : {}) };
  const receipts = new Map();
  const notices = new Map();
  const session = { sessionId: "session-1", metadata };
  const store = {
    paths: () => ({ sessionRoot: path.join(root, "sessions", session.sessionId), conversationsRoot: path.join(root, "sessions", session.sessionId, "conversations") }),
    readMetadataValue: async (_id, name) => metadata[name],
    writeMetadataValue: async (_id, name, value) => { metadata[name] = value; },
    conversationMessageIdExists: async (_id, messageId) => receipts.has(messageId),
    readConversationTail: async () => [{ user: { text: "Please propose validation." },
      messages: [{ role: "assistant", text: "Add the agreed required-field rule." }, { role: "thinking", text: "PRIVATE THOUGHT" }] }],
    writeConversationUserMessage: async (_id, value) => { receipts.set(value.messageId, value); },
    writeConversationSystemMessage: async (_id, value) => {
      if (notices.has(value.messageId)) return null;
      const turn = { turnId: value.messageId, system: { role: "system", ...value } };
      notices.set(value.messageId, turn);
      return turn;
    }
  };
  const context = { runtime: { store, stateRoot: root }, session, vibe64User: { role: "owner", username: "owner" } };
  if (readyPlan) {
    await mkdir(path.dirname(workPlanPath(context)), { recursive: true });
    await publishPlanFixture(context, planDocument());
  }
  const sends = [];
  const events = [];
  let helperCalls = 0;
  let cleanupCalls = 0;
  const router = {
    respond: async () => ({ ok: true, text: '{"mode":"junior","reason":"implementation"}' }),
    classifyInputs: []
  };
  const agent = {
    listCapabilities: async () => ({ engines: [catalog] }),
    requireAssistantAccessForSelection: async () => {},
    sessionState: async () => ({ turn: { active: false } }),
    readGoal: async () => ({ goal: null }),
    resolveEphemeralExecutionProfile: async (_scope, input, options) => ({ model: options.assistantSelection.modelId,
      ...defineVibe64AgentExecutionProfileRequest(input), providerId: options.assistantSelection.engineId,
      revision: "test", thinking: "low", limits: VIBE64_AGENT_HELPER_WORKLOAD_LIMITS.request_routing,
      policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
      request: { allowProviderModelFallback: false, reasoning: true, summary: false } }),
    createEphemeralConversation: async () => ({ ok: true, conversationId: "helper-1" }),
    startEphemeralConversationTurn: async (scope, input, options) => {
      validateConversationOutputSchema(input.outputSchema, input.executionProfile.limits);
      helperCalls++;
      assert.equal(input.outputSchema.properties.decision, undefined, "Router only classifies a new request");
      router.classifyInputs.push(input);
      assert.match(input.message, /agreed required-field/);
      assert.doesNotMatch(input.message, /PRIVATE THOUGHT/);
      assert.notEqual(scope.id, session.sessionId);
      assert.equal(options.session, undefined);
      assert.equal(options.runtime, undefined);
      assert.equal(JSON.parse(metadata.assistant_routing_request).helper.conversationId, "helper-1",
        "capture the native helper before submitting any inference");
      return { ok: true, runId: "helper-turn-1" };
    },
    waitForEphemeralConversationTurn: (...args) => router.respond(...args),
    deleteEphemeralConversation: async () => { cleanupCalls++; return { ok: true }; },
    stopEphemeralConversation: async () => ({ ok: true }),
    inspectMessageAdmission: async () => ({ admission: "unknown" })
  };
  const catalogs = [catalog];
  const connections = new Map();
  const manager = createSessionAgentManager({
    resolveAssistantUser,
    providers: ["codex", "opencode", "claude"].map((id) => ({ id, transportId: id === "codex" ? "codex_app_server" : id === "claude" ? "claude_stream_json" : "opencode_server",
      capabilities: async () => catalogs.find((row) => row.engineId === id) })),
    readRoutingConfiguration: () => configuration.read(),
    readAssistantAccess: async ({ engineId, modelProviderId }) => ({ available: true,
      ownerOnly: modelProviderId === "openai", connectionIdentity: `${engineId}:${modelProviderId}:1`,
      ...connections.get(`${engineId}:${modelProviderId}`) })
  });
  agent.resolveAssistantPurpose = (input, options) => manager.resolveAssistantPurpose(input, options);
  let lock = Promise.resolve();
  const exclusive = (_id, _options, operation) => {
    const next = lock.catch(() => {}).then(() => {
      beforeExclusive?.();
      return operation({ ...context, ..._options });
    });
    lock = next;
    return next;
  };
  let failAdmission = false;
  const routingOptions = { systemRoot: root, agent, exclusive,
    publish: async (_id, value) => { events.push(structuredClone(value)); },
    dispatch: async (_id, input, selected) => {
      await manager.requireAssistantAccessForSelection(selected.assistantSelection || JSON.parse(selected.session.metadata.assistant_selection), selected);
      await input.onPromptSending?.({ threadId: "native-thread" });
      sends.push({ input, selection: selected.assistantSelection });
      if (failAdmission) throw new Error("Lost admission response.");
      receipts.set(input.messageId, input);
      return { ok: true, delivered: true, threadId: "native-thread", turnId: `turn-${sends.length}` };
    } };
  const service = createAssistantRouting(routingOptions);
  return { service, context, metadata, agent, router, sends, events, notices, catalog, catalogs, connections, assignments, configuration,
    restart: () => createAssistantRouting(routingOptions),
    helperCalls: () => helperCalls, cleanupCalls: () => cleanupCalls,
    failAdmission: (value = true) => { failAdmission = value; }, state: () => JSON.parse(metadata.assistant_routing_request || "null") };
}
export { fixture, planDocument, publishPlanFixture };

// Report through the production workflow owner as an active native agent would.
export async function reportOutcome(f, decision, { progress = true, involved = false, explanation = 'Recorded concrete work and checks.', ...extra } = {}) {
  const state = f.state();
  const plan = involved ? await readWorkPlan(f.context) : null;
  const readNative = f.agent.sessionState;
  f.agent.sessionState = async () => ({ turn: { active: true, id: state.turnId } });
  try {
    return await f.service.recordOutcome('session-1', { messageId: state.messageId, turnId: state.turnId, stage: state.stage,
      decision, explanation, progress, ...(plan ? { expectedRevision: plan.revision, expectedProgressRevision: plan.progressRevision || '' } : {}), ...extra }, f.context);
  } finally { f.agent.sessionState = readNative; }
}
