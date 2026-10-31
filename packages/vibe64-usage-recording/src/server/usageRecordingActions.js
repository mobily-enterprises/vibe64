import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { USAGE_INTERACTION_KINDS } from "../shared/contract.js";

/** @typedef {import("./types.js").UsageRecordingService} UsageRecordingService */

const text = (maxLength, extra = {}) => ({ type: "string", minLength: 1, maxLength, required: true, ...extra });
const optionalText = (maxLength) => ({ type: "string", maxLength, required: false });
const sessionId = text(256);
const recordingId = text(24, { pattern: "^rec_[a-z2-7]{20}$" });
const page = { cursor: optionalText(16), limit: { type: "integer", minimum: 1, maximum: 1500, required: false } };

/**
 * Reads need the session's read authority; starting, stopping and changing a
 * recording are commands, with the authority of controlling its Preview.
 * @param {object} dependencies
 * @param {UsageRecordingService} dependencies.usageRecording
 */
function createUsageRecordingActions({ usageRecording }) {
  return Object.freeze([
    ["targets.read", "query", (input) => usageRecording.readTargets(input), {}],
    ["start", "command", (input) => usageRecording.start(input), {
      targetId: text(200),
      parameters: { type: "object", additionalProperties: true, required: false }
    }],
    ["current.read", "query", (input) => usageRecording.readCurrent(input), {}],
    ["stop", "command", (input) => usageRecording.stop(input), { recordingId }],
    ["dismiss", "command", (input) => usageRecording.dismiss(input), { recordingId }],
    ["list", "query", (input) => usageRecording.list(input), {}],
    ["requests.read", "query", (input) => usageRecording.readRequests(input), {
      recordingId, ...page, q: optionalText(200), includeEmpty: { type: "boolean", required: false },
      order: { type: "string", enum: ["oldest", "newest"], required: false }, requestId: optionalText(64)
    }],
    ["request-functions.read", "query", (input) => usageRecording.readRequestFunctions(input), { recordingId, requestId: text(64), ...page }],
    ["interaction.record", "command", (input) => usageRecording.recordInteraction(input), {
      recordingId,
      id: text(8, { pattern: "^i_[0-9]{4,6}$" }),
      at: text(40),
      label: text(80),
      kind: { type: "string", enum: [...USAGE_INTERACTION_KINDS], required: false },
      componentFile: { type: "string", maxLength: 512, nullable: true, required: false }
    }],
    ["delete", "command", (input) => usageRecording.delete(input), { recordingId }]
  ].map(([operation, kind, execute, fields]) => withVibe64ActionContext({
    id: `vibe64.usage-recording.${operation}`, version: 1, kind,
    input: { schema: createSchema({ sessionId, ...fields }), mode: "create" },
    output: null, idempotency: kind === "command" ? "optional" : "none",
    extensions: { assistant: { exclude: true } },
    execute
  })));
}

export { createUsageRecordingActions };
