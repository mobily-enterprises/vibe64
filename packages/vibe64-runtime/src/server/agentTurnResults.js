const AGENT_TURN_RESULT_SCHEMA = "vibe64.agent.turn_result.v1";
const AGENT_TURN_RESULT_BEGIN = "VIBE64_AGENT_RESULT_BEGIN";
const AGENT_TURN_RESULT_END = "VIBE64_AGENT_RESULT_END";

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

function agentTurnPayloadInstruction(title = "", payload = {}) {
  const lines = [`- ${title} payload fields:`];
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

function agentTurnResultEnvelopeExample(payload = {}) {
  return [
    AGENT_TURN_RESULT_BEGIN,
    stableJson({
      schema: AGENT_TURN_RESULT_SCHEMA,
      ...payload
    }),
    AGENT_TURN_RESULT_END
  ].join("\n");
}

function agentTurnResultInstruction({
  doneFields = {},
  doneMeaning = "The step is complete.",
  readyPayload = {},
  waitingForInputMeaning = "You need more information from the user.",
  waitingPayload = {}
} = {}) {
  const ready = isPlainObject(readyPayload) ? readyPayload : {};
  const waiting = isPlainObject(waitingPayload) ? waitingPayload : {};
  return [
    "Vibe64 agent result contract:",
    "- Do not write Vibe64 workflow artifacts directly for this step.",
    "- Write the normal user-facing response first so it is readable in the terminal.",
    "- Finish the turn with exactly one Vibe64 result envelope after the user-facing response.",
    "- Vibe64 reads the envelope from the provider transcript and advances workflow state server-side.",
    "- When the ready payload includes `fields.response`, keep the visible response text and `fields.response` equivalent.",
    "- The envelope must be plain text with these markers on their own lines:",
    agentTurnResultEnvelopeExample({
      fields: doneFields,
      kind: "ready",
      stepId: ready.stepId || "{{session.currentStep}}",
      stepStatus: ready.stepStatus || "{{session.stepMachine.status}}"
    }),
    "- Build the JSON object from the relevant payload fields below.",
    ...agentTurnPayloadInstruction("Ready", ready),
    "- Include any additional `fields` explicitly requested by this prompt.",
    `- Meaning of ready: ${doneMeaning}`,
    "",
    "- If you need user input before this step can continue, use the waiting payload instead.",
    ...agentTurnPayloadInstruction("Waiting", waiting),
    `- Meaning of waiting_for_input: ${waitingForInputMeaning}`,
    "- Optional waiting `inputFields`: include this array only when the answer needs structured fields instead of the default message box.",
    "- Every input field object must include a non-empty `name` property. Do not use `id`; Vibe64 rejects input fields without `name`.",
    "- Input field shape: `{ \"name\": \"fieldName\", \"label\": \"Field label\", \"kind\": \"text\" }`. Supported `kind` values are `text`, `textarea`, and `password`.",
    "- For one small fixed-choice answer, keep the question as normal visible text and add a `Possible answers:` block with bullet choices like `- Button label: exact answer text to submit`. Do not use `inputFields` for simple answer choices.",
    "- To ask for credentials, API keys, tokens, or other secrets, include an input field such as `{ \"name\": \"apiKey\", \"label\": \"API key\", \"kind\": \"password\", \"privacy\": \"private\" }`; ask for the value in the visible question but never include private values in later prompt text.",
    "- Before the envelope, write the same question or blocker in normal response text so users can read it directly.",
    "- Keep the visible question text and the envelope `message` equivalent.",
    "",
    "After the envelope, stop. Do not write workflow artifacts directly for this step."
  ].join("\n");
}

function envelopeBounds(text = "") {
  const source = String(text ?? "");
  const beginIndex = source.lastIndexOf(AGENT_TURN_RESULT_BEGIN);
  if (beginIndex < 0) {
    return null;
  }
  const jsonStart = beginIndex + AGENT_TURN_RESULT_BEGIN.length;
  const endIndex = source.indexOf(AGENT_TURN_RESULT_END, jsonStart);
  if (endIndex < 0) {
    return null;
  }
  return {
    beginIndex,
    endIndex,
    json: source.slice(jsonStart, endIndex).trim(),
    source
  };
}

function stripAgentTurnResultEnvelope(text = "") {
  const bounds = envelopeBounds(text);
  if (!bounds) {
    return String(text ?? "").trim();
  }
  return [
    bounds.source.slice(0, bounds.beginIndex),
    bounds.source.slice(bounds.endIndex + AGENT_TURN_RESULT_END.length)
  ].join("").trim();
}

function parseAgentTurnResultEnvelope(text = "", {
  source = "agent"
} = {}) {
  const bounds = envelopeBounds(text);
  if (!bounds) {
    return {
      ok: false,
      error: "Missing Vibe64 agent result envelope."
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(bounds.json);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid Vibe64 agent result JSON: ${error.message}`
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: "Vibe64 agent result envelope must contain one JSON object."
    };
  }
  if (parsed.schema !== AGENT_TURN_RESULT_SCHEMA) {
    return {
      ok: false,
      error: `Unsupported Vibe64 agent result schema: ${normalizeText(parsed.schema) || "(missing)"}`
    };
  }
  const kind = normalizeText(parsed.kind);
  const input = {
    fields: isPlainObject(parsed.fields) ? parsed.fields : {},
    inputFields: Array.isArray(parsed.inputFields) ? parsed.inputFields : [],
    kind,
    message: normalizeText(parsed.message),
    source: normalizeText(source) || "agent",
    stepId: normalizeText(parsed.stepId),
    stepStatus: normalizeText(parsed.stepStatus),
    text: normalizeText(parsed.text)
  };
  if (!input.kind || !input.stepId || !input.stepStatus) {
    return {
      ok: false,
      error: "Vibe64 agent result envelope requires kind, stepId, and stepStatus."
    };
  }
  return {
    envelope: parsed,
    input,
    ok: true,
    visibleText: stripAgentTurnResultEnvelope(text)
  };
}

export {
  AGENT_TURN_RESULT_BEGIN,
  AGENT_TURN_RESULT_END,
  AGENT_TURN_RESULT_SCHEMA,
  agentTurnResultEnvelopeExample,
  agentTurnResultInstruction,
  parseAgentTurnResultEnvelope,
  stripAgentTurnResultEnvelope
};
