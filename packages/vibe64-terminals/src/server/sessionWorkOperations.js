// The session work child's operations, which sessionWorkOperationCommand.js runs one per process: each one's Git
// work, through the runner the caller gives, and the answer the child writes for its parent.
import { AppError } from "@jskit-ai/kernel/server/runtime";
import {
  applySessionWorkUpdateDirect,
  captureSessionWorkUpdateCheckpointDirect,
  checkSessionUpdatesDirect,
  prepareSessionWorkUpdateDirect,
  regenerateSessionWorkUpdateDirect
} from "./sessionWorkUpdate.js";
import { inspectSessionUpdateFailureDirect } from "./sessionWorkUpdateRecovery.js";
import {
  inspectSessionChangeDiffDirect,
  inspectSessionChangesDirect,
  inspectSessionWorkDirect,
  prepareSessionWorkSaveMessageDirect,
  refreshSessionWorkSaveCacheDirect,
  saveSessionWorkDirect
} from "./sessionWorkSave.js";

const OPERATION_IMPLEMENTATIONS = {
  "change-diff": inspectSessionChangeDiffDirect,
  "changes": inspectSessionChangesDirect,
  "check-updates": checkSessionUpdatesDirect,
  "save": async (input) => {
    const { refreshGenesisCities } = await import("@local/vibe64-genesis/server");
    return saveSessionWorkDirect({
      ...input,
      deferCacheMaintenance: true,
      refreshDerivedArtifacts: refreshGenesisCities
    });
  },
  "save-maintenance": refreshSessionWorkSaveCacheDirect,
  "save-message": prepareSessionWorkSaveMessageDirect,
  "work": inspectSessionWorkDirect,
  "update-failure": inspectSessionUpdateFailureDirect,
  "update-checkpoint": captureSessionWorkUpdateCheckpointDirect,
  "update-prepare": prepareSessionWorkUpdateDirect,
  "update-derived": async (input) => {
    const { refreshGenesisCities } = await import("@local/vibe64-genesis/server");
    return regenerateSessionWorkUpdateDirect({ ...input, refreshDerivedArtifacts: refreshGenesisCities });
  },
  "update-apply": applySessionWorkUpdateDirect
};

/**
 * The failure the parent rethrows: a refusal keeps its status, code and message code; any other failure is a 500.
 * @param {unknown} error
 */
function errorResponse(error) {
  return {
    error: {
      code: String(error?.code || "vibe64_session_work_operation_failed"),
      details: error?.details && typeof error.details === "object" && !Array.isArray(error.details)
        ? error.details
        : {},
      message: String(error?.message || "Session repository operation failed."),
      ...(error?.messageCode ? { messageCode: error.messageCode, messageParams: error.messageParams } : {}),
      status: error instanceof AppError ? error.status : 500
    },
    ok: false
  };
}

/**
 * One operation of the session work child, answered as the child writes it: `{ ok: true, value }`, or the failure.
 * @param {{ operation?: string, input?: object }} payload the child's request, without its host profile
 * @param {{ runCommand: (request: object) => Promise<object> }} options how its Git commands run
 */
async function performSessionWorkOperation(payload, { runCommand }) {
  try {
    const implementation = OPERATION_IMPLEMENTATIONS[String(payload?.operation || "")];
    if (!implementation) {
      const error = new Error("Unsupported session repository operation.");
      error.code = "vibe64_session_work_operation_unsupported";
      throw error;
    }
    const value = await implementation({
      ...(payload.input && typeof payload.input === "object" ? payload.input : {}),
      runCommand
    });
    return { ok: true, value };
  } catch (error) {
    return errorResponse(error);
  }
}

export { errorResponse as sessionWorkOperationFailure, performSessionWorkOperation };
