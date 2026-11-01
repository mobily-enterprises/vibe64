// The recordings running in this server process, one per session at most.
// The recording service registers each one; the Output target launcher asks it
// for the recorder of a launch, and the Preview proxy asks it whether to number
// and log a request. Neither of those knows anything else about recording.

/**
 * One running recording, as the launcher and the Preview proxy see it.
 * @typedef {object} ActiveUsageRecording
 * @property {string} recordingId
 * @property {boolean} web True when the recorded target is the session's Preview.
 * @property {(launch: { outputTargetId?: string, web?: boolean, environment?: object })
 *   => ({ environment: object, usageRecordingPreload: string, exited: () => void } | null)} launch
 *   The recorder for a launch; null when the launch is not the recorded target.
 * @property {(request: { method?: string, path?: string, interaction?: string, fetchDest?: string })
 *   => ({ requestId: string, interaction: string | null, finish: (response: { status?: number | null }) => void } | null)} proxyRequest
 *   The request's number and log; null when the request is not logged.
 * @property {(reason: string) => Promise<void>} stop
 */

/** @type {Map<string, ActiveUsageRecording>} */
const active = new Map();

const entryKey = (projectScope = "", sessionId = "") => `${String(projectScope)}\n${String(sessionId)}`;

/**
 * @param {string} projectScope
 * @param {string} sessionId
 * @param {ActiveUsageRecording} entry
 */
// readable-check: allow module-registry - cycle: vibe64.usage-recording requires vibe64.terminals, whose launcher and Preview proxy read these recordings
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

/**
 * A session that closes ends its recording.
 */
async function stopActiveUsageRecording(projectScope, sessionId, reason = "session-ended") {
  await activeUsageRecording(projectScope, sessionId)?.stop(reason);
}

export {
  activeUsageRecording,
  registerActiveUsageRecording,
  stopActiveUsageRecording
};
