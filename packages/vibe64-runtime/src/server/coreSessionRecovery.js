import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS,
  createSessionRecoveryCoordinator,
  recoverySignature
} from "./sessionRecovery.js";
import {
  SOURCE_INSPECTION_KINDS
} from "./sessionSourceInspection.js";
import {
  createWorkflowSetupRecoveryProvider
} from "./workflowSetupRecovery.js";

function sourceInspectionRecoveryPresentation(kind = "") {
  if (kind === SOURCE_INSPECTION_KINDS.MERGE_CONFLICT) {
    return {
      explanation: "A Git operation left unresolved source conflicts.",
      title: "Source conflicts need resolution"
    };
  }
  if (kind === SOURCE_INSPECTION_KINDS.PLATFORM_ERROR) {
    return {
      explanation: "Vibe64 application inspection is temporarily unavailable.",
      title: "Application inspection is unavailable"
    };
  }
  return {
    explanation: "Vibe64 found invalid application source metadata.",
    title: "Application source needs repair"
  };
}

function createSourceInspectionRecoveryProvider() {
  return {
    id: "source_inspection",
    async inspect({ session = {} } = {}) {
      const inspection = session.sourceInspection;
      if (inspection?.status !== "error") {
        return null;
      }
      const presentation = sourceInspectionRecoveryPresentation(inspection.kind);
      const conflictedFiles = Array.isArray(inspection.merge?.conflictedFiles)
        ? inspection.merge.conflictedFiles.map(normalizeText).filter(Boolean)
        : [];
      const errorCode = normalizeText(inspection.error?.code) || "vibe64_source_inspection_failed";
      const errorMessage = normalizeText(inspection.error?.message) || "Application source inspection failed.";
      const lastKnownGoodAt = normalizeText(inspection.lastKnownGood?.capturedAt);
      return {
        blockedCapabilities: [SESSION_RECOVERY_CAPABILITY_WORKFLOW_PROGRESS],
        code: errorCode,
        evidence: [
          ...(conflictedFiles.length
            ? [{
                label: "Conflicted files",
                value: conflictedFiles.join(", ")
              }]
            : []),
          {
            label: "Inspection error",
            value: errorMessage
          },
          ...(lastKnownGoodAt
            ? [{
                label: "Last valid adapter snapshot",
                value: lastKnownGoodAt
              }]
            : [])
        ],
        explanation: `${presentation.explanation} Source-dependent workflow actions are paused; session controls and repair tools remain available.`,
        id: "source_inspection",
        options: [],
        signature: recoverySignature({
          conflictedFiles,
          errorCode,
          errorMessage,
          kind: inspection.kind
        }),
        title: presentation.title
      };
    }
  };
}

function createCoreSessionRecoveryCoordinator() {
  return createSessionRecoveryCoordinator({
    providers: [
      createSourceInspectionRecoveryProvider(),
      createWorkflowSetupRecoveryProvider()
    ]
  });
}

export {
  createCoreSessionRecoveryCoordinator
};
