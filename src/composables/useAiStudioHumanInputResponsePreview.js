import {
  useAiStudioArtifactPreview
} from "@/composables/useAiStudioArtifactPreview.js";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";

const EDIT_HUMAN_INPUT_RESPONSE_ACTION_ID = "edit_human_input_response";

function useAiStudioHumanInputResponsePreview(options = {}) {
  return useAiStudioArtifactPreview({
    ...options,
    actionId: EDIT_HUMAN_INPUT_RESPONSE_ACTION_ID,
    artifactName: HUMAN_INPUT_RESPONSE_ARTIFACT,
    loadErrorMessage: "AI response could not be loaded."
  });
}

export {
  EDIT_HUMAN_INPUT_RESPONSE_ACTION_ID,
  useAiStudioHumanInputResponsePreview
};
