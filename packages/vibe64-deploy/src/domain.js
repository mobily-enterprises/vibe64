// The domain a running public App Service answers at, moved at once by its owner's own action, through the caller
// that keeps which domain the deployment serves; the record keeps no copy. A Deploy routes its release's domain
// to the public service as well (address.js, its step 7), once that service serves the release; this moves it now,
// with no release, through the same adapter call (takeDomain).
import { randomBytes } from "node:crypto";

import { deployError } from "./steps.js";

/**
 * Moves the Stack's public App Service, as the record holds it, to `domain`, at its provider and at once: the domain
 * first added to the provider project where none covers it, then routed to the service in place of the one it
 * answered at (on mobilynet that one's route is kept, sending to nothing, its DNS target with it). Never with `take`:
 * a name another App Service, a machine or a group of the project answers at stays theirs, refused by the provider
 * (mobilynet's `409 name_taken`), as a Deploy never takes from a thing its record doesn't hold. Refused before the
 * provider is asked anything when the record holds no such service, and by an adapter that can't route one. Its own
 * idempotency keys each time, so a domain moved to again after another is asked again. The record is unchanged.
 * @param {any} adapter @param {any} record @param {any} needs @param {{ domain: string }} where
 * @returns {Promise<{ service: string, domain: string }>}
 */
async function moveDomain(adapter, record, needs, { domain }) {
  const service = needs.services.find((one) => one.exposure === "public")?.id;
  const item = service ? record?.items?.[`service.${service}`] : null;
  if (!item?.id) throw deployError("deployment_item_unknown", "This deployment runs no public App Service to move.", 404);
  if (typeof adapter.takeDomain !== "function") {
    throw deployError("deployment_domain_move_unsupported", `${adapter.title} can't move a running service to another domain.`, 409);
  }
  const key = [record.deploymentId, "takeDomain", service, domain, randomBytes(6).toString("hex")].join("-");
  await adapter.ensureDomain(domain, { idempotencyKey: `${key}-domain` });
  await adapter.takeDomain(item.id, domain, { take: false, idempotencyKey: key });
  return { service, domain };
}

export { moveDomain };
