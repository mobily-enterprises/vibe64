import { publishStateUpgradeFiles, readUpgradeFile as readOptional, verifyUpgradeParents as verifyParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createHash } from "node:crypto";
import path from "node:path";
import { validateAssistantRoutingConfiguration } from "@local/vibe64-core/server/stateUpgrades/routingV2Format";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { codexAuthMarkerPath } from "@local/vibe64-core/server/codexAuthState";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeAssistantRoutingSession } from "@local/vibe64-runtime/server/assistantRoutingStateUpgrade";
import routingScores from "./routingV2Scores.json" with { type: "json" };
import { defineVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { createAiConnectionStore } from "./aiConnectionStore.js";

// Historical defaults belong to this offline upgrade, never to live routing.
const CODEX_RECOMMENDED_HELPER_MODEL = "gpt-5.6-luna";
const CLAUDE_RECOMMENDED_HELPER_MODEL = "haiku";
const roles = ["plan", "code", "economy", "router", "sharedBackup"];
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const routeKey = (value) => JSON.stringify([value.engineId, value.modelProviderId, value.modelId]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Keep this published migration's ranking independent of live role names.
function routingModelScore(selection, role) {
  const row = routingScores.models.find((candidate) => ["engineId", "modelProviderId", "modelId"]
    .every((key) => candidate[key] === selection[key]));
  return (row?.scores || routingScores.defaultScores)[role === "sharedBackup" ? "economy" : role];
}

function offlineSelection(engineId, modelProviderId, modelId, variantId = "") {
  const route = { schema: "vibe64.assistant-selection.v1", engineId, modelProviderId, modelId, variantId,
    agentId: engineId === "opencode" ? "build" : engineId };
  // This is an admitted offline inventory snapshot, not a fabricated live
  // catalogue or credential identity. Runtime revalidates the exact route.
  return { ...route, catalogRevision: `sha256:${digest(JSON.stringify(route))}`, selectionSource: "recommended" };
}

function upgradeAssistantRoutingConfiguration({ configuration, nativeHelpers = {}, connections = [], curatedConnections = [], historicalSelections = [] }) {
  if (configuration) validateAssistantRoutingConfiguration(configuration, { legacy: true });
  if (configuration?.schemaVersion === 2 && !Object.keys(nativeHelpers).length && !connections.some((item) => item.helperModelId) &&
      historicalSelections.every((item) => configuration.orchestrators[item.engineId])) return configuration;
  const pickle = offlineSelection("opencode", "opencode", "big-pickle");
  const orchestrators = structuredClone(configuration?.orchestrators || {});
  if (!Object.keys(orchestrators).length) orchestrators.opencode = Object.fromEntries(roles.map((role) => [role, pickle]));
  for (const engineId of new Set(historicalSelections.map((item) => item.engineId))) {
    if (orchestrators[engineId]) continue;
    const choices = historicalSelections.filter((item) => item.engineId === engineId);
    orchestrators[engineId] = Object.fromEntries(["plan", "code"].map((role) => {
      const sorted = [...choices].sort((left, right) => routingModelScore(right, role) - routingModelScore(left, role) || routeKey(left).localeCompare(routeKey(right), "en"));
      return [role, { ...sorted[0], selectionSource: "recommended" }];
    }));
  }
  for (const engineId of Object.keys(nativeHelpers)) orchestrators[engineId] ||= {};
  if (connections.some((item) => item.helperModelId || item.connected && item.builtIn === false)) orchestrators.opencode ||= {};
  const candidates = new Map([[routeKey(pickle), { selection: pickle, shared: true, backupEligible: true }]]);
  const add = (selection, shared, backupEligible = false) => candidates.set(routeKey(selection), { selection, shared, backupEligible });
  for (const provider of CURATED_CODEX_PROVIDERS) {
    const connection = curatedConnections.find(({ id }) => id === provider.id);
    if (!connection?.connected) continue;
    for (const model of provider.models) {
      if (model.codexHistoryRouting) add(offlineSelection("codex", provider.id, model.id, "low"), !provider.ownerOnly, true);
      if (connection.claudeReady) add(offlineSelection("claude", provider.id, model.id, "low"), !provider.ownerOnly, true);
    }
  }
  for (const connection of connections.filter((item) => item.connected)) {
    const modelIds = new Set([connection.economyModelId, connection.helperModelId, ...(connection.modelAccess?.enabledModelIds || [])]);
    for (const modelId of modelIds) {
      if (!modelId || (connection.modelAccess && connection.modelAccess.mode !== "all" &&
          modelId !== connection.modelAccess.recommendedModelId && !(connection.modelAccess.enabledModelIds || []).includes(modelId))) continue;
      add(offlineSelection("opencode", connection.id, modelId), connection.ownerOnly === false,
        connection.id === "opencode" && modelId === "big-pickle");
    }
  }
  for (const profile of Object.values(orchestrators)) {
    for (const role of roles) {
      const saved = profile[role];
      if (!saved) continue;
      saved.selectionSource ||= "explicit";
      const known = candidates.get(routeKey(saved));
      add(saved, known?.shared === true, known?.backupEligible === true || ["plan", "code"].includes(role));
    }
  }
  for (const [engineId, profile] of Object.entries(orchestrators)) {
    const previous = [];
    if (["codex", "claude"].includes(engineId)) {
      const providerId = engineId === "codex" ? "openai" : "anthropic";
      const defaultModel = engineId === "codex" ? CODEX_RECOMMENDED_HELPER_MODEL : CLAUDE_RECOMMENDED_HELPER_MODEL;
      const helper = nativeHelpers[engineId]?.modelId;
      if (nativeHelpers[engineId] || Object.values(profile).some((item) => item?.modelProviderId === providerId)) {
        const modelId = helper || defaultModel;
        // A saved model-only helper can name a curated provider model. Keep
        // ambiguity as review evidence instead of guessing its provider.
        const matches = [...candidates.values()].filter(({ selection }) => selection.engineId === engineId && selection.modelId === modelId);
        const modelProviderId = matches.length === 1 ? matches[0].selection.modelProviderId : providerId;
        previous.push({ engineId, modelProviderId, modelId, selectionSource: helper ? "explicit" : "default" });
        if (modelId === defaultModel) add(offlineSelection(engineId, providerId, modelId, "low"), false);
      }
      if (engineId === "codex") {
        for (const provider of CURATED_CODEX_PROVIDERS) {
          if (curatedConnections.some((item) => item.id === provider.id && item.connected)) {
            previous.push({ engineId, modelProviderId: provider.id, modelId: provider.models[0].id, selectionSource: "default" });
          }
        }
      }
    } else {
      for (const connection of connections.filter((item) => item.connected)) {
        previous.push({ engineId, modelProviderId: connection.id, modelId: connection.helperModelId || connection.economyModelId,
          selectionSource: connection.helperModelId ? "explicit" : "default" });
      }
      if (!previous.length) previous.push({ engineId, modelProviderId: "opencode", modelId: "big-pickle", selectionSource: "default" });
    }
    const unique = [...new Map(previous.map((entry) => [routeKey(entry), entry])).values()];
    const originalEconomy = profile.economy;
    if (!profile.economy && unique.length === 1) {
      const admitted = candidates.get(routeKey(unique[0]))?.selection;
      if (admitted) profile.economy = { ...admitted, selectionSource: unique[0].selectionSource === "explicit" ? "explicit" : "recommended" };
    }
    if (!Object.hasOwn(profile, "router")) profile.router = originalEconomy ? { ...originalEconomy } : null;
    if (!Object.hasOwn(profile, "sharedBackup")) {
      const economy = profile.economy && candidates.get(routeKey(profile.economy));
      const shared = [...candidates.values()].filter((item) => item.shared && item.backupEligible).map((item) => item.selection)
        .sort((left, right) => routingModelScore(right, "sharedBackup") - routingModelScore(left, "sharedBackup") || routeKey(left).localeCompare(routeKey(right), "en"));
      profile.sharedBackup = economy?.shared && economy.backupEligible ? { ...profile.economy } : shared[0] || null;
    }
    if (!profile.helperRoutingReview && unique.some((entry) => !profile.economy || routeKey(entry) !== routeKey(profile.economy))) {
      profile.helperRoutingReview = { reason: "legacy_helpers_differ", previous: unique, proposed: profile.economy || null };
    }
    for (const role of roles) profile[role] ??= null;
  }
  if (configuration?.schemaVersion === 2 && JSON.stringify(configuration.orchestrators) === JSON.stringify(orchestrators)) return configuration;
  return validateAssistantRoutingConfiguration({ schemaVersion: 2, revision: (configuration?.revision || 0) + 1, orchestrators });
}

function parse(source, label) {
  if (source === null) return null;
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Do not log saved content. */ }
  throw new Error(`${label} is invalid. Inspect it before upgrading routing.`);
}

async function prepareConfiguration(systemRoot, projects, historicalSelections) {
  const routingPath = path.join(systemRoot, "ai-connections/routing.json");
  const connectionsPath = path.join(systemRoot, "ai-connections/connections.json");
  await verifyParents(systemRoot, routingPath);
  const original = await readOptional(routingPath);
  const connectionsSource = await readOptional(connectionsPath);
  const connectionState = parse(connectionsSource, "AI connections");
  if (connectionState && (!Number.isInteger(connectionState.version) || connectionState.version < 1 || connectionState.version > 5 ||
      !object(connectionState.connections) || Object.values(connectionState.connections).some((value) => !object(value) || typeof value.apiKey !== "string" || !value.apiKey ||
        value.helperModelId !== undefined && (typeof value.helperModelId !== "string" || value.helperModelId.length > 512 ||
          [...value.helperModelId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))))) {
    throw new Error("AI connections have an unsupported shape. Inspect them before upgrading routing.");
  }
  const nativeHelpers = {};
  const retired = [];
  for (const engineId of ["codex", "claude"]) {
    const filePath = path.join(systemRoot, `ai-connections/${engineId}-helper-model.json`);
    const source = await readOptional(filePath);
    if (source === null) continue;
    const helper = parse(source, `${engineId} helper settings`);
    if (typeof helper.modelId !== "string" || helper.modelId.length > 200 || /\s/u.test(helper.modelId) ||
        [...helper.modelId].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      throw new Error(`${engineId} helper settings have an unsupported shape.`);
    }
    nativeHelpers[engineId] = helper;
    retired.push({ filePath, original: source, contents: null });
  }
  const curatedConnections = await createCodexProviderConnectionStore({ systemRoot }).list();
  const existing = original !== null || connectionState || projects.length || retired.length || curatedConnections.some((item) => item.connected) ||
    await readOptional(codexAuthMarkerPath(systemRoot)) !== null;
  if (!existing) return [];
  const connections = await createAiConnectionStore({ filePath: connectionsPath,
    verifyConnection: () => { throw new Error("Offline routing upgrade cannot call a provider."); } }).listConnections()
    .then((rows) => rows.map((connection) => ({ ...connection,
      economyModelId: connectionState?.connections[connection.id]?.economyModelId || connection.defaultModelId,
      helperModelId: connectionState?.connections[connection.id]?.helperModelId || "" })));
  const previous = parse(original, "Model routing");
  const configuration = upgradeAssistantRoutingConfiguration({ configuration: previous, nativeHelpers, connections, curatedConnections, historicalSelections });
  const updates = [{ filePath: routingPath, original, contents: configuration === previous ? original : json(configuration) }];
  if (connectionState) {
    const next = structuredClone(connectionState);
    for (const connection of Object.values(next.connections)) delete connection.helperModelId;
    if (JSON.stringify(next) !== JSON.stringify(connectionState)) retired.unshift({ filePath: connectionsPath, original: connectionsSource, contents: json(next) });
  }
  return { updates, retired, configuration };
}

async function upgradeAssistantRouting(context) {
  const { systemRoot, report } = context;
  return publishStateUpgradeFiles({ ...context, prepareUpdates: async (temporaryRoot) => {
      const projects = await listProjectRuntimeRoots(systemRoot);
      const sessionUpdates = [];
      const historicalSelections = [];
      for (const projectRuntimeRoot of projects) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, transform: (session) => {
          const result = upgradeAssistantRoutingSession(session);
          if (session.renewal?.successor?.assistantSelection) historicalSelections.push(defineVibe64AssistantSelection(session.renewal.successor.assistantSelection));
          if (session.metadata.assistant_selection) historicalSelections.push(defineVibe64AssistantSelection(JSON.parse(session.metadata.assistant_selection)));
          for (const conversation of session.conversations) if (conversation.assistantSelection) historicalSelections.push(defineVibe64AssistantSelection(conversation.assistantSelection));
          return result;
        } });
        if (staged.length) report("info", `${path.basename(projectRuntimeRoot)}: ${staged.length} routing state file(s) to upgrade.`);
        sessionUpdates.push(...staged);
      }
      const prepared = await prepareConfiguration(systemRoot, projects, historicalSelections);
      const updates = [...prepared.updates || [], ...sessionUpdates, ...prepared.retired || []];
      for (const [engineId, profile] of Object.entries(prepared.configuration?.orchestrators || {})) {
        if (profile.helperRoutingReview) report("warning", `${engineId}: old helpers differ from Economy. The owner must review helper routing before those helpers run.`);
        if (!profile.sharedBackup) report("warning", `${engineId}: choose a shared Backup in Model routing to enable personal-access substitution.`);
      }
      return updates;
    }
  });
}

export { upgradeAssistantRouting, upgradeAssistantRoutingConfiguration };
