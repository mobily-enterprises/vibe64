import { isPlainObject } from "./core.js";
import { trimmedText as normalizedSessionUiSyncValue } from "./trimmedText.js";

const sessionUiSyncStates = new Map();

function cloneSessionUiSyncRecord(record = null) {
  return isPlainObject(record)
    ? JSON.parse(JSON.stringify(record))
    : null;
}

function sessionUiSyncStateKey(input = {}) {
  const projectSlug = normalizedSessionUiSyncValue(input?.projectSlug);
  const sessionId = normalizedSessionUiSyncValue(input?.sessionId);
  return projectSlug && sessionId ? `${projectSlug}\u0000${sessionId}` : "";
}

function readSessionUiSyncStateForSession(sessionId = "") {
  const normalizedSessionId = normalizedSessionUiSyncValue(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  const state = [...sessionUiSyncStates.values()].find(
    (record) => normalizedSessionUiSyncValue(record?.sessionId) === normalizedSessionId
  );
  return cloneSessionUiSyncRecord(state);
}

function writeSessionUiSyncPatch(input = {}, patch = {}) {
  const key = sessionUiSyncStateKey(input);
  if (!key || !isPlainObject(patch)) {
    return null;
  }
  const base = sessionUiSyncStates.get(key) || {
    projectSlug: normalizedSessionUiSyncValue(input.projectSlug),
    sessionId: normalizedSessionUiSyncValue(input.sessionId)
  };
  const next = {
    ...base,
    ...patch,
    projectSlug: normalizedSessionUiSyncValue(input.projectSlug),
    sessionId: normalizedSessionUiSyncValue(input.sessionId)
  };
  sessionUiSyncStates.set(key, next);
  return cloneSessionUiSyncRecord(next);
}

function writeSessionUiSyncPreviewState(previewState = {}) {
  const state = {
    originId: normalizedSessionUiSyncValue(previewState?.originId),
    projectSlug: normalizedSessionUiSyncValue(previewState?.projectSlug),
    route: normalizedSessionUiSyncValue(previewState?.route),
    sessionId: normalizedSessionUiSyncValue(previewState?.sessionId),
    title: normalizedSessionUiSyncValue(previewState?.title),
    updatedAt: normalizedSessionUiSyncValue(previewState?.updatedAt) || new Date().toISOString()
  };
  if (!state.originId || !state.projectSlug || !state.route || !state.sessionId) {
    return null;
  }
  return writeSessionUiSyncPatch(state, {
    preview: state
  });
}

function clearSessionUiSyncState() {
  sessionUiSyncStates.clear();
}

export {
  clearSessionUiSyncState,
  readSessionUiSyncStateForSession,
  writeSessionUiSyncPreviewState
};
