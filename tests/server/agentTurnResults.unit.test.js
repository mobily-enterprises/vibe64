import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TURN_RESULT_MODE,
  agentTurnResultContract,
  validateAgentTurnResult
} from "@local/vibe64-runtime/server/agentTurnResults";

test("agent turn result validator accepts a complete provider control payload", () => {
  const contract = agentTurnResultContract({
    doneFields: {
      title: "Concise title."
    },
    readyPayload: {
      stepId: "define_work",
      stepStatus: "awaiting_agent_result"
    }
  });
  const parsed = validateAgentTurnResult({
    fields: {
      title: "Build the thing"
    },
    inputFields: [],
    kind: "ready",
    message: "",
    stepId: "define_work",
    stepStatus: "awaiting_agent_result"
  }, contract, {
    source: "codex"
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.input.fields.title, "Build the thing");
});

test("agent turn result validator rejects an incomplete ready result without invalidating an earlier question", () => {
  const contract = agentTurnResultContract({
    doneFields: {
      body: "Work body.",
      title: "Work title.",
      word: "Session word."
    },
    readyPayload: {
      stepId: "seed_application_defined",
      stepStatus: "awaiting_agent_result"
    }
  });
  const waiting = validateAgentTurnResult({
    fields: {},
    inputFields: [],
    kind: "waiting_for_input",
    message: "What should the app do?",
    stepId: "seed_application_defined",
    stepStatus: "awaiting_agent_result"
  }, contract);
  const incompleteSteer = validateAgentTurnResult({
    fields: {
      body: "",
      title: "",
      word: ""
    },
    inputFields: [],
    kind: "ready",
    message: "",
    stepId: "seed_application_defined",
    stepStatus: "awaiting_agent_result"
  }, contract);

  assert.equal(waiting.ok, true);
  assert.equal(incompleteSteer.ok, false);
  assert.match(incompleteSteer.error, /body, title, word/u);
});

test("agent turn result validator preserves private input field descriptors", () => {
  const contract = agentTurnResultContract({
    waitingPayload: {
      stepId: "execute_plan",
      stepStatus: "awaiting_agent_result"
    }
  });
  const parsed = validateAgentTurnResult({
    fields: {},
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
    stepId: "execute_plan",
    stepStatus: "awaiting_agent_result"
  }, contract, {
    source: "codex"
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.input.inputFields.length, 1);
  assert.equal(parsed.input.inputFields[0].kind, "password");
  assert.equal(parsed.input.inputFields[0].label, "Deployment API key");
  assert.equal(parsed.input.inputFields[0].name, "apiKey");
  assert.equal(parsed.input.inputFields[0].privacy, "private");
  assert.equal(parsed.input.inputFields[0].required, true);
  assert.equal(parsed.input.kind, "waiting_for_input");
  assert.equal(parsed.input.message, "I need the deployment API key.");
});

test("agent turn result contract is provider-neutral and has no transcript markers", () => {
  const contract = agentTurnResultContract({
    doneFields: {
      title: "Concise title."
    },
    waitingPayload: {
      kind: "waiting_for_input",
      message: "I need the API key.",
      stepId: "execute_plan",
      stepStatus: "awaiting_agent_result"
    }
  });
  const instruction = contract.instruction;

  assert.equal(contract.mode, AGENT_TURN_RESULT_MODE.STRUCTURED);
  assert.deepEqual(Object.keys(contract.fields), ["title"]);
  assert.deepEqual(contract.optionalFields, []);
  assert.equal(contract.stepId, "execute_plan");
  assert.equal(contract.stepStatus, "awaiting_agent_result");
  assert.match(instruction, /Every item needs `name`, `label`, `kind`, `privacy`, and `required`/u);
  assert.match(instruction, /Reply to the user normally/u);
  assert.match(instruction, /workflow-result control/u);
  assert.doesNotMatch(instruction, /VIBE64_AGENT_RESULT/u);
  assert.doesNotMatch(JSON.stringify(contract), /outputSchema/u);
});

test("agent turn result validator rejects stale workflow state", () => {
  const contract = agentTurnResultContract({
    readyPayload: {
      stepId: "current_step",
      stepStatus: "awaiting_agent_result"
    }
  });
  const parsed = validateAgentTurnResult({
    fields: {},
    inputFields: [],
    kind: "ready",
    message: "",
    stepId: "old_step",
    stepStatus: "awaiting_agent_result"
  }, contract);

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /old_step:awaiting_agent_result/u);
  assert.match(parsed.error, /current_step:awaiting_agent_result/u);
});

test("agent turn result validator rejects duplicate structured input names", () => {
  const contract = agentTurnResultContract({
    waitingPayload: {
      stepId: "execute_plan",
      stepStatus: "awaiting_agent_result"
    }
  });
  const parsed = validateAgentTurnResult({
    fields: {},
    inputFields: [
      {
        kind: "text",
        label: "First value",
        name: "value",
        privacy: "public",
        required: true
      },
      {
        kind: "text",
        label: "Second value",
        name: "value",
        privacy: "public",
        required: true
      }
    ],
    kind: "waiting_for_input",
    message: "I need a value.",
    stepId: "execute_plan",
    stepStatus: "awaiting_agent_result"
  }, contract);

  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /Duplicate Vibe64 input field: value/u);
});
