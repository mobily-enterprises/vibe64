import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// Frozen for this published upgrade: Review and Security pass always run after
// a plan, Data and Quality pass join them, and Deslop and the UI pass keep the
// chat's own switch; nothing runs deeply. Temporary chats, Fix it with AI and
// lessons keep only the mandatory pair (which never runs there) and no save.
const MANDATORY = Object.freeze(["review", "security-pass"]);
const ORDER = Object.freeze(["review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass", "identity-pass", "ui-pass", "deslop"]);
const MODES = new Set(["custom", "senior", "junior", "auto", "fix"]);
const RETIRED_FINISHING_TURN = "Vibe64 now runs passes only after a completed plan, so this request's finishing turn no longer runs. " +
  "Send a new request, or run a pass from Passes.";

/**
 * One saved chat mode in the after-plan shape. The finishing switches become the
 * passes ticked to run after a completed plan: Review stays (it is mandatory, as
 * Security pass is), Data and Quality pass are added, and Deslop and the UI pass
 * stay ticked exactly when their switch was on; Automatically save changes is
 * kept. A value that already lists its after-plan passes is current.
 * @param {Record<string, unknown>} saved
 * @param {{ none?: boolean }} [options]
 */
function afterPlanPreferences(saved, options = {}) {
  const { none = false } = options;
  if (!isRecord(saved) || !MODES.has(saved.mode)) throw new Error("Saved chat mode is unsupported. Inspect it before upgrading.");
  if (Array.isArray(saved.afterPlan)) return saved;
  const { review: _review, deslop, uiPass, autoSave, ...value } = saved;
  // Since 20261107 every saved chat mode holds deslop; a switch it lacks read as on.
  if (typeof deslop !== "boolean") {
    throw new Error("Saved chat mode predates its finishing steps. Run the 20261107 chat finishing steps upgrade first.");
  }
  if (none || saved.mode === "fix") return { ...value, afterPlan: [...MANDATORY], afterPlanDeep: [], autoSave: false };
  const ticked = new Set([...MANDATORY, "data-pass", "quality-pass", ...(uiPass !== false ? ["ui-pass"] : []), ...(deslop ? ["deslop"] : [])]);
  return { ...value, afterPlan: ORDER.filter((id) => ticked.has(id)), afterPlanDeep: [], autoSave: autoSave !== false };
}

function changedPreferences(raw, options) {
  if (!raw) return raw;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw new Error("Saved chat mode is unreadable. Inspect it before upgrading.");
  }
  const next = afterPlanPreferences(saved, options);
  return next === saved ? raw : JSON.stringify(next);
}

/**
 * One saved routing request in schema version 6. Its finishing choices, its
 * prepared finishing message and its list of unreviewed requests are dropped:
 * nothing is replayed, and a request admitted before the upgrade never starts
 * after-plan passes. A finishing turn that had not reached the AI (a direct
 * chat's, or Auto's prepared review that was never delivered) is stopped with
 * the reason, so a Resume can never send its old instructions.
 */
function afterPlanRequest(raw) {
  if (!raw) return raw;
  let previous;
  try {
    previous = JSON.parse(raw);
  } catch {
    throw new Error("Saved routing request is unreadable. Inspect it before upgrading.");
  }
  if (!isRecord(previous)) throw new Error("Saved routing request must be an object.");
  if (previous.schemaVersion === 6) return raw;
  if (previous.schemaVersion !== 5) throw new Error("Saved routing request is unsupported. Finish earlier routing upgrades first.");
  const { finishing: _finishing, unreviewed: _unreviewed, reviewMessage: _reviewMessage, ...request } = previous;
  const next = { ...request, schemaVersion: 6, afterPlan: null };
  const unsent = !["uncertain", "sending"].includes(previous.delivery);
  if (previous.status !== "complete" && previous.stage === "review" && unsent &&
      (previous.mode !== "auto" || previous.followup && previous.delivery !== "accepted")) {
    delete next.followup;
    Object.assign(next, { stopped: true, status: "waiting", error: RETIRED_FINISHING_TURN });
  }
  return JSON.stringify(next);
}

const changedValues = (values, options) => ({
  ...(values.assistant_routing ? { assistant_routing: changedPreferences(values.assistant_routing, options) } : {}),
  ...(values.assistant_routing_request ? { assistant_routing_request: afterPlanRequest(values.assistant_routing_request) } : {})
});

/**
 * Main chat, its temporary chats and a pending renewal's successor: each saved
 * chat mode and routing request. A lesson is a session bound to its learner's
 * attempt (its learning_session metadata).
 */
function afterPlanPassesChanges({ metadata = {}, conversations = [], renewal }) {
  const lesson = { none: Object.hasOwn(metadata, "learning_session") };
  const result = {
    metadata: changedValues(metadata, lesson),
    conversations: conversations.map((record) => !record.routingMetadata ? record : {
      ...record,
      routingMetadata: { ...record.routingMetadata, ...changedValues(record.routingMetadata, { none: true }) }
    })
  };
  const successor = renewal?.successor?.assistantRouting;
  if (successor) {
    const assistantRouting = afterPlanPreferences(successor, lesson);
    if (assistantRouting !== successor) result.renewal = { ...renewal, successor: { ...renewal.successor, assistantRouting } };
  }
  return result;
}

/**
 * 20261114: passes run only after a completed plan. Each chat's finishing
 * switches become its after-plan passes, and saved routing requests move to
 * schema version 6 without replaying anything.
 */
async function upgradeAfterPlanPasses(context) {
  return publishStateUpgradeFiles({
    ...context,
    prepareUpdates: async (temporaryRoot) => {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform: afterPlanPassesChanges });
        context.report(
          "info",
          `${path.basename(projectRuntimeRoot)}: ${staged.length} session file change(s) for passes after a completed plan.`
        );
        updates.push(...staged);
      }
      return updates;
    }
  });
}

const __testables = Object.freeze({ afterPlanPassesChanges, afterPlanPreferences, afterPlanRequest });

export { upgradeAfterPlanPasses, __testables };
