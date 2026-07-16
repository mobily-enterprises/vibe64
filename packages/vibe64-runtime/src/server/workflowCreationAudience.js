import { normalizeText } from "@local/vibe64-core/server/core";

const WORKFLOW_CREATION_AUDIENCE = Object.freeze({
  EXPERT: "expert",
  NOVICE: "novice"
});

const workflowCreationAudiences = new Set(Object.values(WORKFLOW_CREATION_AUDIENCE));

function normalizeWorkflowCreationAudience(value = "") {
  const audience = normalizeText(value).toLowerCase();
  return workflowCreationAudiences.has(audience)
    ? audience
    : WORKFLOW_CREATION_AUDIENCE.EXPERT;
}

function workflowDefinitionSupportsCreationAudience(definition = {}, audience = "") {
  return normalizeWorkflowCreationAudience(definition.creationAudience) ===
    normalizeWorkflowCreationAudience(audience);
}

export {
  WORKFLOW_CREATION_AUDIENCE,
  normalizeWorkflowCreationAudience,
  workflowDefinitionSupportsCreationAudience
};
