import {
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  normalizeWorkflowInputFields
} from "./workflowInputFields.js";

const AGENT_TURN_RESULT_MODE = Object.freeze({
  PLAIN: "plain",
  STRUCTURED: "structured"
});

function agentTurnPayloadInstruction(title = "", payload = {}) {
  const lines = [`- ${title} fields:`];
  for (const [name, value] of Object.entries(isPlainObject(payload) ? payload : {})) {
    if (name === "fields" && isPlainObject(value)) {
      for (const [fieldName, fieldValue] of Object.entries(value)) {
        lines.push(`  - fields.${normalizeText(fieldName)}: ${normalizeText(fieldValue) || "<value>"}`);
      }
      continue;
    }
    lines.push(`  - ${normalizeText(name)}: ${normalizeText(value) || "<value>"}`);
  }
  return lines;
}

function agentTurnResultContract({
  doneFields = {},
  doneMeaning = "The step is complete.",
  optionalDoneFields = [],
  readyPayload = {},
  waitingForInputMeaning = "You need more information from the user.",
  waitingPayload = {}
} = {}) {
  const ready = isPlainObject(readyPayload) ? readyPayload : {};
  const waiting = isPlainObject(waitingPayload) ? waitingPayload : {};
  const fields = isPlainObject(doneFields) ? doneFields : {};
  const optionalFields = (Array.isArray(optionalDoneFields) ? optionalDoneFields : [])
    .map((name) => normalizeText(name))
    .filter((name) => name && Object.hasOwn(fields, name));
  const stepId = normalizeText(ready.stepId || waiting.stepId || "{{session.currentStep}}");
  const stepStatus = normalizeText(ready.stepStatus || waiting.stepStatus || "{{session.stepMachine.status}}");
  return {
    fields,
    instruction: [
      "Vibe64 workflow result:",
      "- Reply to the user normally. Do not print JSON, transport metadata, or a duplicate answer.",
      "- Before the final response, submit the current workflow outcome through the provider's Vibe64 workflow-result control.",
      ...agentTurnPayloadInstruction("Ready", {
        ...ready,
        fields
      }),
      `- Meaning of ready: ${doneMeaning}`,
      "",
      ...agentTurnPayloadInstruction("Waiting", waiting),
      `- Meaning of waiting_for_input: ${waitingForInputMeaning}`,
      "- For waiting_for_input, keep `message` identical to the user-facing question in the normal response.",
      "- Use `inputFields` only for structured text, textarea, or password values. Every item needs `name`, `label`, `kind`, `privacy`, and `required`.",
      "- For a small fixed choice, ask in Markdown and list the exact choices; do not create inputFields.",
      "- Do not write Vibe64 workflow artifacts directly."
    ].join("\n"),
    mode: AGENT_TURN_RESULT_MODE.STRUCTURED,
    optionalFields,
    stepId,
    stepStatus
  };
}

function plainAgentTurnResultContract({
  instruction = ""
} = {}) {
  return {
    fields: {},
    instruction: normalizeText(instruction),
    mode: AGENT_TURN_RESULT_MODE.PLAIN,
    optionalFields: [],
    stepId: "",
    stepStatus: ""
  };
}

function normalizedAgentTurnResult(result = {}, {
  source = "agent"
} = {}) {
  if (!isPlainObject(result)) {
    return {
      error: "Vibe64 workflow result must be an object.",
      ok: false
    };
  }
  let inputFields = [];
  try {
    inputFields = normalizeWorkflowInputFields(result.inputFields, {
      duplicateCode: "vibe64_duplicate_agent_workflow_input_field",
      missingNameCode: "vibe64_agent_workflow_input_field_name_missing",
      ownerLabel: "Vibe64 agent workflow result"
    });
  } catch (error) {
    return {
      error: normalizeText(error?.message) || "Vibe64 workflow result contains invalid input fields.",
      ok: false
    };
  }
  const input = {
    fields: Object.fromEntries(Object.entries(isPlainObject(result.fields) ? result.fields : {}).map(([name, value]) => [
      normalizeText(name),
      normalizeText(value)
    ]).filter(([name]) => Boolean(name))),
    inputFields,
    kind: normalizeText(result.kind),
    message: normalizeText(result.message),
    source: normalizeText(source) || "agent",
    stepId: normalizeText(result.stepId),
    stepStatus: normalizeText(result.stepStatus),
    text: normalizeText(result.text)
  };
  if (!input.kind || !input.stepId || !input.stepStatus) {
    return {
      error: "Vibe64 agent result requires kind, stepId, and stepStatus.",
      ok: false
    };
  }
  return {
    input,
    ok: true
  };
}

function validateAgentTurnResult(result = {}, contract = null, {
  source = "agent"
} = {}) {
  const normalized = normalizedAgentTurnResult(result, {
    source
  });
  if (!normalized.ok) {
    return normalized;
  }
  const input = normalized.input;
  if (!isPlainObject(contract) || contract.mode !== AGENT_TURN_RESULT_MODE.STRUCTURED) {
    return {
      error: "The current Vibe64 turn does not accept a structured workflow result.",
      ok: false
    };
  }
  if (input.stepId !== normalizeText(contract.stepId) || input.stepStatus !== normalizeText(contract.stepStatus)) {
    return {
      error: `Vibe64 workflow result targets ${input.stepId}:${input.stepStatus}, but the active turn expects ${normalizeText(contract.stepId)}:${normalizeText(contract.stepStatus)}.`,
      ok: false
    };
  }
  if (input.kind === "waiting_for_input") {
    return input.message
      ? normalized
      : {
          error: "A waiting Vibe64 workflow result requires a user-facing message.",
          ok: false
        };
  }
  if (input.kind !== "ready") {
    return {
      error: `Unsupported Vibe64 workflow result kind: ${input.kind || "(missing)"}.`,
      ok: false
    };
  }
  const missingFields = Object.keys(isPlainObject(contract.fields) ? contract.fields : {})
    .filter((name) => !(Array.isArray(contract.optionalFields) ? contract.optionalFields : []).includes(name))
    .filter((name) => !normalizeText(input.fields[name]));
  return missingFields.length === 0
    ? normalized
    : {
        error: `A ready Vibe64 workflow result requires non-empty fields: ${missingFields.join(", ")}.`,
        ok: false
      };
}

export {
  AGENT_TURN_RESULT_MODE,
  agentTurnResultContract,
  plainAgentTurnResultContract,
  validateAgentTurnResult
};
