import crypto from "node:crypto";

import {
  applySessionWorkUpdateDirect,
  captureSessionWorkUpdateCheckpointDirect,
  prepareSessionWorkUpdateDirect,
  regenerateSessionWorkUpdateDirect
} from "../../packages/vibe64-terminals/src/server/sessionWorkUpdate.js";

/**
 * Runs the four Update stages that the session work helper runs, in this
 * process, so a test can supply its own command runner and derived-artifact
 * refresh. The managed `updateSessionWork` covers locking and progress.
 * @param {object} input the Update input that the helper's stages receive
 */
async function updateSessionWorkInProcess(input) {
  const stageInput = { derivedArtifactPaths: [], operationId: crypto.randomUUID(), ...input };
  const checkpoint = await captureSessionWorkUpdateCheckpointDirect(stageInput);
  const prepared = await prepareSessionWorkUpdateDirect({ ...stageInput, checkpoint });
  if (prepared.status === "already_current") return prepared;
  const regenerated = await regenerateSessionWorkUpdateDirect({ ...stageInput, prepared });
  return applySessionWorkUpdateDirect({ ...stageInput, prepared: regenerated });
}

export { updateSessionWorkInProcess };
