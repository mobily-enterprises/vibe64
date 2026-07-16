import {
  createWorkflowRegistry,
  registerWorkflowContributorModules
} from "./workflowRegistry.js";
import {
  coreWorkflowStepFactories
} from "./workflowStepFactories.js";
import {
  coreCodingWorkflowModule
} from "./workflowModules/coreCoding.js";
import {
  coreLifecycleWorkflowModule
} from "./workflowModules/coreLifecycle.js";
import {
  coreInitializationWorkflowModule
} from "./workflowModules/coreInitialization.js";
import {
  coreMaintenanceWorkflowModule
} from "./workflowModules/coreMaintenance.js";

const coreWorkflowStepFactoryModules = Object.freeze([
  coreWorkflowStepFactories
]);

const coreWorkflowModules = Object.freeze([
  coreLifecycleWorkflowModule,
  coreInitializationWorkflowModule,
  coreCodingWorkflowModule,
  coreMaintenanceWorkflowModule
]);

function registerCoreWorkflowModules(registry) {
  return registerWorkflowContributorModules(registry, {
    stepFactoryModules: coreWorkflowStepFactoryModules,
    workflowModules: coreWorkflowModules
  });
}

function createCoreWorkflowRegistry({
  stepFactoryModules = [],
  workflowModules = []
} = {}) {
  const registry = createWorkflowRegistry();
  registerCoreWorkflowModules(registry);
  return registerWorkflowContributorModules(registry, {
    stepFactoryModules,
    workflowModules
  });
}

export {
  coreWorkflowModules,
  coreWorkflowStepFactoryModules,
  createCoreWorkflowRegistry,
  registerCoreWorkflowModules
};
