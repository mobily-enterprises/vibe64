import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TURN_RESULT_BEGIN,
  AGENT_TURN_RESULT_END,
  AGENT_TURN_RESULT_SCHEMA,
  agentTurnResultInstruction,
  parseAgentTurnResultEnvelope,
  stripAgentTurnResultEnvelope
} from "@local/vibe64-runtime/server/agentTurnResults";

test("agent turn result parser accepts the marked JSON envelope", () => {
  const text = [
    "Done.",
    AGENT_TURN_RESULT_BEGIN,
    JSON.stringify({
      fields: {
        response: "Done."
      },
      kind: "ready",
      schema: AGENT_TURN_RESULT_SCHEMA,
      stepId: "maintenance_conversation",
      stepStatus: "awaiting_agent_result"
    }),
    AGENT_TURN_RESULT_END
  ].join("\n");

  const parsed = parseAgentTurnResultEnvelope(text, {
    source: "codex"
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.input, {
    fields: {
      response: "Done."
    },
    inputFields: [],
    kind: "ready",
    message: "",
    source: "codex",
    stepId: "maintenance_conversation",
    stepStatus: "awaiting_agent_result",
    text: ""
  });
  assert.equal(parsed.visibleText, "Done.");
  assert.equal(stripAgentTurnResultEnvelope(text), "Done.");
});

test("agent turn result parser preserves structured private input field descriptors", () => {
  const text = [
    "I need the deployment API key.",
    AGENT_TURN_RESULT_BEGIN,
    JSON.stringify({
      inputFields: [
        {
          kind: "password",
          label: "Deployment API key",
          name: "apiKey",
          privacy: "private",
          required: true
        }
      ],
      kind: "waiting_for_input",
      message: "I need the deployment API key.",
      schema: AGENT_TURN_RESULT_SCHEMA,
      stepId: "execute_plan",
      stepStatus: "awaiting_agent_result"
    }),
    AGENT_TURN_RESULT_END
  ].join("\n");

  const parsed = parseAgentTurnResultEnvelope(text, {
    source: "codex"
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.input.inputFields, [
    {
      kind: "password",
      label: "Deployment API key",
      name: "apiKey",
      privacy: "private",
      required: true
    }
  ]);
  assert.equal(parsed.input.kind, "waiting_for_input");
  assert.equal(parsed.input.message, "I need the deployment API key.");
});

test("agent turn result instruction requires input field names", () => {
  const instruction = agentTurnResultInstruction({
    waitingPayload: {
      kind: "waiting_for_input",
      message: "I need the API key.",
      stepId: "execute_plan",
      stepStatus: "awaiting_agent_result"
    }
  });

  assert.match(instruction, /Every input field object must include a non-empty `name` property/u);
  assert.match(instruction, /Do not use `id`/u);
  assert.match(instruction, /"name": "fieldName"/u);
  assert.match(instruction, /"name": "apiKey"/u);
  assert.match(instruction, /"kind": "password"/u);
  assert.match(instruction, /"privacy": "private"/u);
  assert.match(instruction, /Possible answers:/u);
  assert.match(instruction, /Do not use `inputFields` for simple answer choices/u);
  assert.doesNotMatch(instruction, /submitOnSelect/u);
});

test("agent turn result parser rejects missing or stale schemas", () => {
  assert.deepEqual(parseAgentTurnResultEnvelope("plain assistant text"), {
    error: "Missing Vibe64 agent result envelope.",
    ok: false
  });

  const parsed = parseAgentTurnResultEnvelope([
    AGENT_TURN_RESULT_BEGIN,
    JSON.stringify({
      kind: "ready",
      schema: "old",
      stepId: "step",
      stepStatus: "awaiting_agent_result"
    }),
    AGENT_TURN_RESULT_END
  ].join("\n"));

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /Unsupported Vibe64 agent result schema/u);
});
