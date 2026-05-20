import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";

const AUTOPILOT_STEP_DONE_MARKER_START = "[[AI_STUDIO_AUTOPILOT_STEP_DONE_V1]]";
const AUTOPILOT_STEP_DONE_MARKER_END = "[[/AI_STUDIO_AUTOPILOT_STEP_DONE_V1]]";
const STEP_MARKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function normalizeMarkerId(value = "") {
  return String(value || "").replace(/\s+/gu, "").trim();
}

function normalizeStepMarkerText(value = "") {
  return stripTerminalControlSequences(value)
    .replace(/\r\n?/gu, "\n");
}

function normalizeStepDonePayload(value = {}) {
  const actionId = normalizeMarkerId(value.actionId);
  const requestId = normalizeMarkerId(value.requestId);
  const stepId = normalizeMarkerId(value.stepId);
  if (
    !STEP_MARKER_ID_PATTERN.test(actionId) ||
    !STEP_MARKER_ID_PATTERN.test(requestId) ||
    !STEP_MARKER_ID_PATTERN.test(stepId)
  ) {
    return null;
  }
  return {
    actionId,
    requestId,
    stepId
  };
}

function markerObjectText(blockText = "") {
  const source = String(blockText || "").trim();
  const objectStart = source.indexOf("{");
  const objectEnd = source.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    return source;
  }
  return source.slice(objectStart, objectEnd + 1);
}

function readJsonStringField(source = "", fieldName = "") {
  const match = String(source || "").match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, "u"));
  return match?.[1] || "";
}

function parseStepDoneMarkerBlock(blockText = "") {
  const source = markerObjectText(blockText);
  try {
    return normalizeStepDonePayload(JSON.parse(source));
  } catch {
    return normalizeStepDonePayload({
      actionId: readJsonStringField(source, "actionId"),
      requestId: readJsonStringField(source, "requestId"),
      stepId: readJsonStringField(source, "stepId")
    });
  }
}

function stepDoneMarkerRecords(output = "") {
  const source = normalizeStepMarkerText(output);
  const records = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(AUTOPILOT_STEP_DONE_MARKER_START, cursor);
    if (start < 0) {
      return records;
    }

    const contentStart = start + AUTOPILOT_STEP_DONE_MARKER_START.length;
    const end = source.indexOf(AUTOPILOT_STEP_DONE_MARKER_END, contentStart);
    if (end < 0) {
      return records;
    }
    const nestedStart = source.indexOf(AUTOPILOT_STEP_DONE_MARKER_START, contentStart);
    if (nestedStart >= 0 && nestedStart < end) {
      cursor = nestedStart;
      continue;
    }

    const marker = parseStepDoneMarkerBlock(source.slice(contentStart, end));
    if (marker) {
      records.push({
        marker,
        start
      });
    }
    cursor = end + AUTOPILOT_STEP_DONE_MARKER_END.length;
  }
  return records;
}

function latestStepDoneMarker(output = "", {
  actionId = "",
  requestId = "",
  stepId = ""
} = {}) {
  const expectedActionId = String(actionId || "").trim();
  const expectedRequestId = String(requestId || "").trim();
  const expectedStepId = String(stepId || "").trim();
  return stepDoneMarkerRecords(output)
    .filter((record) => !expectedActionId || record.marker.actionId === expectedActionId)
    .filter((record) => !expectedRequestId || record.marker.requestId === expectedRequestId)
    .filter((record) => !expectedStepId || record.marker.stepId === expectedStepId)
    .sort((left, right) => left.start - right.start)
    .at(-1)?.marker || null;
}

function stepDoneMarkerInstruction({
  actionId = "",
  requestId = "",
  stepId = ""
} = {}) {
  const payload = {
    actionId: String(actionId || "").trim(),
    requestId: String(requestId || "").trim(),
    stepId: String(stepId || "").trim()
  };
  return [
    "AI Studio Autopilot completion contract:",
    "When this workflow action is fully complete, append exactly this marker block as the final output.",
    "Do not emit the marker until all work, checks, and final reporting for this action are complete.",
    "Do not write any prose after the closing marker.",
    AUTOPILOT_STEP_DONE_MARKER_START,
    JSON.stringify(payload, null, 2),
    AUTOPILOT_STEP_DONE_MARKER_END
  ].join("\n");
}

export {
  AUTOPILOT_STEP_DONE_MARKER_END,
  AUTOPILOT_STEP_DONE_MARKER_START,
  latestStepDoneMarker,
  stepDoneMarkerInstruction
};
