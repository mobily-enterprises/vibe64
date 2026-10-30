// The recordings running in this server process, one per session at most.
// The recording service registers each one; the Output target launcher asks it
// for the recorder of a launch, and the Preview proxy asks it whether to number
// and log a request. Neither of those knows anything else about recording.
//
// An entry provides:
//   launch({ outputTargetId, web, runtimes, sourceRoot, environment })
//     → null when this launch is not the recorded target, else
//       { environment, usageRecordingPreload, exited(event) }
//   web: true when the recorded target is the session's Preview
//   proxyRequest({ method, path, interaction }) → { requestId, interaction, finish({ status }) } | null
//   recordingId
//   stop(reason) → Promise
const active = new Map();

const entryKey = (projectScope = "", sessionId = "") => `${String(projectScope)}\n${String(sessionId)}`;

function registerActiveUsageRecording(projectScope, sessionId, entry) {
  const key = entryKey(projectScope, sessionId);
  active.set(key, entry);
  return () => {
    if (active.get(key) === entry) active.delete(key);
  };
}

function activeUsageRecording(projectScope, sessionId) {
  return active.get(entryKey(projectScope, sessionId)) || null;
}

// A session that closes ends its recording.
async function stopActiveUsageRecording(projectScope, sessionId, reason = "session-ended") {
  await activeUsageRecording(projectScope, sessionId)?.stop(reason);
}

export {
  activeUsageRecording,
  registerActiveUsageRecording,
  stopActiveUsageRecording
};
