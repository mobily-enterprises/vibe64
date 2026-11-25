// Take Production offline and Delete, beside a Deploy (steps.js): `takeOffline` deletes every App Service a record holds,
// the public one first, keeping its resources and their data for the next Deploy, and waits until the provider lists
// none of them; `deleteResource` deletes one resource the Stack no longer names, with its data, when the owner typed its
// name. Both answer the record without what they deleted.

import { reporterOf } from "./report.js";
import { backoffPauses, deployError, retryable } from "./steps.js";

// How long takeOffline waits between reads of the provider while the services go, and how many reads it makes: an
// instance leaving drains first (mobilynet's 30 seconds and its stop signal's as long again; AWS's load balancer its
// 300), so ten minutes in all.
const OFFLINE_PAUSE_MS = 5_000;
const OFFLINE_READS = 120;

/**
 * Takes the environment's services down, the public one first: their services go, every resource and its data stay.
 * Once each delete is asked the record without them is kept (`save`); then the provider is read again (`pause` between
 * reads) until it lists none of them, each instance having drained, and the record is answered. A provider still
 * removing some after `maxReads` reads is refused `production_deploy_offline_unfinished`, naming them: the record kept says
 * they are gone, and the provider finishes removing them by itself.
 * @param {any} adapter @param {any} record
 * @param {{ save?: (record: any) => Promise<any> | any, pause?: () => Promise<void> | void, maxReads?: number, report?: (event: any) => unknown }} [options]
 *   `report` told each delete as it starts and ends, the wait, each service gone (`{ kind: "gone", service, words }`),
 *   each read tried again and the end, as a Deploy tells them
 */
async function takeOffline(adapter, record, {
  save = (kept) => kept, pause = () => new Promise((resolve) => setTimeout(resolve, OFFLINE_PAUSE_MS)), maxReads = OFFLINE_READS, report = () => {}
} = {}) {
  const tell = reporterOf(report);
  const kept = structuredClone(record);
  const services = Object.values(kept.items).filter((item) => item.kind === "service")
    .sort((one, other) => (one.exposure === "public" ? -1 : 0) - (other.exposure === "public" ? -1 : 0));
  for (const item of services) {
    const words = `Deleting App Service ${item.name}`;
    tell({ kind: "step", phase: "start", step: "deleteService", service: item.name, words });
    await adapter.deleteService(item.id);
    // The App Service it was made in place of, while a Deploy that stopped in between left it running (steps.js 8).
    if (item.replaces) await adapter.deleteService(item.replaces.id).catch((error) => { if (![404, 409].includes(error?.status)) throw error; });
    tell({ kind: "step", phase: "done", step: "deleteService", service: item.name, words });
    delete kept.items[`service.${item.name}`];
    for (const resource of Object.values(kept.items)) delete resource.links?.[item.name];
  }
  const saved = await save(kept);
  const going = new Map(services.map((item) => [item.id, item.name]));
  let left = [...going.values()];
  let waiting = null;
  let failedReads = 0;
  for (let read = 0; read < maxReads; read += 1) {
    let listed;
    try {
      listed = await adapter.inventory();
      failedReads = 0;
    } catch (error) {
      if (!retryable(error)) throw error;
      failedReads += 1;
      tell({ kind: "retry", words: `Reading ${adapter.title} again`, attempt: failedReads, message: error.message });
      for (let one = 0; one < backoffPauses(failedReads); one += 1) await pause();
      continue;
    }
    const now = listed.filter((thing) => going.has(thing.id)).map((thing) => going.get(thing.id));
    for (const name of left.filter((one) => !now.includes(one))) tell({ kind: "gone", service: name, words: `App Service ${name} is gone` });
    left = now;
    if (left.length === 0) {
      tell({ kind: "end", outcome: "offline" });
      return saved;
    }
    const words = `Waiting for ${adapter.title} to remove ${left.join(" and ")}`;
    if (words !== waiting) tell({ kind: "wait", words });
    waiting = words;
    await pause();
  }
  throw deployError("production_deploy_offline_unfinished", `${left.join(" and ")} ${left.length === 1 ? "is" : "are"} still being removed at ${adapter.title}; `
    + "they take no new requests, and it finishes removing them by itself.", 504, { removing: left });
}

/**
 * Deletes a disconnected resource and its data, its own action: only one the record holds and the Stack no longer
 * names, and only when the owner typed its name.
 * @param {any} adapter @param {any} record @param {any} needs @param {{ name: string, typed: string }} which
 */
async function deleteResource(adapter, record, needs, { name, typed }) {
  const item = record.items[`resource.${name}`];
  if (!item) throw deployError("production_deploy_item_unknown", `${name} isn't a resource this deployment made.`, 404);
  if (needs.resources.some((one) => one.id === name)) throw deployError("production_deploy_resource_in_use", `genesis/stack.md still names ${name}: remove it there first.`);
  if (typed !== name) throw deployError("production_deploy_confirmation_wrong", `Type ${name} to delete it and its data.`, 422);
  await adapter.deleteResource(item.id);
  const kept = structuredClone(record);
  delete kept.items[`resource.${name}`];
  return kept;
}

export { deleteResource, takeOffline };
