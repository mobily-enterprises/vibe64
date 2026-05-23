import {
  useAiStudioArtifactPreview
} from "@/composables/useAiStudioArtifactPreview.js";

const REPORT_PREVIEW_ID = "report";

function useAiStudioReportPreview(options = {}) {
  return useAiStudioArtifactPreview({
    ...options,
    loadErrorMessage: "Report could not be loaded.",
    previewId: REPORT_PREVIEW_ID
  });
}

export {
  REPORT_PREVIEW_ID,
  useAiStudioReportPreview
};
