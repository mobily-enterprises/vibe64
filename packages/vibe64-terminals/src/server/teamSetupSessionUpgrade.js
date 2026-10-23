import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { v4OwnerSetup } from "@local/vibe64-core/server/stateUpgrades/routingV4Format";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function parsed(raw, label) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`Saved ${label} is unreadable. Inspect it before upgrading.`); }
  if (!object(value)) throw new Error(`Saved ${label} must be an object.`);
  return value;
}

// Chat preferences no longer name a workflow tool; a merge repair chat runs on
// Fix it with AI.
function preferences(raw, repair) {
  if (!raw) return raw;
  const saved = parsed(raw, "chat mode");
  const { workflowEngineId: _workflowEngineId, override: _override, ...value } = saved;
  if (repair) Object.assign(value, { mode: "fix", review: false });
  else if (saved.override) value.override = saved.override;
  const current = !Object.hasOwn(saved, "workflowEngineId") && (!repair || saved.mode === "fix" && saved.review === false && !saved.override);
  return current ? raw : JSON.stringify(value);
}

// A retained request or goal keeps its v4 snapshot's workflow block as the
// owner setup, and its Helper role as Quick helper. Nothing is replayed.
function snapshot(raw, label) {
  if (!raw) return raw;
  const value = parsed(raw, label);
  if (!object(value.configuration?.orchestrators)) return raw;
  const next = { ...value, configuration: { revision: value.configuration.revision,
    owner: v4OwnerSetup(value.configuration.orchestrators[value.workflowEngineId] || {}) } };
  if (object(value.assignments) && Object.hasOwn(value.assignments, "helper")) {
    const { helper, ...assignments } = value.assignments;
    next.assignments = { ...assignments, quickHelper: helper };
  }
  if (value.decision?.role === "helper") next.decision = { ...value.decision, role: "quickHelper" };
  return JSON.stringify(next);
}

function changedValues(values = {}, repair = false) {
  const changes = {};
  if (values.assistant_routing) changes.assistant_routing = preferences(values.assistant_routing, repair);
  if (values.assistant_routing_request) changes.assistant_routing_request = snapshot(values.assistant_routing_request, "routing request");
  if (values.assistant_routing_goal) changes.assistant_routing_goal = snapshot(values.assistant_routing_goal, "routing goal");
  return changes;
}

function teamSetupSessionChanges({ metadata = {}, conversations = [], renewal }) {
  const result = { metadata: changedValues(metadata), conversations: conversations.map((record) => !record.routingMetadata ? record
    : { ...record, routingMetadata: { ...record.routingMetadata,
      ...changedValues(record.routingMetadata, record.recoveryOperation === "update") } }) };
  const successor = renewal?.successor?.assistantRouting;
  if (object(successor) && Object.hasOwn(successor, "workflowEngineId")) {
    const { workflowEngineId: _workflowEngineId, ...assistantRouting } = successor;
    result.renewal = { ...renewal, successor: { ...renewal.successor, assistantRouting } };
  }
  return result;
}

// 20261023: sessions, temporary chats and renewals move to the owner/team
// setups. Retained requests keep their delivery; nothing is replayed.
async function upgradeTeamSetupSessions(context) {
  return publishStateUpgradeFiles({ ...context, prepareUpdates: async (temporaryRoot) => {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform: teamSetupSessionChanges });
      context.report("info", `${path.basename(projectRuntimeRoot)}: ${staged.length} session file change(s) for the owner and team AI setups.`);
      updates.push(...staged);
    }
    return updates;
  } });
}

export { teamSetupSessionChanges, upgradeTeamSetupSessions };
