import { createService } from "./service.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./admission.js").UsageRecordingAdmission} UsageRecordingAdmission */

/**
 * The usage recording capability: the service and the admission decision it uses.
 * @param {object} dependencies
 * @param {UsageRecordingAdmission} dependencies.admission
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 */
function createUsageRecording({
  admission,
  events,
  logger,
  project,
  terminals
}) {
  const {
    readTargets,
    start,
    readCurrent,
    stop,
    dismiss,
    list,
    readRequests,
    readRequestFunctions,
    recordInteraction,
    delete: deleteRecording
  } = createService({
    admission,
    events,
    logger,
    project,
    terminals
  });
  return Object.freeze({
    admit: admission,
    readTargets,
    start,
    readCurrent,
    stop,
    dismiss,
    list,
    readRequests,
    readRequestFunctions,
    recordInteraction,
    delete: deleteRecording
  });
}

export { createUsageRecording };
