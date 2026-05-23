import {
  useAiStudioArtifactPreview
} from "@/composables/useAiStudioArtifactPreview.js";

const HUMAN_INPUT_RESPONSE_PREVIEW_ID = "ai_response";

function useAiStudioHumanInputResponsePreview(options = {}) {
  return useAiStudioArtifactPreview({
    ...options,
    loadErrorMessage: "AI response could not be loaded.",
    previewId: HUMAN_INPUT_RESPONSE_PREVIEW_ID
  });
}

export {
  HUMAN_INPUT_RESPONSE_PREVIEW_ID,
  useAiStudioHumanInputResponsePreview
};
