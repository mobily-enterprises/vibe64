import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
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
    Object.freeze({
      id: "vibe64.usage-recording.targets.read",
      version: 1,
      kind: "query",
      input: { schema: createSchema({ sessionId }), mode: "create" },
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readTargets(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.start",
      version: 1,
      kind: "command",
      input: {
        schema: createSchema({
          sessionId,
          targetId: text(200),
          parameters: { type: "object", additionalProperties: true, required: false }
        }),
        mode: "create"
      },
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.start(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.current.read",
      version: 1,
      kind: "query",
      input: { schema: createSchema({ sessionId }), mode: "create" },
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readCurrent(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.stop",
      version: 1,
      kind: "command",
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.stop(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.dismiss",
      version: 1,
      kind: "command",
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.dismiss(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.list",
      version: 1,
      kind: "query",
      input: { schema: createSchema({ sessionId }), mode: "create" },
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.list(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.requests.read",
      version: 1,
      kind: "query",
      input: {
        schema: createSchema({
          sessionId,
          recordingId,
          ...page,
          q: optionalText(200),
          includeEmpty: { type: "boolean", required: false },
          order: { type: "string", enum: ["oldest", "newest"], required: false },
          requestId: optionalText(64)
        }),
        mode: "create"
      },
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readRequests(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.request-functions.read",
      version: 1,
      kind: "query",
      input: { schema: createSchema({ sessionId, recordingId, requestId: text(64), ...page }), mode: "create" },
      output: null,
      idempotency: "none",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readRequestFunctions(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.interaction.record",
      version: 1,
      kind: "command",
      input: {
        schema: createSchema({
          sessionId,
          recordingId,
          id: text(8, { pattern: "^i_[0-9]{4,6}$" }),
          at: text(40),
          label: text(80),
          kind: { type: "string", enum: [...USAGE_INTERACTION_KINDS], required: false },
          componentFile: { type: "string", maxLength: 512, nullable: true, required: false }
        }),
        mode: "create"
      },
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.recordInteraction(input)
    }),
    Object.freeze({
      id: "vibe64.usage-recording.delete",
      version: 1,
      kind: "command",
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      output: null,
      idempotency: "optional",
      extensions: { assistant: { exclude: true }, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.delete(input)
    })
  ]);
}

export { createUsageRecordingActions };
