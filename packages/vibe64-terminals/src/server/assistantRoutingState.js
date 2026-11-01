/**
 * One routing's shared state: its settings, the requests it is preparing, their send timings,
 * the follow-ups it schedules live, and the cancelled messages whose cleanup has not settled.
 * @param {object} settings
 * @param {string} settings.systemRoot
 * @param {boolean} settings.allowAuto
 */
function createAssistantRoutingState({ systemRoot, allowAuto }) {
  const running = new Map();
  // Sub-phase times of each send before native delivery, reported once.
  const timings = new Map();

  const liveFollowupRequests = new Map();

  // Messages cancelled in this process whose lock-held cleanup has not settled.
  // A request naming one stays stopped, whichever operation saves it meanwhile.
  const cancelling = new Set();

  return Object.freeze({
    systemRoot,
    allowAuto,
    running,
    timings,
    liveFollowupRequests,
    cancelling
  });
}

export {
  createAssistantRoutingState
};
