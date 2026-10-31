import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { VIBE64_DATABASE_LAYOUT_CHANGED_EVENT } from "../shared/events.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */

/** @param {RuntimeEvents} events */
function createDatabaseLayoutChangedPublisher(events) {
  return (sessionId, session) => events.publish({
    type: "entity.changed",
    source: "vibe64",
    entity: "database_layout",
    operation: "updated",
    entityId: sessionId,
    scope: { kind: "global", id: null },
    occurredAt: new Date().toISOString(),
    realtime: {
      audience: "all_clients",
      event: VIBE64_DATABASE_LAYOUT_CHANGED_EVENT,
      payload: {
        projectSlug: currentProjectRequestContext()?.slug || session.projectSlug || "",
        sessionId
      }
    }
  });
}

export { createDatabaseLayoutChangedPublisher };
