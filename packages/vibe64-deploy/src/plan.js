// The Plan: what a Deploy of a project's environment will do to each item, like `terraform plan`, from the Stack's
// needs (the desired state), the record (what Vibe64 made) and what the provider reports now (refreshed first: the
// adapter's inventory of every thing of the provider project). Each service is offered the provider's sizes that meet
// its `- Needs at least`, cheapest first; each item gets its verb (new, kept, changed, replaced, removed, disconnected,
// missing) and the drift between the record and the provider (a size changed by hand), which the owner decides, per
// difference, to keep or to put back; things of the provider project that are not this deployment's are listed and left
// alone. An App Service's count is a running setting, not part of a Deploy: a service the Deploy makes (new, or gone at
// the provider) starts with the count chosen or the Stack's `- Production:`, and one the provider runs keeps the count
// it runs there, which the Plan shows and prices (`instances.live`) and the Deploy never changes; only `setInstances`
// (steps.js) does. The record keeps no count, and one an older record holds is ignored. The quote is at list price. The
// hash covers the needs, the choices in effect, the decisions and a digest of the observed state, so a Deploy whose
// plan was read before anything moved (a size, a count, a price, a thing gone or changed by hand) is refused and the
// plan read again. Where the provider's offer says its project's quotas and what is used of them, the Plan counts what
// the Deploy adds to each and names any it would pass, before anything is made (quotaOf); where it doesn't, the Plan
// says they aren't checked. The hash leaves the quotas out: their use moves with the rest of the provider project, and
// the Deploy counts them again as it starts.
//
// Nothing here calls a provider: the adapter's `offer()` and `inventory()` answer what the plan reads.
import { createHash } from "node:crypto";

import { LABEL, itemKey } from "./record.js";

/**
 * A refusal the Plan names, which stops a Deploy: `{ code, message, item? }`.
 * @param {string} code @param {string} message @param {string} [item]
 */
function problem(code, message, item) {
  return { code, message, ...(item ? { item } : {}) };
}

/** JSON with every object's keys sorted, so equal values hash alike. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The offered sizes a service may run on: those meeting its smallest machine, cheapest first. */
function eligibleSizes(sizes, atLeast) {
  return sizes
    .filter((size) => !atLeast || (size.vcpus >= atLeast.vcpus && size.memoryGib >= atLeast.memoryGib))
    .sort((one, other) => (BigInt(one.monthlyNano) < BigInt(other.monthlyNano) ? -1 : BigInt(one.monthlyNano) > BigInt(other.monthlyNano) ? 1 : 0));
}

/**
 * The sizes a service is offered: the provider's whole machines (`offer.machineSizes`) for one with a sandbox allowance
 * or reached at each instance, where the provider runs those apart from the rest; `offer.sizes` otherwise, and for
 * every service when the offer has no machineSizes.
 */
function sizesOffered(offer, service) {
  return offer.machineSizes && (service.sandbox.length > 0 || service.reached === "each") ? offer.machineSizes : offer.sizes;
}

/** What the plan reads of an observed thing: the fields drift and the hash compare. */
function digestOf(thing) {
  return {
    id: thing.id,
    kind: thing.kind,
    name: thing.name,
    size: thing.size ?? null,
    instances: thing.instances ?? null,
    exposure: thing.exposure ?? null,
    resourceKind: thing.resourceKind ?? null,
    deployment: thing.labels?.[LABEL.deployment] ?? null,
    item: thing.labels?.[LABEL.item] ?? null
  };
}

const NOTHING = Object.freeze({ machines: 0, vcpus: 0, memoryGib: 0, diskGib: 0 });

/** What one machine of a size takes of each quota a provider may count. */
function takenBy(size) {
  return { machines: 1, vcpus: size?.vcpus ?? 0, memoryGib: size?.memoryGib ?? 0, diskGib: size?.dataDiskGib ?? 0 };
}

/**
 * What the Deploy adds to the provider project's quotas, against what is left of each: `{ checked: true, quotas: [{
 * quota, unit, limit, used, adding }] }` with a problem for each it would pass, or `{ checked: false, words }` where the
 * offer doesn't say them. Each service counts its instances at its size, each resource its machine, as the offer's
 * `quota.counts` says the provider counts them. A Deploy makes and grows things (resources, then services) before it
 * shrinks or deletes any, so what it adds is each item's growth, never less than nothing: a service made smaller, fewer
 * or removed frees its share only after the rest is made.
 * @param {any} offer @param {any} needs @param {{ services: Record<string, any>, resources: Record<string, any> }} effective
 * @param {(kind: string, name: string) => any} thingOf the provider's thing of an item the record holds, or undefined
 * @param {Array<{ code: string, message: string }>} problems
 */
function quotaOf(offer, needs, effective, thingOf, problems) {
  if (!offer.quota?.quotas) {
    return { checked: false, words: offer.quota?.unchecked ?? `${offer.title} doesn't say its quotas, so a Deploy doesn't check them before it starts.` };
  }
  const { quotas, counts } = offer.quota;
  const adding = Object.fromEntries(quotas.map((line) => [line.quota, 0]));
  const grow = (kind, wanted, held) => {
    for (const quota of counts[kind] ?? []) if (quota in adding) adding[quota] += Math.max(0, wanted[quota] - held[quota]);
  };
  const times = (taken, count) => Object.fromEntries(Object.entries(taken).map(([quota, amount]) => [quota, amount * count]));
  const serviceSizes = [...offer.sizes, ...(offer.machineSizes ?? [])];
  for (const service of needs.services) {
    const choice = effective.services[service.id];
    const thing = thingOf("service", service.id);
    const wanted = times(takenBy(sizesOffered(offer, service).find((size) => size.name === choice.size)), Number.isInteger(choice.instances) ? choice.instances : 0);
    const held = thing ? times(takenBy(serviceSizes.find((size) => size.name === thing.size)), thing.instances ?? 0) : NOTHING;
    grow("service", wanted, held);
  }
  for (const resource of needs.resources) {
    const sizes = offer.resources[resource.kind]?.sizes ?? [];
    const thing = thingOf("resource", resource.id);
    const wanted = takenBy(sizes.find((size) => size.name === effective.resources[resource.id]?.size));
    grow("resource", wanted, thing ? takenBy(sizes.find((size) => size.name === thing.size)) : NOTHING);
  }
  const lines = quotas.map(({ quota, unit, limit, used }) => ({ quota, unit, limit, used, adding: adding[quota] }));
  for (const line of lines) {
    const short = line.used + line.adding - line.limit;
    if (line.adding > 0 && short > 0) {
      problems.push(problem("production_quota_short", `${offer.title}'s quota of ${line.unit} for this project is ${line.limit}, ${line.used} in use: this Deploy `
        + `needs ${line.adding} more, ${short} more than is left. Ask ${offer.title} to raise it, or choose smaller sizes or fewer instances, then deploy.`, `quota.${line.quota}`));
    }
  }
  return { checked: true, quotas: lines };
}

/**
 * The Plan of a Deploy.
 * @param {object} input
 * @param {object} input.needs needsOfStack's needs
 * @param {any | null} input.record the environment's record (record.js), null before the first deploy
 * @param {Array<{ id: string, name: string, kind: "service" | "resource", labels?: Record<string, string>, size?: string | null, instances?: number | null, exposure?: string, resourceKind?: string }>} input.observed
 *   the adapter's inventory: every thing of the provider project now
 * @param {{ title: string, currency: string, sizes: Array<{ name: string, vcpus: number, memoryGib: number, monthlyNano: string }>, machineSizes?: Array<{ name: string, vcpus: number, memoryGib: number, monthlyNano: string }>, balancer: { monthlyNano: string } | null, resources: Record<string, { title?: string, sizes: Array<{ name: string, monthlyNano: string }>, defaultSize: string }>, unsupported?: Record<string, string> }} input.offer
 *   the adapter's offer: its service sizes and the load balancer's price, and each resource kind's sizes. Optional:
 *   `machineSizes`, the whole machines a provider that runs some services apart offers a service with a sandbox
 *   allowance or reached at each instance (sizesOffered); `resources[kind].title`, the product a kind is, which the
 *   Plan's resource carries; `unsupported`, the provider's reason for each resource kind it runs none of, which the
 *   refusal carries; `quota`, the provider project's quotas (`quotas: [{ quota, unit, limit, used }]`, and `counts`:
 *   which of them a service's instance and a resource's machine count against), or `unchecked`, why it doesn't say
 * @param {{ services?: Record<string, { size?: string, instances?: number }>, resources?: Record<string, { size?: string }> }} [input.choices]
 *   the owner's choices now, over those the record keeps: a service's `instances` only for one the Deploy makes (a
 *   service the provider runs keeps its count, and another count for it is refused)
 * @param {Record<string, "keep" | "putBack">} [input.decisions] for each drift (`<kind>.<name>.<field>`), keep the
 *   provider's value or put the recorded one back
 */
function planOf({ needs, record, observed, offer, choices = {}, decisions = {} }) {
  const problems = [];
  const recorded = record?.items ?? {};
  const deploymentId = record?.deploymentId ?? null;
  const byId = new Map(observed.map((thing) => [thing.id, thing]));
  const ours = new Set(Object.values(recorded).map((item) => item.id).filter(Boolean));
  const kept = record?.choices ?? { services: {}, resources: {} };
  const items = [];
  const effective = { services: {}, resources: {} };
  // Each service's count at the provider, null for one the Deploy makes: shown, never a choice.
  const running = {};
  const lines = [];

  // Drift on a recorded thing the provider still has: its size as the record left it, against what the provider
  // reports. Each needs a decision; keeping one sets the choice in effect to the provider's value.
  const driftOf = (item, thing, fields) => fields
    .filter((field) => thing[field] !== undefined && item[field] !== undefined && thing[field] !== item[field])
    .map((field) => {
      const key = `${itemKey(item.kind, item.name)}.${field}`;
      const decision = decisions[key] ?? null;
      if (!decision) {
        problems.push(problem("production_drift_undecided", `${item.name}: size ${thing.size} at ${offer.title}, ${item.size} in your choices. `
          + `Keep ${offer.title}'s value or put yours back, then deploy.`, key));
      }
      return { field, provider: thing[field], recorded: item[field], decision };
    });
  const decided = (drift, field, fallback) => {
    const found = drift.find((entry) => entry.field === field && entry.decision === "keep");
    return found ? found.provider : fallback;
  };

  for (const service of needs.services) {
    const key = itemKey("service", service.id);
    const item = recorded[key];
    const thing = item?.id ? byId.get(item.id) : undefined;
    const atLeast = service.atLeast;
    const sizes = eligibleSizes(sizesOffered(offer, service), atLeast);
    if (sizes.length === 0) {
      problems.push(problem("production_size_unavailable", `${offer.title} offers no size with at least ${atLeast.vcpus} vCPU and `
        + `${atLeast.memoryGib} GiB right now, which ${service.id} needs.`, key));
    }
    const drift = item && thing ? driftOf(item, thing, ["size"]) : [];
    const before = kept.services?.[service.id] ?? {};
    const asked = choices.services?.[service.id] ?? {};
    const current = sizes.some((size) => size.name === before.size) ? before.size : sizes[0]?.name ?? null;
    // The count the provider runs, which the Deploy keeps (a service made again for its exposure starts with it too);
    // a service the Deploy makes new starts with the count chosen, else the Stack's.
    const live = thing ? thing.instances ?? null : null;
    const choice = {
      size: asked.size ?? decided(drift, "size", current),
      instances: thing ? live : asked.instances ?? service.instances.start
    };
    if (choice.size !== null && !sizes.some((size) => size.name === choice.size)) {
      problems.push(problem("production_choice_invalid", `choices.services.${service.id}.size is one of ${sizes.map((size) => size.name).join(", ") || "none"}.`, key));
    }
    if (thing && asked.instances !== undefined && asked.instances !== live) {
      problems.push(problem("production_instances_running", `${service.id} runs ${live} instance${live === 1 ? "" : "s"} at ${offer.title}: a Deploy leaves `
        + "the count of an App Service that runs as it is. Set its instances to change it.", key));
    } else if (!thing && (!Number.isInteger(choice.instances) || choice.instances < service.instances.min || choice.instances > service.instances.max)) {
      problems.push(problem("production_choice_invalid", `choices.services.${service.id}.instances is ${service.instances.min} to ${service.instances.max}, `
        + `as genesis/stack.md's - Instances: says.`, key));
    }
    effective.services[service.id] = choice;
    running[service.id] = live;
    let verb = "kept";
    const changes = [];
    if (!item) verb = "new";
    else if (!thing) verb = "missing";
    else if (thing.exposure && thing.exposure !== service.exposure) {
      verb = "replaced";
      changes.push({ field: "exposure", from: thing.exposure, to: service.exposure });
    } else {
      // What the Deploy changes at the provider: its size, where the choice in effect differs from it there.
      if (thing.size !== choice.size) {
        changes.push({ field: "size", from: thing.size, to: choice.size });
        verb = "changed";
      }
    }
    items.push({ kind: "service", name: service.id, verb, id: thing?.id ?? null, changes, drift });
    const price = sizes.find((size) => size.name === choice.size);
    if (price && Number.isInteger(choice.instances)) {
      lines.push({ item: key, part: "instances", size: choice.size, count: choice.instances, monthlyNano: (BigInt(price.monthlyNano) * BigInt(choice.instances)).toString() });
    }
    if (service.exposure === "public" && offer.balancer) lines.push({ item: key, part: "load balancer", monthlyNano: String(offer.balancer.monthlyNano) });
  }

  for (const resource of needs.resources) {
    const key = itemKey("resource", resource.id);
    const item = recorded[key];
    const thing = item?.id ? byId.get(item.id) : undefined;
    const kind = offer.resources[resource.kind];
    if (!kind) {
      const why = offer.unsupported?.[resource.kind];
      problems.push(problem("production_resource_unsupported", `${offer.title} runs no ${resource.kind} for ${resource.id}.${why ? ` ${why}` : ""}`, key));
      continue;
    }
    const drift = item && thing ? driftOf(item, thing, ["size"]) : [];
    const before = kept.resources?.[resource.id] ?? {};
    const choice = { size: choices.resources?.[resource.id]?.size ?? decided(drift, "size", before.size ?? kind.defaultSize) };
    if (!kind.sizes.some((size) => size.name === choice.size)) {
      problems.push(problem("production_choice_invalid", `choices.resources.${resource.id}.size is one of ${kind.sizes.map((size) => size.name).join(", ")}.`, key));
    }
    effective.resources[resource.id] = choice;
    let verb = "kept";
    const changes = [];
    if (!item) verb = "new";
    else if (!thing) {
      verb = "missing";
      problems.push(problem("production_resource_missing", `${resource.id}: gone at ${offer.title} (deleted outside Vibe64). A Deploy never makes `
        + "a new one in its place by itself, since its data went with it.", key));
    } else if (thing.resourceKind && thing.resourceKind !== resource.kind) {
      problems.push(problem("production_resource_kind_changed", `${resource.id} is a ${thing.resourceKind} at ${offer.title} and genesis/stack.md now `
        + `says ${resource.kind}. A Deploy never replaces what holds data: keep ${resource.id} as it was (it is then disconnected, its data `
        + "kept) and declare the new one under a new name in genesis/stack.md (the coding agent can do this), Save, then deploy.", key));
    } else if (thing.size !== choice.size) {
      verb = "changed";
      changes.push({ field: "size", from: thing.size, to: choice.size });
    }
    items.push({ kind: "resource", name: resource.id, verb, id: thing?.id ?? null, changes, drift });
    const price = kind.sizes.find((size) => size.name === choice.size);
    if (price?.monthlyNano) lines.push({ item: key, part: resource.kind, size: choice.size, monthlyNano: String(price.monthlyNano) });
  }

  // What the record has and the Stack no longer does: a service goes (it holds no data); a resource is disconnected,
  // kept running with its data and still priced.
  const named = new Set([...needs.services.map((one) => itemKey("service", one.id)), ...needs.resources.map((one) => itemKey("resource", one.id))]);
  for (const [key, item] of Object.entries(recorded)) {
    if (named.has(key)) continue;
    const thing = item.id ? byId.get(item.id) : undefined;
    if (item.kind === "service") {
      items.push({ kind: "service", name: item.name, verb: thing ? "removed" : "missing", id: thing?.id ?? null, changes: [], drift: [] });
      continue;
    }
    items.push({ kind: "resource", name: item.name, verb: thing ? "disconnected" : "missing", id: thing?.id ?? null, changes: [], drift: [] });
    const kind = offer.resources[thing?.resourceKind ?? item.resourceKind];
    const price = kind?.sizes.find((size) => size.name === (thing?.size ?? item.size));
    if (thing && price?.monthlyNano) lines.push({ item: key, part: thing.resourceKind ?? item.resourceKind, size: thing.size, monthlyNano: String(price.monthlyNano) });
  }

  const quota = quotaOf(offer, needs, effective, (kind, name) => {
    const item = recorded[itemKey(kind, name)];
    return item?.id ? byId.get(item.id) : undefined;
  }, problems);

  // The provider project's other things: not this deployment's, never changed, linked, deleted or priced.
  const foreign = observed
    .filter((thing) => !ours.has(thing.id) && (!deploymentId || thing.labels?.[LABEL.deployment] !== deploymentId))
    .map((thing) => ({ id: thing.id, name: thing.name, kind: thing.kind, vibe64: Boolean(thing.labels?.[LABEL.deployment]) }));

  const services = needs.services.map((service) => {
    const sizes = eligibleSizes(sizesOffered(offer, service), service.atLeast);
    return {
      id: service.id,
      exposure: service.exposure,
      sizes,
      defaultSize: effective.services[service.id].size,
      // The range a count is chosen or set in, the Stack's starting count, and the count the provider runs (null for a
      // service the Deploy makes), which a Deploy never changes: `setInstances` does.
      instances: { min: service.instances.min, max: service.instances.max, default: service.instances.start, live: running[service.id] },
      balancer: service.exposure === "public" ? offer.balancer : null
    };
  });
  const resources = needs.resources.filter((resource) => offer.resources[resource.kind]).map((resource) => ({
    id: resource.id,
    kind: resource.kind,
    ...(offer.resources[resource.kind].title ? { title: offer.resources[resource.kind].title } : {}),
    sizes: offer.resources[resource.kind].sizes,
    defaultSize: effective.resources[resource.id]?.size ?? offer.resources[resource.kind].defaultSize
  }));
  const monthlyNano = lines.reduce((sum, line) => sum + BigInt(line.monthlyNano), 0n).toString();
  const relevant = observed.filter((thing) => ours.has(thing.id) || foreign.some((one) => one.id === thing.id)).map(digestOf)
    .sort((one, other) => (one.id < other.id ? -1 : 1));
  const hash = `sha256:${createHash("sha256").update(stableJson({
    needs, choices: effective, decisions, items, lines, observed: relevant, currency: offer.currency
  })).digest("hex")}`;
  return { services, resources, items, foreign, choices: effective, lines, monthlyNano, currency: offer.currency, quota, problems, hash };
}

export { eligibleSizes, planOf, stableJson };
