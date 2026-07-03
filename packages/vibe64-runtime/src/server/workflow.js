import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeWorkflowRepositoryProfile
} from "@local/vibe64-core/server/projectRepository";
import {
  createCoreWorkflowRegistry
} from "./registerCoreWorkflowModules.js";
import {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID
} from "./workflowModules/coreCoding.js";

const DEFAULT_WORKFLOW_REPOSITORY_PROFILE = WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;

const featureWorkflowDefinitionIdsByRepositoryProfile = Object.freeze({
  [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
  [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_FEATURE,
  [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_FEATURE
});

const seedWorkflowDefinitionIdsByRepositoryProfile = Object.freeze({
  [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
  [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_SEED_APPLICATION,
  [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_SEED_APPLICATION
});

function registryOrDefault(workflowRegistry = null) {
  return workflowRegistry || createCoreWorkflowRegistry();
}

function workflowRepositoryProfileOrDefault(value = "") {
  return normalizeWorkflowRepositoryProfile(value) || DEFAULT_WORKFLOW_REPOSITORY_PROFILE;
}

function workflowDefinitionRepositoryProfiles(definition = {}) {
  const profiles = Array.isArray(definition.workflowRepositoryProfiles)
    ? definition.workflowRepositoryProfiles
        .map((profile) => normalizeWorkflowRepositoryProfile(profile))
        .filter(Boolean)
    : [];
  return profiles.length
    ? [...new Set(profiles)]
    : [DEFAULT_WORKFLOW_REPOSITORY_PROFILE];
}

function workflowDefinitionSupportsRepositoryProfile(definition = {}, workflowRepositoryProfile = "") {
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  return workflowDefinitionRepositoryProfiles(definition).includes(normalizedProfile);
}

function featureWorkflowDefinitionIdForRepositoryProfile(workflowRepositoryProfile = "") {
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  return featureWorkflowDefinitionIdsByRepositoryProfile[normalizedProfile] ||
    featureWorkflowDefinitionIdsByRepositoryProfile[DEFAULT_WORKFLOW_REPOSITORY_PROFILE];
}

function seedWorkflowDefinitionIdForRepositoryProfile(workflowRepositoryProfile = "") {
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  return seedWorkflowDefinitionIdsByRepositoryProfile[normalizedProfile] ||
    seedWorkflowDefinitionIdsByRepositoryProfile[DEFAULT_WORKFLOW_REPOSITORY_PROFILE];
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

function normalizeWorkflowDefinitionIdForRepositoryProfile(definitionId = "", {
  workflowRegistry = null,
  workflowRepositoryProfile = ""
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  const normalizedDefinitionId = normalizeWorkflowDefinitionId(definitionId, {
    workflowRegistry: registry
  });
  const definition = registry.definitionForWorkflow(normalizedDefinitionId);
  if (!workflowDefinitionSupportsRepositoryProfile(definition, workflowRepositoryProfile)) {
    throw vibe64Error(
      `Vibe64 workflow definition ${normalizedDefinitionId} is not available for repository profile ${workflowRepositoryProfileOrDefault(workflowRepositoryProfile)}.`,
      "vibe64_workflow_definition_repository_profile_mismatch"
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
  workflowRepositoryProfile = "",
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  if (seedRequired) {
    const workflowDefinitionId = seedWorkflowDefinitionIdForRepositoryProfile(normalizedProfile);
    const definition = workflowDefinition(workflowDefinitionId, {
      workflowRegistry: registry
    });
    return {
      defaultWorkflowDefinition: workflowDefinitionId,
      mode: "seed_required",
      requiredWorkflowDefinition: {
        description: definition.description,
        id: definition.id,
        label: definition.label
      },
      seedRequired: true,
      workflowRepositoryProfile: normalizedProfile,
      workflowDefinitions: []
    };
  }
  const defaultWorkflowDefinition = featureWorkflowDefinitionIdForRepositoryProfile(normalizedProfile);
  return {
    defaultWorkflowDefinition,
    mode: "select",
    requiredWorkflowDefinition: null,
    seedRequired: false,
    workflowRepositoryProfile: normalizedProfile,
    workflowDefinitions: Object.values(registry.workflowDefinitionsById())
      .filter((definition) => definition.userSelectable === true)
      .filter((definition) => workflowDefinitionSupportsRepositoryProfile(definition, normalizedProfile))
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
  DEFAULT_WORKFLOW_REPOSITORY_PROFILE,
  featureWorkflowDefinitionIdForRepositoryProfile,
  seedWorkflowDefinitionIdForRepositoryProfile,
  normalizeWorkflowDefinitionId,
  normalizeWorkflowDefinitionIdForRepositoryProfile,
  workflowDefinitionRepositoryProfiles,
  workflowDefinitionSupportsRepositoryProfile,
  workflowDefinition,
  workflowDefinitionCreationOptions,
  workflowForDefinition
};
