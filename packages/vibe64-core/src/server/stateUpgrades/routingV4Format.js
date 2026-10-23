// Frozen validation for the published schema-4 upgrades.
const routingRoles = ["senior", "junior", "helper", "router", "sharedBackup"];
// eslint-disable-next-line no-control-regex -- Routing identifiers must exclude ASCII control characters.
const controlCharacters = /[\x00-\x1f\x7f]/u;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function validateAssistantRoutingConfiguration(value) {
  const invalid = () => { throw new Error("Saved model routing has an unsupported shape. Restore or repair the settings before changing them."); };
  if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !object(value.orchestrators) || value.schemaVersion !== 4) invalid();
  const assignment = (entry) => {
    if (!object(entry) || entry.schema !== "vibe64.assistant-selection.v1" ||
        Object.keys(entry).some((key) => !["schema", "engineId", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision", "selectionSource"].includes(key)) ||
        !["codex", "claude", "opencode"].includes(entry.engineId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(entry.catalogRevision || "") ||
        !["engineId", "agentId", "modelProviderId", "modelId", "variantId"].every((name) =>
          typeof entry[name] === "string" && entry[name].length <= 512 &&
          (name === "variantId" || entry[name].trim().length) && !controlCharacters.test(entry[name])) ||
        !["recommended", "explicit"].includes(entry.selectionSource)) invalid();
  };
  for (const [engineId, roles] of Object.entries(value.orchestrators)) {
    if (!["codex", "claude", "opencode"].includes(engineId) || !object(roles) ||
        Object.keys(roles).some((key) => ![...routingRoles, "helperRoutingReview"].includes(key))) invalid();
    for (const role of routingRoles) {
      if (roles[role] == null) continue;
      assignment(roles[role]);
      if (["senior", "junior"].includes(role) && roles[role].engineId !== engineId) invalid();
    }
    if (roles.helperRoutingReview !== undefined) {
      const review = roles.helperRoutingReview;
      if (!object(review) || Object.keys(review).some((key) => !["reason", "previous", "proposed"].includes(key)) ||
          review.reason !== "helper_choices_differ" || !Array.isArray(review.previous) ||
          !review.previous.length || review.previous.some((entry) => !object(entry) ||
            Object.keys(entry).some((key) => !["engineId", "modelProviderId", "modelId", "selectionSource"].includes(key)) ||
            !["codex", "claude", "opencode"].includes(entry.engineId) ||
            !["modelProviderId", "modelId"].every((key) => typeof entry[key] === "string" && entry[key].length > 0 && entry[key].length <= 512 && !controlCharacters.test(entry[key])) ||
            !["explicit", "default"].includes(entry.selectionSource))) invalid();
      if (review.proposed != null) assignment(review.proposed);
    }
  }
  return value;
}

// Frozen v4 -> v5 mapping for the 20261023 owner/team setups upgrade, shared by
// its routing and session owners.
const V4_ENGINE_ORDER = ["claude", "codex", "opencode"];

// The workflow block that becomes the owner's setup: one with Senior or Junior,
// preferring one with both, then Claude Code, Codex, OpenCode.
function v4SourceEngineId(orchestrators = {}) {
  const candidates = V4_ENGINE_ORDER.filter((engineId) => orchestrators[engineId]?.senior || orchestrators[engineId]?.junior);
  return candidates.find((engineId) => orchestrators[engineId].senior && orchestrators[engineId].junior) || candidates[0] || "";
}

// A v4 workflow block's roles as the v5 owner setup. Saved values are copied
// exactly; null stays off and an absent role stays absent.
function v4OwnerSetup(block = {}) {
  const owner = {};
  for (const role of ["senior", "junior", "router"]) if (block[role] !== undefined) owner[role] = block[role];
  const quickHelper = block.helper ?? block.helperRoutingReview?.proposed ?? block.helper;
  if (quickHelper !== undefined) owner.quickHelper = quickHelper;
  return { ...owner, colleague: { follows: "senior" }, fix: { follows: "junior" }, explain: { follows: "quickHelper" } };
}

export { V4_ENGINE_ORDER, validateAssistantRoutingConfiguration, v4OwnerSetup, v4SourceEngineId };
