import { trimmedText } from "../shared/trimmedText.js";

const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT = "vibe64.source-editor.sync.error";
const VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT = "vibe64.source-editor.sync.ready";

function safeSourceEditorFileNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function plainObject(value = null) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceEditorFileChangeFromResult(result = {}) {
  const source = plainObject(result) ? result : {};
  return plainObject(source.fileChange) ? source.fileChange : null;
}

function sourceEditorFileRealtimePayload({ result = {} } = {}) {
  const fileChange = sourceEditorFileChangeFromResult(result);
  if (!fileChange) {
    return {};
  }
  const hash = trimmedText(fileChange.hash);
  const originId = trimmedText(fileChange.originId);
  const path = trimmedText(fileChange.path);
  const projectSlug = trimmedText(fileChange.projectSlug);
  const sessionId = trimmedText(fileChange.sessionId);
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
    updatedAt: trimmedText(fileChange.updatedAt)
  };
}

export {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  sourceEditorFileRealtimePayload
};
