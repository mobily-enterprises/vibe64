import {
  createSessionRecoveryCoordinator
} from "./sessionRecovery.js";
import {
  createWorkflowSetupRecoveryProvider
} from "./workflowSetupRecovery.js";

function createCoreSessionRecoveryCoordinator() {
  return createSessionRecoveryCoordinator({
    providers: [createWorkflowSetupRecoveryProvider()]
  });
}

export {
  createCoreSessionRecoveryCoordinator
};
