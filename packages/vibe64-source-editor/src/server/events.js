import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  sourceEditorFileRealtimePayload
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

/**
 * The realtime event announcing a source file change to the editors open on its session, or null when the result
 * carries no complete file change.
 * @param {object} result
 * @param {string} operation
 */
function sourceEditorFileChangedEvent(result, operation) {
  const payload = sourceEditorFileRealtimePayload({ result });
  const sessionId = String(payload.sessionId || "").trim();
  const path = String(payload.path || "").trim();
  if (!sessionId || !path) {
    return null;
  }
  return Object.freeze({
    type: "entity.changed",
    source: "vibe64",
    entity: "source_editor_file",
    operation,
    entityId: `${sessionId}:${path}`,
    scope: Object.freeze({
      kind: "global",
      id: null
    }),
    occurredAt: new Date().toISOString(),
    realtime: Object.freeze({
      audience: "all_clients",
      event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
      payload: Object.freeze(payload)
    })
  });
}

/**
 * The event of an action that created a source file.
 * @param {{ result: object }} execution
 */
function sourceEditorFileCreatedEvent({ result }) {
  return sourceEditorFileChangedEvent(result, "created");
}

/**
 * The event of an action that saved a source file.
 * @param {{ result: object }} execution
 */
function sourceEditorFileSavedEvent({ result }) {
  return sourceEditorFileChangedEvent(result, "saved");
}

/**
 * The event of an action that wrote the integration configuration: created when it had no base, saved otherwise.
 * @param {{ input: object, result: object }} execution
 */
function sourceEditorIntegrationsWrittenEvent({ input, result }) {
  return sourceEditorFileChangedEvent(result, input.baseHash === null ? "created" : "saved");
}

export {
  sourceEditorFileCreatedEvent,
  sourceEditorFileSavedEvent,
  sourceEditorIntegrationsWrittenEvent
};
