import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TURN_RESULT_BEGIN,
  AGENT_TURN_RESULT_END,
  AGENT_TURN_RESULT_SCHEMA,
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
