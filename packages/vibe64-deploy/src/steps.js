// The steps of a Deploy, one at a time, each call to the provider idempotent (by its key) so a step tried again, or a
// Deploy left half done and resumed from its record, repeats nothing: `nextStep` reads the plan, the needs, the record
// and what the provider reports now and names the one thing to do next (or that the deployment is live, or failed);
// `applyStep` does it through the adapter and answers the record as it then stands. In order:
//
//   1. a service whose exposure changed is deleted first (it holds no data), to be made again;
//   2. each resource's hosted service is made (labelled) or resized, and waited for;
//   3. the public service's domain is added to the provider project when none covers it, then each of the domain's
//      other names (the release's `aliases`, such as its www name): a release with them is refused before anything is
//      asked by a provider that can't route a running service (no takeDomain), and one naming the domain itself, a
//      name twice or something that is no host name, which the app's server would refuse to start with;
//   4. each internal service, then each public one, in two passes. First, every service that runs a release and is to
//      be handed a new one is linked to each resource it isn't linked to at the provider, every one before this Deploy
//      hands any release, so the instances its next release starts have them however soon the provider starts them
//      (one that reuses a build starts them as the refresh starts: a production Deploy, 18 Nov). Its settings go with
//      its release, never ahead of it: where they differ from those it was given, the release brings them, in place
//      of those, the names it was given before and no longer taken out. The provider's refresh starts its new
//      instances and its release task with them while the version before keeps serving with its own, and the service
//      takes them only once that refresh succeeded; one that fails or is aborted leaves the service's settings as
//      they were (mobilynet main c3575399). So no instance of the version before starts for this Deploy's settings,
//      before or after its migrations ran (production Deploys of 23 Nov: settings given ahead of a release restarted
//      web's version before, once computers' release had migrated the database, and knex refused it), and a value
//      changed after a release failed for it reaches that release (a production Deploy, 19 Nov). A release declares
//      only what the Stack names (a Production Env entry is no part of it), so a provider must take a name the
//      release doesn't declare, as mobilynet does (decided 19 Nov). A setting a service requires that the Production
//      Env has no value for fails the Deploy before any change, naming it. A service whose settings name one this
//      Deploy still makes (a Reaches of a new service) is handed its release without them, and given them in 6.
//      Then, each service in turn: its release is uploaded, then its service made (internal: no routes; public: routed
//      at the domain and its other names, with a connection to each service it reaches; without any while another
//      service the record holds has one: address.js), with the count the plan chose for a service it makes, or handed the release, which rolls to the count the service runs (a provider's refresh rolls to the count the service has as
//      it rolls, as mobilynet's does); then each resource it is still not linked to is linked the moment that refresh
//      is open, and the refresh waited for.
//      A service still running the release it was last handed, made from the same upload (the archive and its
//      declaration: releaseDigest), keeps it and is handed none, so none of its instances is replaced for nothing (a
//      provider refreshes onto every release it is handed, even the one it runs). A provider may take a link only
//      with the service's new release under way (the release the service runs doesn't name the resource, it runs none
//      yet, or the refresh moving it hasn't read its release): its adapter refuses it LINK_NEEDS_RELEASE, and a link
//      asked before the release is then made once its refresh is open. A provider may take such a link against the
//      release the refresh moves to, putting its settings in that refresh and replacing any instance it started
//      without them (mobilynet does, its engine-support M14); a link taken against the release the service runs gives
//      the refresh's instances its settings as the refresh starts, which is why the engine links first. A refresh
//      that fails may end the links made against the release it moved to (mobilynet's do), which the record lets go so
//      the next Deploy makes them again, and fails the deployment with that service's reason; the services not yet
//      moved keep serving their version. Where the adapter runs a release's task, the first release a Deploy hands
//      carries the migrations, once, unless the database ran that code's (the record's `migrated`);
//   5. a resource the Stack no longer names is unlinked from every service that stays, now that none runs a release
//      naming it, and kept running with its data;
//   6. each service's settings (package.js settingValues, the public one's with the other names as APP_REDIRECT_HOSTS,
//      which its server sends on to the domain) when they differ from those it was given (one that kept its
//      release gets them here, so a change of the Production Env alone is a settings refresh of the release it runs;
//      one handed a release got them with it, in 4), the services it reaches, then its size as the plan's choices say:
//      after every move ended, since a provider may refuse a settings replace while a link made ahead of a refresh is
//      open (mobilynet does). A size change alone is only that, and the record's choices follow it, so the next plan
//      starts from what runs. The record counts settings as given (their hash and names) once the refresh that brought
//      them succeeded: one that failed left the service with those it had, which the next Deploy gives again;
//   7. the domain and its other names, where the public service lacks any, are routed to it once it serves its
//      release (address.js);
//   8. a service the Stack no longer names is deleted (its links end with it);
//   9. live, once every service runs its release with as many healthy instances as it runs at the provider and its
//      last refresh did not fail; the address's DNS target is told once (address.js).
//
// A service's count is a running setting, never part of a Deploy: the Deploy makes a service with the count the plan
// chose for it and never sets, puts back or keeps a count after that. The provider holds it, set by `setInstances` (the
// owner's scale action, instances.js: at once, within the Stack's `- Instances:` range), the provider's own controls or
// an app scaling its own service with its key, and the record keeps no copy (a count an older record holds is ignored).
//
// The record names each link the engine made, and a link counts only while the provider holds it: where the adapter
// lists a resource's links (mobilynet's inventory does), one the provider ended is none, so the next step makes it
// again, whichever run made it and however it ended. A provider may end, when a refresh fails or is aborted (mobilynet
// does), every link the release its service still runs doesn't name, even when no Deploy reads that refresh (the run
// that made the links stopped first, and the next began while it was still open), and an owner may remove a link by
// hand. An adapter that lists none is taken at the record's word.
//
// What the record does not hold is never touched: every call names a thing the engine made and labelled (record.js
// labelsFor). A Deploy never deletes or makes again a thing that holds data; deleting a disconnected resource is
// `deleteResource`, and taking the services down `takeOffline` (both offline.js), which returns once they are gone. A
// Deploy holds the lease `deploy:<deployment id>` while it runs, renewed at each step, where the adapter takes leases.
//
// A Deploy and a Take offline say what they do as they do it, through the caller's `report` (report.js): each step as
// it starts and ends, in the engine's own words (`stepWords`), each wait when its words change, each call tried again
// (a step's, or a read of the provider that got no answer, a 5xx or its rate limit, which a Deploy waiting for a long
// build may meet) and the end. A report names the step, the service or resource and the refresh it started, never a
// setting's value, and one that throws or rejects never stops the run. A read of the provider that may answer later is
// tried again, waiting one pause, then two, four and at most six, so a Deploy waiting for a build lives until it is
// live or fails. A Deploy first reads how the refreshes a Deploy before it started and never read ended (that one
// stopped in its wait), letting go of a failed one's links and release as that Deploy would have, and counting the
// settings a succeeded one brought as given (lastRun.js).
//
// A Deploy the owner asks to stop (`stopAsked`) stops at its next step's boundary while nothing it did has reached what
// Production serves, and otherwise says why not and goes on (stop.js).
//
// Each call's idempotency key names this Deploy's run, so a call tried again within it gets the first answer, and a
// later Deploy asking the same again (a count put back, a service made again after it was taken offline) is not
// answered with an old one (mobilynet keeps a key's first answer for 7 days). A Deploy cut short between a create and
// keeping its record is made whole by the labels: the next one finds the thing labelled as that item and adopts it.
import { createHash, randomBytes } from "node:crypto";

import { addressChange, addressWords, aliasesProblem, domainHolder, domainStep } from "./address.js";
import { settleLastRun } from "./lastRun.js";
import { MIGRATED_NOTE, migrationDue, migrationsOf, noteHandOver, noteTask } from "./migrations.js";
import { planOf, stableJson } from "./plan.js";
import { LABEL, keptChoices, labelsFor } from "./record.js";
import { reporterOf, stepEvent, stepWords } from "./report.js";
import { requiredWithoutValue, settingValues } from "./package.js";
import { STOP_WORDS, stopAtBoundary } from "./stop.js";

const LEASE_SECONDS = 600;
// An adapter's refusal of a link its provider takes only with the service's new release under way: the release the
// service runs doesn't name the resource, it runs none yet, or the refresh moving it hasn't read its release yet.
const LINK_NEEDS_RELEASE = "link_needs_release";
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
    declared: release.settings[service.id], env: release.env, domain: release.domain, aliases: service.exposure === "public" ? release.aliases ?? [] : [],
    trustedProxies: release.trustedProxies, port: release.port, reached
  });
}

/** What the record keeps of the settings a service was given: their hash and names. @param {any} values settingValues' */
const givenOf = (values) => ({ settingsHash: values.hash, settingNames: Object.keys({ ...values.settings, ...values.secrets }).sort() });

/**
 * What a release brings of a service's settings (the header's 4): `remove`, the names it was given before and no
 * longer, and `given`, what the record keeps once its refresh succeeded. A record that never kept the names it gave
 * (one from before them) keeps no hash then, so 6 replaces them once, dropping the names no longer given.
 * @param {any} values settingValues' @param {any} item the service's record
 */
function broughtOf(values, item) {
  const given = givenOf(values);
  const before = item?.settingNames ?? null;
  return {
    remove: before ? before.filter((name) => !given.settingNames.includes(name)) : [],
    given: before ? given : { ...given, settingsHash: null }
  };
}

/** The connections a service opens: one to each service it reaches, on the port services listen on, in Stack order. */
function connectionsOf(service, record, port) {
  return service.reaches.map((reach) => ({ to: record.items[`service.${reach.service}`]?.id ?? null, port }));
}

/** A read of the provider that may answer later: no answer, a 5xx, its rate limit, a thing busy. @param {any} error */
const retryable = (error) => error?.retryable === true;
// A read tried again waits one pause, then two, four and at most six (5, 10, 20 and 30 seconds at the caller's 5).
const BACKOFF_PAUSES_MAX = 6;
/** The pauses before the provider is read again after this many failed reads in a row. @param {number} failures */
const backoffPauses = (failures) => Math.min(2 ** (failures - 1), BACKOFF_PAUSES_MAX);

/**
 * The next step of a Deploy, or `{ kind: "live" }`, or `{ kind: "failed", message }`, or `{ kind: "wait", words }`
 * when the provider is still at work on the last one.
 * @param {object} context
 * @param {any} context.plan planOf's plan, read when the Deploy began
 * @param {any} context.needs needsOfStack's needs
 * @param {any} context.record the record, its `run` this Deploy's
 * @param {any[]} context.observed the adapter's inventory now
 * @param {{ id: string, declarations: Record<string, any>, digests: Record<string, string>, settings: Record<string, any>, env: Record<string, string>, domain: string, aliases?: string[], trustedProxies: string, port: number }} context.release
 *   `digests` each service's releaseDigest, `aliases` the domain's other names
 */
function nextStep({ plan, needs, record, observed, release }) {
  const run = record.run;
  if (run.failure) return { kind: "failed", message: run.failure };
  const byId = new Map(observed.map((thing) => [thing.id, thing]));
  const itemOf = (kind, name) => record.items[`${kind}.${name}`];
  const thingOf = (item) => (item?.id ? byId.get(item.id) : undefined);
  // The migrations run once, with the first release this Deploy hands, when the database hasn't run this code's.
  const migrateTask = (serviceId) => (migrationDue(release.migrations, record, serviceId) ? { task: "migrate" } : {});
  // A service is linked to a resource while the provider holds the link the record names: where the adapter lists the
  // links a resource's thing holds (`links`), one it ended counts as none, so it is made again whichever run made it.
  const linked = (resourceId, serviceId) => {
    const item = itemOf("resource", resourceId);
    const linkId = item?.links?.[serviceId];
    const held = thingOf(item)?.links;
    return Boolean(linkId) && (!Array.isArray(held) || held.some((link) => link.id === linkId));
  };

  // A service whose last refresh failed, naming why, or null; and whether it runs this Deploy's release with as many
  // healthy instances as the provider runs now, whatever set that count.
  const failureOf = (service, thing) => (!thing.refresh && thing.lastError ? `${service.id}: ${thing.lastError.message ?? thing.lastError}` : null);
  const serves = (service, thing) => thing.version === run.services[service.id].version && !thing.refresh
    && thing.healthy >= (Number.isInteger(thing.instances) ? thing.instances : 1);

  // A service keeps its release only while the provider runs it with no error: one that failed since is handed it again.
  const keeps = (service, item, thing) => Boolean(thing) && item?.release?.digest === release.digests[service.id]
    && thing.version === item.release.version && !thing.lastError;

  // A setting a service requires that the Production Env has no value for (a generated secret it doesn't hold) would
  // fail the release or the App Service requiring it, so the Deploy says so before it changes anything.
  for (const service of needs.services) {
    const missing = requiredWithoutValue(release.settings[service.id], release.env, service.reaches.map((reach) => reach.setting));
    if (missing.length > 0) {
      return { kind: "failed", message: `${service.id} requires ${missing.join(", ")}, which the Production Env has no value for: `
        + `give ${missing.length === 1 ? "it a value" : "each a value"} in the Production Env, then deploy to production.` };
    }
  }

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

  // 3. The domain the public service is routed at, then each of its other names.
  const aliases = release.aliases ?? [];
  if (!run.domain) return { kind: "ensureDomain", domain: release.domain };
  const unadded = aliases.find((alias) => !(run.aliases ?? []).includes(alias));
  if (unadded) return { kind: "ensureDomain", domain: unadded, alias: true };

  // 4. Each service: readied on the version it runs, every one before any release; then its release, its App
  // Service, its refresh, its links.
  const partsOf = (service) => {
    const item = itemOf("service", service.id);
    return { item, state: run.services[service.id] ?? {}, thing: thingOf(item) };
  };
  // A service that runs a version, readied on it before this Deploy hands any release (the header's 4): each resource
  // linked but one taken only with the release (LINK_NEEDS_RELEASE). Null once readied. Its settings go with its
  // release, or, where it keeps its release, in 6.
  const readyOf = (service, { state, thing }) => {
    if (state.version || !thing?.version) return null;
    const first = needs.resources.find((resource) => !linked(resource.id, service.id) && !(state.afterRelease ?? []).includes(resource.id));
    return first ? { kind: "link", resource: first.id, id: itemOf("resource", first.id).id, service: service.id, serviceId: thing.id, beforeRelease: true } : null;
  };
  for (const service of servicesInOrder(needs)) {
    const parts = partsOf(service);
    if (!parts.thing) {
      const made = labelledAs(observed, record, "service", service.id);
      if (made && !parts.item) return { kind: "adopt", item: "service", name: service.id, thing: made };
    }
    const ready = readyOf(service, parts);
    if (ready) return ready;
  }
  for (const service of servicesInOrder(needs)) {
    const parts = partsOf(service);
    const { item, state, thing } = parts;
    const unlinked = (resource) => !linked(resource.id, service.id);
    if (!state.version) {
      const ready = readyOf(service, parts);
      if (ready) return ready;
      if (keeps(service, item, thing)) return { kind: "keepRelease", service: service.id };
      if (!thing) return { kind: "uploadRelease", service: service.id, id: null };
      // Its settings go with its release where they differ from those it was given; where they name a service this
      // Deploy still makes, they follow in 6, on that release.
      const values = valuesOf(service, { record, release }, byId);
      const brought = values && values.hash !== item.settingsHash ? { values } : {};
      return { kind: "releaseService", service: service.id, id: thing.id, ...migrateTask(service.id), ...brought };
    }
    if (!thing) {
      const name = release.declarations[service.id].name;
      const leaving = observed.find((one) => one.name === name);
      if (leaving) return { kind: "wait", words: `Waiting for the old ${service.id} to go` };
      const values = valuesOf(service, { record, release }, byId);
      if (!values) return { kind: "wait", words: `Waiting for the services ${service.id} reaches` };
      const held = service.exposure === "public" ? [release.domain, ...aliases].map((name) => domainHolder(record, thingOf, name)).find(Boolean) : null;
      return { kind: "createService", service: service.id, values, ...(held ? { withoutDomain: held.name } : {}), ...migrateTask(service.id) };
    }
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

  // 6. Settings, the services each reaches, then size, as chosen.
  for (const service of servicesInOrder(needs)) {
    const item = itemOf("service", service.id);
    const thing = thingOf(item);
    const values = valuesOf(service, { record, release }, byId);
    if (values.hash !== item.settingsHash) return { kind: "putSettings", service: service.id, id: thing.id, values };
    const connections = connectionsOf(service, record, release.port);
    if (stableJson(connections) !== stableJson(thing.connections ?? [])) return { kind: "changeService", service: service.id, id: thing.id, change: { connections } };
    const choice = plan.choices.services[service.id];
    if (thing.size !== choice.size) return { kind: "changeService", service: service.id, id: thing.id, change: { size: choice.size } };
  }

  // 7. The domain, where the public service lacks it.
  const routed = needs.services.find((one) => one.exposure === "public");
  const front = routed ? thingOf(itemOf("service", routed.id)) : null;
  const routing = front && domainStep({
    service: routed, thing: front, domain: release.domain, holder: domainHolder(record, thingOf, release.domain, front),
    aliases: aliases.map((host) => ({ host, holder: domainHolder(record, thingOf, host, front) })), serving: serves(routed, front), failure: failureOf(routed, front)
  });
  if (routing) return routing;

  // 8. A service the Stack no longer names.
  for (const item of Object.values(record.items)) {
    if (item.kind === "service" && !needs.services.some((one) => one.id === item.name) && thingOf(item)) {
      return { kind: "deleteService", service: item.name, id: item.id, replaced: false };
    }
  }

  // 9. Live once every service runs its release, healthy, its last refresh (a link's or a change's) not failed: a
  // provider clears a service's last error when a refresh succeeds, and this Deploy's release refresh did. It waits
  // for as many healthy instances as the provider runs now, whatever set that count.
  for (const service of servicesInOrder(needs)) {
    const thing = thingOf(itemOf("service", service.id));
    const failure = failureOf(service, thing);
    if (failure) return { kind: "failed", message: failure };
    if (serves(service, thing)) continue;
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
  // What the step's report says beside its words.
  let message = null;
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
      if (step.alias) run.aliases = [...(run.aliases ?? []), step.domain];
      else run.domain = step.domain;
      break;
    case "uploadRelease":
      stateOf(step.service).version = (await adapter.uploadRelease(release.declarations[step.service].name, upload(step.service))).version;
      break;
    case "keepRelease":
      stateOf(step.service).version = record.items[`service.${step.service}`].release.version;
      break;
    case "releaseService": {
      const item = record.items[`service.${step.service}`];
      const brought = step.values ? broughtOf(step.values, item) : null;
      const answer = await adapter.releaseService(step.id, upload(step.service), {
        app: release.declarations[step.service].name,
        task: step.task ?? null,
        values: step.values ?? null,
        remove: brought?.remove ?? [],
        idempotencyKey: keyOf(record, "release", step.service, { digest: release.digests[step.service], settings: step.values?.hash ?? null })
      });
      Object.assign(stateOf(step.service), { version: answer.version, refreshId: answer.refreshId, handed: true, bringing: brought?.given ?? null });
      item.release = { digest: release.digests[step.service], version: answer.version };
      message = noteHandOver(record, release.migrations, step);
      break;
    }
    case "createService": {
      const service = serviceOf(step.service);
      const choice = plan.choices.services[service.id];
      const { values } = step;
      const connections = connectionsOf(service, record, release.port);
      const name = release.declarations[service.id].name;
      const state = stateOf(service.id);
      // A public service is routed at the other names with the domain; an adapter that can't route them never gets one.
      const aliases = service.exposure === "public" && !step.withoutDomain ? release.aliases ?? [] : [];
      const made = await adapter.createService({
        name, exposure: service.exposure, size: choice.size, instances: choice.instances, app: name, version: state.version,
        settings: values.settings, secrets: values.secrets, domain: step.withoutDomain ? null : release.domain, connections, labels: labelsFor(record, { kind: "service", name: service.id }),
        ...(aliases.length > 0 ? { aliases } : {}), ...(step.task ? { task: step.task } : {})
      }, { idempotencyKey: keyOf(record, "service", service.id, name) });
      record.items[`service.${service.id}`] = {
        kind: "service", name: service.id, id: made.id, providerName: name, origin: "made", size: choice.size,
        exposure: service.exposure, ...givenOf(values), release: { digest: release.digests[service.id], version: state.version }
      };
      Object.assign(state, { refreshId: made.refreshId, handed: true });
      message = noteHandOver(record, release.migrations, step);
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
        ? { kind: "service", name: step.name, id: thing.id, providerName: thing.name, origin: "made", size: thing.size, exposure: thing.exposure }
        : { kind: "resource", name: step.name, id: thing.id, providerName: thing.name, origin: "made", size: thing.size, resourceKind: thing.resourceKind, links: {} };
      // A service adopted is handed this Deploy's release like any other.
      if (step.item === "service") delete run.services[step.name];
      break;
    }
    case "checkRefresh": {
      const refresh = await adapter.readRefresh(step.id, step.refreshId);
      const state = stateOf(step.service);
      const { task, message: said } = noteTask(record, state, refresh);
      if (task) message = said;
      if (refresh && (refresh.state === "failed" || refresh.state === "aborted")) {
        // The links made against it ended with it, and the release it moved to may not run: the next Deploy makes them
        // and hands it that release again.
        for (const resource of state.linkedAhead ?? []) delete record.items[`resource.${resource}`]?.links?.[step.service];
        const item = record.items[`service.${step.service}`];
        if (item) delete item.release;
        const why = refresh.error?.message ?? `its refresh ${refresh.state}`;
        const what = task?.state === "failed" ? "the migrations failed, so no instance of the new release started"
          : ["create", "release"].includes(refresh.kind) ? "the release did not go live" : `its ${refresh.kind} change did not go live`;
        // The settings it brought didn't go live either: the service keeps those it had, which the record still names.
        run.failure = `${step.service}: ${what}: ${why}`
          + (refresh.fromVersion ? ` The version before (${refresh.fromVersion}) still serves${state.bringing ? ", with its settings as they were" : ""}.` : "")
          + (run.migration?.state === "ran" ? MIGRATED_NOTE : "");
      }
      // The settings it brought are the service's once it succeeded.
      if (refresh?.state === "succeeded" && state.bringing) Object.assign(record.items[`service.${step.service}`], state.bringing);
      Object.assign(state, { refreshId: null, linkedAhead: [], bringing: null });
      break;
    }
    case "putSettings": {
      const refreshId = await adapter.putSettings(step.id, step.values, { idempotencyKey: keyOf(record, "settings", step.service, step.values.hash) });
      // Given once its refresh succeeded; a provider that takes them at once (a service whose first release failed)
      // starts none.
      if (refreshId) Object.assign(stateOf(step.service), { refreshId, bringing: givenOf(step.values) });
      else Object.assign(record.items[`service.${step.service}`], givenOf(step.values));
      break;
    }
    case "changeService": {
      const refreshId = await adapter.changeService(step.id, step.change, { idempotencyKey: keyOf(record, "change", step.service, step.change) });
      const item = Object.assign(record.items[`service.${step.service}`], step.change);
      // The next plan starts from what the service runs now: a Deploy that fails after this keeps the size it set.
      if (step.change.size) record.choices = { ...record.choices, services: { ...record.choices?.services, [step.service]: { size: item.size } } };
      if (refreshId) stateOf(step.service).refreshId = refreshId;
      break;
    }
    case "takeDomain":
      await adapter.takeDomain(step.id, step.domain, {
        take: Boolean(step.from), ...(step.aliases ? { aliases: step.aliases } : {}),
        idempotencyKey: keyOf(record, "takeDomain", step.service, step.aliases ? { domain: step.domain, aliases: step.aliases } : step.domain)
      });
      break;
    case "deleteService":
      await adapter.deleteService(step.id);
      delete record.items[`service.${step.service}`];
      delete run.services[step.service];
      for (const item of Object.values(record.items)) if (item.kind === "resource") delete item.links?.[step.service];
      break;
    default:
      throw new TypeError(`No step ${step.kind}.`);
  }
  return { record, ...(message ? { message } : {}) };
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
    throw deployError("production_deploy_lease_held", `Another ${held.holder ?? "Vibe64"} is deploying this since ${since} UTC; try again when it finishes.`, 409, held);
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
 * @param {any} options.release `{ id, archive, declarations, settings, env, domain, aliases? }` (archive: packArchive's
 *   bytes; aliases: the domain's other names, none when left out)
 * @param {string} options.holder who holds the lease, such as "Vibe64 on my-workstation"
 * @param {(record: any) => Promise<any> | any} [options.save] keeps the record after each step, answering it as kept
 * @param {() => Promise<void> | void} [options.pause] between steps, while the provider works
 * @param {(event: any) => unknown} [options.report] told each step as it starts and ends (`{ at, kind: "step", phase:
 *   "start" | "done" | "refused", step, words, service?, resource?, refresh?, message? }`), each wait when its words
 *   change (`{ kind: "wait", words }`), each call tried again (`{ kind: "retry", words, message }`) and the end (`{ kind:
 *   "end", outcome, message?, migrations? }`, `migrations` "ran", "failed", "asked" or "skipped" where the provider runs
 *   them once as a release's task). A step that hands the migrations, or reads how they went, says so in its `message`,
 *   which names the instance whose logs hold their output.
 * @param {() => boolean} [options.stopAsked] whether the owner asked to stop this Deploy since it was last called (each
 *   ask is answered once): at the next step's boundary the Deploy stops where stop.js allows it, its updates under way
 *   stopped at the provider and its run kept `stopped` (`{ kind: "step", step: "stop", phase: "start" | "done" |
 *   "refused" }`, then `{ kind: "end", outcome: "stopped" }`), or says why it can't and goes on
 * @param {number} [options.maxSteps]
 * @returns {Promise<{ outcome: "live" | "failed" | "stopped", message?: string, record: any, steps: string[] }>}
 */
async function deploy({
  adapter, needs, record: start, choices = {}, decisions = {}, planHash, release, holder, save = (kept) => kept, pause = () => {}, report = () => {},
  stopAsked = () => false, maxSteps = 1000
}) {
  const tell = reporterOf(report);
  // The domain's other names, refused before the provider is asked anything where they can't be served.
  const aliases = release.aliases ?? [];
  const aliasesRefused = aliasesProblem(release.domain, aliases);
  if (aliasesRefused) throw deployError("production_deploy_aliases_invalid", `The domain's other names are refused: ${aliasesRefused}.`, 422);
  if (aliases.length > 0 && typeof adapter.takeDomain !== "function") {
    throw deployError("production_deploy_aliases_unsupported",
      `${adapter.title} can't answer at other names than the domain (${aliases.join(", ")}): remove them, then deploy to production.`, 409);
  }
  const [offer, observed] = await Promise.all([adapter.offer(), adapter.inventory()]);
  const plan = planOf({ needs, record: start, observed, offer, choices, decisions });
  if (plan.hash !== planHash) throw deployError("production_deploy_plan_stale", "What this Deploy would do changed since the plan was read: read the plan again, then deploy to production.");
  if (plan.problems.length > 0) throw deployError("production_deploy_plan_refused", plan.problems[0].message, 422, { problems: plan.problems });
  const digests = Object.fromEntries(needs.services.map((service) => {
    const declaration = release.declarations[service.id];
    return [service.id, releaseDigest(adapter.serviceUpload(release.archive, declaration), declaration)];
  }));
  const full = { ...release, digests, port: adapter.servicePort, trustedProxies: await adapter.trustedProxies(), migrations: migrationsOf(adapter, needs, release) };
  // Taken once the release is read, so a release refused gives up no lease it holds.
  const lease = await takeDeployLease(adapter, start, holder);
  const run = { id: `run_${randomBytes(6).toString("hex")}`, release: release.id, planHash, state: "deploying", domain: null, services: {}, failure: null };
  let record = await save({ ...(await settleLastRun(adapter, start, tell)), run });
  const steps = [];
  let waiting = null;
  let failedReads = 0;
  let stopping = false;
  try {
    for (let count = 0; count < maxSteps; count += 1) {
      // A stop asked: tried again at the next boundary while the provider doesn't answer, and the wait said again after a
      // refusal.
      if (stopping || stopAsked()) {
        const first = !stopping;
        stopping = true;
        try {
          const stopped = await stopAtBoundary({ adapter, record, save, tell, first });
          if (stopped) return { ...stopped, steps };
          [stopping, waiting] = [false, null];
        } catch (error) {
          if (!retryable(error)) throw error;
          tell({ kind: "retry", words: STOP_WORDS, message: error.message });
          await pause();
          continue;
        }
      }
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
        const address = step.kind === "live" ? await addressChange(adapter, release.domain, record.address) : null;
        if (step.kind === "live") Object.assign(ended, { choices: keptChoices(plan.choices), lastPlan: { hash: plan.hash } });
        if (address) ended.address = { host: address.host, target: address.target };
        record = await save(ended);
        if (address) tell({ kind: "address", ...address, words: addressWords(address) });
        // Whether this Deploy's migrations ran, failed or were skipped (no release handed, or one the database ran); none
        // where they run as each instance starts.
        const migrations = full.migrations ? (record.run.migration?.state ?? "skipped") : null;
        tell({ kind: "end", outcome: step.kind, ...(step.message ? { message: step.message } : {}), ...(migrations ? { migrations } : {}) });
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
          const done = await applyStep(adapter, step, { record, needs, plan, release: full });
          record = await save(done.record);
          tell({ ...stepEvent(step, words, record), phase: "done", ...(done.message ? { message: done.message } : {}) });
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
    throw deployError("production_deploy_unfinished", `The Deploy took more than ${maxSteps} steps; its record keeps where it stopped.`, 500);
  } finally {
    if (lease) await adapter.lease.release(lease.id);
  }
}

// Take Production offline and Delete are offline.js's, named here too for those who import them from the steps.
export { deleteResource, takeOffline } from "./offline.js";
export {
  LEASE_SECONDS, LINK_NEEDS_RELEASE, applyStep, backoffPauses, deployError, deploy, nextStep, releaseDigest, retryable, stepWords,
  takeDeployLease
};
