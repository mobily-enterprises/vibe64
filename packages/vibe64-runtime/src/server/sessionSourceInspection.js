import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const SOURCE_INSPECTION_KINDS = Object.freeze({
  MERGE_CONFLICT: "merge_conflict",
  PLATFORM_ERROR: "platform_error",
  SOURCE_ERROR: "source_error"
});

const PROJECT_MANIFEST_SOURCE_ERROR_CODES = new Set([
  "vibe64_committed_project_manifest_invalid",
  "vibe64_project_manifest_invalid_json",
  "vibe64_project_manifest_object_required",
  "vibe64_project_manifest_schema_unsupported"
]);

function isSourceMetadataError(error = null) {
  const code = normalizeText(error?.code);
  return PROJECT_MANIFEST_SOURCE_ERROR_CODES.has(code) ||
    /^vibe64_invalid_[a-z0-9_]*json$/u.test(code);
}

function sourceInspectionFailure(error = null, {
  merge = null
} = {}) {
  const conflictedFiles = Array.isArray(merge?.conflictedFiles)
    ? merge.conflictedFiles.map(normalizeText).filter(Boolean)
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
  if (isSourceMetadataError(error)) {
    return {
      error: {
        code: normalizeText(error?.code),
        message: "Application source metadata is invalid and must be repaired."
      },
      kind: SOURCE_INSPECTION_KINDS.SOURCE_ERROR
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
    return "Resolve the source conflicts before running this workflow operation.";
  }
  if (inspection.kind === SOURCE_INSPECTION_KINDS.SOURCE_ERROR) {
    return "Repair the application source metadata before running this workflow operation.";
  }
  return "Application inspection must recover before running this workflow operation.";
}

function sourceInspectionBlockedError(inspection = {}) {
  const error = vibe64Error(
    normalizeText(inspection.error?.message) || sourceInspectionDisabledReason(inspection),
    normalizeText(inspection.error?.code) || "vibe64_source_inspection_unavailable"
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
  SOURCE_INSPECTION_KINDS,
  assertSourceInspectionHealthy,
  isSourceMetadataError,
  sourceInspectionDisabledReason,
  sourceInspectionFailure
};
