import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

import { USAGE_INTERACTION_KINDS } from "../shared/contract.js";

/** @typedef {import("./types.js").UsageRecordingService} UsageRecordingService */

const ACTION_USAGE_RECORDING_TARGETS_READ = "vibe64.usage-recording.targets.read";
const ACTION_USAGE_RECORDING_START = "vibe64.usage-recording.start";
const ACTION_USAGE_RECORDING_CURRENT_READ = "vibe64.usage-recording.current.read";
const ACTION_USAGE_RECORDING_STOP = "vibe64.usage-recording.stop";
const ACTION_USAGE_RECORDING_DISMISS = "vibe64.usage-recording.dismiss";
const ACTION_USAGE_RECORDING_LIST = "vibe64.usage-recording.list";
const ACTION_USAGE_RECORDING_REQUESTS_READ = "vibe64.usage-recording.requests.read";
const ACTION_USAGE_RECORDING_REQUEST_FUNCTIONS_READ = "vibe64.usage-recording.request-functions.read";
const ACTION_USAGE_RECORDING_INTERACTION_FUNCTIONS_READ = "vibe64.usage-recording.interaction-functions.read";
const ACTION_USAGE_RECORDING_INTERACTION_RECORD = "vibe64.usage-recording.interaction.record";
const ACTION_USAGE_RECORDING_DELETE = "vibe64.usage-recording.delete";

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
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_TARGETS_READ,
      input: { schema: createSchema({ sessionId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readTargets(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_USAGE_RECORDING_START,
      input: {
        schema: createSchema({
          sessionId,
          targetId: text(200),
          parameters: { type: "object", additionalProperties: true, required: false }
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.start(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_CURRENT_READ,
      input: { schema: createSchema({ sessionId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readCurrent(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_USAGE_RECORDING_STOP,
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.stop(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_USAGE_RECORDING_DISMISS,
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.dismiss(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_LIST,
      input: { schema: createSchema({ sessionId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.list(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_REQUESTS_READ,
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
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readRequests(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_REQUEST_FUNCTIONS_READ,
      input: {
        schema: createSchema({
          sessionId,
          recordingId,
          requestId: text(64),
          ...page
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readRequestFunctions(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_USAGE_RECORDING_INTERACTION_FUNCTIONS_READ,
      input: {
        schema: createSchema({
          sessionId,
          recordingId,
          interactionId: text(64),
          ...page
        }),
        mode: "create"
      },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.readInteractionFunctions(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_USAGE_RECORDING_INTERACTION_RECORD,
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
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.recordInteraction(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_USAGE_RECORDING_DELETE,
      input: { schema: createSchema({ sessionId, recordingId }), mode: "create" },
      extensions: { ...NOT_A_TOOL, vibe64: PROJECT_OPERATION },
      execute: (input) => usageRecording.delete(input)
    })
  ]);
}

export {
  ACTION_USAGE_RECORDING_CURRENT_READ,
  ACTION_USAGE_RECORDING_DELETE,
  ACTION_USAGE_RECORDING_DISMISS,
  ACTION_USAGE_RECORDING_INTERACTION_FUNCTIONS_READ,
  ACTION_USAGE_RECORDING_INTERACTION_RECORD,
  ACTION_USAGE_RECORDING_LIST,
  ACTION_USAGE_RECORDING_REQUESTS_READ,
  ACTION_USAGE_RECORDING_REQUEST_FUNCTIONS_READ,
  ACTION_USAGE_RECORDING_START,
  ACTION_USAGE_RECORDING_STOP,
  ACTION_USAGE_RECORDING_TARGETS_READ,
  createUsageRecordingActions
};
