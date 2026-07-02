const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT = "vibe64.source-editor.file.opened";
const VIBE64_SOURCE_EDITOR_FILE_EVENT_ENTITY = "source_editor_file";
const VIBE64_SOURCE_EDITOR_FILE_EVENT_SOURCE = "vibe64";
const VIBE64_SOURCE_EDITOR_FILE_REALTIME_AUDIENCE = "all_clients";

function normalizeSourceEditorFileValue(value = "") {
  return String(value || "").trim();
}

function safeSourceEditorFileNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function plainObject(value = null) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceEditorFileChangeFromServiceResult(result = {}) {
  const source = plainObject(result) ? result : {};
  return plainObject(source.fileChange) ? source.fileChange : null;
}

function sourceEditorFileOpenFromServiceResult(result = {}) {
  const source = plainObject(result) ? result : {};
  return plainObject(source.fileOpen) ? source.fileOpen : null;
}

function sourceEditorFileRealtimePayload({ result = {} } = {}) {
  const fileChange = sourceEditorFileChangeFromServiceResult(result);
  if (!fileChange) {
    return {};
  }
  const hash = normalizeSourceEditorFileValue(fileChange.hash);
  const originId = normalizeSourceEditorFileValue(fileChange.originId);
  const path = normalizeSourceEditorFileValue(fileChange.path);
  const projectSlug = normalizeSourceEditorFileValue(fileChange.projectSlug);
  const sessionId = normalizeSourceEditorFileValue(fileChange.sessionId);
  if (!hash || !originId || !path || !projectSlug || !sessionId) {
    return {};
  }
  const mtimeMs = safeSourceEditorFileNumber(fileChange.mtimeMs);
  const size = safeSourceEditorFileNumber(fileChange.size);
  return {
    hash,
    ...(mtimeMs === null ? {} : { mtimeMs }),
    originId,
    path,
    projectSlug,
    sessionId,
    ...(size === null ? {} : { size }),
    updatedAt: normalizeSourceEditorFileValue(fileChange.updatedAt)
  };
}

function sourceEditorFileOpenRealtimePayload({ result = {} } = {}) {
  const fileOpen = sourceEditorFileOpenFromServiceResult(result);
  if (!fileOpen) {
    return {};
  }
  const originId = normalizeSourceEditorFileValue(fileOpen.originId);
  const path = normalizeSourceEditorFileValue(fileOpen.path);
  const projectSlug = normalizeSourceEditorFileValue(fileOpen.projectSlug);
  const sessionId = normalizeSourceEditorFileValue(fileOpen.sessionId);
  if (!originId || !path || !projectSlug || !sessionId) {
    return {};
  }
  return {
    originId,
    path,
    projectSlug,
    sessionId,
    updatedAt: normalizeSourceEditorFileValue(fileOpen.updatedAt)
  };
}

function sourceEditorFileEntityIdFromServiceEvent({ result = {} } = {}) {
  const payload = sourceEditorFileRealtimePayload({ result });
  return payload.sessionId && payload.path ? `${payload.sessionId}:${payload.path}` : null;
}

function sourceEditorFileOpenEntityIdFromServiceEvent({ result = {} } = {}) {
  const payload = sourceEditorFileOpenRealtimePayload({ result });
  return payload.sessionId && payload.path ? `${payload.sessionId}:${payload.path}` : null;
}

function vibe64SourceEditorFileChangedServiceEvent() {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_SOURCE_EDITOR_FILE_EVENT_SOURCE,
    entity: VIBE64_SOURCE_EDITOR_FILE_EVENT_ENTITY,
    operation: "updated",
    entityId: sourceEditorFileEntityIdFromServiceEvent,
    realtime: Object.freeze({
      audience: VIBE64_SOURCE_EDITOR_FILE_REALTIME_AUDIENCE,
      event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
      payload: sourceEditorFileRealtimePayload
    })
  });
}

function vibe64SourceEditorFileOpenedServiceEvent() {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_SOURCE_EDITOR_FILE_EVENT_SOURCE,
    entity: VIBE64_SOURCE_EDITOR_FILE_EVENT_ENTITY,
    operation: "selected",
    entityId: sourceEditorFileOpenEntityIdFromServiceEvent,
    realtime: Object.freeze({
      audience: VIBE64_SOURCE_EDITOR_FILE_REALTIME_AUDIENCE,
      event: VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
      payload: sourceEditorFileOpenRealtimePayload
    })
  });
}

export {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  sourceEditorFileOpenRealtimePayload,
  sourceEditorFileRealtimePayload,
  vibe64SourceEditorFileChangedServiceEvent,
  vibe64SourceEditorFileOpenedServiceEvent
};
