import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { validateAssistantRoutingConfiguration } from "@local/vibe64-core/server/assistantRoutingStore";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { publishAssistantRoutingUpgrade } from "./assistantRoutingUpgrade.js";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function helperAssignments(value) {
  if (!object(value)) throw new Error("Saved model assignments must be an object.");
  const next = { ...value };
  if (Object.hasOwn(next, "intern")) {
    if (Object.hasOwn(next, "helper")) throw new Error("Both previous and current Helper assignments exist. Resolve the conflict before upgrading.");
    next.helper = next.intern;
    delete next.intern;
  }
  return next;
}

function helperConfiguration(value) {
  if (!object(value) || !object(value.orchestrators) || value.schemaVersion !== undefined && ![3, 4].includes(value.schemaVersion)) {
    throw new Error("Run the preceding model-routing upgrades before upgrading Helper settings.");
  }
  const next = {
    ...value,
    orchestrators: Object.fromEntries(Object.entries(value.orchestrators).map(([engine, roles]) => [engine, helperAssignments(roles)]))
  };
  if (value.schemaVersion !== undefined) next.schemaVersion = 4;
  return next;
}

// Only visit owned profile fields; authored messages, prompts and model IDs are opaque.
function upgradeHelperProfiles(value) {
  if (Array.isArray(value)) return value.map(upgradeHelperProfiles);
  if (!object(value)) return value;
  const next = { ...value };
  for (const key of ["executionProfile", "executionProfileRequest", "commitTitleExecutionProfile"]) {
    const profile = next[key];
    if (object(profile) && ["economy", "intern"].includes(profile.profileId)) {
      next[key] = { ...profile, profileId: "helper" };
    }
  }
  for (const key of ["helper", "assistantHelper", "decision", "entries", "records", "executionProfiles"]) {
    if (next[key]) next[key] = upgradeHelperProfiles(next[key]);
  }
  return next;
}

function routingRecord(value, { preferences = false, history = false } = {}) {
  if (!object(value)) throw new Error("Saved routing must be an object.");
  const previousChat = value.mode === "intern";
  const next = upgradeHelperProfiles(value);
  for (const key of ["mode", "requestedMode", "resolvedMode", "role", "purpose", "instructionPurpose"]) {
    if (next[key] === "intern") next[key] = history ? "helper" : "junior";
    if (["mode", "requestedMode", "resolvedMode", "role"].includes(key) && next[key] &&
        !["senior", "junior", "helper", "router", "auto", "review", "deslop"].includes(next[key])) {
      throw new Error("Saved routing contains an unknown role. Inspect it before upgrading.");
    }
  }
  if (next.schemaVersion !== undefined) {
    if (![3, 4].includes(next.schemaVersion)) throw new Error("Run the preceding routing upgrades before upgrading saved requests.");
    next.schemaVersion = 4;
  }
  if (next.configuration) next.configuration = helperConfiguration(next.configuration);
  if (next.assignments) {
    next.assignments = helperAssignments(next.assignments);
    if (previousChat && next.assignments.helper) {
      next.assignments.junior = next.assignments.helper;
      delete next.assignments.helper;
    }
  }
  if (next.override?.role) next.override = routingRecord(next.override);
  if (next.decision) next.decision = routingRecord(next.decision);
  if (!previousChat) return next;
  if (preferences) {
    // New turns use the workflow's Junior. The workspace Helper choice is untouched.
    delete next.override;
    next.review = false;
    return next;
  }

  // Already accepted work retains its exact destination and receipt identity.
  const selection = next.selection || next.assignments?.junior || next.decision?.effectiveSelection;
  if (!selection || !next.configuration) return next;
  next.workflowEngineId = selection.engineId;
  next.configuration.orchestrators[selection.engineId] = {
    ...next.configuration.orchestrators[selection.engineId], senior: selection, junior: selection
  };
  if (next.decision) {
    const captured = {
      configuredSelection: selection,
      effectiveSelection: selection,
      connectionIdentity: next.decision.connectionIdentity,
      backupUsed: next.decision.backupUsed,
      backupReason: next.decision.backupReason
    };
    next.decision.workflowEngineId = selection.engineId;
    next.decision.seniorJuniorPair = { senior: captured, junior: captured };
    next.assignments = { ...next.assignments, senior: selection, junior: selection };
  }
  return next;
}

function upgradeRoutingMetadata(value) {
  const changes = {};
  for (const key of ["assistant_routing", "assistant_routing_request", "assistant_routing_goal"]) {
    if (!value[key]) continue;
    const parsed = JSON.parse(value[key]);
    if (parsed === null) continue;
    const next = routingRecord(parsed, { preferences: key === "assistant_routing" });
    if (JSON.stringify(parsed) !== JSON.stringify(next)) changes[key] = JSON.stringify(next);
  }
  return changes;
}

function upgradeAssistantHelperSession({ metadata: saved, conversations, renewal }) {
  const next = {
    metadata: upgradeRoutingMetadata(saved),
    conversations: conversations.map(conversation => {
      const updated = { ...conversation };
      if (conversation.routingMetadata) {
        updated.routingMetadata = {
          ...conversation.routingMetadata,
          ...upgradeRoutingMetadata(conversation.routingMetadata)
        };
      }
      return updated;
    })
  };
  if (renewal?.successor?.assistantRouting) {
    next.renewal = {
      ...renewal,
      successor: {
        ...renewal.successor,
        assistantRouting: routingRecord(renewal.successor.assistantRouting, { preferences: true })
      }
    };
  }
  return next;
}

function upgradeAssistantHelperTurn(value) {
  return value.assistantRouting ? { ...value, assistantRouting: routingRecord(value.assistantRouting, { history: true }) } : value;
}

async function readOptional(filePath) {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade requires a regular file: ${filePath}`);
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function upgradeAssistantHelpers(context) {
  const { systemRoot, report } = context;
  return publishAssistantRoutingUpgrade({ ...context, prepareUpdates: async temporaryRoot => {
    const updates = [];
    const filePath = path.join(systemRoot, "ai-connections/routing.json");
    const original = await readOptional(filePath);
    if (original !== null) {
      const parsed = JSON.parse(original);
      if (parsed.schemaVersion < 3) {
        if (context.apply) throw new Error("Run the preceding model-routing upgrades first.");
        report("info", "Earlier upgrades will prepare the existing model choices before Helper conversion.");
        return updates;
      }
      const next = validateAssistantRoutingConfiguration(helperConfiguration(parsed));
      if (JSON.stringify(next) !== JSON.stringify(parsed)) updates.push({ filePath, original, contents: json(next) });
    }
    const connectionsPath = path.join(systemRoot, "ai-connections/connections.json");
    const connectionsSource = await readOptional(connectionsPath);
    if (connectionsSource !== null) {
      const connections = JSON.parse(connectionsSource);
      if (!object(connections) || !object(connections.connections) ||
          Object.values(connections.connections).some(entry => !object(entry))) throw new Error("AI connections have an unsupported shape.");
      let changed = false;
      for (const entry of Object.values(connections.connections)) {
        if (!Object.hasOwn(entry, "economyModelId")) continue;
        if (entry.defaultModelId !== undefined && entry.defaultModelId !== entry.economyModelId) throw new Error("Provider defaults conflict. Review AI connections before upgrading.");
        entry.defaultModelId = entry.economyModelId;
        delete entry.economyModelId;
        changed = true;
      }
      if (changed) updates.push({ filePath: connectionsPath, original: connectionsSource, contents: json(connections) });
    }
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot,
        transform: upgradeAssistantHelperSession, transformTurnMetadata: upgradeAssistantHelperTurn,
        transformHelperRecord: upgradeHelperProfiles });
      updates.push(...staged);
      const oldRoot = path.join(projectRuntimeRoot, "codex-economy-thread-ownership");
      let entries = [];
      try {
        if (!(await lstat(oldRoot)).isDirectory()) throw new Error("Helper ownership must be a regular directory.");
        entries = await readdir(oldRoot, { withFileTypes: true });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === ".locks") {
          if ((await readdir(path.join(oldRoot, entry.name))).length) throw new Error("Stop helper writers and resolve retained ownership locks before upgrading.");
          continue;
        }
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) throw new Error("Inspect unexpected helper ownership files before upgrading.");
        const from = path.join(oldRoot, entry.name);
        const source = await readOptional(from);
        const target = path.join(projectRuntimeRoot, "codex-helper-thread-ownership", entry.name);
        const record = upgradeHelperProfiles(JSON.parse(source));
        if (!object(record) || !record.threadId || !record.ownershipId || !record.executionProfile) throw new Error("Helper ownership is incomplete. Inspect it before upgrading.");
        vibe64AgentExecutionProfileAuditSnapshot(record.executionProfile);
        if (["economy", "intern"].includes(record.identity?.runtime?.executionMode)) {
          record.identity = { ...record.identity, runtime: { ...record.identity.runtime, executionMode: "helper" } };
        }
        const contents = json(record);
        const existing = await readOptional(target);
        if (existing !== null && existing !== contents) throw new Error("Conflicting Helper ownership records require inspection before upgrading.");
        updates.push({ filePath: target, original: existing, contents }, { filePath: from, original: source, contents: null });
      }
      if (staged.length || entries.length) report("info", `${path.basename(projectRuntimeRoot)}: converting saved Helper settings and ownership.`);
    }
    report("info", "Helper keeps the saved model and thinking. Former third-role chats switch to Junior; accepted work and authored messages retain their destination and identity.");
    return updates;
  } });
}

export { upgradeAssistantHelpers, upgradeAssistantHelperSession, upgradeAssistantHelperTurn };
