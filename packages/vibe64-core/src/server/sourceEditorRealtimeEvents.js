import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT = "vibe64.source-editor.sync.error";
const VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT = "vibe64.source-editor.sync.ready";

function safeSourceEditorFileNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sourceEditorFileChangeFromResult(result = {}) {
  const source = isRecord(result) ? result : {};
  return isRecord(source.fileChange) ? source.fileChange : null;
}

function sourceEditorFileRealtimePayload({ result = {} } = {}) {
  const fileChange = sourceEditorFileChangeFromResult(result);
  if (!fileChange) {
    return {};
  }
  const hash = normalizeText(fileChange.hash);
  const originId = normalizeText(fileChange.originId);
  const path = normalizeText(fileChange.path);
  const projectSlug = normalizeText(fileChange.projectSlug);
  const sessionId = normalizeText(fileChange.sessionId);
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
    updatedAt: normalizeText(fileChange.updatedAt)
  };
}

export {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  sourceEditorFileRealtimePayload
};
