// The steps of a Deploy, one at a time, each call to the provider idempotent (by its key) so a step tried again, or a
// Deploy left half done and resumed from its record, repeats nothing: `nextStep` reads the plan, the needs, the record
// and what the provider reports now and names the one thing to do next (or that the deployment is live, or failed);
// `applyStep` does it through the adapter and answers the record as it then stands. In order:
//
//   1. a service whose exposure changed is deleted first (it holds no data), to be made again;
//   2. each resource's hosted service is made (labelled) or resized, and waited for;
//   3. the public service's domain is added to the provider project when none covers it;
//   4. each internal service, then each public one: a service that runs a release is first linked to each resource
//      it isn't linked to at the provider, so the instances its next release starts have them however soon the
//      provider starts them (one that reuses a build starts them as the refresh starts: a production Deploy, 18 Nov);
//      its release is uploaded, then its service made (internal: no routes; public: routed at the domain, with a
//      connection to each service it reaches) or handed the release and, while that refresh is open, set to the count
//      chosen (a provider's refresh may roll to the count the service has as it rolls, as mobilynet's does, so it starts
//      as many new instances as the plan says, and one that fails leaves the version before on that count); then each
//      resource it is still not linked to is linked the moment that refresh is open, and the refresh waited for.
//      A service still running the release it was last handed, made from the same upload (the archive and its
//      declaration: releaseDigest), keeps it and is handed none, so none of its instances is replaced for nothing (a
//      provider refreshes onto every release it is handed, even the one it runs). A provider may take a link only
//      with the service's new release under way (the release the service runs doesn't name the resource, it runs none
//      yet, or the refresh moving it hasn't read its release): its adapter refuses it LINK_NEEDS_RELEASE, and a link
//      asked before the release is then made once its refresh is open. mobilynet takes such a link against the release
//      the refresh moves to, putting its settings in that refresh and replacing any instance it started without them
//      (engine-support M14); a link it checks against the release the service runs gives the refresh's instances its
//      settings as the refresh starts, which is why the engine links first. A refresh that fails ends, at mobilynet,
//      the links made against the release it moved to, which the record lets go so the next Deploy makes them again,
//      and fails the deployment with that service's reason; the services not yet moved keep serving their version;
//   5. a resource the Stack no longer names is unlinked from every service that stays, now that none runs a release
//      naming it, and kept running with its data;
//   6. each service's settings (package.js settingValues) when they differ from those it was given, the services it
//      reaches, then its size and (when it was handed no release) its count as the plan's choices say: after every
//      move ended, since a provider may refuse a settings replace while a link made ahead of a refresh is open (mobilynet
//      does). A count or size change alone is only that, and the record's choices follow each, so the next plan starts
//      from what runs;
//   7. a service the Stack no longer names is deleted (its links end with it);
//   8. live, once every service runs its release with as many healthy instances as chosen and its last refresh did
//      not fail.
//
// The record names each link the engine made, and a link counts only while the provider holds it: where the adapter
// lists a resource's links (mobilynet's inventory does), one the provider ended is none, so the next step makes it
// again, whichever run made it and however it ended. A refresh that fails or is aborted ends every link the release its
// service still runs doesn't name, even when no Deploy reads that refresh (the run that made the links stopped first,
// and the next began while it was still open), and an owner may remove a link by hand. An adapter that lists none is
// taken at the record's word.
//
// What the record does not hold is never touched: every call names a thing the engine made and labelled (record.js
// labelsFor). A Deploy never deletes or makes again a thing that holds data; deleting a disconnected resource is
// `deleteResource`, and taking the services down `takeOffline`, which returns once they are gone, each its own call. A
// Deploy holds the lease `deploy:<deployment id>` while it runs, renewed at each step, where the adapter takes leases.
//
// A Deploy and a Take offline say what they do as they do it, through the caller's `report`: each step as it starts and
// ends, in the engine's own words (`stepWords`), each wait when its words change, each call tried again (a step's, or a
// read of the provider that got no answer, a 5xx or its rate limit, which a Deploy waiting for a long build may meet)
// and the end. A report names the step, the service or resource and the refresh it started, never a setting's value,
// and one that throws or rejects never stops the run. A read of the provider that may answer later is tried again,
// waiting one pause, then two, four and at most six, so a Deploy waiting for a build lives until it is live or fails.
// A Deploy first reads how the refreshes a Deploy before it started and never read ended (that one stopped in its
// wait), letting go of a failed one's links and release as that Deploy would have (settleLastRun).
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
// An adapter's refusal of a link its provider takes only with the service's new release under way: the release the
// service runs doesn't name the resource, it runs none yet, or the refresh moving it hasn't read its release yet.
const LINK_NEEDS_RELEASE = "link_needs_release";
// How long takeOffline waits between reads of the provider while the services go, and how many reads it makes: an
// instance leaving drains first (mobilynet's 30 seconds and its stop signal's as long again; AWS's load balancer its
// 300), so ten minutes in all.
const OFFLINE_PAUSE_MS = 5_000;
const OFFLINE_READS = 120;

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

/**
 * What a service's release is made of: its upload's SHA-256 (the archive with what the provider adds for the service)
 * and its declaration. The record keeps it with the version the service was handed (`release`), so a Deploy of the
 * same commit, Stack and engine hands no service a release again.
 * @param {{ sha256: string }} upload @param {unknown} declaration
 */
function releaseDigest(upload, declaration) {
  return `sha256:${createHash("sha256").update(stableJson({ upload: upload.sha256, declaration })).digest("hex")}`;
}

/** The thing of the provider labelled as this deployment's item, made by a Deploy cut short before its record kept it. */
function labelledAs(observed, record, kind, name) {
  return observed.find((thing) => thing.kind === kind && thing.state !== "deleting" && thing.labels?.[LABEL.deployment] === record.deploymentId
    && thing.labels?.[LABEL.item] === `${kind}.${name}`);
}

/**
 * The values a service is given, with each of its Reaches settings the reached service's private address: its own
 * (`internalUrl`) where the provider reports one, else `http://<internalName>:<port>`.
 * @param {any} service the need's service @param {any} context the run's context @param {Map<string, any>} byId
 */
function valuesOf(service, { record, release }, byId) {
  const reached = {};
  for (const reach of service.reaches) {
    const thing = byId.get(record.items[`service.${reach.service}`]?.id);
    const address = thing?.internalUrl ?? (thing?.internalName ? `http://${thing.internalName}:${release.port}` : null);
    if (!address) return null;
    reached[reach.setting] = address;
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
 * What a step does, in the words a person reads in a Deploy's log: the step and the service or resource it is for.
 * @param {any} step nextStep's step @param {{ needs?: any, release?: { domain?: string } }} [context]
 */
function stepWords(step, { needs, release } = {}) {
  const exposure = needs?.services.find((one) => one.id === step.service)?.exposure;
  switch (step.kind) {
    case "createResource": return `Making the hosted service for ${step.resource}`;
    case "resizeResource": return `Resizing the hosted service of ${step.resource} to ${step.size}`;
    case "adopt": return `Taking up ${step.item === "service" ? "App Service" : "the hosted service of"} ${step.name}, made by a Deploy cut short`;
    case "ensureDomain": return `Adding the domain ${step.domain}`;
    case "uploadRelease": return `Uploading the release of ${step.service}`;
    case "keepRelease": return `${step.service} keeps the release it runs: the same commit, Stack and engine`;
    case "releaseService": return `Handing App Service ${step.service} the new release`;
    case "createService": return exposure === "public"
      ? `Making App Service ${step.service}, public behind the load balancer at ${release?.domain ?? "its domain"}`
      : `Making App Service ${step.service}, internal: only the app's other services reach it`;
    case "link": return `Linking ${step.service} to ${step.resource}`;
    case "checkRefresh": return `Reading how the update of ${step.service} ended`;
    case "unlink": return `Unlinking ${step.resource}, no longer in genesis/stack.md, from ${step.service}`;
    case "putSettings": return `Updating the settings of ${step.service}`;
    case "changeService": {
      const { change } = step;
      if (change.connections) return `Updating the services ${step.service} reaches`;
      if (change.size) return `Resizing App Service ${step.service} to ${change.size}`;
      return `Setting App Service ${step.service} to ${change.instances} instance${change.instances === 1 ? "" : "s"}`;
    }
    case "deleteService": return step.replaced
      ? `Deleting App Service ${step.service}, to make it again: its exposure changed`
      : `Deleting App Service ${step.service}, no longer in genesis/stack.md`;
    default: return step.kind;
  }
}

/**
 * The caller's report, stamped with the time, never failing the run: a report that throws or rejects is ignored.
 * @param {(event: any) => unknown} report
 */
function reporterOf(report) {
  return (event) => {
    try {
      const answered = report({ at: new Date().toISOString(), ...event });
      if (typeof answered?.catch === "function") answered.catch(() => {});
    } catch {
      // A report is the caller's: it never stops the run it reports on.
    }
  };
}

/**
 * What a report says of a step: its kind, the service or resource it is for, its words, and the refresh it started or
 * read (`{ serviceId, refreshId }`); never its values.
 * @param {any} step @param {string} words @param {any} [record] the record after the step, for the refresh it started
 */
function stepEvent(step, words, record = null) {
  const event = { kind: "step", step: step.kind, words, ...(step.service ? { service: step.service } : {}), ...(step.resource ? { resource: step.resource } : {}) };
  if (step.kind === "checkRefresh") return { ...event, refresh: { serviceId: step.id, refreshId: step.refreshId } };
  const refreshId = step.service ? record?.run.services[step.service]?.refreshId : null;
  const serviceId = step.service ? record?.items[`service.${step.service}`]?.id : null;
  return refreshId && serviceId ? { ...event, refresh: { serviceId, refreshId } } : event;
}

/** A read of the provider that may answer later: no answer, a 5xx, its rate limit, a thing busy. @param {any} error */
const retryable = (error) => error?.retryable === true;
/** Text ending as a sentence ends, its own full stop kept. @param {string} text */
const sentence = (text) => (/[.!?]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`);
// A read tried again waits one pause, then two, four and at most six (5, 10, 20 and 30 seconds at the caller's 5).
const BACKOFF_PAUSES_MAX = 6;
/** The pauses before the provider is read again after this many failed reads in a row. @param {number} failures */
const backoffPauses = (failures) => Math.min(2 ** (failures - 1), BACKOFF_PAUSES_MAX);

/**
 * What a Deploy that stopped before it read how its refreshes ended (the editor stopped, or a read failed in its wait)
 * left: each refresh it started is read now, and one that failed or was aborted is let go as the run would have let it
 * go, its links made ahead dropped (they ended with it) and its service handed its release again, so the next Deploy
 * makes them again and nothing it holds is stale. A refresh still open is waited for by the next Deploy as it reads
 * the service; should it then fail, the links it ends are made again as the provider no longer holds them (nextStep).
 * Answers the record with the reason of each that failed.
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
    if (refresh && (refresh.state === "failed" || refresh.state === "aborted")) {
      for (const resource of state.linkedAhead ?? []) delete kept.items[`resource.${resource}`]?.links?.[service];
      delete kept.items[`service.${service}`].release;
      tell({ kind: "step", phase: "done", step: "settleRefresh", service, words,
        message: `It ${refresh.state}: ${sentence(refresh.error?.message ?? "the provider gave no reason")} This Deploy hands ${service} its release again.` });
    } else tell({ kind: "step", phase: "done", step: "settleRefresh", service, words, message: `It is ${refresh?.state ?? "gone"}.` });
  }
  return kept;
}

/**
 * The next step of a Deploy, or `{ kind: "live" }`, or `{ kind: "failed", message }`, or `{ kind: "wait", words }`
 * when the provider is still at work on the last one.
 * @param {object} context
 * @param {any} context.plan planOf's plan, read when the Deploy began
 * @param {any} context.needs needsOfStack's needs
 * @param {any} context.record the record, its `run` this Deploy's
 * @param {any[]} context.observed the adapter's inventory now
 * @param {{ id: string, declarations: Record<string, any>, digests: Record<string, string>, settings: Record<string, any>, env: Record<string, string>, domain: string, trustedProxies: string, port: number }} context.release
 *   `digests` each service's releaseDigest
 */
function nextStep({ plan, needs, record, observed, release }) {
  const run = record.run;
  if (run.failure) return { kind: "failed", message: run.failure };
  const byId = new Map(observed.map((thing) => [thing.id, thing]));
  const itemOf = (kind, name) => record.items[`${kind}.${name}`];
  const thingOf = (item) => (item?.id ? byId.get(item.id) : undefined);
  // A service is linked to a resource while the provider holds the link the record names: where the adapter lists the
  // links a resource's thing holds (`links`), one it ended counts as none, so it is made again whichever run made it.
  const linked = (resourceId, serviceId) => {
    const item = itemOf("resource", resourceId);
    const linkId = item?.links?.[serviceId];
    const held = thingOf(item)?.links;
    return Boolean(linkId) && (!Array.isArray(held) || held.some((link) => link.id === linkId));
  };

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
    const unlinked = (resource) => !linked(resource.id, service.id);
    if (!state.version) {
      // Before its release, a service that runs one is linked to each resource it isn't linked to, so its next
      // instances start with them however soon the provider starts them (a build it reuses starts them at once). A
      // link the provider takes only with the new release under way (LINK_NEEDS_RELEASE) waits for that release.
      const first = thing?.version ? needs.resources.find((resource) => unlinked(resource) && !(state.afterRelease ?? []).includes(resource.id)) : null;
      if (first) return { kind: "link", resource: first.id, id: itemOf("resource", first.id).id, service: service.id, serviceId: thing.id, beforeRelease: true };
      // Kept only while the provider runs it with no error: one that failed since is handed it again.
      const live = item?.release;
      if (thing && live?.digest === release.digests[service.id] && thing.version === live.version && !thing.lastError) {
        return { kind: "keepRelease", service: service.id };
      }
      return { kind: thing ? "releaseService" : "uploadRelease", service: service.id, id: thing?.id ?? null };
    }
    if (!thing) {
      const name = release.declarations[service.id].name;
      const leaving = observed.find((one) => one.name === name);
      if (leaving) return { kind: "wait", words: `Waiting for the old ${service.id} to go` };
      const values = valuesOf(service, { record, release }, byId);
      if (!values) return { kind: "wait", words: `Waiting for the services ${service.id} reaches` };
      return { kind: "createService", service: service.id, values };
    }
    // The count chosen goes with the release, set while its refresh is open: mobilynet's refresh rolls to the count the
    // service has as it rolls, so it starts as many new instances as chosen and, if it fails, the version before serves
    // on that count. With no release handed, the count changes after the moves (6).
    const { instances } = plan.choices.services[service.id];
    if (state.refreshId && thing.instances !== instances) return { kind: "changeService", service: service.id, id: thing.id, change: { instances } };
    // A service runs one refresh at a time, the rest queued behind it, and shows the one under way, else the next: this
    // Deploy's has ended once none is. A resource it is still not linked to (a new service, one that runs no release,
    // a release naming a new resource) is linked the moment that refresh is open (against the release it moves to),
    // or once none of its is open.
    const late = needs.resources.find(unlinked);
    const ours = state.refreshId && thing.refresh?.id === state.refreshId ? thing.refresh.state : null;
    if (late && (["building", "rolling"].includes(ours) || !state.refreshId)) {
      return { kind: "link", resource: late.id, id: itemOf("resource", late.id).id, service: service.id, serviceId: thing.id };
    }
    if (state.refreshId) {
      if (thing.refresh) return { kind: "wait", words: late && (!ours || ours === "queued") ? `Waiting for ${service.id} to start building` : `Updating ${service.id}` };
      return { kind: "checkRefresh", service: service.id, id: thing.id, refreshId: state.refreshId };
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
    case "keepRelease":
      stateOf(step.service).version = record.items[`service.${step.service}`].release.version;
      break;
    case "releaseService": {
      const answer = await adapter.releaseService(step.id, upload(step.service));
      Object.assign(stateOf(step.service), { version: answer.version, refreshId: answer.refreshId });
      record.items[`service.${step.service}`].release = { digest: release.digests[step.service], version: answer.version };
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
        exposure: service.exposure, settingsHash: values.hash, release: { digest: release.digests[service.id], version: state.version }
      };
      state.refreshId = made.refreshId;
      break;
    }
    case "link": {
      const state = stateOf(step.service);
      let linkId;
      try {
        linkId = (await adapter.linkResource(step.id, step.serviceId, adapter.needOf(step.resource), { idempotencyKey: keyOf(record, "link", step.resource, step.service) })).id;
      } catch (error) {
        // Taken only with the service's new release under way: asked before its release, it is linked once that
        // release's refresh is open; asked while this Deploy's refresh is open (not yet under way, or ended first),
        // the next step links again in a moment, or reads how it ended and links after it.
        if (error?.code === LINK_NEEDS_RELEASE && step.beforeRelease) {
          state.afterRelease = [...(state.afterRelease ?? []), step.resource];
          break;
        }
        if (error?.code === LINK_NEEDS_RELEASE && state.refreshId) break;
        // Linked by a Deploy cut short before its record kept the link, or known only to the provider (a record made
        // again from labels holds no links): the link stands, and is kept now.
        if (error?.code !== "need_linked" || !error.details?.linkId) throw error;
        linkId = error.details.linkId;
      }
      (record.items[`resource.${step.resource}`].links ??= {})[step.service] = linkId;
      if (state.refreshId) state.linkedAhead = [...(state.linkedAhead ?? []), step.resource];
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
      const state = stateOf(step.service);
      if (refresh && (refresh.state === "failed" || refresh.state === "aborted")) {
        // The links made against it ended with it, and the release it moved to may not run: the next Deploy makes them
        // and hands it that release again.
        for (const resource of state.linkedAhead ?? []) delete record.items[`resource.${resource}`]?.links?.[step.service];
        if (record.items[`service.${step.service}`]) delete record.items[`service.${step.service}`].release;
        const what = ["create", "release"].includes(refresh.kind) ? "the release did not go live" : `its ${refresh.kind} change did not go live`;
        run.failure = `${step.service}: ${what}: ${refresh.error?.message ?? `its refresh ${refresh.state}`}`
          + (refresh.fromVersion ? ` The version before (${refresh.fromVersion}) still serves.` : "");
      }
      Object.assign(state, { refreshId: null, linkedAhead: [] });
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
      const item = Object.assign(record.items[`service.${step.service}`], step.change);
      // The next plan starts from what the service runs now: a Deploy that fails after this keeps the count or size it set.
      if (step.change.instances !== undefined || step.change.size) {
        record.choices = { ...record.choices, services: { ...record.choices?.services, [step.service]: { size: item.size, instances: item.instances } } };
      }
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
 * @param {(event: any) => unknown} [options.report] told each step as it starts and ends (`{ at, kind: "step", phase:
 *   "start" | "done" | "refused", step, words, service?, resource?, refresh?, message? }`), each wait when its words
 *   change (`{ kind: "wait", words }`), each call tried again (`{ kind: "retry", words, message }`) and the end (`{ kind:
 *   "end", outcome, message? }`)
 * @param {number} [options.maxSteps]
 * @returns {Promise<{ outcome: "live" | "failed", message?: string, record: any, steps: string[] }>}
 */
async function deploy({
  adapter, needs, record: start, choices = {}, decisions = {}, planHash, release, holder, save = (kept) => kept, pause = () => {}, report = () => {}, maxSteps = 1000
}) {
  const tell = reporterOf(report);
  const [offer, observed] = await Promise.all([adapter.offer(), adapter.inventory()]);
  const plan = planOf({ needs, record: start, observed, offer, choices, decisions });
  if (plan.hash !== planHash) throw deployError("deployment_plan_stale", "What this Deploy would do changed since the plan was read: read the plan again, then deploy.");
  if (plan.problems.length > 0) throw deployError("deployment_plan_refused", plan.problems[0].message, 422, { problems: plan.problems });
  const lease = await takeDeployLease(adapter, start, holder);
  const digests = Object.fromEntries(needs.services.map((service) => {
    const declaration = release.declarations[service.id];
    return [service.id, releaseDigest(adapter.serviceUpload(release.archive, declaration), declaration)];
  }));
  const full = { ...release, digests, port: adapter.servicePort, trustedProxies: await adapter.trustedProxies() };
  const run = { id: `run_${randomBytes(6).toString("hex")}`, release: release.id, planHash, state: "deploying", domain: null, services: {}, failure: null };
  let record = await save({ ...(await settleLastRun(adapter, start, tell)), run });
  const steps = [];
  let waiting = null;
  let failedReads = 0;
  try {
    for (let count = 0; count < maxSteps; count += 1) {
      let observed;
      try {
        observed = await adapter.inventory();
        failedReads = 0;
      } catch (error) {
        // The provider may answer later (a long build keeps it busy): read it again, waiting longer each time.
        if (!retryable(error)) throw error;
        failedReads += 1;
        tell({ kind: "retry", words: `Reading ${adapter.title} again`, attempt: failedReads, message: error.message });
        for (let one = 0; one < backoffPauses(failedReads); one += 1) await pause();
        continue;
      }
      const step = nextStep({ plan, needs, record, observed, release: full });
      if (step.kind === "live" || step.kind === "failed") {
        const ended = { ...structuredClone(record), run: { ...record.run, state: step.kind, failure: step.message ?? null } };
        if (step.kind === "live") Object.assign(ended, { choices: structuredClone(plan.choices), lastPlan: { hash: plan.hash } });
        record = await save(ended);
        tell({ kind: "end", outcome: step.kind, ...(step.message ? { message: step.message } : {}) });
        return { outcome: step.kind, ...(step.message ? { message: step.message } : {}), record, steps };
      }
      steps.push(step.kind === "wait" ? `wait: ${step.words}` : `${step.kind}${step.service ? ` ${step.service}` : step.resource ? ` ${step.resource}` : ""}`);
      if (step.kind === "wait") {
        if (step.words !== waiting) tell({ kind: "wait", words: step.words });
        waiting = step.words;
      } else {
        waiting = null;
        const words = stepWords(step, { needs, release: full });
        tell({ ...stepEvent(step, words), phase: "start" });
        try {
          record = await save((await applyStep(adapter, step, { record, needs, plan, release: full })).record);
          tell({ ...stepEvent(step, words, record), phase: "done" });
        } catch (error) {
          // A refusal waits for a person: the Deploy fails with it, its record kept as far as it got. Anything the
          // provider may answer later (no answer, its rate limit, a thing busy) is tried again at the next step.
          if (typeof error?.retryable !== "boolean") throw error;
          if (error.retryable) tell({ ...stepEvent(step, words), kind: "retry", message: error.message });
          else {
            record = await save({ ...structuredClone(record), run: { ...record.run, failure: `${steps.at(-1)}: ${error.message}` } });
            tell({ ...stepEvent(step, words), phase: "refused", message: error.message });
          }
        }
        if (lease) {
          try {
            await adapter.lease.renew(lease.id, LEASE_SECONDS);
          } catch (error) {
            if (!retryable(error)) throw error;
            tell({ kind: "retry", words: "Renewing the Deploy's lease", message: error.message });
          }
        }
      }
      await pause();
    }
    throw deployError("deployment_unfinished", `The Deploy took more than ${maxSteps} steps; its record keeps where it stopped.`, 500);
  } finally {
    if (lease) await adapter.lease.release(lease.id);
  }
}

/**
 * Takes the environment's services down, the public one first: their services go, every resource and its data stay.
 * Once each delete is asked the record without them is kept (`save`); then the provider is read again (`pause` between
 * reads) until it lists none of them, each instance having drained, and the record is answered. A provider still
 * removing some after `maxReads` reads is refused `deployment_offline_unfinished`, naming them: the record kept says
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
  throw deployError("deployment_offline_unfinished", `${left.join(" and ")} ${left.length === 1 ? "is" : "are"} still being removed at ${adapter.title}; `
    + "they take no new requests, and it finishes removing them by itself.", 504, { removing: left });
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

export { LEASE_SECONDS, LINK_NEEDS_RELEASE, applyStep, deleteResource, deploy, nextStep, releaseDigest, stepWords, takeDeployLease, takeOffline };
