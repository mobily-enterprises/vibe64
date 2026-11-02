import { isPlainObject } from "./core.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const sessionUiSyncStates = new Map();

function cloneSessionUiSyncRecord(record = null) {
  return isPlainObject(record)
    ? JSON.parse(JSON.stringify(record))
    : null;
}

function sessionUiSyncStateKey(input) {
  const projectSlug = normalizeText(input?.projectSlug);
  const sessionId = normalizeText(input?.sessionId);
  return projectSlug && sessionId ? `${projectSlug}\u0000${sessionId}` : "";
}

function readSessionUiSyncStateForSession(sessionId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  const state = [...sessionUiSyncStates.values()].find(
    (record) => normalizeText(record?.sessionId) === normalizedSessionId
  );
  return cloneSessionUiSyncRecord(state);
}

function writeSessionUiSyncPatch(input = {}, patch = {}) {
  const key = sessionUiSyncStateKey(input);
  if (!key || !isPlainObject(patch)) {
    return null;
  }
  const base = sessionUiSyncStates.get(key) || {
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(input.sessionId)
  };
  const next = {
    ...base,
    ...patch,
    projectSlug: normalizeText(input.projectSlug),
    sessionId: normalizeText(input.sessionId)
  };
  sessionUiSyncStates.set(key, next);
  return cloneSessionUiSyncRecord(next);
}

function writeSessionUiSyncPreviewState(previewState) {
  const state = {
    originId: normalizeText(previewState?.originId),
    projectSlug: normalizeText(previewState?.projectSlug),
    route: normalizeText(previewState?.route),
    sessionId: normalizeText(previewState?.sessionId),
    title: normalizeText(previewState?.title),
    updatedAt: normalizeText(previewState?.updatedAt) || new Date().toISOString()
  };
  if (!state.originId || !state.projectSlug || !state.route || !state.sessionId) {
    return null;
  }
  return writeSessionUiSyncPatch(state, {
    preview: state
  });
}

export {
  readSessionUiSyncStateForSession,
  writeSessionUiSyncPreviewState
};
