// A Deploy's first read (steps.js deploy): how the refreshes the Deploy before it started and never read ended, that
// Deploy having stopped in its wait.
import { noteTask } from "./migrations.js";
import { sentence } from "./report.js";

/**
 * What a Deploy that stopped before it read how its refreshes ended (the editor stopped, or a read failed in its wait)
 * left: each refresh it started is read now, and one that failed or was aborted is let go as the run would have let it
 * go, its links made ahead dropped (they ended with it) and its service handed its release again, so the next Deploy
 * makes them again and nothing it holds is stale. A refresh still open is waited for by the next Deploy as it reads
 * the service; should it then fail, the links it ends are made again as the provider no longer holds them (nextStep).
 * A settings refresh that didn't succeed, open or ended, gives its settings again. Answers the record with the reason
 * of each that failed.
 * @param {any} adapter @param {any} record @param {(event: any) => void} tell
 */
async function settleLastRun(adapter, record, tell) {
  const kept = structuredClone(record);
  for (const [service, state] of Object.entries(kept.run?.services ?? {})) {
    const id = kept.items[`service.${service}`]?.id;
    if (!state?.refreshId || !id || kept.run.state === "live") continue;
    const words = `Reading how the last Deploy's update of ${service} ended`;
    tell({ kind: "step", phase: "start", step: "settleRefresh", service, words, refresh: { serviceId: id, refreshId: state.refreshId } });
    const refresh = await adapter.readRefresh(id, state.refreshId);
    noteTask(kept, state, refresh);
    // A settings refresh not known to have succeeded (failed, or still open and may yet fail): the provider may keep the
    // settings the service had, so this Deploy gives them again.
    if (state.settingsRefresh && refresh?.state !== "succeeded") delete kept.items[`service.${service}`].settingsHash;
    if (refresh && (refresh.state === "failed" || refresh.state === "aborted")) {
      for (const resource of state.linkedAhead ?? []) delete kept.items[`resource.${resource}`]?.links?.[service];
      delete kept.items[`service.${service}`].release;
      tell({ kind: "step", phase: "done", step: "settleRefresh", service, words, message: `It ${refresh.state}: `
        + `${sentence(refresh.error?.message ?? "the provider gave no reason")} This Deploy hands ${service} its ${state.settingsRefresh ? "settings and " : ""}release again.` });
    } else tell({ kind: "step", phase: "done", step: "settleRefresh", service, words, message: `It is ${refresh?.state ?? "gone"}.` });
  }
  return kept;
}

export { settleLastRun };
