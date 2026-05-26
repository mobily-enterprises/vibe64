import {
  createChatWithAiMachine,
  createEditableArtifactReviewMachine
} from "./workflowStepMachineHelpers.js";

const coreWorkflowStepFactories = Object.freeze({
  factories: Object.freeze([
    {
      createMachine: createChatWithAiMachine,
      id: "chat_with_ai"
    },
    {
      createMachine: createEditableArtifactReviewMachine,
      id: "editable_artifact_review"
    }
  ]),
  id: "core.step_factories"
});

export {
  coreWorkflowStepFactories
};
