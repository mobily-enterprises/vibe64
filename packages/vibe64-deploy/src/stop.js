// Stopping a Deploy while it runs (steps.js deploy, its `stopAsked`): the workspace owner's way out of a Deploy that
// waits, such as one whose build is queued at its provider behind another. A Deploy stops only while nothing it did has
// reached what Production serves: no service runs its new release yet, and every update it started is still before
// its build passed, so no release task (its migrations) and no new instance has started. Each such update is stopped
// at the provider (the adapter's stopRefresh: the update aborted, its build ended) and the run kept `stopped`: the
// services keep the version they ran, and the next Deploy reads how those updates ended (lastRun.js) and hands their
// releases again. Past that point a stop is refused, saying why: the Deploy goes on and ends by itself.

// The states of a provider's update still open: before its build passed, it can be stopped.
const OPEN_UPDATE = Object.freeze(["queued", "building"]);
// The stop's words in the Deploy's log.
const STOP_WORDS = "Stopping this Deploy, as the workspace owner asked";

/**
 * Whether the Deploy a record runs may stop now: `{ allowed: true, refreshes }`, the updates it started that are still
 * open (`{ service, id, refreshId, buildId }`), each before its build passed; or `{ allowed: false, reason }`, why not,
 * in words the owner reads. A record whose run isn't deploying holds nothing open: allowed, with nothing to stop.
 * @param {any} adapter the provider's adapter: its `refreshProgress` says where an update stands
 * @param {any} record the record as the Deploy kept it last
 * @returns {Promise<{ allowed: true, refreshes: Array<{ service: string, id: string, refreshId: string, buildId: string | null }> } | { allowed: false, reason: string }>}
 */
async function deployStopOf(adapter, record) {
  const run = record?.run;
  if (run?.state !== "deploying") return { allowed: true, refreshes: [] };
  const refreshes = [];
  for (const [service, state] of Object.entries(run.services ?? {})) {
    const id = record.items[`service.${service}`]?.id;
    // Handed this Deploy's release, and its update ended: it succeeded (a failed one fails the Deploy).
    if (state?.handed && !state.refreshId) return refused(`The service ${service} already runs its new release, and stopping now would leave Production partly on it.`);
    if (!state?.refreshId || !id) continue;
    if (typeof adapter.refreshProgress !== "function") return refused(`The update of ${service} under way can't be stopped at ${adapter.title}.`);
    const progress = await adapter.refreshProgress(id, state.refreshId);
    if (progress.started) {
      return refused(state.handed
        ? `The new release of ${service} is past its build: its migrations or its new instances have started.`
        : `The instances of ${service} are restarting with its new settings.`);
    }
    if (OPEN_UPDATE.includes(progress.state)) refreshes.push({ service, id, refreshId: state.refreshId, buildId: progress.buildId ?? null });
  }
  return { allowed: true, refreshes };
}

/** A stop refused: why, then what the Deploy does. @param {string} why */
const refused = (why) => ({ allowed: false, reason: `This Deploy can't be stopped now. ${why} It goes on and ends by itself: Live, or Failed with its reason.` });

/**
 * Stops the updates a stop allowed (deployStopOf's `refreshes`) at the provider, and answers the record with its run
 * `stopped` (its services' updates stay named in it, for the next Deploy to read how they ended) and the log's words
 * for what was ended.
 * @param {any} adapter @param {any} record
 * @param {Array<{ service: string, id: string, refreshId: string, buildId: string | null }>} refreshes
 */
async function stopRun(adapter, record, refreshes) {
  const said = [];
  for (const one of refreshes) {
    const { buildEnded, buildRefusal } = await adapter.stopRefresh(one.id, one.refreshId, one.buildId);
    const build = !one.buildId ? "" : buildEnded
      ? `, and its build ${one.buildId}`
      : `; its build ${one.buildId} could not be ended (${buildRefusal}) and ends at ${adapter.title} by itself`;
    said.push(`Ended the update of ${one.service}${build}.`);
  }
  const ended = said.length > 0 ? said.join(" ") : "No update of a service was under way.";
  return {
    record: { ...structuredClone(record), run: { ...record.run, state: "stopped", failure: null } },
    message: `${ended} Production keeps serving the version it served before this Deploy; deploy again whenever you're ready.`
  };
}

/**
 * A stop asked of a Deploy, at its step's boundary (steps.js deploy): where deployStopOf allows it, the updates stopped,
 * the record kept `stopped` (`save`) and the end told, answering `{ outcome: "stopped", message, record }`; otherwise
 * the refusal told with its reason, answering null. The stop's start is told when `first`. A provider that doesn't
 * answer throws, for the Deploy to try again.
 * @param {{ adapter: any, record: any, save: (record: any) => any, tell: (event: any) => void, first: boolean }} options
 */
async function stopAtBoundary({ adapter, record, save, tell, first }) {
  if (first) tell({ kind: "step", phase: "start", step: "stop", words: STOP_WORDS });
  const decision = await deployStopOf(adapter, record);
  if (!decision.allowed) {
    tell({ kind: "step", phase: "refused", step: "stop", words: STOP_WORDS, message: decision.reason });
    return null;
  }
  const { record: stopped, message } = await stopRun(adapter, record, decision.refreshes);
  const kept = await save(stopped);
  tell({ kind: "step", phase: "done", step: "stop", words: STOP_WORDS });
  tell({ kind: "end", outcome: "stopped", message });
  return { outcome: "stopped", message, record: kept };
}

export { STOP_WORDS, deployStopOf, stopAtBoundary };
