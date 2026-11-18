// The steps of a Deploy, one at a time, each call to the provider idempotent (by its key) so a step tried again, or a
// Deploy left half done and resumed from its record, repeats nothing: `nextStep` reads the plan, the needs, the record
// and what the provider reports now and names the one thing to do next (or that the deployment is live, or failed);
// `applyStep` does it through the adapter and answers the record as it then stands. In order:
//
//   1. a service whose exposure changed is deleted first (it holds no data), to be made again;
//   2. each resource's hosted service is made (labelled) or resized, and waited for;
//   3. the public service's domain is added to the provider project when none covers it;
//   4. each internal service, then each public one: its release is uploaded, then its service made (internal: no
//      routes; public: routed at the domain, with a connection to each service it reaches) or handed the release, its
//      refresh waited for, then linked to every resource it isn't linked to yet. mobilynet checks a link against the
//      release the service runs, which moves only when a refresh succeeds, so a link follows the refresh that brings
//      the release naming its need; the link's settings reach the instances in a refresh of their own, which step 8
//      waits for. A refresh that fails fails the deployment with that service's reason, and the services not yet
//      moved keep serving their version;
//   5. a resource the Stack no longer names is unlinked from every service that stays, now that none runs a release
//      naming it, and kept running with its data;
//   6. each service's settings (package.js settingValues) when they differ from those it was given, the services it
//      reaches, then its size and count as the plan's choices say;
//   7. a service the Stack no longer names is deleted (its links end with it);
//   8. live, once every service runs its release with as many healthy instances as chosen and its last refresh did
//      not fail.
//
// What the record does not hold is never touched: every call names a thing the engine made and labelled (record.js
// labelsFor). A Deploy never deletes or makes again a thing that holds data; deleting a disconnected resource is
// `deleteResource`, and taking the services down `takeOffline`, each its own call. A Deploy holds the lease
// `deploy:<deployment id>` while it runs, renewed at each step, where the adapter takes leases.
//
// Each call's idempotency key names this Deploy's run, so a call tried again within it gets the first answer, and a
// later Deploy asking the same again (a count put back, a service made again after it was taken offline) is not
// answered with an old one (mobilynet keeps a key's first answer for 7 days). A Deploy cut short between a create and
// keeping its record is made whole by the labels: the next one finds the thing labelled as that item and adopts it.
import { createHash, randomBytes } from "node:crypto";

import { planOf, stableJson } from "./plan.js";
import { LABEL, labelsFor } from "./record.js";
import { settingValues } from "./package.js";

const LEASE_SECONDS = 600;

/** A refusal or failure of a Deploy: `code`, a message a person can act on, and `status` for the caller's answer. */
function deployError(code, message, status = 409, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

/** The order a Deploy moves services in: internal ones first, so a public one reaches them once it starts. */
function servicesInOrder(needs) {
  return [...needs.services.filter((one) => one.exposure !== "public"), ...needs.services.filter((one) => one.exposure === "public")];
}

/**
 * An idempotency key for one call of this Deploy's run: the deployment, the run, the call, the item and a digest of
 * what it asks, at most 100 printable characters (mobilynet takes 128).
 * @param {any} record @param {string} call @param {string} item an item's name (at most 40 characters) @param {unknown} [asked]
 */
function keyOf(record, call, item, asked = null) {
  return [record.deploymentId, record.run.id, call, item, createHash("sha256").update(stableJson(asked)).digest("hex").slice(0, 16)].join("-");
}

/** The thing of the provider labelled as this deployment's item, made by a Deploy cut short before its record kept it. */
function labelledAs(observed, record, kind, name) {
  return observed.find((thing) => thing.kind === kind && thing.state !== "deleting" && thing.labels?.[LABEL.deployment] === record.deploymentId
    && thing.labels?.[LABEL.item] === `${kind}.${name}`);
}

/**
 * The values a service is given, with each of its Reaches settings the reached service's private address.
 * @param {any} service the need's service @param {any} context the run's context @param {Map<string, any>} byId
 */
function valuesOf(service, { record, release }, byId) {
  const reached = {};
  for (const reach of service.reaches) {
    const thing = byId.get(record.items[`service.${reach.service}`]?.id);
    if (!thing?.internalName) return null;
    reached[reach.setting] = `http://${thing.internalName}:${release.port}`;
  }
  return settingValues({
    declared: release.settings[service.id], env: release.env, domain: release.domain, trustedProxies: release.trustedProxies, port: release.port, reached
  });
}

/** The connections a service opens: one to each service it reaches, on the port services listen on, in Stack order. */
function connectionsOf(service, record, port) {
  return service.reaches.map((reach) => ({ to: record.items[`service.${reach.service}`]?.id ?? null, port }));
}

/**
 * The next step of a Deploy, or `{ kind: "live" }`, or `{ kind: "failed", message }`, or `{ kind: "wait", words }`
 * when the provider is still at work on the last one.
 * @param {object} context
 * @param {any} context.plan planOf's plan, read when the Deploy began
 * @param {any} context.needs needsOfStack's needs
 * @param {any} context.record the record, its `run` this Deploy's
 * @param {any[]} context.observed the adapter's inventory now
 * @param {{ id: string, declarations: Record<string, any>, settings: Record<string, any>, env: Record<string, string>, domain: string, trustedProxies: string, port: number }} context.release
 */
function nextStep({ plan, needs, record, observed, release }) {
  const run = record.run;
  if (run.failure) return { kind: "failed", message: run.failure };
  const byId = new Map(observed.map((thing) => [thing.id, thing]));
  const itemOf = (kind, name) => record.items[`${kind}.${name}`];
  const thingOf = (item) => (item?.id ? byId.get(item.id) : undefined);

  // 1. A service whose exposure changed goes first, to be made again.
  for (const service of needs.services) {
    const thing = thingOf(itemOf("service", service.id));
    if (thing && thing.exposure !== service.exposure) return { kind: "deleteService", service: service.id, id: thing.id, replaced: true };
  }

  // 2. The resources' hosted services: made, resized, running; a disconnected one unlinked and kept.
  let starting = null;
  for (const resource of needs.resources) {
    const item = itemOf("resource", resource.id);
    if (!item?.id) {
      const made = labelledAs(observed, record, "resource", resource.id);
      return made ? { kind: "adopt", item: "resource", name: resource.id, thing: made } : { kind: "createResource", resource: resource.id };
    }
    const thing = thingOf(item);
    if (!thing) return { kind: "failed", message: `${resource.id} is gone at its provider (deleted outside Vibe64); nothing was made in its place.` };
    if (thing.state === "failed") return { kind: "failed", message: `${resource.id} did not start: ${thing.lastError?.message ?? "its provider gave no reason"}` };
    const size = plan.choices.resources[resource.id].size;
    if (thing.state === "running" && thing.size !== size) return { kind: "resizeResource", resource: resource.id, id: thing.id, size };
    if (thing.state !== "running") starting ??= resource.id;
  }
  if (starting) return { kind: "wait", words: `Starting ${starting}` };

  // 3. The domain the public service is routed at.
  if (!run.domain) return { kind: "ensureDomain", domain: release.domain };

  // 4. Each service: its release, its App Service, its refresh, its links.
  for (const service of servicesInOrder(needs)) {
    const item = itemOf("service", service.id);
    const state = run.services[service.id] ?? {};
    const thing = thingOf(item);
    if (!thing) {
      const made = labelledAs(observed, record, "service", service.id);
      if (made && !item) return { kind: "adopt", item: "service", name: service.id, thing: made };
    }
    if (!state.version) return { kind: thing ? "releaseService" : "uploadRelease", service: service.id, id: thing?.id ?? null };
    if (!thing) {
      const name = release.declarations[service.id].name;
      const leaving = observed.find((one) => one.name === name);
      if (leaving) return { kind: "wait", words: `Waiting for the old ${service.id} to go` };
      const values = valuesOf(service, { record, release }, byId);
      if (!values) return { kind: "wait", words: `Waiting for the services ${service.id} reaches` };
      return { kind: "createService", service: service.id, values };
    }
    // A service runs one refresh at a time, the rest queued behind it: this Deploy's has ended once none is under way.
    if (state.refreshId) {
      if (thing.refresh) return { kind: "wait", words: `Updating ${service.id}` };
      return { kind: "checkRefresh", service: service.id, id: thing.id, refreshId: state.refreshId };
    }
    for (const resource of needs.resources) {
      const resourceItem = itemOf("resource", resource.id);
      if (!resourceItem.links?.[service.id]) return { kind: "link", resource: resource.id, id: resourceItem.id, service: service.id, serviceId: thing.id };
    }
  }

  // 5. A resource the Stack no longer names: unlinked from the services that stay, kept with its data.
  for (const [key, item] of Object.entries(record.items)) {
    if (item.kind !== "resource" || needs.resources.some((one) => `resource.${one.id}` === key)) continue;
    const [service, linkId] = Object.entries(item.links ?? {}).find(([name]) => needs.services.some((one) => one.id === name)) ?? [];
    if (linkId) return { kind: "unlink", resource: item.name, id: item.id, service, linkId };
  }

  // 6. Settings, the services each reaches, then size and count, as chosen.
  for (const service of servicesInOrder(needs)) {
    const item = itemOf("service", service.id);
    const thing = thingOf(item);
    const values = valuesOf(service, { record, release }, byId);
    if (values.hash !== item.settingsHash) return { kind: "putSettings", service: service.id, id: thing.id, values };
    const connections = connectionsOf(service, record, release.port);
    if (stableJson(connections) !== stableJson(thing.connections ?? [])) return { kind: "changeService", service: service.id, id: thing.id, change: { connections } };
    const choice = plan.choices.services[service.id];
    if (thing.size !== choice.size) return { kind: "changeService", service: service.id, id: thing.id, change: { size: choice.size } };
    if (thing.instances !== choice.instances) return { kind: "changeService", service: service.id, id: thing.id, change: { instances: choice.instances } };
  }

  // 7. A service the Stack no longer names.
  for (const item of Object.values(record.items)) {
    if (item.kind === "service" && !needs.services.some((one) => one.id === item.name) && thingOf(item)) {
      return { kind: "deleteService", service: item.name, id: item.id, replaced: false };
    }
  }

  // 8. Live once every service runs its release, healthy, its last refresh (a link's or a change's) not failed: a
  // provider clears a service's last error when a refresh succeeds, and this Deploy's release refresh did.
  for (const service of servicesInOrder(needs)) {
    const thing = thingOf(itemOf("service", service.id));
    const { version } = run.services[service.id];
    const wanted = plan.choices.services[service.id].instances;
    if (!thing.refresh && thing.lastError) {
      return { kind: "failed", message: `${service.id}: ${thing.lastError.message ?? thing.lastError}` };
    }
    if (thing.version === version && !thing.refresh && thing.healthy >= wanted) continue;
    return { kind: "wait", words: `Waiting for ${service.id}'s instances` };
  }
  return { kind: "live" };
}

/**
 * Does one step through the adapter and answers the record as it then stands (a copy; the one given is unchanged).
 * @param {any} adapter the provider's adapter (adapters/<provider>/index.js)
 * @param {any} step nextStep's step
 * @param {{ record: any, needs: any, plan: any, release: any }} context `release.archive` the packed archive's bytes
 * @returns {Promise<{ record: any }>}
 */
async function applyStep(adapter, step, { record: given, needs, plan, release }) {
  const record = structuredClone(given);
  const run = record.run;
  const serviceOf = (id) => needs.services.find((one) => one.id === id);
  const stateOf = (id) => {
    run.services[id] ??= {};
    return run.services[id];
  };
  const upload = (service) => adapter.serviceUpload(release.archive, release.declarations[service]);
  switch (step.kind) {
    case "createResource": {
      const resource = needs.resources.find((one) => one.id === step.resource);
      const name = adapter.hostedName(record.app, resource.id);
      const made = await adapter.createResource({
        name, kind: resource.kind, size: plan.choices.resources[resource.id].size, labels: labelsFor(record, { kind: "resource", name: resource.id })
      }, { idempotencyKey: keyOf(record, "resource", resource.id, name) });
      record.items[`resource.${resource.id}`] = {
        kind: "resource", name: resource.id, id: made.id, providerName: made.name, origin: "made", size: made.size, resourceKind: resource.kind, links: {}
      };
      break;
    }
    case "resizeResource":
      await adapter.resizeResource(step.id, step.size, { idempotencyKey: keyOf(record, "resize", step.resource, step.size) });
      record.items[`resource.${step.resource}`].size = step.size;
      break;
    case "unlink":
      await adapter.unlinkResource(step.id, step.linkId);
      delete record.items[`resource.${step.resource}`].links[step.service];
      break;
    case "ensureDomain":
      await adapter.ensureDomain(step.domain, { idempotencyKey: keyOf(record, "domain", "public", step.domain) });
      run.domain = step.domain;
      break;
    case "uploadRelease":
      stateOf(step.service).version = (await adapter.uploadRelease(release.declarations[step.service].name, upload(step.service))).version;
      break;
    case "releaseService": {
      const answer = await adapter.releaseService(step.id, upload(step.service));
      Object.assign(stateOf(step.service), { version: answer.version, refreshId: answer.refreshId });
      break;
    }
    case "createService": {
      const service = serviceOf(step.service);
      const choice = plan.choices.services[service.id];
      const { values } = step;
      const connections = connectionsOf(service, record, release.port);
      const name = release.declarations[service.id].name;
      const state = stateOf(service.id);
      const made = await adapter.createService({
        name, exposure: service.exposure, size: choice.size, instances: choice.instances, app: name, version: state.version,
        settings: values.settings, secrets: values.secrets, domain: release.domain, connections, labels: labelsFor(record, { kind: "service", name: service.id })
      }, { idempotencyKey: keyOf(record, "service", service.id, name) });
      record.items[`service.${service.id}`] = {
        kind: "service", name: service.id, id: made.id, providerName: name, origin: "made", size: choice.size, instances: choice.instances,
        exposure: service.exposure, settingsHash: values.hash
      };
      state.refreshId = made.refreshId;
      break;
    }
    case "link": {
      let linkId;
      try {
        linkId = (await adapter.linkResource(step.id, step.serviceId, adapter.needOf(step.resource), { idempotencyKey: keyOf(record, "link", step.resource, step.service) })).id;
      } catch (error) {
        // Linked by a Deploy cut short before its record kept the link: the link stands, and is kept now.
        if (error?.code !== "need_linked" || !error.details?.linkId) throw error;
        linkId = error.details.linkId;
      }
      record.items[`resource.${step.resource}`].links[step.service] = linkId;
      break;
    }
    case "adopt": {
      const { thing } = step;
      record.items[`${step.item}.${step.name}`] = step.item === "service"
        ? { kind: "service", name: step.name, id: thing.id, providerName: thing.name, origin: "made", size: thing.size, instances: thing.instances, exposure: thing.exposure }
        : { kind: "resource", name: step.name, id: thing.id, providerName: thing.name, origin: "made", size: thing.size, resourceKind: thing.resourceKind, links: {} };
      // A service adopted is handed this Deploy's release like any other.
      if (step.item === "service") delete run.services[step.name];
      break;
    }
    case "checkRefresh": {
      const refresh = await adapter.readRefresh(step.id, step.refreshId);
      if (refresh && (refresh.state === "failed" || refresh.state === "aborted")) {
        const what = ["create", "release"].includes(refresh.kind) ? "the release did not go live" : `its ${refresh.kind} change did not go live`;
        run.failure = `${step.service}: ${what}: ${refresh.error?.message ?? `its refresh ${refresh.state}`}`
          + (refresh.fromVersion ? ` The version before (${refresh.fromVersion}) still serves.` : "");
      }
      stateOf(step.service).refreshId = null;
      break;
    }
    case "putSettings": {
      const refreshId = await adapter.putSettings(step.id, step.values, { idempotencyKey: keyOf(record, "settings", step.service, step.values.hash) });
      record.items[`service.${step.service}`].settingsHash = step.values.hash;
      stateOf(step.service).refreshId = refreshId;
      break;
    }
    case "changeService": {
      const refreshId = await adapter.changeService(step.id, step.change, { idempotencyKey: keyOf(record, "change", step.service, step.change) });
      Object.assign(record.items[`service.${step.service}`], step.change);
      if (refreshId) stateOf(step.service).refreshId = refreshId;
      break;
    }
    case "deleteService":
      await adapter.deleteService(step.id);
      delete record.items[`service.${step.service}`];
      delete run.services[step.service];
      for (const item of Object.values(record.items)) if (item.kind === "resource") delete item.links?.[step.service];
      break;
    default:
      throw new TypeError(`No step ${step.kind}.`);
  }
  return { record };
}

/**
 * The lease a Deploy holds, where the adapter takes leases: taken, or refused naming who holds it and since when.
 * @param {any} adapter @param {any} record @param {string} holder such as "Vibe64 on my-workstation"
 */
async function takeDeployLease(adapter, record, holder) {
  if (!adapter.lease) return null;
  try {
    return await adapter.lease.take(`deploy:${record.deploymentId}`, holder, LEASE_SECONDS);
  } catch (error) {
    if (error?.code !== "lease_held") throw error;
    const held = error.details ?? {};
    const since = held.since ? new Date(held.since).toISOString().slice(11, 16) : "a moment ago";
    throw deployError("deployment_lease_held", `Another ${held.holder ?? "Vibe64"} is deploying this since ${since} UTC; try again when it finishes.`, 409, held);
  }
}

/**
 * A whole Deploy through the engine: the plan read again and its hash compared with the one the owner confirmed, the
 * lease taken, then one step at a time until live or failed, the record kept after each (`save`), the lease renewed
 * at each step and given up at the end.
 * @param {object} options
 * @param {any} options.adapter
 * @param {any} options.needs
 * @param {any} options.record the environment's record (record.js newRecord before the first deploy)
 * @param {object} [options.choices] @param {object} [options.decisions]
 * @param {string} options.planHash the hash of the plan the owner confirmed
 * @param {any} options.release `{ id, archive, declarations, settings, env, domain }` (archive: packArchive's bytes)
 * @param {string} options.holder who holds the lease, such as "Vibe64 on my-workstation"
 * @param {(record: any) => Promise<any> | any} [options.save] keeps the record after each step, answering it as kept
 * @param {() => Promise<void> | void} [options.pause] between steps, while the provider works
 * @param {number} [options.maxSteps]
 * @returns {Promise<{ outcome: "live" | "failed", message?: string, record: any, steps: string[] }>}
 */
async function deploy({ adapter, needs, record: start, choices = {}, decisions = {}, planHash, release, holder, save = (kept) => kept, pause = () => {}, maxSteps = 1000 }) {
  const [offer, observed] = await Promise.all([adapter.offer(), adapter.inventory()]);
  const plan = planOf({ needs, record: start, observed, offer, choices, decisions });
  if (plan.hash !== planHash) throw deployError("deployment_plan_stale", "What this Deploy would do changed since the plan was read: read the plan again, then deploy.");
  if (plan.problems.length > 0) throw deployError("deployment_plan_refused", plan.problems[0].message, 422, { problems: plan.problems });
  const lease = await takeDeployLease(adapter, start, holder);
  const full = { ...release, port: adapter.servicePort, trustedProxies: await adapter.trustedProxies() };
  const run = { id: `run_${randomBytes(6).toString("hex")}`, release: release.id, planHash, state: "deploying", domain: null, services: {}, failure: null };
  let record = await save({ ...structuredClone(start), run });
  const steps = [];
  try {
    for (let count = 0; count < maxSteps; count += 1) {
      const step = nextStep({ plan, needs, record, observed: await adapter.inventory(), release: full });
      if (step.kind === "live" || step.kind === "failed") {
        const ended = { ...structuredClone(record), run: { ...record.run, state: step.kind, failure: step.message ?? null } };
        if (step.kind === "live") Object.assign(ended, { choices: structuredClone(plan.choices), lastPlan: { hash: plan.hash } });
        record = await save(ended);
        return { outcome: step.kind, ...(step.message ? { message: step.message } : {}), record, steps };
      }
      steps.push(step.kind === "wait" ? `wait: ${step.words}` : `${step.kind}${step.service ? ` ${step.service}` : step.resource ? ` ${step.resource}` : ""}`);
      if (step.kind !== "wait") {
        try {
          record = await save((await applyStep(adapter, step, { record, needs, plan, release: full })).record);
        } catch (error) {
          // A refusal waits for a person: the Deploy fails with it, its record kept as far as it got. Anything the
          // provider may answer later (no answer, its rate limit, a thing busy) is tried again at the next step.
          if (typeof error?.retryable !== "boolean") throw error;
          if (!error.retryable) record = await save({ ...structuredClone(record), run: { ...record.run, failure: `${steps.at(-1)}: ${error.message}` } });
        }
        if (lease) await adapter.lease.renew(lease.id, LEASE_SECONDS);
      }
      await pause();
    }
    throw deployError("deployment_unfinished", `The Deploy took more than ${maxSteps} steps; its record keeps where it stopped.`, 500);
  } finally {
    if (lease) await adapter.lease.release(lease.id);
  }
}

/**
 * Takes the environment's services down, the public one first: their App Services go, every resource and its data
 * stay. Answers the record without them.
 * @param {any} adapter @param {any} record
 */
async function takeOffline(adapter, record) {
  const kept = structuredClone(record);
  const services = Object.values(kept.items).filter((item) => item.kind === "service")
    .sort((one, other) => (one.exposure === "public" ? -1 : 0) - (other.exposure === "public" ? -1 : 0));
  for (const item of services) {
    await adapter.deleteService(item.id);
    delete kept.items[`service.${item.name}`];
    for (const resource of Object.values(kept.items)) delete resource.links?.[item.name];
  }
  return kept;
}

/**
 * Deletes a disconnected resource and its data, its own action: only one the record holds and the Stack no longer
 * names, and only when the owner typed its name.
 * @param {any} adapter @param {any} record @param {any} needs @param {{ name: string, typed: string }} which
 */
async function deleteResource(adapter, record, needs, { name, typed }) {
  const item = record.items[`resource.${name}`];
  if (!item) throw deployError("deployment_item_unknown", `${name} isn't a resource this deployment made.`, 404);
  if (needs.resources.some((one) => one.id === name)) throw deployError("deployment_resource_in_use", `genesis/stack.md still names ${name}: remove it there first.`);
  if (typed !== name) throw deployError("deployment_confirmation_wrong", `Type ${name} to delete it and its data.`, 422);
  await adapter.deleteResource(item.id);
  const kept = structuredClone(record);
  delete kept.items[`resource.${name}`];
  return kept;
}

export { LEASE_SECONDS, applyStep, deleteResource, deploy, nextStep, takeDeployLease, takeOffline };
