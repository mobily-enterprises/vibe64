// A host composition may provide this token to refuse a recording, for example
// when resources are low. Start calls it before launching anything and shows a
// refusal's reason verbatim.
const USAGE_RECORDING_ADMISSION_TOKEN = "vibe64.usage-recording.admission";

/**
 * The decision Start asks for before launching a recording.
 * @typedef {(request: {
 *   sessionId: string,
 *   projectSlug: string,
 *   targetKind: string,
 *   runtimes: string[]
 * }) => Promise<{ admitted: true } | { admitted: false, reason: string }>} UsageRecordingAdmission
 */

/**
 * The admission used when no host supplies one: every recording is admitted.
 * @type {UsageRecordingAdmission}
 */
async function admitUsageRecording() {
  return { admitted: true };
}

/**
 * Refuses a host admission that is not a function. A missing one is null.
 * @param {UsageRecordingAdmission | null} admission
 */
function assertUsageRecordingAdmission(admission) {
  if (admission && typeof admission !== "function") {
    throw new TypeError("Vibe64 usage recording admission must be a function or null.");
  }
}

export {
  USAGE_RECORDING_ADMISSION_TOKEN,
  admitUsageRecording,
  assertUsageRecordingAdmission
};
