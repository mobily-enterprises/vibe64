import { curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { VIBE64_AGENT_EXECUTION_WORKLOAD_IDS } from "./agentExecutionProfiles.js";
import { canUseVibe64Assistant, VIBE64_ASSISTANT_ACCESS_ERROR_CODES } from "./assistantAccess.js";
import {
  ASSISTANT_SETUP_ROLES,
  ASSISTANT_ROLE_DEFAULT_FOLLOWS,
  ASSISTANT_PURPOSE_ROLES,
  ASSISTANT_ROLE_PURPOSES,
  assistantModeLabel,
  routingError,
  upgradeRequired,
  withArticle,
  needsMainChatApproval,
  assistantRoutingSetupFor,
  assistantRoutingSetupValues,
  assistantSetupRoleValue
} from "./assistantRouting.js";
import routingScores from "./assistantRoutingScores.json" with { type: "json" };
import { defineVibe64AssistantSelection, resolveVibe64AssistantSelection } from "./assistantSelection.js";

// Which model each routing role can take, the recommended assignment for each role, and which assistant serves a
// request's purpose.

function hasConnectedAssistantModels(engine) {
  return engine?.modelProviders?.some((provider) => provider.connected && provider.models?.length > 0) === true;
}

function routingModelChoices(engine, options = {}) {
  const { purpose = "senior" } = options;
  if (!engine) return [];
  return (engine.modelProviders || []).filter((provider) => provider.connected).flatMap((provider) =>
    (provider.models || []).filter((model) => model.status === "available").flatMap((model) => {
      const agent = engine.agents.find((item) => ["primary", "all"].includes(item.mode) &&
        (!item.modelProviderId || item.modelProviderId === provider.id) && (!item.modelId || item.modelId === model.id));
      if (!agent) return [];
      const curated = curatedCodexModel(model.id, provider.id);
      const isolated = Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS).includes(purpose);
      const compatibilityError = engine.engineId === "codex" && provider.id !== "openai" &&
        !(curated?.modelProviderId === provider.id && (isolated || curated.codexHistoryRouting === true))
        ? `${model.label} is connected, but switching models in Codex has not been verified. Choose a supported routing model.` : "";
      return [{
        agentId: agent.id,
        engineId: engine.engineId,
        modelProviderId: provider.id,
        modelId: model.id,
        variantId: agent.variantId || (model.variants.some(({ id }) => id === engine.defaults.variantId) ? engine.defaults.variantId : ""),
        catalogRevision: engine.revision,
        label: model.label,
        providerLabel: provider.label,
        description: provider.description,
        variants: model.variants,
        capabilities: model.capabilities,
        compatibilityError
      }];
    }));
}

/**
 * One row per model and billing: a subscription runs only in its own tool
 * (structurally, only Claude Code and Codex produce these endpoints), while a
 * key-based model may run in each tool where its provider is connected.
 */
function routingRunsInChoices(models = []) {
  const groups = new Map();
  for (const model of models) {
    const billing = ["claude_subscription", "codex_subscription"].includes(model.endpointCode) ? model.endpointCode : "key";
    const key = JSON.stringify([model.modelProviderId, model.modelId, billing]);
    if (!groups.has(key)) groups.set(key, { modelProviderId: model.modelProviderId, modelId: model.modelId, billing, choices: [] });
    groups.get(key).choices.push(model);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    engineIds: group.choices.map(({ engineId }) => engineId),
    ...(group.billing === "key" ? {} : {
      fixedRunsIn: {
        engineId: group.choices[0].engineId,
        reason: group.billing === "claude_subscription" ? "claude_plan" : "chatgpt_plan"
      }
    })
  }));
}

function routingScoreRow(selection) {
  return routingScores.models.find((candidate) => ["engineId", "modelProviderId", "modelId"]
    .every((key) => candidate[key] === selection[key]));
}

function routingModelScore(selection, role) {
  return (routingScoreRow(selection)?.scores ||
    routingScores.providerDefaultScores[selection.modelProviderId] ||
    routingScores.defaultScores)[role];
}

/**
 * The catalogue may name a model's recommended thinking per role; otherwise
 * background roles think low and the rest think high.
 */
function routingRecommendedEffort(selection, role) {
  return routingScoreRow(selection)?.efforts?.[role] || (["quickHelper", "router"].includes(role) ? "low" : "high");
}

function routingConnectionAccess(selection, connections = []) {
  return connections.find((entry) =>
    entry.engineId === selection.engineId && entry.modelProviderId === selection.modelProviderId && entry.modelId === selection.modelId)
    || connections.find((entry) =>
      entry.engineId === selection.engineId && entry.modelProviderId === selection.modelProviderId && !entry.modelId);
}

const isRoutingSelection = (value) => Boolean(value?.schema);

/**
 * One recommended value per role of the setup. Team members' choices exclude
 * personal connections; preferProvider keeps a role on that provider and tool
 * when it offers a valid choice, otherwise on the role's current value.
 */
function recommendedRoutingAssignments({ catalogs = [], setup = "owner", values = {}, connectionAccess = [], preferProvider = null } = {}) {
  const recommended = {};
  const sameRoute = (left, right) => ["engineId", "modelProviderId", "modelId", "agentId"].every((key) => left?.[key] === right?.[key]);
  const stableKey = (choice) => JSON.stringify([choice.engineId, choice.modelProviderId, choice.modelId, choice.agentId]);
  for (const role of ASSISTANT_SETUP_ROLES[setup]) {
    const follows = ASSISTANT_ROLE_DEFAULT_FOLLOWS[setup][role];
    if (follows) {
      recommended[role] = { follows };
      continue;
    }
    const scoreRole = role === "colleague" ? "senior" : role;
    const purpose = ASSISTANT_ROLE_PURPOSES[scoreRole];
    const seniorEngine = role === "junior" ? recommended.senior?.engineId : "";
    let choices = catalogs.flatMap((catalog) => routingModelChoices(catalog, { purpose }))
      .filter((choice) => !choice.compatibilityError && (!seniorEngine || choice.engineId === seniorEngine) &&
        (!["junior", "colleague"].includes(role) || choice.capabilities?.toolcall !== false))
      .filter((choice) => {
        const access = routingConnectionAccess(choice, connectionAccess);
        return access?.available !== false && (setup !== "nonOwner" || access?.ownerOnly === false);
      });
    if (preferProvider) {
      const preferred = choices.filter((choice) =>
        choice.modelProviderId === preferProvider.modelProviderId && choice.engineId === preferProvider.engineId);
      if (!preferred.length) {
        recommended[role] = values[role] ?? null;
        continue;
      }
      choices = preferred;
    }
    choices.sort((left, right) => routingModelScore(right, scoreRole) - routingModelScore(left, scoreRole)
      || Number(right.engineId === "claude") - Number(left.engineId === "claude")
      || Number(sameRoute(right, values[role])) - Number(sameRoute(left, values[role]))
      || stableKey(left).localeCompare(stableKey(right), "en"));
    const choice = choices[0];
    if (!choice) {
      recommended[role] = null;
      continue;
    }
    const selectedEngine = catalogs.find((catalog) => catalog.engineId === choice.engineId);
    if (sameRoute(choice, values[role])) {
      try {
        recommended[role] = {
          ...routingAssignmentSelection(selectedEngine, values[role], { purpose }),
          selectionSource: "recommended"
        }; continue;
      } catch { /* An obsolete variant must not prevent an otherwise eligible recommendation. */ }
    }
    const preferredEffort = routingRecommendedEffort(choice, scoreRole);
    const agent = selectedEngine.agents.find(({ id }) => id === choice.agentId);
    const selection = resolveVibe64AssistantSelection(selectedEngine, {
      ...choice,
      variantId: agent.variantId || (choice.variants.some(({ id }) => id === preferredEffort) ? preferredEffort : choice.variantId)
    });
    recommended[role] = { ...selection, selectionSource: "recommended" };
  }
  return recommended;
}

function routingAssignmentSelection(engine, assignment, options = {}) {
  const { purpose = "senior" } = options;
  // A saved role keeps its exact model when the catalogue refreshes. Validate
  // availability against the current catalogue instead of silently substituting.
  if (!assignment) throw routingError("Choose this model in Models first.", "vibe64_assistant_model_unassigned");
  if (!engine || assignment.engineId !== engine.engineId) {
    throw routingError("The chosen model's tool is not available.", "vibe64_assistant_engine_unavailable");
  }
  const selection = resolveVibe64AssistantSelection(engine, { ...assignment, catalogRevision: engine.revision });
  const choice = routingModelChoices(engine, { purpose }).find((item) =>
    item.modelProviderId === selection.modelProviderId && item.modelId === selection.modelId);
  if (choice?.compatibilityError) throw routingError(choice.compatibilityError, "vibe64_assistant_model_incompatible");
  return selection;
}

function joinedLabels(labels) {
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function resolveAssistantPurpose({
  purpose,
  actor,
  configuration,
  catalogs = [],
  connectionAccess = [],
  override,
  requirements = {},
  reviewEnabled = false,
  validateModels = true,
  temporaryChat = false,
  practice = false
} = {}) {
  const role = ASSISTANT_PURPOSE_ROLES[purpose];
  const setup = assistantRoutingSetupFor(purpose, actor, { temporaryChat, practice });
  const result = {
    available: false,
    reasonCode: "",
    message: "",
    role: role || purpose,
    setup,
    followedRole: "",
    settingsRevision: configuration?.revision,
    configuredSelection: null,
    effectiveSelection: null,
    connectionIdentity: "",
    instructionPurpose: purpose,
    executionProfileRequest: null
  };
  try {
    if (actor === undefined) throw routingError("The requesting user is required to resolve model routing.", "vibe64_assistant_routing_actor_required");
    if (configuration && (configuration.orchestrators || !configuration.owner)) throw upgradeRequired();
    if (needsMainChatApproval(purpose, actor, { temporaryChat, practice })) {
      return {
        ...result,
        reasonCode: "vibe64_main_chat_approval_required",
        approvalRequired: true,
        message: "Main chat runs on the owner's AI. Your messages wait for their approval."
      };
    }
    const values = assistantRoutingSetupValues(configuration, purpose, actor, { temporaryChat, practice });
    if (purpose === "auto") {
      const missingRoles = ["senior", "junior", "router"].filter((name) =>
        !isRoutingSelection(assistantSetupRoleValue(values, name).value));
      if (missingRoles.length && setup === "nonOwner") {
        const names = joinedLabels([...new Set(missingRoles.map((name) => assistantModeLabel(values[name].follows)))]);
        return {
          ...result,
          reasonCode: "vibe64_team_ai_role_unconfigured",
          missingRoles,
          message: `The workspace owner hasn't chosen a ${names} model for team members yet.`
        };
      }
      if (missingRoles.length) {
        const names = joinedLabels(missingRoles.map(assistantModeLabel));
        return {
          ...result,
          reasonCode: "vibe64_assistant_role_unconfigured",
          missingRoles,
          message: missingRoles.length === 1 ? `Auto needs a ${names} model. Choose one in Models.`
            : `Auto needs models for ${names}. Choose them in Models.`
        };
      }
      const input = { actor, configuration, catalogs, connectionAccess, validateModels, practice };
      const junior = resolveAssistantPurpose({ ...input, purpose: "junior", requirements, reviewEnabled: true });
      const router = resolveAssistantPurpose({ ...input, purpose: "request_routing" });
      const unavailable = [junior, router].find((decision) => !decision.available);
      if (unavailable) return { ...result, reasonCode: unavailable.reasonCode, message: unavailable.message };
      return {
        ...result,
        available: true,
        engineId: junior.engineId,
        seniorJuniorPair: junior.seniorJuniorPair,
        router: router.effectiveSelection,
        routerConnectionIdentity: router.connectionIdentity
      };
    }
    if (!role) throw routingError("Unknown assistant purpose.", "vibe64_assistant_purpose_unknown");
    if (override && (!["custom", "senior", "junior"].includes(override.role) || !override.selection)) {
      throw routingError("A conversation override must identify its role and selection.", "vibe64_assistant_override_invalid");
    }
    const configured = (roleName) => override?.role === roleName ? { value: override.selection, followedRole: "" }
      : assistantSetupRoleValue(values, roleName);
    const identity = ({ value, followedRole }, roleName) => {
      const named = followedRole || roleName;
      if (!value) {
        if (roleName === "custom") throw routingError("Choose a custom model from Chat mode.", "vibe64_assistant_custom_model_missing");
        if (setup === "nonOwner") {
          throw routingError(
            `The workspace owner hasn't chosen ${withArticle(assistantModeLabel(named))} model for team members yet.`,
            "vibe64_team_ai_role_unconfigured"
          );
        }
        throw routingError(`Choose ${withArticle(assistantModeLabel(named))} model in Models.`, "vibe64_assistant_role_unconfigured");
      }
      const selection = defineVibe64AssistantSelection(value);
      const access = routingConnectionAccess(selection, connectionAccess);
      if (!access || typeof access.ownerOnly !== "boolean" || typeof access.available !== "boolean" ||
          typeof access.connectionIdentity !== "string" || !access.connectionIdentity.trim()) {
        throw routingError(
          "The chosen connection is no longer recognised. Review Models.",
          VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE,
          { messageCode: "vibe64_assistant_connection_unrecognised" }
        );
      }
      if (!canUseVibe64Assistant({ ...access, available: true }, actor)) {
        if (roleName === "custom") {
          throw routingError(
            "This custom model uses a personal connection. Choose a model you can access.",
            VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED,
            { messageCode: "vibe64_assistant_custom_model_personal" }
          );
        }
        if (setup === "nonOwner") {
          throw routingError(
            "This team model uses a personal plan. The workspace owner must choose a Workspace-use model.",
            VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED,
            { messageCode: "vibe64_assistant_team_model_personal" }
          );
        }
        throw routingError("Only the workspace owner can use this personal AI connection.", VIBE64_ASSISTANT_ACCESS_ERROR_CODES.RESTRICTED);
      }
      return { selection, access };
    };
    const validate = (destination, instructionPurpose, requiredCapabilities = []) => {
      if (destination.access.available === false) {
        throw routingError("The selected AI connection is unavailable.", VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE);
      }
      // Read-only mode choices need connection/access decisions, without
      // launching model discovery. Dispatch always validates the model catalogue.
      if (!validateModels) return destination;
      const engine = catalogs.find((entry) => entry.engineId === destination.selection.engineId);
      const selection = routingAssignmentSelection(engine, destination.selection, { purpose: instructionPurpose });
      const model = engine.modelProviders.find(({ id }) =>
        id === selection.modelProviderId).models.find(({ id }) => id === selection.modelId);
      if (["junior", "review", "deslop", "fix"].includes(instructionPurpose) && model.capabilities?.toolcall === false) {
        throw routingError("The selected model cannot perform coding or review tools.", "vibe64_assistant_capability_unavailable");
      }
      if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some((name) => model.capabilities?.[name] !== true)) {
        throw routingError(
          "The selected model does not support this request's required capabilities.",
          "vibe64_assistant_capabilities_unsupported"
        );
      }
      return { ...destination, selection };
    };
    const snapshot = (original, effective) => ({
      configuredSelection: original.selection,
      effectiveSelection: effective.selection,
      connectionIdentity: effective.access.connectionIdentity
    });
    if (role === "senior" || role === "junior") {
      const original = { senior: identity(configured("senior"), "senior"), junior: identity(configured("junior"), "junior") };
      if (original.senior.selection.engineId !== original.junior.selection.engineId) {
        throw override
          ? routingError("Senior and Junior overrides must run in your main AI's tool.", "vibe64_assistant_override_pair_engine_mismatch")
          : routingError("Senior and Junior must run in the same tool.", "vibe64_assistant_pair_engine_mismatch");
      }
      const effective = { ...original };
      for (const key of ["senior", "junior"]) effective[key] = validate(effective[key], key, requirements[key]);
      effective[role] = validate(effective[role], purpose, requirements.capabilities);
      if (reviewEnabled || purpose === "review") effective.senior = validate(effective.senior, "review", requirements.review);
      result.seniorJuniorPair = Object.fromEntries(["senior", "junior"].map((key) => [key, snapshot(original[key], effective[key])]));
      Object.assign(result, result.seniorJuniorPair[role], { engineId: original.senior.selection.engineId });
    } else {
      const value = configured(role);
      const original = identity(value, role);
      const effective = validate(original, purpose, requirements.capabilities);
      Object.assign(result, snapshot(original, effective), { followedRole: value.followedRole, engineId: effective.selection.engineId });
    }
    if (Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS).includes(purpose)) {
      result.executionProfileRequest = { profileId: "helper", workloadId: purpose };
    }
    return { ...result, available: true };
  } catch (error) {
    return { ...result, reasonCode: error.code || "vibe64_assistant_routing_invalid", message: error.message };
  }
}

export {
  hasConnectedAssistantModels,
  recommendedRoutingAssignments,
  resolveAssistantPurpose,
  routingAssignmentSelection,
  routingModelChoices,
  routingModelScore,
  routingRunsInChoices
};
