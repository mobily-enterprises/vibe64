import { vibe64Error } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const SOURCE_INSPECTION_KINDS = Object.freeze({
  MERGE_CONFLICT: "merge_conflict",
  PLATFORM_ERROR: "platform_error"
});

function sourceInspectionFailure({
  merge = null
} = {}) {
  const conflictedFiles = Array.isArray(merge?.conflictedFiles)
    ? merge.conflictedFiles.map(toText).filter(Boolean)
    : [];
  if (conflictedFiles.length > 0) {
    return {
      error: {
        code: "vibe64_source_merge_conflict",
        message: "The application source has unresolved Git conflicts."
      },
      kind: SOURCE_INSPECTION_KINDS.MERGE_CONFLICT,
      merge: {
        conflictedFiles
      }
    };
  }
  return {
    error: {
      code: "vibe64_source_inspection_unavailable",
      message: "Vibe64 could not inspect this application right now."
    },
    kind: SOURCE_INSPECTION_KINDS.PLATFORM_ERROR
  };
}

function sourceInspectionDisabledReason(inspection = {}) {
  if (inspection.kind === SOURCE_INSPECTION_KINDS.MERGE_CONFLICT) {
    return "Resolve the source conflicts before changing this session source.";
  }
  return "Application inspection must recover before changing this session source.";
}

function sourceInspectionBlockedError(inspection = {}) {
  const error = vibe64Error(
    toText(inspection.error?.message) || sourceInspectionDisabledReason(inspection),
    toText(inspection.error?.code) || "vibe64_source_inspection_unavailable"
  );
  error.sourceInspection = inspection;
  return error;
}

function assertSourceInspectionHealthy(inspection = null) {
  if (inspection?.status === "error") {
    throw sourceInspectionBlockedError(inspection);
  }
}

export {
  assertSourceInspectionHealthy,
  sourceInspectionFailure
};
