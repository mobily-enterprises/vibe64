import {
  defineVibe64AssistantSelection,
  vibe64AssistantConversationKey,
  VIBE64_ASSISTANT_ENGINE_IDS
} from "../shared/assistantSelection.js";
import { assistantRoutingPreferences as currentPreferences, ASSISTANT_PURPOSE_ROLES } from "../shared/assistantRouting.js";
import { validateAssistantRoutingConfiguration as validateV2 } from "@local/vibe64-core/server/stateUpgrades/routingV2Format";
import { validateAssistantRoutingConfiguration as validateV3 } from "@local/vibe64-core/server/stateUpgrades/routingV3Format";
import { validateAssistantRoutingConfiguration as validateV4 } from "@local/vibe64-core/server/assistantRoutingStore";

const engines = new Set(Object.values(VIBE64_ASSISTANT_ENGINE_IDS));
const modes = new Set(["plan", "code", "economy", "auto"]);
const requestStatuses = new Set([
  "routing", "sending", "uncertain", "sent", "failed", "cancelled", "done",
  "review_pending", "review_sending", "review_uncertain", "reviewing"
]);
const nativeRequestStatuses = new Set([
  ...requestStatuses, "planning", "planning_pending", "planning_sending", "planning_uncertain",
  "implementation_pending", "implementation_sending", "implementation_uncertain"
]);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

// Validate known native formats without translating their captured decisions.
// Configuration snapshots omit schemaVersion; the enclosing request supplies it.
function validateAssistantRoutingUpgradeRecord(value, { schemaVersion = 4, preferences = false, request = false } = {}) {
  if (!record(value) || ![3, 4].includes(schemaVersion) ||
      value.schemaVersion !== undefined && value.schemaVersion !== schemaVersion) {
    throw new Error("Saved routing has an unsupported format. Use the matching release.");
  }
  const roles = new Set(["custom", "senior", "junior", "auto", "router", "review", "deslop",
    schemaVersion === 3 ? "intern" : "helper", ...Object.keys(ASSISTANT_PURPOSE_ROLES).filter(role => role !== "helper")]);
  for (const key of ["mode", "requestedMode", "resolvedMode", "role"]) {
    if (value[key] !== undefined && value[key] !== "" && !roles.has(value[key])) {
      throw new Error("Saved routing contains an unknown role. Inspect it before upgrading.");
    }
  }
  if (preferences) currentPreferences(schemaVersion === 3 && value.mode === "intern" ? { ...value, mode: "junior" } : value);
  if (value.workflowEngineId !== undefined) workflow(value.workflowEngineId, "Saved routing");
  const legacyAdmission = value.configuration === undefined && value.admissionRequired === true;
  if (request && (!value.mode || !record(value.configuration) && !legacyAdmission ||
      !record(value.assignments) || !Object.keys(value.assignments).length ||
      !nativeRequestStatuses.has(value.status))) {
    throw new Error("Saved routing has an unsupported routing request. Inspect it before upgrading.");
  }
  for (const key of ["selection", "observedSelection", "effectiveSelection", "configuredSelection", "destination", "deliverySelection"]) {
    if (value[key] != null) selection(value[key], "Saved routing");
  }
  if (value.configuration) {
    const validate = schemaVersion === 3 ? validateV3 : validateV4;
    validate({ ...value.configuration, schemaVersion: value.configuration.schemaVersion ?? schemaVersion });
  }
  if (value.assignments !== undefined) {
    if (!record(value.assignments)) throw new Error("Saved routing assignments must be an object.");
    for (const [role, assigned] of Object.entries(value.assignments)) {
      if (!roles.has(role) || role === "auto") throw new Error("Saved routing contains an unknown assignment role.");
      selection(assigned, "Saved routing assignment");
    }
  }
  if (value.override) {
    if (value.override.schema) selection(value.override, "Saved routing override");
    else {
      if (!value.override.selection) throw new Error("Saved routing override has no captured model selection.");
      validateAssistantRoutingUpgradeRecord(value.override, { schemaVersion });
    }
  }
  if (value.mode === "custom" && !preferences && !value.selection && !value.override && !value.assignments?.custom) {
    throw new Error("Saved Custom routing has no captured model selection.");
  }
  if (value.decision) validateAssistantRoutingUpgradeRecord(value.decision, { schemaVersion });
  if (value.seniorJuniorPair) {
    if (!record(value.seniorJuniorPair) || Object.keys(value.seniorJuniorPair).some(role => !["senior", "junior"].includes(role))) {
      throw new Error("Saved routing has an invalid workflow pair.");
    }
    for (const destination of Object.values(value.seniorJuniorPair)) validateAssistantRoutingUpgradeRecord(destination, { schemaVersion });
  }
  if (value.planCodePair) throw new Error("Saved native routing contains a legacy workflow pair.");
  return value;
}

// Frozen preference validation for the published V2 migration.
function assistantRoutingPreferences(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !modes.has(value.mode)) {
    throw Object.assign(new Error("Choose Plan, Code, Economy, or Auto."), { code: "vibe64_assistant_routing_invalid", statusCode: 409 });
  }
  if (value.workflowEngineId !== undefined && !Object.values(VIBE64_ASSISTANT_ENGINE_IDS).includes(value.workflowEngineId)) {
    throw Object.assign(new Error("Choose a supported workflow orchestrator."), { code: "vibe64_assistant_routing_invalid", statusCode: 409 });
  }
  return { mode: value.mode, review: value.review === true,
    ...(value.workflowEngineId ? { workflowEngineId: value.workflowEngineId } : {}),
    ...(value.override && value.mode !== "auto" ? { override: defineVibe64AssistantSelection(value.override) } : {}) };
}

function readRecord(raw, label) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value === null || record(value)) return value;
  } catch { /* Report the owned field, never stored message content. */ }
  throw new Error(`${label} is not a valid object. Inspect it before upgrading routing.`);
}

function selection(value, label) {
  try { return defineVibe64AssistantSelection(value); }
  catch { throw new Error(`${label} has an invalid assistant selection. Inspect it before upgrading routing.`); }
}

function workflow(value, label) {
  if (!engines.has(value)) throw new Error(`${label} has an unsupported workflow engine. Inspect it before upgrading routing.`);
  return value;
}

function requestWorkflow(request, label) {
  if (!modes.has(request.mode) || !requestStatuses.has(request.status) || !record(request.assignments)) {
    throw new Error(`${label} has an unsupported routing request. Inspect it before upgrading routing.`);
  }
  if (request.schemaVersion !== undefined && ![1, 2].includes(request.schemaVersion)) {
    throw new Error(`${label} has a newer routing request. Use the matching release.`);
  }
  if (request.workflowEngineId) return workflow(request.workflowEngineId, label);
  const pair = [request.assignments.plan, request.assignments.code].filter(Boolean)
    .map((value) => selection(value, label).engineId);
  if (new Set(pair).size > 1) {
    throw new Error(`${label} has conflicting Plan and Code engines. Resolve the unfinished request before upgrading routing.`);
  }
  if (pair.length) return pair[0];
  return request.assignments[request.mode] ? selection(request.assignments[request.mode], label).engineId : "";
}

function upgradeMetadata(metadata, currentSelection, label) {
  const savedPreferences = readRecord(metadata.assistant_routing, `${label} preferences`);
  const savedRequest = readRecord(metadata.assistant_routing_request, `${label} request`);
  const savedGoal = readRecord(metadata.assistant_routing_goal, `${label} goal`);
  const nativeRequest = savedRequest && [3, 4].includes(savedRequest.schemaVersion);
  const nativeGoal = savedGoal && ["senior", "junior", "custom", "intern"].includes(savedGoal.mode);
  const nativePreferences = savedPreferences && (["senior", "junior", "custom", "intern"].includes(savedPreferences.mode) ||
    savedPreferences.mode === "auto" && (nativeRequest || nativeGoal));
  if (nativeRequest) validateAssistantRoutingUpgradeRecord(savedRequest, { schemaVersion: savedRequest.schemaVersion, request: true });
  if (nativeGoal) {
    const schemaVersion = savedGoal.configuration?.schemaVersion ?? (savedGoal.mode === "intern" ||
      savedRequest?.schemaVersion === 3 || Object.values(savedGoal.configuration?.orchestrators || {}).some(roles => Object.hasOwn(roles, "intern")) ? 3 : 4);
    validateAssistantRoutingUpgradeRecord(savedGoal, { schemaVersion });
    if (!savedGoal.selection) throw new Error(`${label} has an invalid explicit goal selection.`);
  }
  if (nativePreferences) validateAssistantRoutingUpgradeRecord(savedPreferences, { preferences: true,
    schemaVersion: savedPreferences.mode === "intern" ? 3 : 4 });
  const nativeWorkflows = [
    nativePreferences && savedPreferences.workflowEngineId,
    nativeRequest && !["done", "cancelled"].includes(savedRequest.status) && savedRequest.workflowEngineId,
    nativeGoal && !["complete", "completed"].includes(savedGoal.status) && (savedGoal.workflowEngineId || savedGoal.selection.engineId)].filter(Boolean);
  if (new Set(nativeWorkflows).size > 1) throw new Error(`${label} has conflicting unfinished workflow identities.`);
  const preferences = nativePreferences ? null : savedPreferences;
  const request = nativeRequest ? null : savedRequest;
  const goal = nativeGoal ? null : savedGoal;
  if ((nativeRequest || nativeGoal || nativePreferences) && !preferences && !request && !goal) return {};
  const unfinished = request && !["done", "cancelled"].includes(request.status);
  // Validate completed records too, but do not reinterpret their old role names.
  if (request) requestWorkflow(request, label);
  if (preferences && !modes.has(preferences.mode)) throw new Error(`${label} has an invalid chat mode.`);
  if (preferences?.override) selection(preferences.override, label);
  if (goal && (!modes.has(goal.mode) || goal.mode === "auto" || !goal.selection)) {
    throw new Error(`${label} has an invalid explicit goal selection.`);
  }
  const goalSelection = goal ? selection(goal.selection, label) : null;
  const activeGoal = goal && !["complete", "completed"].includes(goal.status);
  const evidence = [
    ...nativeWorkflows,
    preferences?.workflowEngineId && workflow(preferences.workflowEngineId, label),
    unfinished && requestWorkflow(request, label),
    activeGoal && (goal.workflowEngineId ? workflow(goal.workflowEngineId, label) : goalSelection.engineId)
  ].filter(Boolean);
  if (new Set(evidence).size > 1) {
    throw new Error(`${label} has conflicting unfinished workflow identities. Resolve the request or goal before upgrading routing.`);
  }
  const workflowEngineId = evidence[0] || currentSelection?.engineId;
  const changes = {};
  if (request && !unfinished && [1, 2].includes(request.schemaVersion)) {
    const assignments = Object.entries(request.assignments);
    if (!assignments.length || assignments.some(([role]) => !["plan", "code", "economy", "router", "sharedBackup"].includes(role))) {
      throw new Error(`${label} has invalid legacy terminal assignments.`);
    }
    for (const [, assigned] of assignments) selection(assigned, label);
    if (request.configuration !== undefined) {
      validateV2({ ...request.configuration, schemaVersion: request.configuration?.schemaVersion ?? request.schemaVersion }, { legacy: true });
    } else {
      // Later role upgrades advance this legacy tag to 4. Preserve explicit
      // fresh-admission evidence rather than accepting any configuration-less 4.
      changes.assistant_routing_request = JSON.stringify({ ...request, admissionRequired: true });
    }
  }
  if (workflowEngineId) {
    // Legacy direct chats retain their exact destination and editing behavior.
    let next = preferences;
    if (!next && activeGoal) next = { mode: goal.mode, review: false, override: goalSelection };
    if (!next && unfinished) next = { mode: request.mode, review: request.review === true,
      ...(request.mode !== "auto" && request.assignments[request.mode] ? { override: selection(request.assignments[request.mode], label) } : {}) };
    next ||= { mode: "code", review: false, ...(currentSelection ? { override: currentSelection } : {}) };
    if (!nativePreferences) changes.assistant_routing = JSON.stringify({ ...next, workflowEngineId });
  } else if (preferences || unfinished || activeGoal) {
    throw new Error(`${label} has no evidenced workflow identity. Repair its assistant selection before upgrading routing.`);
  }
  if (unfinished && request.schemaVersion !== 2) {
    const next = { ...request, schemaVersion: 2, workflowEngineId,
      assignments: { ...request.assignments }, admissionRequired: true };
    if (next.mode === "auto" && !Object.hasOwn(next.assignments, "router")) {
      if (!next.assignments.economy) throw new Error(`${label} has no captured Auto classifier. Resolve the unfinished request before upgrading routing.`);
      next.assignments.router = next.assignments.economy;
      delete next.assignments.economy;
    }
    // Old records have no captured connection identities. Receipt inspection
    // remains possible; a fresh inference must go through trusted admission.
    if (["routing", "sending"].includes(next.status)) next.status = next.attemptedMessageId ? "uncertain" : "failed";
    if (next.status === "review_sending") next.status = next.attemptedMessageId ? "review_uncertain" : "review_pending";
    if (next.review && next.status === "sent") next.reviewStatus = "incomplete";
    next.error = "Routing settings were upgraded. Check any pending delivery, then retry with your current AI access.";
    changes.assistant_routing_request = JSON.stringify(next);
  }
  if (activeGoal && !goal.workflowEngineId) changes.assistant_routing_goal = JSON.stringify({ ...goal, workflowEngineId });
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => metadata[key] !== value));
}

// Used only by the stopped-service upgrade. The session store owns discovery,
// archive extraction and staging; this transform owns routing fields alone.
function upgradeAssistantRoutingSession({ sessionId, metadata, conversations, renewal = null }) {
  if (renewal && (renewal.kind !== "vibe64.session_renewal" || renewal.schemaVersion !== 1)) {
    throw new Error(`Renewal of ${sessionId} has an unsupported format. Inspect it before upgrading routing.`);
  }
  const current = metadata.assistant_selection
    ? selection(readRecord(metadata.assistant_selection, `Session ${sessionId}`), `Session ${sessionId}`) : null;
  const result = { metadata: upgradeMetadata(metadata, current, `Session ${sessionId}`), conversations: [] };
  for (const conversation of conversations) {
    const label = `Temporary conversation ${conversation.conversationId} in session ${sessionId}`;
    const selected = conversation.assistantSelection ? selection(conversation.assistantSelection, label) : null;
    if (conversation.routingMetadata !== undefined && !record(conversation.routingMetadata)) {
      throw new Error(`${label} has invalid routing metadata.`);
    }
    const previousMetadata = conversation.routingMetadata || {};
    const changes = upgradeMetadata(previousMetadata, selected, label);
    const next = { ...conversation, ...(Object.keys(changes).length ? { routingMetadata: { ...previousMetadata, ...changes } } : {}) };
    if (conversation.nativeBindings !== undefined && !record(conversation.nativeBindings)) throw new Error(`${label} has invalid native bindings.`);
    for (const binding of Object.values(conversation.nativeBindings || {})) {
      if (!record(binding) || typeof binding.conversationId !== "string" || !binding.conversationId.trim()) {
        throw new Error(`${label} has an invalid retained native conversation.`);
      }
      selection(binding.assistantSelection, `${label} retained binding`);
    }
    if (conversation.providerConversationId) {
      if (!selected) throw new Error(`${label} has a native conversation without an exact assistant selection.`);
      const key = selected.engineId === "codex" && previousMetadata.codex_routing_home_provider
        ? "codex" : vibe64AssistantConversationKey(selected);
      const previous = conversation.nativeBindings?.[key];
      if (previous && previous.conversationId !== conversation.providerConversationId) throw new Error(`${label} has conflicting native conversation identities.`);
      next.nativeBindings = { ...conversation.nativeBindings, [key]: {
        conversationId: conversation.providerConversationId, assistantSelection: selected,
        agentSettings: conversation.agentSettings || {}, runId: conversation.runId || "", messageId: conversation.messageId || ""
      } };
    }
    if (JSON.stringify(next) !== JSON.stringify(conversation)) result.conversations.push(next);
  }
  if (renewal?.successor?.assistantSelection && !["completed", "cancelled"].includes(renewal.status)) {
    const selected = selection(renewal.successor.assistantSelection, `Renewal of ${sessionId}`);
    const previous = renewal.successor.assistantRouting;
    if (previous && ["senior", "junior", "custom", "intern"].includes(previous.mode)) {
      validateAssistantRoutingUpgradeRecord(previous, { preferences: true, schemaVersion: previous.mode === "intern" ? 3 : 4 });
      return result;
    }
    const preferences = assistantRoutingPreferences(previous ||
      { mode: "code", review: false, override: selected, workflowEngineId: selected.engineId });
    if (!preferences.workflowEngineId) preferences.workflowEngineId = selected.engineId;
    if (JSON.stringify(preferences) !== JSON.stringify(previous)) {
      result.renewal = { ...renewal, successor: { ...renewal.successor, assistantRouting: preferences } };
    }
  }
  return result;
}

export { upgradeAssistantRoutingSession, validateAssistantRoutingUpgradeRecord };
