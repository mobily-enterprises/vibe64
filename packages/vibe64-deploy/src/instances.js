// An App Service's count: a running setting the provider holds, never part of a Deploy (steps.js), which makes a
// service with the count its plan chose and leaves the count of one that runs as it is. The owner's scale action sets
// it here, at once; the provider's own controls and an app scaling its own service with its key set it too. The record
// keeps no copy of it.
import { randomBytes } from "node:crypto";

import { deployError } from "./steps.js";

/**
 * Sets how many instances an App Service runs, at its provider and at once: the owner's scale action, never part of
 * a Deploy. Only a service the record holds and the Stack names, and a whole count within its `- Instances:` range,
 * refused naming the range; the provider may still refuse it (its own limits, a quota, no room for more). Its own
 * idempotency key each time, so a count set again after an app or the provider changed it is asked again, not answered
 * with the first answer. The record keeps no count, so it is unchanged. Answers the count asked and the refresh the
 * provider started for it, null where it starts none (mobilynet, AWS and Google place or drain instances at once).
 * @param {any} adapter @param {any} record @param {any} needs @param {{ service: string, instances: number }} which
 * @returns {Promise<{ service: string, instances: number, refreshId: string | null }>}
 */
async function setInstances(adapter, record, needs, { service, instances }) {
  const need = needs.services.find((one) => one.id === service);
  const item = record?.items?.[`service.${service}`];
  if (!need || !item?.id) throw deployError("deployment_item_unknown", `${service} isn't an App Service this deployment runs.`, 404);
  const { min, max } = need.instances;
  if (!Number.isInteger(instances) || instances < min || instances > max) {
    throw deployError("deployment_instances_outside", `${service} runs ${min} to ${max} instances, as genesis/stack.md's - Instances: says.`, 422, { min, max });
  }
  const idempotencyKey = [record.deploymentId, "instances", service, instances, randomBytes(6).toString("hex")].join("-");
  const refreshId = await adapter.changeService(item.id, { instances }, { idempotencyKey });
  return { service, instances, refreshId: refreshId ?? null };
}

export { setInstances };
