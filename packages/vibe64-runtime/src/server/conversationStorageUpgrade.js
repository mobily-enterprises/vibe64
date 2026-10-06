import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64SessionStore } from "./sessionStore.js";

export async function upgradeSessionConversations(context) {
  return publishStateUpgradeFiles({ ...context, async prepareUpdates(temporaryRoot) {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      updates.push(...await store.prepareConversationStorageUpgrade({ temporaryRoot }));
    }
    return updates;
  } });
}

// Removing Undo must not strand a partially applied native rewind. Inspect via
// the existing session/archive owner; completed markers and history stay intact.
export async function inspectConversationUndoRetirement(context) {
  return publishStateUpgradeFiles({ ...context, async prepareUpdates(temporaryRoot) {
    const inspectMetadata = (metadata, label) => {
      if (!metadata?.assistant_changeover) return;
      let state;
      try { state = JSON.parse(metadata.assistant_changeover); }
      catch { throw new Error(`${label} has invalid conversation changeover metadata. Inspect it before upgrading.`); }
      if (state !== null && (typeof state !== "object" || Array.isArray(state))) {
        throw new Error(`${label} has invalid conversation changeover metadata. Inspect it before upgrading.`);
      }
      if (state?.rewind != null && (typeof state.rewind !== "object" ||
          Array.isArray(state.rewind) || state.rewind.completed !== true)) {
        throw new Error(`${label} has an unfinished conversation Undo. Complete it using the previous release before upgrading; this release cannot resume Undo. No history was changed.`);
      }
    };
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform({ sessionId, metadata, conversations }) {
        inspectMetadata(metadata, `Session ${sessionId}`);
        for (const conversation of conversations) {
          inspectMetadata(conversation.routingMetadata, `Temporary conversation ${conversation.conversationId} in session ${sessionId}`);
        }
        return {};
      } });
    }
    return [];
  } });
}
