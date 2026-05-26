import {
  registerWorkflowStepFactories,
  registerWorkflowSteps,
  registerWorkflows
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
  coreMaintenanceWorkflowModule
} from "./workflowModules/coreMaintenance.js";

registerWorkflowStepFactories(coreWorkflowStepFactories.id, coreWorkflowStepFactories.factories);

[
  coreLifecycleWorkflowModule,
  coreCodingWorkflowModule,
  coreMaintenanceWorkflowModule
].forEach((module) => {
  registerWorkflowSteps(module.id, module.stepDefinitions);
  if (module.workflowDefinitions.length > 0) {
    registerWorkflows(module.id, module.workflowDefinitions);
  }
  registerWorkflowSteps(module.id, module.stepMachineContributions);
});
