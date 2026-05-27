import {
  vibe64Error,
  isPlainObject,
  normalizeText,
  plainClone
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

function normalizeWorkflowModuleId(moduleId = "") {
  const normalizedModuleId = normalizeText(moduleId);
  if (!normalizedModuleId) {
    throw vibe64Error(
      "Vibe64 workflow modules require an id.",
      "vibe64_workflow_module_invalid"
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
    throw vibe64Error(
      `Vibe64 workflow ${context} requires a step id.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (!definition) {
    throw vibe64Error(
      `Vibe64 workflow ${context} must register a definition.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (!machine && !factoryId) {
    throw vibe64Error(
      `Vibe64 workflow ${context} must register a machine or factory.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (machine && factoryId) {
    throw vibe64Error(
      `Vibe64 workflow ${context} cannot register both a machine and factory.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (definition && normalizeText(definition.id) !== stepId) {
    throw vibe64Error(
      `Vibe64 workflow ${context} definition id does not match ${stepId}.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (machine && normalizeText(machine.stepId) !== stepId) {
    throw vibe64Error(
      `Vibe64 workflow ${context} machine step id does not match ${stepId}.`,
      "vibe64_workflow_module_invalid"
    );
  }

  return {
    definition: deepFreeze(plainClone(definition)),
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
    throw vibe64Error(
      `Vibe64 workflow ${context} requires an id.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (typeof factory.createMachine !== "function") {
    throw vibe64Error(
      `Vibe64 workflow ${context} requires a createMachine function.`,
      "vibe64_workflow_module_invalid"
    );
  }

  return Object.freeze({
    createMachine: factory.createMachine,
    id: factoryId
  });
}

function normalizeWorkflowStepEntry(entry = {}) {
  if (typeof entry === "string") {
    return {
      rejectTo: "",
      recheckTo: "",
      stepId: normalizeText(entry)
    };
  }
  const entryObject = isPlainObject(entry) ? entry : {};
  return {
    rejectTo: normalizeText(entryObject.rejectTo),
    recheckTo: normalizeText(entryObject.recheckTo),
    stepId: normalizeText(entryObject.stepId || entryObject.id)
  };
}

function normalizeWorkflowSteps(workflow = {}) {
  const entries = Array.isArray(workflow.steps) ? workflow.steps : [];
  return entries
    .map(normalizeWorkflowStepEntry)
    .filter((entry) => entry.stepId);
}

function validateWorkflowStepEntries(workflowId = "", steps = []) {
  const stepIds = steps.map((entry) => entry.stepId);
  if (steps.length === 0) {
    throw vibe64Error(
      `Vibe64 workflow ${workflowId} must list at least one step.`,
      "vibe64_workflow_module_invalid"
    );
  }
  if (stepIds.length !== new Set(stepIds).size) {
    throw vibe64Error(
      `Vibe64 workflow ${workflowId} has duplicate step ids.`,
      "vibe64_workflow_module_invalid"
    );
  }

  const stepIndexById = new Map(stepIds.map((stepId, index) => [stepId, index]));
  function validateEarlierStepTarget(entry = {}, index = 0, fieldName = "") {
    const targetStepId = normalizeText(entry[fieldName]);
    if (!targetStepId) {
      return;
    }
    const targetIndex = stepIndexById.get(targetStepId);
    if (targetIndex === undefined) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} step ${entry.stepId} ${fieldName} points to unknown step: ${targetStepId}.`,
        "vibe64_workflow_unknown_target_step"
      );
    }
    if (targetIndex >= index) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} step ${entry.stepId} ${fieldName} target must be an earlier step: ${targetStepId}.`,
        "vibe64_workflow_invalid_target_step"
      );
    }
  }

  steps.forEach((entry, index) => {
    validateEarlierStepTarget(entry, index, "rejectTo");
    validateEarlierStepTarget(entry, index, "recheckTo");
  });
}

function normalizeWorkflowIntentHandlers(workflowId = "", steps = [], intentHandlers = {}) {
  if (intentHandlers === undefined) {
    return deepFreeze({});
  }
  if (!isPlainObject(intentHandlers)) {
    throw vibe64Error(
      `Vibe64 workflow ${workflowId} intentHandlers must be an object.`,
      "vibe64_workflow_module_invalid"
    );
  }

  const stepIds = new Set(steps.map((entry) => entry.stepId));
  const normalizedHandlers = {};
  for (const [rawStepId, stepHandlers] of Object.entries(intentHandlers)) {
    const stepId = normalizeText(rawStepId);
    if (!stepId) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} intentHandlers contains an empty step id.`,
        "vibe64_workflow_module_invalid"
      );
    }
    if (!stepIds.has(stepId)) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} intentHandlers references unknown step: ${stepId}.`,
        "vibe64_workflow_unknown_step"
      );
    }
    if (!isPlainObject(stepHandlers)) {
      throw vibe64Error(
        `Vibe64 workflow ${workflowId} intentHandlers.${stepId} must be an object.`,
        "vibe64_workflow_module_invalid"
      );
    }

    const normalizedStepHandlers = {};
    for (const [rawIntentId, handler] of Object.entries(stepHandlers)) {
      const intentId = normalizeText(rawIntentId);
      if (!intentId) {
        throw vibe64Error(
          `Vibe64 workflow ${workflowId} intentHandlers.${stepId} contains an empty intent id.`,
          "vibe64_workflow_module_invalid"
        );
      }
      if (typeof handler !== "function") {
        throw vibe64Error(
          `Vibe64 workflow ${workflowId} intentHandlers.${stepId}.${intentId} must be a function.`,
          "vibe64_workflow_module_invalid"
        );
      }
      normalizedStepHandlers[intentId] = handler;
    }
    normalizedHandlers[stepId] = Object.freeze(normalizedStepHandlers);
  }
  return deepFreeze(normalizedHandlers);
}

function normalizeWorkflowContribution(moduleId = "", contribution = {}, index = 0) {
  const contributionObject = isPlainObject(contribution) ? contribution : {};
  const workflowConfig = { ...contributionObject };
  delete workflowConfig.intentHandlers;
  const workflow = plainClone(workflowConfig);
  const workflowId = normalizeText(workflow.id);
  const context = `${moduleId} workflow ${index + 1}`;
  const steps = normalizeWorkflowSteps(workflow);
  const workflowMetadata = { ...workflow };
  delete workflowMetadata.stepIds;
  delete workflowMetadata.steps;

  if (!workflowId) {
    throw vibe64Error(
      `Vibe64 workflow ${context} requires an id.`,
      "vibe64_workflow_module_invalid"
    );
  }
  validateWorkflowStepEntries(workflowId, steps);
  const intentHandlers = normalizeWorkflowIntentHandlers(
    workflowId,
    steps,
    contributionObject.intentHandlers
  );

  return deepFreeze({
    definition: {
      ...workflowMetadata,
      id: workflowId,
      steps
    },
    id: workflowId,
    intentHandlers
  });
}

function workflowContributionDefinition(workflow = {}) {
  return isPlainObject(workflow.definition)
    ? workflow.definition
    : workflow;
}

function workflowContributionIntentHandlers(workflow = {}) {
  return isPlainObject(workflow.intentHandlers)
    ? workflow.intentHandlers
    : {};
}

function publicWorkflowDefinition(workflow = {}) {
  const definition = workflowContributionDefinition(workflow);
  return deepFreeze({
    ...definition,
    steps: Array.isArray(definition.steps) ? definition.steps : []
  });
}

function workflowIntentHandlersForRecord(workflowRecord = {}) {
  return isPlainObject(workflowRecord.intentHandlers)
    ? workflowRecord.intentHandlers
    : {};
}

function workflowIntentHandlerRecords(intentHandlers = {}) {
  return Object.fromEntries(Object.entries(isPlainObject(intentHandlers) ? intentHandlers : {})
    .map(([stepId, handlers]) => [
      stepId,
      Object.keys(isPlainObject(handlers) ? handlers : {}).sort()
    ])
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)));
}

function workflowForRecord(workflowRecord = {}, stepRecords = new Map()) {
  const definition = workflowRecord.definition;
  return deepFreeze({
    definition: plainClone(definition),
    id: definition.id,
    intentHandlers: workflowIntentHandlersForRecord(workflowRecord),
    steps: definition.steps.map((entry) => {
      const stepId = entry.stepId;
      const stepDefinition = stepRecords.get(stepId)?.definition || null;
      if (!stepDefinition) {
        throw vibe64Error(
          `Vibe64 workflow ${definition.id} references unregistered step: ${stepId}.`,
          "vibe64_workflow_unknown_step"
        );
      }
      return {
        ...plainClone(stepDefinition),
        workflow: {
          rejectTo: entry.rejectTo,
          recheckTo: entry.recheckTo
        }
      };
    })
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
  throw vibe64Error(
    `Vibe64 workflow module ${moduleId} ${kind} must be an object or array.`,
    "vibe64_workflow_module_invalid"
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

function normalizeContributorModules(modules = [], kind = "modules") {
  const moduleList = Array.isArray(modules) ? modules : [modules];
  return moduleList.map((module, index) => {
    if (!isPlainObject(module)) {
      throw vibe64Error(
        `Vibe64 workflow ${kind} entry ${index + 1} must be an object.`,
        "vibe64_workflow_module_invalid"
      );
    }
    return module;
  });
}

function hasModuleContribution(module = {}, key = "") {
  return Object.hasOwn(module, key) && module[key] !== undefined;
}

function registerWorkflowContributorModules(registry, {
  stepFactoryModules = [],
  workflowModules = []
} = {}) {
  const normalizedStepFactoryModules = normalizeContributorModules(
    stepFactoryModules,
    "step factory modules"
  );
  const normalizedWorkflowModules = normalizeContributorModules(
    workflowModules,
    "workflow modules"
  );

  normalizedStepFactoryModules.forEach((module) => {
    if (!hasModuleContribution(module, "factories")) {
      throw vibe64Error(
        `Vibe64 workflow step factory module ${normalizeText(module.id) || "(unknown)"} must define factories.`,
        "vibe64_workflow_module_invalid"
      );
    }
    registry.registerStepFactories(module.id, module.factories);
  });
  normalizedWorkflowModules.forEach((module) => {
    if (!hasModuleContribution(module, "steps") && !hasModuleContribution(module, "workflowDefinitions")) {
      throw vibe64Error(
        `Vibe64 workflow module ${normalizeText(module.id) || "(unknown)"} must define steps or workflowDefinitions.`,
        "vibe64_workflow_module_invalid"
      );
    }
  });
  normalizedWorkflowModules.forEach((module) => {
    if (hasModuleContribution(module, "steps")) {
      registry.registerSteps(module.id, module.steps);
    }
  });
  normalizedWorkflowModules.forEach((module) => {
    if (hasModuleContribution(module, "workflowDefinitions")) {
      registry.registerWorkflows(module.id, module.workflowDefinitions);
    }
  });
  return registry;
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
    if (contribution.factoryId && !stepFactoryRecords.has(contribution.factoryId)) {
      throw vibe64Error(
        `Vibe64 workflow step ${contribution.id} references unregistered step factory: ${contribution.factoryId}.`,
        "vibe64_workflow_unknown_step_factory"
      );
    }

    stepRecords.set(contribution.id, Object.freeze({
      definition: contribution.definition,
      factoryConfig: contribution.factoryConfig,
      factoryId: contribution.factoryId,
      id: contribution.id,
      machine: contribution.machine,
      moduleId
    }));
  }

  function storeWorkflowContribution(moduleId = "", workflow = {}) {
    const definition = publicWorkflowDefinition(workflow);
    const intentHandlers = workflowContributionIntentHandlers(workflow);
    const missingStepIds = definition.steps
      .map((entry) => entry.stepId)
      .filter((stepId) => !stepRecords.get(stepId)?.definition);
    if (missingStepIds.length > 0) {
      throw vibe64Error(
        `Vibe64 workflow ${definition.id} references unregistered steps: ${missingStepIds.join(", ")}.`,
        "vibe64_workflow_unknown_step"
      );
    }
    workflowRecords.set(definition.id, Object.freeze({
      definition,
      id: definition.id,
      intentHandlers,
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
    return workflowForRecord(workflowRecord, stepRecords);
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
      throw vibe64Error(
        `Vibe64 workflow step ${stepRecord.id} references unregistered step factory: ${stepRecord.factoryId}.`,
        "vibe64_workflow_unknown_step_factory"
      );
    }
    const machine = factoryRecord.createMachine({
      ...(stepRecord.factoryConfig || {}),
      stepId: stepRecord.id
    });
    if (!isPlainObject(machine) || normalizeText(machine.stepId) !== stepRecord.id) {
      throw vibe64Error(
        `Vibe64 workflow step factory ${factoryRecord.id} returned an invalid machine for step ${stepRecord.id}.`,
        "vibe64_workflow_invalid_step_factory"
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
        intentHandlers: workflowIntentHandlerRecords(record.intentHandlers),
        moduleId: record.moduleId,
        steps: plainClone(record.definition.steps)
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

const _testing = Object.freeze({
  createWorkflowRegistry
});

export {
  _testing,
  createWorkflowRegistry,
  registerWorkflowContributorModules
};
