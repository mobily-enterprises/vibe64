import assert from "node:assert/strict";
import test from "node:test";
import { upgradeAssistantRoutingSession } from "../../packages/vibe64-runtime/src/server/assistantRoutingStateUpgrade.js";

const selected = (engineId = "codex", modelId = "gpt-6-astra", modelProviderId = "openai") => ({
  schema: "vibe64.assistant-selection.v1", engineId, modelId, modelProviderId,
  agentId: engineId === "opencode" ? "build" : engineId, variantId: "",
  catalogRevision: `sha256:${"a".repeat(64)}`
});
const planner = selected();
const coder = selected("codex", "deepseek-flash", "deepseek");
const helper = selected("codex", "gpt-6-luna");
const pickle = selected("opencode", "big-pickle", "opencode");
const request = (patch = {}) => ({
  mode: "auto", status: "routing", messageId: "user-message-1", assignments: { plan: planner, code: coder, economy: helper },
  input: { message: "Do this work", displayMessage: "My exact message" },
  submittedBy: { id: "member-1", role: "member" }, settingsRevision: 7,
  createdAt: "2026-09-22T11:00:00Z", review: true, reviewMessageId: "review-message-1", ...patch
});
const session = (metadata = {}, conversations = []) => ({
  sessionId: "session-1", metadata: { assistant_selection: JSON.stringify(planner), ...metadata }, conversations
});
const parse = (result, name) => JSON.parse(result.metadata[name]);

test("legacy direct chat gains Code with its exact selection; completed request cannot pick its workflow", () => {
  const input = session({ assistant_selection: JSON.stringify(pickle),
    assistant_routing_request: JSON.stringify(request({ status: "done" })),
    assistant_changeover: '{"lastEngine":"opencode","engines":{"codex":{"seen":{"turn/1":"hash"}}}}',
    agent_conversation_id: "preserve-native"
  });
  const before = structuredClone(input);
  const result = upgradeAssistantRoutingSession(input);
  assert.deepEqual(parse(result, "assistant_routing"), { mode: "code", review: false, override: pickle, workflowEngineId: "opencode" });
  assert.deepEqual(Object.keys(result.metadata), ["assistant_routing"]);
  assert.deepEqual(input, before);
});

test("an unfinished Auto request keeps its classifier, actor, exact message and workflow", () => {
  const savedRequest = request();
  const input = session({ assistant_selection: JSON.stringify(pickle),
    assistant_routing: '{"mode":"auto","review":true}',
    assistant_routing_request: JSON.stringify(savedRequest)
  });
  const result = upgradeAssistantRoutingSession(input);
  assert.deepEqual(parse(result, "assistant_routing"), { mode: "auto", review: true, workflowEngineId: "codex" });
  const next = parse(result, "assistant_routing_request");
  assert.deepEqual(next.assignments, { plan: planner, code: coder, router: helper });
  for (const key of ["submittedBy", "input", "messageId", "createdAt", "reviewMessageId", "settingsRevision"]) {
    assert.deepEqual(next[key], savedRequest[key]);
  }
  assert.equal(next.status, "failed");
  assert.equal(next.admissionRequired, true);
  assert.equal(next.workflowEngineId, "codex");
  assert.equal(next.schemaVersion, 2);
  assert.deepEqual(upgradeAssistantRoutingSession({ ...input, metadata: { ...input.metadata, ...result.metadata } }), { metadata: {}, conversations: [] });
});

test("uncertain deliveries retain receipts and review identity without being classified again", () => {
  for (const [status, expected] of [["sending", "uncertain"], ["uncertain", "uncertain"],
    ["review_sending", "review_uncertain"], ["review_uncertain", "review_uncertain"]]) {
    const previous = request({ status, attemptedMessageId: "attempted", threadId: "native-1", turnId: "turn-1" });
    const next = parse(upgradeAssistantRoutingSession(session({ assistant_routing_request: JSON.stringify(previous) })), "assistant_routing_request");
    assert.equal(next.status, expected);
    assert.equal(next.attemptedMessageId, "attempted");
    assert.equal(next.threadId, "native-1");
    assert.equal(next.turnId, "turn-1");
    assert.equal(next.reviewMessageId, "review-message-1");
    assert.equal(next.admissionRequired, true);
  }
});

test("unfinished request evidence supplies missing preferences instead of mixing engines", () => {
  const result = upgradeAssistantRoutingSession(session({ assistant_selection: JSON.stringify(pickle),
    assistant_routing_request: JSON.stringify(request()) }));
  assert.deepEqual(parse(result, "assistant_routing"), { mode: "auto", review: true, workflowEngineId: "codex" });
  const direct = upgradeAssistantRoutingSession(session({ assistant_selection: JSON.stringify(pickle),
    assistant_routing_request: JSON.stringify(request({ mode: "code", assignments: { code: coder, plan: planner } })) }));
  assert.deepEqual(parse(direct, "assistant_routing"), { mode: "code", review: true, override: coder, workflowEngineId: "codex" });
});

test("explicit Router already present is preserved and direct Economy keeps its assignment", () => {
  const next = parse(upgradeAssistantRoutingSession(session({
    assistant_routing_request: JSON.stringify(request({ assignments: { plan: planner, code: coder, economy: helper, router: pickle } }))
  })), "assistant_routing_request");
  assert.deepEqual(next.assignments.router, pickle);
  assert.deepEqual(next.assignments.economy, helper);
  const economy = parse(upgradeAssistantRoutingSession(session({
    assistant_routing_request: JSON.stringify(request({ mode: "economy", assignments: { economy: helper } }))
  })), "assistant_routing_request");
  assert.deepEqual(economy.assignments, { economy: helper });
});

test("goal pins keep their mode and destination even when the current selection differs", () => {
  const pinned = { mode: "economy", selection: helper, objective: "Keep working", status: "active" };
  const result = upgradeAssistantRoutingSession(session({ assistant_selection: JSON.stringify(pickle), assistant_routing_goal: JSON.stringify(pinned) }));
  assert.deepEqual(parse(result, "assistant_routing_goal"), { ...pinned, workflowEngineId: "codex" });
  assert.deepEqual(parse(result, "assistant_routing"), { mode: "economy", review: false, override: helper, workflowEngineId: "codex" });
});

test("temporary migration retains the exact native binding, scoped changeover and unrelated presentation", () => {
  const conversation = {
    conversationId: "temporary-1", assistantSelection: coder, providerConversationId: "native-123",
    purpose: "diagnosis", state: "open", title: "My chat", draft: "Unsent text", createdAt: "2026-09-22T11:00:00Z",
    routingMetadata: { assistant_routing: '{"mode":"auto","review":true}',
      assistant_changeover: '{"lastEngine":"codex","engines":{"codex":{"pending":{"messageId":"pending-1"}}}}',
      codex_routing_home_provider: "openai", assistant_routing_request: JSON.stringify(request()) }
  };
  const input = session({}, [conversation]);
  const before = structuredClone(input);
  const result = upgradeAssistantRoutingSession(input);
  const next = result.conversations[0];
  assert.deepEqual(next.nativeBindings, { codex: { conversationId: "native-123", assistantSelection: coder,
    agentSettings: {}, runId: "", messageId: "" } });
  assert.equal(next.providerConversationId, "native-123");
  for (const key of ["conversationId", "assistantSelection", "purpose", "state", "title", "draft", "createdAt"]) assert.deepEqual(next[key], conversation[key]);
  assert.equal(next.routingMetadata.assistant_changeover, conversation.routingMetadata.assistant_changeover);
  assert.equal(JSON.parse(next.routingMetadata.assistant_routing_request).assignments.router.modelId, helper.modelId);
  assert.deepEqual(input, before);
  assert.deepEqual(upgradeAssistantRoutingSession({ ...input, metadata: { ...input.metadata, ...result.metadata }, conversations: [next] }), { metadata: {}, conversations: [] });
});

test("native bindings are seeded only from evidenced native conversations", () => {
  const visited = { conversationId: "visited", assistantSelection: pickle, agentSettings: {}, runId: "", messageId: "" };
  const result = upgradeAssistantRoutingSession(session({}, [
    { conversationId: "one", assistantSelection: coder, providerConversationId: "deepseek-native" },
    { conversationId: "two", assistantSelection: planner, providerConversationId: "", nativeBindings: { opencode: visited } }
  ]));
  assert.equal(result.conversations[0].nativeBindings["codex/deepseek"].conversationId, "deepseek-native");
  assert.deepEqual(result.conversations[0].nativeBindings["codex/deepseek"].assistantSelection, coder);
  assert.deepEqual(result.conversations[1].nativeBindings, { opencode: visited });
  assert.equal(result.conversations[1].providerConversationId, "");
});

test("conflicting unfinished identities require recovery instead of guessing", () => {
  for (const metadata of [
    { assistant_routing: JSON.stringify({ mode: "auto", workflowEngineId: "opencode" }), assistant_routing_request: JSON.stringify(request()) },
    { assistant_routing_goal: JSON.stringify({ mode: "code", status: "active", selection: pickle }), assistant_routing_request: JSON.stringify(request()) },
    { assistant_routing_request: JSON.stringify(request({ assignments: { plan: planner, code: pickle, economy: helper } })) }
  ]) assert.throws(() => upgradeAssistantRoutingSession(session(metadata)), /conflicting/u);
  assert.throws(() => upgradeAssistantRoutingSession(session({}, [{ conversationId: "one", assistantSelection: planner,
    providerConversationId: "current", nativeBindings: { codex: { conversationId: "different", assistantSelection: planner } } }])), /conflicting native/u);
});

test("unsupported or corrupt routing is rejected without including stored content in the error", () => {
  for (const metadata of [
    { assistant_routing: '{"secret":"DO-NOT-LOG"' },
    { assistant_routing: '{"mode":"unknown"}' },
    { assistant_routing_request: JSON.stringify(request({ schemaVersion: 3 })) },
    { assistant_routing_request: JSON.stringify(request({ assignments: { plan: planner, code: coder } })) },
    { assistant_routing_request: JSON.stringify(request({ status: "unknown" })) },
    { assistant_routing_goal: '{"mode":"auto","selection":{}}' }
  ]) assert.throws(() => upgradeAssistantRoutingSession(session(metadata)), (error) => !error.message.includes("DO-NOT-LOG"));
  assert.deepEqual(upgradeAssistantRoutingSession({ sessionId: "never-used-ai", metadata: {}, conversations: [] }), { metadata: {}, conversations: [] });
});

test("pending renewal upgrades its captured destination without taking the predecessor's workflow", () => {
  const renewal = { kind: "vibe64.session_renewal", schemaVersion: 1, sessionId: "legacy", status: "running", stage: "successor_creating",
    approved: { text: "Exact reviewed handover" }, successor: { assistantSelection: pickle, attempt: 2 } };
  const input = { ...session({ assistant_selection: JSON.stringify(planner) }), renewal };
  const next = upgradeAssistantRoutingSession(input).renewal;
  assert.deepEqual(next.successor.assistantRouting, { mode: "code", review: false, override: pickle, workflowEngineId: "opencode" });
  assert.deepEqual(next.approved, renewal.approved);
  assert.equal(next.successor.attempt, 2);
  assert.equal(renewal.successor.assistantRouting, undefined);
  assert.equal(upgradeAssistantRoutingSession({ ...input, renewal: next }).renewal, undefined);
  assert.equal(upgradeAssistantRoutingSession({ ...input, renewal: { ...renewal, status: "completed" } }).renewal, undefined);
});
