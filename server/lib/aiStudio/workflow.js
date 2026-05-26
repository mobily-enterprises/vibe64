import {
  aiStudioError,
  normalizeText
} from "./core.js";
import "./registerCoreWorkflowModules.js";
import {
  registeredWorkflowDefinitionsById,
  workflowDefinitionForId,
  workflowForId
} from "./workflowRegistry.js";
import {
  AI_STUDIO_WORKFLOW_DEFINITION_IDS,
  DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID
} from "./workflowModules/coreCoding.js";

function normalizeWorkflowDefinitionId(definitionId = "") {
  const normalizedDefinitionId = normalizeText(definitionId) || DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID;
  if (!workflowDefinitionForId(normalizedDefinitionId)) {
    throw aiStudioError(
      `Unknown AI Studio workflow definition: ${normalizedDefinitionId}`,
      "ai_studio_unknown_workflow_definition"
    );
  }
  return normalizedDefinitionId;
}

function workflowDefinition(definitionId = DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID) {
  return workflowDefinitionForId(normalizeWorkflowDefinitionId(definitionId));
}

function workflowForDefinition(definitionId = DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID) {
  return workflowForId(normalizeWorkflowDefinitionId(definitionId));
}

function workflowDefinitionCreationOptions({
  seedRequired = false
} = {}) {
  if (seedRequired) {
    const definition = workflowDefinition(AI_STUDIO_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION);
    return {
      defaultWorkflowDefinition: AI_STUDIO_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
      mode: "seed_required",
      requiredWorkflowDefinition: {
        description: definition.description,
        id: definition.id,
        label: definition.label
      },
      seedRequired: true,
      workflowDefinitions: []
    };
  }
  return {
    defaultWorkflowDefinition: DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID,
    mode: "select",
    requiredWorkflowDefinition: null,
    seedRequired: false,
    workflowDefinitions: Object.values(registeredWorkflowDefinitionsById())
      .filter((definition) => definition.userSelectable === true)
      .map((definition) => ({
        description: definition.description,
        id: definition.id,
        label: definition.label
      }))
  };
}

export {
  AI_STUDIO_WORKFLOW_DEFINITION_IDS,
  DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  normalizeWorkflowDefinitionId,
  workflowDefinition,
  workflowDefinitionCreationOptions,
  workflowForDefinition
};
