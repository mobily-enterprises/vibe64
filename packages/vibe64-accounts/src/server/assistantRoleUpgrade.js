import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { validateAssistantRoutingConfiguration } from "@local/vibe64-core/server/assistantRoutingStore";
import { validateAssistantRoutingConfiguration as validateV2 } from "@local/vibe64-core/server/stateUpgrades/routingV2Format";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { publishAssistantRoutingUpgrade } from "./assistantRoutingUpgrade.js";

const oldRoles = { plan: "senior", code: "junior", economy: "intern" };
const roles = new Set(["senior", "junior", "intern", "router", "auto", "review", "deslop"]);
const object = value => value && typeof value === "object" && !Array.isArray(value);

function role(value) {
  if (value === "") return value;
  const next = Object.hasOwn(oldRoles, value) ? oldRoles[value] : value;
  if (!roles.has(next)) throw new Error("Routing contains an unknown model role. Inspect the saved routing before upgrading.");
  return next;
}

function roleMap(value) {
  if (!object(value)) throw new Error("Routing assignments must be an object.");
  const result = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    const nextKey = Object.hasOwn(oldRoles, key) ? oldRoles[key] : key;
    if (Object.hasOwn(result, nextKey)) throw new Error("Routing contains both old and new names for one role. Resolve the conflict before upgrading.");
    result[nextKey] = entry;
  }
  if (result.helperRoutingReview?.reason === "legacy_helpers_differ") {
    result.helperRoutingReview = { ...result.helperRoutingReview, reason: "helper_choices_differ" };
  }
  return result;
}

function configuration(value) {
  if (!object(value) || !object(value.orchestrators) ||
      value.schemaVersion !== undefined && ![1, 2, 3].includes(value.schemaVersion)) {
    throw new Error("Routing configuration has an unsupported shape.");
  }
  return { ...value, ...(value.schemaVersion !== undefined ? { schemaVersion: 3 } : {}),
    orchestrators: Object.fromEntries(Object.entries(value.orchestrators).map(([engine, assignments]) => [engine, roleMap(assignments)])) };
}

function routingRecord(value) {
  if (!object(value)) throw new Error("Saved routing must be an object.");
  const next = { ...value };
  for (const field of ["mode", "requestedMode", "resolvedMode", "role"]) {
    if (next[field] !== undefined) next[field] = role(next[field]);
  }
  for (const field of ["purpose", "instructionPurpose"]) {
    if (Object.hasOwn(oldRoles, next[field])) next[field] = role(next[field]);
  }
  if (next.schemaVersion !== undefined) {
    if (![1, 2, 3].includes(next.schemaVersion)) throw new Error("Routing request uses a newer format. Use the matching release.");
    next.schemaVersion = 3;
  }
  if (next.assignments) next.assignments = roleMap(next.assignments);
  if (next.configuration) next.configuration = configuration(next.configuration);
  if (next.override) next.override = routingRecord(next.override);
  if (next.decision) next.decision = routingRecord(next.decision);
  if (next.planCodePair) {
    if (next.seniorJuniorPair) throw new Error("Routing contains conflicting workflow pairs.");
    next.seniorJuniorPair = roleMap(next.planCodePair);
    delete next.planCodePair;
  }
  if (next.continuation === "plan") next.continuation = "planning";
  return next;
}

function metadata(value) {
  const changes = {};
  for (const field of ["assistant_routing", "assistant_routing_request", "assistant_routing_goal"]) {
    if (!value[field]) continue;
    let parsed;
    try { parsed = JSON.parse(value[field]); }
    catch { throw new Error(`Invalid ${field}. Inspect the saved routing before upgrading.`); }
    if (parsed === null) continue;
    const next = routingRecord(parsed);
    if (JSON.stringify(next) !== JSON.stringify(parsed)) changes[field] = JSON.stringify(next);
  }
  return changes;
}

function upgradeAssistantRoleSession({ metadata: saved, conversations, renewal }) {
  for (const conversation of conversations) {
    if (conversation.routingMetadata !== undefined && !object(conversation.routingMetadata)) {
      throw new Error("Temporary conversation routing metadata must be an object. Inspect it before upgrading.");
    }
  }
  return {
    metadata: metadata(saved),
    conversations: conversations.map(conversation => ({ ...conversation,
      ...(conversation.routingMetadata ? { routingMetadata: { ...conversation.routingMetadata, ...metadata(conversation.routingMetadata) } } : {})
    })),
    ...(renewal?.successor?.assistantRouting ? { renewal: { ...renewal, successor: { ...renewal.successor,
      assistantRouting: routingRecord(renewal.successor.assistantRouting)
    } } } : {})
  };
}

function upgradeAssistantRoleTurn(value) {
  return value.assistantRouting ? { ...value, assistantRouting: routingRecord(value.assistantRouting) } : value;
}

async function upgradeAssistantRoles(context) {
  const { systemRoot, report } = context;
  return publishAssistantRoutingUpgrade({ ...context, prepareUpdates: async temporaryRoot => {
    const updates = [];
    const filePath = path.join(systemRoot, "ai-connections", "routing.json");
    let original;
    try {
      const directory = await lstat(path.dirname(filePath));
      if (!directory.isDirectory() || !(await lstat(filePath)).isFile()) throw new Error("Model routing must be a regular file in a regular directory.");
      original = await readFile(filePath, "utf8");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (original !== undefined) {
      let parsed;
      try { parsed = JSON.parse(original); } catch { throw new Error("Model routing is invalid JSON. Repair it before upgrading roles."); }
      if (!object(parsed)) throw new Error("Model routing must be an object. Repair it before upgrading roles.");
      if (parsed.schemaVersion === 3) validateAssistantRoutingConfiguration(parsed);
      else {
        validateV2(parsed, { legacy: true });
        if (parsed.schemaVersion === 1) {
          if (context.apply) throw new Error("Run the preceding routing V2 upgrade before renaming roles.");
          report("info", "The preceding routing V2 upgrade will prepare the older configuration first.");
        } else {
          const next = validateAssistantRoutingConfiguration(configuration(parsed));
          updates.push({ filePath, original, contents: `${JSON.stringify(next, null, 2)}\n` });
        }
      }
    }
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot,
        transform: upgradeAssistantRoleSession, transformTurnMetadata: upgradeAssistantRoleTurn });
      if (staged.length) report("info", `${path.basename(projectRuntimeRoot)}: ${staged.length} routing metadata/history file(s) to rename.`);
      updates.push(...staged);
    }
    report("info", "Senior, Junior and Intern preserve model selections, request receipts and message contents. Native provider histories are unchanged.");
    return updates;
  } });
}

export { upgradeAssistantRoles, upgradeAssistantRoleSession, upgradeAssistantRoleTurn };
