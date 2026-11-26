import assert from "node:assert/strict";
import test from "node:test";
import { __testables as requestTestables } from "../../packages/vibe64-execution/src/server/request.js";
import { managedExecutionDescription } from "../../packages/vibe64-execution/src/host/managedExecution.js";
import { claudeAiPurpose } from "../../packages/vibe64-terminals/src/server/claudeConversationEnvironment.js";

const { normalizeExecutionDescriptor } = requestTestables;

test("an AI run's purpose rides on its execution record, and a malformed one is refused", () => {
  const descriptor = (aiPurpose) => normalizeExecutionDescriptor(
    { kind: "assistant", lifecycle: "service", ownerId: "session-1", aiPurpose },
    { mode: "detached" }
  );
  assert.equal(descriptor("agent-turn").aiPurpose, "agent-turn");
  assert.equal(descriptor("helper:prompt_hint").aiPurpose, "helper:prompt_hint");
  assert.equal(descriptor("helper:shared").aiPurpose, "helper:shared");
  assert.equal(Object.hasOwn(descriptor(undefined), "aiPurpose"), false);
  for (const malformed of ["helper", "helper:", "turn", "helper:Prompt Hint", "agent-turn\n", 7]) {
    assert.throws(() => descriptor(malformed), { code: "vibe64_execution_ai_purpose_invalid" }, String(malformed));
  }
});

test("a Claude process names its purpose: a chat's agent turn, a helper's workload, or a helper scope's feature", () => {
  assert.equal(claudeAiPurpose(null, {}), "agent-turn");
  assert.equal(claudeAiPurpose({ workloadId: "prompt_hint" }, { assistantScope: { id: "hints_0b4c" } }), "helper:prompt_hint");
  assert.equal(claudeAiPurpose(null, { assistantScope: { id: "naming_0b4c" } }), "helper:naming");
  assert.equal(claudeAiPurpose(null, { assistantScope: { id: "" } }), "helper:shared");
});

test("an AI run's unit description names its purpose, and the helper refuses a malformed one", () => {
  assert.equal(managedExecutionDescription("job", undefined), "Vibe64 job execution");
  assert.equal(managedExecutionDescription("assistant", "agent-turn"), "Vibe64 assistant execution (agent-turn)");
  assert.equal(managedExecutionDescription("assistant", "helper:prompt_hint"), "Vibe64 assistant execution (helper:prompt_hint)");
  assert.throws(() => managedExecutionDescription("assistant", "helper:x\nExecStart=/bin/sh"), /invalid AI run purpose/u);
});
