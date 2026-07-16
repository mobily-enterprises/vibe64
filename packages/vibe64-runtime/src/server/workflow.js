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
import {
  VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS
} from "./workflowModules/coreInitialization.js";
import {
  WORKFLOW_CREATION_AUDIENCE,
  normalizeWorkflowCreationAudience,
  workflowDefinitionSupportsCreationAudience
} from "./workflowCreationAudience.js";

const DEFAULT_WORKFLOW_REPOSITORY_PROFILE = WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;

const WORKFLOW_FAMILY = Object.freeze({
  FEATURE: "feature",
  INITIALIZATION: "initialization",
  SEED: "seed"
});
const workflowDefinitionIdsByFamily = Object.freeze({
  [WORKFLOW_FAMILY.FEATURE]: Object.freeze({
    [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
    [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_FEATURE,
    [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_FEATURE
  }),
  [WORKFLOW_FAMILY.INITIALIZATION]: Object.freeze({
    [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.GITHUB_PR,
    [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT,
    [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE
  }),
  [WORKFLOW_FAMILY.SEED]: Object.freeze({
    [WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR]: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
    [WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT]: VIBE64_WORKFLOW_DEFINITION_IDS.CANONICAL_GIT_SEED_APPLICATION,
    [WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE]: VIBE64_WORKFLOW_DEFINITION_IDS.LOCAL_SOURCE_SEED_APPLICATION
  })
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

function workflowDefinitionIdForRepositoryProfile(family, workflowRepositoryProfile = "") {
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  const definitionIds = workflowDefinitionIdsByFamily[family];
  return definitionIds[normalizedProfile] || definitionIds[DEFAULT_WORKFLOW_REPOSITORY_PROFILE];
}

function featureWorkflowDefinitionIdForRepositoryProfile(workflowRepositoryProfile = "") {
  return workflowDefinitionIdForRepositoryProfile(WORKFLOW_FAMILY.FEATURE, workflowRepositoryProfile);
}

function seedWorkflowDefinitionIdForRepositoryProfile(workflowRepositoryProfile = "") {
  return workflowDefinitionIdForRepositoryProfile(WORKFLOW_FAMILY.SEED, workflowRepositoryProfile);
}

function initializationWorkflowDefinitionIdForRepositoryProfile(workflowRepositoryProfile = "") {
  return workflowDefinitionIdForRepositoryProfile(WORKFLOW_FAMILY.INITIALIZATION, workflowRepositoryProfile);
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

function workflowDefinitionSummary(definition = {}) {
  return {
    description: definition.description,
    id: definition.id,
    label: definition.label
  };
}

function requiredWorkflowCreationOptions({
  family,
  workflowRepositoryProfile,
  workflowRegistry
} = {}) {
  const workflowDefinitionId = workflowDefinitionIdForRepositoryProfile(
    family,
    workflowRepositoryProfile
  );
  const initializationRequired = family === WORKFLOW_FAMILY.INITIALIZATION;
  const seedRequired = family === WORKFLOW_FAMILY.SEED;
  return {
    defaultWorkflowDefinition: workflowDefinitionId,
    initializationRequired,
    mode: initializationRequired ? "initialization_required" : "seed_required",
    requiredWorkflowDefinition: workflowDefinitionSummary(workflowDefinition(workflowDefinitionId, {
      workflowRegistry
    })),
    seedRequired,
    workflowRepositoryProfile,
    workflowDefinitions: []
  };
}

function workflowDefinitionCreationOptions({
  creationAudience = WORKFLOW_CREATION_AUDIENCE.EXPERT,
  initializationRequired = false,
  seedRequired = false,
  workflowRepositoryProfile = "",
  workflowRegistry = null
} = {}) {
  const registry = registryOrDefault(workflowRegistry);
  const normalizedProfile = workflowRepositoryProfileOrDefault(workflowRepositoryProfile);
  const normalizedCreationAudience = normalizeWorkflowCreationAudience(creationAudience);
  if (initializationRequired) {
    return requiredWorkflowCreationOptions({
      family: WORKFLOW_FAMILY.INITIALIZATION,
      workflowRegistry: registry,
      workflowRepositoryProfile: normalizedProfile
    });
  }
  if (seedRequired) {
    return requiredWorkflowCreationOptions({
      family: WORKFLOW_FAMILY.SEED,
      workflowRegistry: registry,
      workflowRepositoryProfile: normalizedProfile
    });
  }
  const workflowDefinitions = Object.values(registry.workflowDefinitionsById())
    .filter((definition) => definition.userSelectable === true)
    .filter((definition) => workflowDefinitionSupportsRepositoryProfile(definition, normalizedProfile))
    .filter((definition) => workflowDefinitionSupportsCreationAudience(definition, normalizedCreationAudience))
    .sort((left, right) => {
      return workflowDefinitionDisplayOrder(left) - workflowDefinitionDisplayOrder(right) ||
        String(left.label || "").localeCompare(String(right.label || ""));
    });
  const preferredWorkflowDefinition = featureWorkflowDefinitionIdForRepositoryProfile(normalizedProfile);
  const defaultWorkflowDefinition = workflowDefinitions.some((definition) => definition.id === preferredWorkflowDefinition)
    ? preferredWorkflowDefinition
    : workflowDefinitions[0]?.id || "";
  return {
    defaultWorkflowDefinition,
    initializationRequired: false,
    mode: "select",
    requiredWorkflowDefinition: null,
    seedRequired: false,
    workflowRepositoryProfile: normalizedProfile,
    workflowDefinitions: workflowDefinitions.map(workflowDefinitionSummary)
  };
}

export {
  VIBE64_INITIALIZATION_WORKFLOW_DEFINITION_IDS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  DEFAULT_WORKFLOW_REPOSITORY_PROFILE,
  featureWorkflowDefinitionIdForRepositoryProfile,
  initializationWorkflowDefinitionIdForRepositoryProfile,
  seedWorkflowDefinitionIdForRepositoryProfile,
  normalizeWorkflowDefinitionId,
  normalizeWorkflowDefinitionIdForRepositoryProfile,
  workflowDefinitionRepositoryProfiles,
  workflowDefinitionSupportsRepositoryProfile,
  workflowDefinition,
  workflowDefinitionCreationOptions,
  workflowForDefinition
};
