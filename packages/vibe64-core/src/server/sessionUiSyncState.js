import { isPlainObject } from "./core.js";
import { trimmedText } from "../shared/trimmedText.js";

const sessionUiSyncStates = new Map();

function cloneSessionUiSyncRecord(record = null) {
  return isPlainObject(record)
    ? JSON.parse(JSON.stringify(record))
    : null;
}

function sessionUiSyncStateKey(input = {}) {
  const projectSlug = trimmedText(input?.projectSlug);
  const sessionId = trimmedText(input?.sessionId);
  return projectSlug && sessionId ? `${projectSlug}\u0000${sessionId}` : "";
}

function readSessionUiSyncStateForSession(sessionId = "") {
  const normalizedSessionId = trimmedText(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  const state = [...sessionUiSyncStates.values()].find(
    (record) => trimmedText(record?.sessionId) === normalizedSessionId
  );
  return cloneSessionUiSyncRecord(state);
}

function writeSessionUiSyncPatch(input = {}, patch = {}) {
  const key = sessionUiSyncStateKey(input);
  if (!key || !isPlainObject(patch)) {
    return null;
  }
  const base = sessionUiSyncStates.get(key) || {
    projectSlug: trimmedText(input.projectSlug),
    sessionId: trimmedText(input.sessionId)
  };
  const next = {
    ...base,
    ...patch,
    projectSlug: trimmedText(input.projectSlug),
    sessionId: trimmedText(input.sessionId)
  };
  sessionUiSyncStates.set(key, next);
  return cloneSessionUiSyncRecord(next);
}

function writeSessionUiSyncPreviewState(previewState = {}) {
  const state = {
    originId: trimmedText(previewState?.originId),
    projectSlug: trimmedText(previewState?.projectSlug),
    route: trimmedText(previewState?.route),
    sessionId: trimmedText(previewState?.sessionId),
    title: trimmedText(previewState?.title),
    updatedAt: trimmedText(previewState?.updatedAt) || new Date().toISOString()
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
