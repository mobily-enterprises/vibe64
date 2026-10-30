import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const text = (maxLength, extra = {}) => ({ type: "string", minLength: 1, maxLength, required: true, ...extra });
const optionalText = (maxLength) => ({ type: "string", maxLength, required: false });
const sessionId = text(256);
const recordingId = text(24, { pattern: "^rec_[a-z2-7]{20}$" });
const page = { cursor: optionalText(16), limit: { type: "integer", minimum: 1, maximum: 1500, required: false } };

// Reads need the session's read authority; starting, stopping and changing a
// recording are commands, with the authority of controlling its Preview.
const OPERATIONS = [
  ["targets.read", "readTargets", "query", {}],
  ["start", "start", "command", {
    targetId: text(200),
    parameters: { type: "object", additionalProperties: true, required: false }
  }],
  ["current.read", "readCurrent", "query", {}],
  ["stop", "stop", "command", { recordingId }],
  ["dismiss", "dismiss", "command", { recordingId }],
  ["list", "list", "query", {}],
  ["requests.read", "readRequests", "query", {
    recordingId, ...page, q: optionalText(200), includeEmpty: { type: "boolean", required: false }
  }],
  ["request-functions.read", "readRequestFunctions", "query", { recordingId, requestId: text(64), ...page }],
  ["interaction.record", "recordInteraction", "command", {
    recordingId,
    id: text(8, { pattern: "^i_[0-9]{4,6}$" }),
    at: text(40),
    label: text(80),
    componentFile: { type: "string", maxLength: 512, nullable: true, required: false }
  }],
  ["delete", "delete", "command", { recordingId }]
];

function createUsageRecordingActions({ usageRecording }) {
  return OPERATIONS.map(([operation, method, kind, fields]) => withVibe64ActionContext({
    id: `vibe64.usage-recording.${operation}`, version: 1, kind,
    input: { schema: createSchema({ sessionId, ...fields }), mode: "create" },
    output: null, idempotency: kind === "command" ? "optional" : "none",
    extensions: { assistant: { exclude: true } },
    execute: (input) => usageRecording[method](input)
  }));
}

export { createUsageRecordingActions };
