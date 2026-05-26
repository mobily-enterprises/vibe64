import {
  aiStudioError,
  isPlainObject,
  normalizeText,
  plainClone
} from "@local/ai-studio-core/server/core";
import { deepFreeze } from "@local/ai-studio-core/server/deepFreeze";

function normalizeWorkflowModuleId(moduleId = "") {
  const normalizedModuleId = normalizeText(moduleId);
  if (!normalizedModuleId) {
    throw aiStudioError(
      "AI Studio workflow modules require an id.",
      "ai_studio_workflow_module_invalid"
    );
  }
  return normalizedModuleId;
}

function normalizeWorkflowStepContribution(moduleId = "", contribution = {}, index = 0) {
  const contributionObject = isPlainObject(contribution) ? contribution : {};
  const definition = isPlainObject(contributionObject.definition)
    ? contributionObject.definition
    : null;
  const machine = isPlainObject(contributionObject.machine)
    ? contributionObject.machine
    : null;
  const factoryId = normalizeText(contributionObject.factoryId);
  const factoryConfig = isPlainObject(contributionObject.config)
    ? Object.freeze({ ...contributionObject.config })
    : null;
  const stepId = normalizeText(contributionObject.id || definition?.id || machine?.stepId);
  const context = `${moduleId} step ${index + 1}`;

  if (!stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} requires a step id.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (!definition && !machine && !factoryId) {
    throw aiStudioError(
      `AI Studio workflow ${context} must register a definition, machine, or factory.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (machine && factoryId) {
    throw aiStudioError(
      `AI Studio workflow ${context} cannot register both a machine and factory.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (definition && normalizeText(definition.id) !== stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} definition id does not match ${stepId}.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (machine && normalizeText(machine.stepId) !== stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} machine step id does not match ${stepId}.`,
      "ai_studio_workflow_module_invalid"
    );
  }

  return {
    definition: definition ? deepFreeze(plainClone(definition)) : null,
    factoryConfig,
    factoryId,
    id: stepId,
    machine
  };
}

function normalizeStepFactoryContribution(moduleId = "", contribution = {}, index = 0) {
  const factory = isPlainObject(contribution) ? contribution : {};
  const factoryId = normalizeText(factory.id);
  const context = `${moduleId} step factory ${index + 1}`;

  if (!factoryId) {
    throw aiStudioError(
      `AI Studio workflow ${context} requires an id.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (typeof factory.createMachine !== "function") {
    throw aiStudioError(
      `AI Studio workflow ${context} requires a createMachine function.`,
      "ai_studio_workflow_module_invalid"
    );
  }

  return Object.freeze({
    createMachine: factory.createMachine,
    id: factoryId
  });
}

function normalizeWorkflowContribution(moduleId = "", contribution = {}, index = 0) {
  const workflow = isPlainObject(contribution) ? plainClone(contribution) : {};
  const workflowId = normalizeText(workflow.id);
  const context = `${moduleId} workflow ${index + 1}`;
  const stepIds = Array.isArray(workflow.stepIds)
    ? workflow.stepIds.map(normalizeText).filter(Boolean)
    : [];

  if (!workflowId) {
    throw aiStudioError(
      `AI Studio workflow ${context} requires an id.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (stepIds.length === 0) {
    throw aiStudioError(
      `AI Studio workflow ${context} must list at least one step.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (stepIds.length !== new Set(stepIds).size) {
    throw aiStudioError(
      `AI Studio workflow ${workflowId} has duplicate step ids.`,
      "ai_studio_workflow_module_invalid"
    );
  }

  return deepFreeze({
    ...workflow,
    id: workflowId,
    stepIds
  });
}

function normalizeContributionList(moduleId = "", kind = "contributions", contributions = []) {
  if (contributions === undefined) {
    return [];
  }
  if (Array.isArray(contributions)) {
    return contributions;
  }
  if (isPlainObject(contributions)) {
    return [contributions];
  }
  throw aiStudioError(
    `AI Studio workflow module ${moduleId} ${kind} must be an object or array.`,
    "ai_studio_workflow_module_invalid"
  );
}

function normalizeContributionsForModule(
  moduleId = "",
  kind = "contributions",
  contributions = [],
  normalizeContribution
) {
  const normalizedModuleId = normalizeWorkflowModuleId(moduleId);
  const contributionList = normalizeContributionList(normalizedModuleId, kind, contributions);
  return {
    contributions: contributionList.map((contribution, index) => (
      normalizeContribution(normalizedModuleId, contribution, index)
    )),
    normalizedModuleId
  };
}

function storeContributions(contributions = [], storeContribution) {
  const registeredContributions = contributions.map((contribution) => {
    storeContribution(contribution);
    return contribution;
  });
  return deepFreeze(registeredContributions);
}

function createWorkflowRegistry() {
  const stepFactoryRecords = new Map();
  const stepRecords = new Map();
  const workflowRecords = new Map();

  function storeStepFactoryContribution(moduleId = "", factory = {}) {
    stepFactoryRecords.set(factory.id, Object.freeze({
      createMachine: factory.createMachine,
      id: factory.id,
      moduleId
    }));
  }

  function storeStepContribution(moduleId = "", contribution = {}) {
    const existing = stepRecords.get(contribution.id);
    const definition = contribution.definition || existing?.definition || null;
    const machine = contribution.machine || (contribution.factoryId ? null : existing?.machine || null);
    const factoryId = contribution.factoryId || (contribution.machine ? "" : existing?.factoryId || "");
    const factoryConfig = contribution.factoryId
      ? contribution.factoryConfig
      : contribution.machine
        ? null
        : existing?.factoryConfig || null;
    const ownerModuleId = contribution.definition ? moduleId : existing?.moduleId || moduleId;
    if (factoryId && !stepFactoryRecords.has(factoryId)) {
      throw aiStudioError(
        `AI Studio workflow step ${contribution.id} references unregistered step factory: ${factoryId}.`,
        "ai_studio_workflow_unknown_step_factory"
      );
    }

    stepRecords.set(contribution.id, Object.freeze({
      definition,
      factoryConfig,
      factoryId,
      id: contribution.id,
      machine,
      moduleId: ownerModuleId
    }));
  }

  function storeWorkflowContribution(moduleId = "", workflow = {}) {
    const missingStepIds = workflow.stepIds.filter((stepId) => !stepRecords.get(stepId)?.definition);
    if (missingStepIds.length > 0) {
      throw aiStudioError(
        `AI Studio workflow ${workflow.id} references unregistered steps: ${missingStepIds.join(", ")}.`,
        "ai_studio_workflow_unknown_step"
      );
    }
    workflowRecords.set(workflow.id, Object.freeze({
      definition: workflow,
      id: workflow.id,
      moduleId
    }));
  }

  function registerStepFactories(moduleId = "", factories = []) {
    const {
      contributions,
      normalizedModuleId
    } = normalizeContributionsForModule(
      moduleId,
      "step factories",
      factories,
      normalizeStepFactoryContribution
    );
    return storeContributions(contributions, (factory) => {
      storeStepFactoryContribution(normalizedModuleId, factory);
    });
  }

  function registerSteps(moduleId = "", steps = []) {
    const {
      contributions,
      normalizedModuleId
    } = normalizeContributionsForModule(
      moduleId,
      "steps",
      steps,
      normalizeWorkflowStepContribution
    );
    return storeContributions(contributions, (step) => {
      storeStepContribution(normalizedModuleId, step);
    });
  }

  function registerWorkflows(moduleId = "", workflows = []) {
    const {
      contributions,
      normalizedModuleId
    } = normalizeContributionsForModule(
      moduleId,
      "workflows",
      workflows,
      normalizeWorkflowContribution
    );
    return storeContributions(contributions, (workflow) => {
      storeWorkflowContribution(normalizedModuleId, workflow);
    });
  }

  function definitionForStep(stepId = "") {
    const definition = stepRecords.get(normalizeText(stepId))?.definition || null;
    return plainClone(definition);
  }

  function definitionForWorkflow(workflowId = "") {
    const definition = workflowRecords.get(normalizeText(workflowId))?.definition || null;
    return plainClone(definition);
  }

  function workflowForId(workflowId = "") {
    const workflowRecord = workflowRecords.get(normalizeText(workflowId));
    if (!workflowRecord) {
      return null;
    }
    const definition = workflowRecord.definition;
    return deepFreeze({
      definition: plainClone(definition),
      id: definition.id,
      steps: definition.stepIds.map((stepId) => {
        const stepDefinition = stepRecords.get(stepId)?.definition || null;
        if (!stepDefinition) {
          throw aiStudioError(
            `AI Studio workflow ${definition.id} references unregistered step: ${stepId}.`,
            "ai_studio_workflow_unknown_step"
          );
        }
        return plainClone(stepDefinition);
      })
    });
  }

  function machineForStep(stepId = "") {
    const stepRecord = stepRecords.get(normalizeText(stepId));
    if (!stepRecord) {
      return null;
    }
    if (stepRecord.machine) {
      return stepRecord.machine;
    }
    if (!stepRecord.factoryId) {
      return null;
    }
    const factoryRecord = stepFactoryRecords.get(stepRecord.factoryId);
    if (!factoryRecord) {
      throw aiStudioError(
        `AI Studio workflow step ${stepRecord.id} references unregistered step factory: ${stepRecord.factoryId}.`,
        "ai_studio_workflow_unknown_step_factory"
      );
    }
    const machine = factoryRecord.createMachine({
      ...(stepRecord.factoryConfig || {}),
      stepId: stepRecord.id
    });
    if (!isPlainObject(machine) || normalizeText(machine.stepId) !== stepRecord.id) {
      throw aiStudioError(
        `AI Studio workflow step factory ${factoryRecord.id} returned an invalid machine for step ${stepRecord.id}.`,
        "ai_studio_workflow_invalid_step_factory"
      );
    }
    return machine;
  }

  function registeredStepFactoryRecords() {
    return Array.from(stepFactoryRecords.values())
      .map((record) => ({
        id: record.id,
        moduleId: record.moduleId
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function registeredStepRecords() {
    return Array.from(stepRecords.values())
      .map((record) => ({
        hasDefinition: Boolean(record.definition),
        hasMachine: Boolean(record.machine || (record.factoryId && stepFactoryRecords.has(record.factoryId))),
        id: record.id,
        moduleId: record.moduleId
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function registeredWorkflowRecords() {
    return Array.from(workflowRecords.values())
      .map((record) => ({
        id: record.id,
        moduleId: record.moduleId,
        stepIds: [...record.definition.stepIds]
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function workflowDefinitionsById() {
    return Object.fromEntries(Array.from(workflowRecords.values())
      .map((record) => [record.id, plainClone(record.definition)])
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)));
  }

  return Object.freeze({
    definitionForStep,
    definitionForWorkflow,
    machineForStep,
    registeredStepFactoryRecords,
    registeredStepRecords,
    registeredWorkflowRecords,
    registerStepFactories,
    registerSteps,
    registerWorkflows,
    workflowDefinitionsById,
    workflowForId
  });
}

const workflowRegistry = createWorkflowRegistry();

function registerWorkflowStepFactories(moduleId = "", factories = []) {
  return workflowRegistry.registerStepFactories(moduleId, factories);
}

function registerWorkflowSteps(moduleId = "", steps = []) {
  return workflowRegistry.registerSteps(moduleId, steps);
}

function registerWorkflows(moduleId = "", workflows = []) {
  return workflowRegistry.registerWorkflows(moduleId, workflows);
}

function registeredWorkflowStepRecords() {
  return workflowRegistry.registeredStepRecords();
}

function registeredWorkflowStepFactoryRecords() {
  return workflowRegistry.registeredStepFactoryRecords();
}

function registeredWorkflowRecords() {
  return workflowRegistry.registeredWorkflowRecords();
}

function registeredWorkflowDefinitionsById() {
  return workflowRegistry.workflowDefinitionsById();
}

function workflowDefinitionForId(workflowId = "") {
  return workflowRegistry.definitionForWorkflow(workflowId);
}

function workflowForId(workflowId = "") {
  return workflowRegistry.workflowForId(workflowId);
}

function workflowStepMachineForStep(stepId = "") {
  return workflowRegistry.machineForStep(stepId);
}

const _testing = Object.freeze({
  createWorkflowRegistry,
  registeredWorkflowRecords,
  registeredWorkflowStepFactoryRecords,
  registeredWorkflowStepRecords
});

export {
  _testing,
  registeredWorkflowDefinitionsById,
  registerWorkflowStepFactories,
  registerWorkflowSteps,
  registerWorkflows,
  workflowDefinitionForId,
  workflowForId,
  workflowStepMachineForStep
};
