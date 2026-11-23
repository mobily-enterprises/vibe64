import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * One saved routing request in schema version 7, where a plan's passes live in the plan and the
 * request holds only the pass its turn runs. The list of after-plan passes a request carried
 * (passChain) and an Auto plan handoff's draft are dropped. Its plan was completed before its passes ran, so it has no Passes
 * section to continue from: a request still at one of those passes finishes here, nothing is
 * replayed, and its remaining passes run from Passes.
 */
function passesInPlansRequest(raw) {
  if (!raw) return raw;
  let previous;
  try {
    previous = JSON.parse(raw);
  } catch {
    throw new Error("Saved routing request is unreadable. Inspect it before upgrading.");
  }
  if (!isRecord(previous)) throw new Error("Saved routing request must be an object.");
  if (previous.schemaVersion === 7) return raw;
  if (previous.schemaVersion !== 6) throw new Error("Saved routing request is unsupported. Finish earlier routing upgrades first.");
  const { passChain: _passChain, ...request } = previous;
  const next = { ...request, schemaVersion: 7 };
  // Senior now writes a handed-over plan from the request and the conversation, never from a draft.
  if (isRecord(previous.planHandoff)) {
    const { draft: _draft, ...handoff } = previous.planHandoff;
    next.planHandoff = handoff;
  }
  if (previous.stage === "pass") {
    delete next.followup;
    delete next.error;
    Object.assign(next, { stopped: true, status: "complete" });
  }
  return JSON.stringify(next);
}

const changedValues = (values) => values.assistant_routing_request
  ? { assistant_routing_request: passesInPlansRequest(values.assistant_routing_request) }
  : {};

/** Main chat's and its temporary chats' saved routing requests. */
function passesInPlansChanges({ metadata = {}, conversations = [] }) {
  return {
    metadata: changedValues(metadata),
    conversations: conversations.map((record) => !record.routingMetadata ? record : {
      ...record,
      routingMetadata: { ...record.routingMetadata, ...changedValues(record.routingMetadata) }
    })
  };
}

/**
 * 20261123: a plan's passes live in its Passes section. Saved routing requests move to schema
 * version 7 without their list of after-plan passes; nothing is replayed.
 */
async function upgradePassesInPlans(context) {
  return publishStateUpgradeFiles({
    ...context,
    prepareUpdates: async (temporaryRoot) => {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform: passesInPlansChanges });
        context.report(
          "info",
          `${path.basename(projectRuntimeRoot)}: ${staged.length} session file change(s) for passes that live in plans.`
        );
        updates.push(...staged);
      }
      return updates;
    }
  });
}

const __testables = Object.freeze({ passesInPlansChanges, passesInPlansRequest });

export { upgradePassesInPlans, __testables };
