import {
  useAiStudioArtifactPreview
} from "@/composables/useAiStudioArtifactPreview.js";
import {
  REPORT_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";

const EDIT_REPORT_ACTION_ID = "edit_report";

function useAiStudioReportPreview(options = {}) {
  return useAiStudioArtifactPreview({
    ...options,
    actionId: EDIT_REPORT_ACTION_ID,
    artifactName: REPORT_ARTIFACT,
    loadErrorMessage: "Report could not be loaded."
  });
}

export {
  EDIT_REPORT_ACTION_ID,
  useAiStudioReportPreview
};
