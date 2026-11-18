// The Plan: what a Deploy of a project's environment will do to each item, like `terraform plan`, from the Stack's
// needs (the desired state), the record (what Vibe64 made) and what the provider reports now (refreshed first: the
// adapter's inventory of every thing of the provider project). Each service is offered the provider's sizes that meet
// its `- Needs at least`, cheapest first; each item gets its verb (new, kept, changed, replaced, removed,
// disconnected, missing) and the drift between the record and the provider (a count or size changed by hand), which
// the owner decides, per difference, to keep or to put back; things of the provider project that are not this
// deployment's are listed and left alone. The quote is at list price. The hash covers the needs, the choices in
// effect, the decisions and a digest of the observed state, so a Deploy whose plan was read before anything moved
// (a size, a price, a thing gone or changed by hand) is refused and the plan read again.
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

/**
 * The Plan of a Deploy.
 * @param {object} input
 * @param {object} input.needs needsOfStack's needs
 * @param {any | null} input.record the environment's record (record.js), null before the first deploy
 * @param {Array<{ id: string, name: string, kind: "service" | "resource", labels?: Record<string, string>, size?: string | null, instances?: number | null, exposure?: string, resourceKind?: string }>} input.observed
 *   the adapter's inventory: every thing of the provider project now
 * @param {{ title: string, currency: string, sizes: Array<{ name: string, vcpus: number, memoryGib: number, monthlyNano: string }>, balancer: { monthlyNano: string } | null, resources: Record<string, { sizes: Array<{ name: string, monthlyNano: string }>, defaultSize: string }> }} input.offer
 *   the adapter's offer: its service sizes and the load balancer's price, and each resource kind's sizes
 * @param {{ services?: Record<string, { size?: string, instances?: number }>, resources?: Record<string, { size?: string }> }} [input.choices]
 *   the owner's choices now, over those the record keeps
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
  const lines = [];

  // Drift on a recorded thing the provider still has: its size and count as the record left them, against what the
  // provider reports. Each needs a decision; keeping one sets the choice in effect to the provider's value.
  const driftOf = (item, thing, fields) => fields
    .filter((field) => thing[field] !== undefined && item[field] !== undefined && thing[field] !== item[field])
    .map((field) => {
      const key = `${itemKey(item.kind, item.name)}.${field}`;
      const decision = decisions[key] ?? null;
      if (!decision) {
        problems.push(problem("production_drift_undecided", `${item.name}: ${field === "instances" ? `${thing.instances} instances` : `size ${thing.size}`} `
          + `at ${offer.title}, ${field === "instances" ? item.instances : item.size} in your choices. Keep ${offer.title}'s value or put yours back, then deploy.`, key));
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
    const sizes = eligibleSizes(offer.sizes, atLeast);
    if (sizes.length === 0) {
      problems.push(problem("production_size_unavailable", `${offer.title} offers no size with at least ${atLeast.vcpus} vCPU and `
        + `${atLeast.memoryGib} GiB right now, which ${service.id} needs.`, key));
    }
    const drift = item && thing ? driftOf(item, thing, ["size", "instances"]) : [];
    const before = kept.services?.[service.id] ?? {};
    const asked = choices.services?.[service.id] ?? {};
    const current = sizes.some((size) => size.name === before.size) ? before.size : sizes[0]?.name ?? null;
    const choice = {
      size: asked.size ?? decided(drift, "size", current),
      instances: asked.instances ?? decided(drift, "instances", before.instances ?? service.instances.start)
    };
    if (choice.size !== null && !sizes.some((size) => size.name === choice.size)) {
      problems.push(problem("production_choice_invalid", `choices.services.${service.id}.size is one of ${sizes.map((size) => size.name).join(", ") || "none"}.`, key));
    }
    if (!Number.isInteger(choice.instances) || choice.instances < service.instances.min || choice.instances > service.instances.max) {
      problems.push(problem("production_choice_invalid", `choices.services.${service.id}.instances is ${service.instances.min} to ${service.instances.max}, `
        + `as genesis/stack.md's - Instances: says.`, key));
    }
    effective.services[service.id] = choice;
    let verb = "kept";
    const changes = [];
    if (!item) verb = "new";
    else if (!thing) verb = "missing";
    else if (thing.exposure && thing.exposure !== service.exposure) {
      verb = "replaced";
      changes.push({ field: "exposure", from: thing.exposure, to: service.exposure });
    } else {
      // What the Deploy changes at the provider: whatever the choice in effect differs from there.
      for (const field of ["size", "instances"]) {
        if (thing[field] !== choice[field]) changes.push({ field, from: thing[field], to: choice[field] });
      }
      if (changes.length > 0) verb = "changed";
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
      problems.push(problem("production_resource_unsupported", `${offer.title} runs no ${resource.kind} for ${resource.id}.`, key));
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

  // The provider project's other things: not this deployment's, never changed, linked, deleted or priced.
  const foreign = observed
    .filter((thing) => !ours.has(thing.id) && (!deploymentId || thing.labels?.[LABEL.deployment] !== deploymentId))
    .map((thing) => ({ id: thing.id, name: thing.name, kind: thing.kind, vibe64: Boolean(thing.labels?.[LABEL.deployment]) }));

  const services = needs.services.map((service) => {
    const sizes = eligibleSizes(offer.sizes, service.atLeast);
    return {
      id: service.id,
      exposure: service.exposure,
      sizes,
      defaultSize: effective.services[service.id].size,
      instances: { min: service.instances.min, max: service.instances.max, default: service.instances.start },
      balancer: service.exposure === "public" ? offer.balancer : null
    };
  });
  const resources = needs.resources.filter((resource) => offer.resources[resource.kind]).map((resource) => ({
    id: resource.id,
    kind: resource.kind,
    sizes: offer.resources[resource.kind].sizes,
    defaultSize: effective.resources[resource.id]?.size ?? offer.resources[resource.kind].defaultSize
  }));
  const monthlyNano = lines.reduce((sum, line) => sum + BigInt(line.monthlyNano), 0n).toString();
  const relevant = observed.filter((thing) => ours.has(thing.id) || foreign.some((one) => one.id === thing.id)).map(digestOf)
    .sort((one, other) => (one.id < other.id ? -1 : 1));
  const hash = `sha256:${createHash("sha256").update(stableJson({
    needs, choices: effective, decisions, items, lines, observed: relevant, currency: offer.currency
  })).digest("hex")}`;
  return { services, resources, items, foreign, choices: effective, lines, monthlyNano, currency: offer.currency, problems, hash };
}

export { eligibleSizes, planOf, stableJson };
