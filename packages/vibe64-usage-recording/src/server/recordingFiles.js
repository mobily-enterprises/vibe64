import path from "node:path";

import { USAGE_RECORDING_ID_PATTERN } from "../shared/contract.js";

// Recordings live beside the session, outside its source, and are deleted with
// it. A host's storage report and cleanup find them through this module.
const USAGE_RECORDINGS_DIRECTORY_NAME = "usage-recordings";

function usageRecordingsPath(session = {}) {
  const sessionRoot = String(session?.sessionRoot || "").trim();
  return sessionRoot ? path.join(sessionRoot, USAGE_RECORDINGS_DIRECTORY_NAME) : "";
}

function usageRecordingPath(session = {}, recordingId = "") {
  const recordingsPath = usageRecordingsPath(session);
  return recordingsPath && USAGE_RECORDING_ID_PATTERN.test(recordingId) ? path.join(recordingsPath, recordingId) : "";
}

export {
  USAGE_RECORDINGS_DIRECTORY_NAME,
  usageRecordingPath,
  usageRecordingsPath
};
