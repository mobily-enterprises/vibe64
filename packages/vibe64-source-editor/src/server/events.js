import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  sourceEditorFileRealtimePayload
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

function createSourceEditorFileChangedPublisher(events) {
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("Source editor event publication requires runtime.events.");
  }
  return async function publishSourceEditorEvent(result = {}, {
    operation = "updated"
  } = {}) {
    const payload = sourceEditorFileRealtimePayload({ result });
    const sessionId = String(payload.sessionId || "").trim();
    const path = String(payload.path || "").trim();
    if (!sessionId || !path) {
      return null;
    }
    return events.publish(Object.freeze({
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
    }));
  };
}

export {
  createSourceEditorFileChangedPublisher
};
