import {
  aiStudioError,
  normalizeText
} from "@local/ai-studio-core/server/core";
import {
  createCoreWorkflowRegistry
} from "./registerCoreWorkflowModules.js";
import {
  AI_STUDIO_WORKFLOW_DEFINITION_IDS,
  DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID
} from "./workflowModules/coreCoding.js";

function registryOrDefault(workflowRegistry = null) {
  return workflowRegistry || createCoreWorkflowRegistry();
}

function normalizeWorkflowDefinitionId(definitionId = "", {
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  const normalizedDefinitionId = normalizeText(definitionId) || DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID;
  if (!registry.definitionForWorkflow(normalizedDefinitionId)) {
    throw aiStudioError(
      `Unknown AI Studio workflow definition: ${normalizedDefinitionId}`,
      "ai_studio_unknown_workflow_definition"
    );
  }
  return normalizedDefinitionId;
}

function workflowDefinition(definitionId = DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID, {
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  return registry.definitionForWorkflow(normalizeWorkflowDefinitionId(definitionId, {
    workflowRegistry: registry
  }));
}

function workflowForDefinition(definitionId = DEFAULT_AI_STUDIO_WORKFLOW_DEFINITION_ID, {
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  return registry.workflowForId(normalizeWorkflowDefinitionId(definitionId, {
    workflowRegistry: registry
  }));
}

function workflowDefinitionCreationOptions({
  seedRequired = false,
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  if (seedRequired) {
    const definition = workflowDefinition(AI_STUDIO_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION, {
      workflowRegistry: registry
    });
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
    workflowDefinitions: Object.values(registry.workflowDefinitionsById())
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
