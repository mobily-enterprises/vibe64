// Frozen input/output contract of the published 20260923-routing-v2 upgrade.
const routingRoles = ["plan", "code", "economy", "router", "sharedBackup"];
// eslint-disable-next-line no-control-regex -- Routing identifiers must exclude ASCII control characters.
const controlCharacters = /[\x00-\x1f\x7f]/u;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

function validateAssistantRoutingConfiguration(value, { legacy = false } = {}) {
  const invalid = () => { throw new Error("Saved model routing has an unsupported shape. Restore or repair the settings before changing them."); };
  if (!object(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !object(value.orchestrators) || !(legacy ? [1, 2] : [2]).includes(value.schemaVersion)) invalid();
  const assignment = (entry) => {
    if (!object(entry) || entry.schema !== "vibe64.assistant-selection.v1" ||
        Object.keys(entry).some((key) => !["schema", "engineId", "agentId", "modelProviderId", "modelId", "variantId", "catalogRevision", "selectionSource"].includes(key)) ||
        !["codex", "claude", "opencode"].includes(entry.engineId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(entry.catalogRevision || "") ||
        !["engineId", "agentId", "modelProviderId", "modelId", "variantId"].every((name) =>
          typeof entry[name] === "string" && entry[name].length <= 512 &&
          (name === "variantId" || entry[name].trim().length) && !controlCharacters.test(entry[name])) ||
        !(legacy && entry.selectionSource === undefined || ["recommended", "explicit"].includes(entry.selectionSource))) invalid();
  };
  for (const [engineId, roles] of Object.entries(value.orchestrators)) {
    if (!["codex", "claude", "opencode"].includes(engineId) || !object(roles) ||
        Object.keys(roles).some((key) => ![...routingRoles, "helperRoutingReview"].includes(key))) invalid();
    for (const role of routingRoles) {
      if (roles[role] == null) continue;
      assignment(roles[role]);
      if (["plan", "code"].includes(role) && roles[role].engineId !== engineId) invalid();
    }
    if (roles.helperRoutingReview !== undefined) {
      const review = roles.helperRoutingReview;
      if (!object(review) || Object.keys(review).some((key) => !["reason", "previous", "proposed"].includes(key)) ||
          review.reason !== "legacy_helpers_differ" || !Array.isArray(review.previous) ||
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

export { validateAssistantRoutingConfiguration };
