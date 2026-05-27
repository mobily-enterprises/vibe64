import {
  useVibe64ArtifactPreview
} from "@/composables/useVibe64ArtifactPreview.js";

const REPORT_PREVIEW_ID = "report";

function useVibe64ReportPreview(options = {}) {
  return useVibe64ArtifactPreview({
    ...options,
    loadErrorMessage: "Report could not be loaded.",
    previewId: REPORT_PREVIEW_ID
  });
}

export {
  REPORT_PREVIEW_ID,
  useVibe64ReportPreview
};
