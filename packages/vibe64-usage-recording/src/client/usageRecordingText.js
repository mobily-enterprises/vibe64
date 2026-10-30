import { USAGE_RECORDING_LIMITS } from "../shared/contract.js";

const STOPPED = Object.freeze({
  person: "Stopped manually",
  "time-limit": `Stopped after ${USAGE_RECORDING_LIMITS.durationMs / 60_000} minutes`,
  "request-limit": `Stopped at ${USAGE_RECORDING_LIMITS.capturedRequests.toLocaleString("en-US")} requests`,
  "size-limit": "Stopped at its size limit",
  "target-exited": "Stopped when the command finished",
  "session-ended": "Stopped when the session ended",
  error: "Stopped after an error"
});

// Every failed tracer carries the same reason.
function usageRecordingFailure(recording) {
  return (recording?.tracers || []).find((tracer) => tracer?.reason)?.reason || "The recording could not start.";
}

// How a finished recording ended, in plain words; "" while it runs.
function usageRecordingEnd(recording) {
  if (["failed", "unavailable"].includes(recording?.state)) return `Failed: ${usageRecordingFailure(recording)}`;
  return recording?.state === "stopped" ? STOPPED[recording.stopReason] || "Stopped" : "";
}

export {
  usageRecordingEnd,
  usageRecordingFailure
};
