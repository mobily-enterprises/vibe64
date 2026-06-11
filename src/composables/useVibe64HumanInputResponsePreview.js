import {
  useVibe64ArtifactPreview
} from "@/composables/useVibe64ArtifactPreview.js";

const HUMAN_INPUT_RESPONSE_PREVIEW_ID = "ai_response";

function useVibe64HumanInputResponsePreview(options = {}) {
  return useVibe64ArtifactPreview({
    ...options,
    loadErrorMessage: "Reply could not be loaded.",
    previewId: HUMAN_INPUT_RESPONSE_PREVIEW_ID
  });
}

export {
  HUMAN_INPUT_RESPONSE_PREVIEW_ID,
  useVibe64HumanInputResponsePreview
};
