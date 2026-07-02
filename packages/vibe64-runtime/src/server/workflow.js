import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  createCoreWorkflowRegistry
} from "./registerCoreWorkflowModules.js";
import {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
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
  const normalizedDefinitionId = normalizeText(definitionId) || DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID;
  if (!registry.definitionForWorkflow(normalizedDefinitionId)) {
    throw vibe64Error(
      `Unknown Vibe64 workflow definition: ${normalizedDefinitionId}`,
      "vibe64_unknown_workflow_definition"
    );
  }
  return normalizedDefinitionId;
}

function workflowDefinition(definitionId = DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID, {
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  return registry.definitionForWorkflow(normalizeWorkflowDefinitionId(definitionId, {
    workflowRegistry: registry
  }));
}

function workflowForDefinition(definitionId = DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID, {
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  return registry.workflowForId(normalizeWorkflowDefinitionId(definitionId, {
    workflowRegistry: registry
  }));
}

function workflowDefinitionDisplayOrder(definition = {}) {
  const order = Number(definition.displayOrder);
  return Number.isFinite(order) ? order : 1000;
}

function workflowDefinitionCreationOptions({
  seedRequired = false,
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  if (seedRequired) {
    const definition = workflowDefinition(VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION, {
      workflowRegistry: registry
    });
    return {
      defaultWorkflowDefinition: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
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
    defaultWorkflowDefinition: DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
    mode: "select",
    requiredWorkflowDefinition: null,
    seedRequired: false,
    workflowDefinitions: Object.values(registry.workflowDefinitionsById())
      .filter((definition) => definition.userSelectable === true)
      .sort((left, right) => {
        return workflowDefinitionDisplayOrder(left) - workflowDefinitionDisplayOrder(right) ||
          String(left.label || "").localeCompare(String(right.label || ""));
      })
      .map((definition) => ({
        description: definition.description,
        id: definition.id,
        label: definition.label
      }))
  };
}

export {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  normalizeWorkflowDefinitionId,
  workflowDefinition,
  workflowDefinitionCreationOptions,
  workflowForDefinition
};
