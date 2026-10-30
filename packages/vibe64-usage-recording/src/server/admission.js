// A host composition may provide this token to refuse a recording, for example
// when resources are low. Start calls it before launching anything and shows a
// refusal's reason verbatim.
const USAGE_RECORDING_ADMISSION_TOKEN = "vibe64.usage-recording.admission";

// async ({ sessionId, projectSlug, targetKind, runtimes })
//   → { admitted: true } | { admitted: false, reason }
async function admitUsageRecording() {
  return { admitted: true };
}

export {
  USAGE_RECORDING_ADMISSION_TOKEN,
  admitUsageRecording
};
