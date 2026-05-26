import {
  createChatWithAiMachine,
  createEditableArtifactReviewMachine
} from "./workflowStepMachineHelpers.js";

function coreWorkflowStepFactoryModule() {
  return {
    id: "core.step_factories",
    stepFactories: Object.freeze([
      {
        createMachine: createChatWithAiMachine,
        id: "chat_with_ai"
      },
      {
        createMachine: createEditableArtifactReviewMachine,
        id: "editable_artifact_review"
      }
    ])
  };
}

export {
  coreWorkflowStepFactoryModule
};
