import { existsSync } from "node:fs";
import path from "node:path";
import { runCaptureCommand } from "@local/vibe64-execution/server";
import {
  inspectIncomingContributionsDirect,
  changeIncomingContributionDirect,
  checkSessionUpdatesDirect,
  captureSessionWorkUpdateCheckpointDirect,
  prepareSessionWorkUpdateDirect,
  regenerateSessionWorkUpdateDirect,
  applySessionWorkUpdateDirect,
  inspectSessionChangeDiffDirect,
  inspectSessionChangesDirect,
  inspectSessionWorkDirect,
  prepareSessionWorkSaveMessageDirect,
  refreshSessionWorkSaveCacheDirect,
  saveSessionWorkDirect
} from "./sessionWorkSave.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const OPERATION_IMPLEMENTATIONS = {
  "incoming": inspectIncomingContributionsDirect,
  "incoming-change": async (input) => {
    const { refreshGenesisCities } = await import("@local/vibe64-genesis/server");
    return changeIncomingContributionDirect({ ...input, refreshDerivedArtifacts: refreshGenesisCities });
  },
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
  "save-message": async (input) => {
    // Map regeneration validates the project's Stack before publication. Catch
    // missing contracts before optional model naming, without rewriting source.
    if (input.derivedArtifactPaths?.length && existsSync(path.join(input.session.sourcePath, "genesis/blueprint.md"))) {
      const { inspectGenesisStackComponents } = await import("@local/vibe64-genesis/server");
      await inspectGenesisStackComponents({ projectRoot: input.session.sourcePath });
    }
    return prepareSessionWorkSaveMessageDirect(input);
  },
  "work": inspectSessionWorkDirect,
  "update-checkpoint": captureSessionWorkUpdateCheckpointDirect,
  "update-prepare": prepareSessionWorkUpdateDirect,
  "update-derived": async (input) => {
    const { refreshGenesisCities } = await import("@local/vibe64-genesis/server");
    return regenerateSessionWorkUpdateDirect({ ...input, refreshDerivedArtifacts: refreshGenesisCities });
  },
  "update-apply": applySessionWorkUpdateDirect
};

function runLocalCommand(request = {}) {
  return runCaptureCommand(request.command, request.args, {
    cwd: request.cwd,
    env: {
      ...process.env,
      ...(request.env || {})
    },
    execution: request.execution,
    input: request.input,
    maxBuffer: request.maxBuffer,
    outputEncoding: request.outputEncoding,
    timeout: request.timeout
  });
}

async function readInput() {
  let serialized = "";
  for await (const chunk of process.stdin) {
    serialized += String(chunk || "");
    if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) {
      throw new Error("Session repository operation input is too large.");
    }
  }
  return JSON.parse(serialized || "{}");
}

function errorResponse(error) {
  return {
    error: {
      code: String(error?.code || "vibe64_session_work_operation_failed"),
      details: error?.details && typeof error.details === "object" && !Array.isArray(error.details)
        ? error.details
        : {},
      message: String(error?.message || "Session repository operation failed.")
    },
    ok: false
  };
}

try {
  const payload = await readInput();
  const implementation = OPERATION_IMPLEMENTATIONS[String(payload?.operation || "")];
  if (!implementation) {
    const error = new Error("Unsupported session repository operation.");
    error.code = "vibe64_session_work_operation_unsupported";
    throw error;
  }
  const value = await implementation({
    ...(payload.input && typeof payload.input === "object" ? payload.input : {}),
    runCommand: runLocalCommand
  });
  process.stdout.write(JSON.stringify({ ok: true, value }));
} catch (error) {
  process.stdout.write(JSON.stringify(errorResponse(error)));
  process.exitCode = 1;
}
