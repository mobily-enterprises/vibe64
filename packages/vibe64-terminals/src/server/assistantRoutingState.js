/**
 * One routing's shared state: its settings, the requests it is preparing, their send timings,
 * the follow-ups it schedules live, the cancelled messages whose cleanup has not settled, and the interrupted
 * turns it resumes after a wait.
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
  // Messages of requests Stop recorded without the lock, while a Save or Update held it, kept stopped likewise
  // until the next locked admission or settle.
  const stopping = new Set();
  // That cleanup runs after Cancel answers; routing's close waits for it, so it
  // writes nothing once the server has closed.
  const settling = new Set();
  // Interrupted turns this process resumes after a short wait (a lost connection, an overloaded AI service), by
  // request key; close clears them, and the next server's reconcile schedules any left.
  const resumeTimers = new Map();

  return Object.freeze({
    systemRoot,
    allowAuto,
    running,
    timings,
    liveFollowupRequests,
    cancelling,
    stopping,
    settling,
    resumeTimers
  });
}

export {
  createAssistantRoutingState
};
