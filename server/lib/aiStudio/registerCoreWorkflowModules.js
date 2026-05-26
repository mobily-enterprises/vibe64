import {
  registerWorkflowStepFactories,
  registerWorkflowSteps,
  registerWorkflows
} from "./workflowRegistry.js";
import {
  coreWorkflowStepFactoryModule
} from "./workflowStepFactories.js";
import {
  coreCodingWorkflowDefinitionModule,
  coreCodingWorkflowMachineModule
} from "./workflowModules/coreCoding.js";
import {
  coreLifecycleWorkflowDefinitionModule,
  coreLifecycleWorkflowMachineModule
} from "./workflowModules/coreLifecycle.js";
import {
  coreMaintenanceWorkflowDefinitionModule,
  coreMaintenanceWorkflowMachineModule
} from "./workflowModules/coreMaintenance.js";

const stepFactoryModule = coreWorkflowStepFactoryModule();
registerWorkflowStepFactories(stepFactoryModule.id, stepFactoryModule.stepFactories);

[
  coreLifecycleWorkflowDefinitionModule(),
  coreCodingWorkflowDefinitionModule(),
  coreMaintenanceWorkflowDefinitionModule()
].forEach((module) => {
  registerWorkflowSteps(module.id, module.steps);
  if (module.workflows) {
    registerWorkflows(module.id, module.workflows);
  }
});

[
  coreLifecycleWorkflowMachineModule(),
  coreCodingWorkflowMachineModule(),
  coreMaintenanceWorkflowMachineModule()
].forEach((module) => {
  registerWorkflowSteps(module.id, module.steps);
});
