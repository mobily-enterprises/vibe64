const sessionUiSyncStates = new Map();
const SOURCE_EDITOR_DASHBOARD_ROUTE_SEGMENT = "files";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizedSessionUiSyncValue(value = "") {
  return String(value || "").trim();
}

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

function readSessionUiSyncState(input = {}) {
  const key = sessionUiSyncStateKey(input);
  return key ? cloneSessionUiSyncRecord(sessionUiSyncStates.get(key)) : null;
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

function writeSessionUiSyncViewState(viewState = {}) {
  const state = {
    originId: normalizedSessionUiSyncValue(viewState?.originId),
    projectPane: normalizedSessionUiSyncValue(viewState?.projectPane),
    projectSlug: normalizedSessionUiSyncValue(viewState?.projectSlug),
    routeFullPath: normalizedSessionUiSyncValue(viewState?.routeFullPath),
    sessionId: normalizedSessionUiSyncValue(viewState?.sessionId),
    updatedAt: normalizedSessionUiSyncValue(viewState?.updatedAt) || new Date().toISOString()
  };
  if (!state.originId || !state.projectSlug || !state.routeFullPath || !state.sessionId) {
    return null;
  }
  return writeSessionUiSyncPatch(state, {
    viewState: state
  });
}

function sourceEditorViewStateFromFileOpen(fileOpen = {}) {
  const projectSlug = normalizedSessionUiSyncValue(fileOpen?.projectSlug);
  const sessionId = normalizedSessionUiSyncValue(fileOpen?.sessionId);
  const originId = normalizedSessionUiSyncValue(fileOpen?.originId);
  if (!originId || !projectSlug || !sessionId) {
    return null;
  }
  return {
    originId,
    projectPane: "dashboard",
    projectSlug,
    routeFullPath: `/app/project/${encodeURIComponent(projectSlug)}/dashboard/${SOURCE_EDITOR_DASHBOARD_ROUTE_SEGMENT}`,
    sessionId,
    updatedAt: normalizedSessionUiSyncValue(fileOpen?.updatedAt) || new Date().toISOString()
  };
}

function writeSessionUiSyncSourceEditorOpen(fileOpen = {}) {
  const state = {
    originId: normalizedSessionUiSyncValue(fileOpen?.originId),
    path: normalizedSessionUiSyncValue(fileOpen?.path),
    projectSlug: normalizedSessionUiSyncValue(fileOpen?.projectSlug),
    sessionId: normalizedSessionUiSyncValue(fileOpen?.sessionId),
    updatedAt: normalizedSessionUiSyncValue(fileOpen?.updatedAt) || new Date().toISOString()
  };
  if (!state.originId || !state.path || !state.projectSlug || !state.sessionId) {
    return null;
  }
  const viewState = sourceEditorViewStateFromFileOpen(state);
  return writeSessionUiSyncPatch(state, {
    sourceEditor: state,
    ...(viewState ? { viewState } : {})
  });
}

function clearSessionUiSyncState() {
  sessionUiSyncStates.clear();
}

export {
  clearSessionUiSyncState,
  readSessionUiSyncState,
  sessionUiSyncStateKey,
  writeSessionUiSyncSourceEditorOpen,
  writeSessionUiSyncViewState
};
