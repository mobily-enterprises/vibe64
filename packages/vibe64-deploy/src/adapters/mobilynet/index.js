// The mobilynet adapter: what the engine's plan and steps ask of a provider, in mobilynet's calls (client.js), for one
// mobilynet project and region. Each service is an App Service and each resource a hosted service of mobilynet's
// catalogue (its interface the resource's kind: mysql, postgresql, redis, s3 for a bucket), linked to every service
// under the resource's need (V64_<ID>). Its offer is mobilynet's App Service instance sizes with their list prices, the
// load balancer's and each hosted app's sizes, and the project's quotas with their use; its inventory every App Service
// and hosted service of the project with its labels, the only things the steps act on being those the record holds,
// each hosted service Vibe64 made with the links mobilynet holds of it, which the steps believe over the record's.
// Every App Service it makes drains for mobilynet's shortest time (DRAIN_SECONDS).
//
// The domain: a public App Service asks for the domain's name in its `routes`, and mobilynet sends the name's route to
// it, making the route or taking the one the name has (kept, sending to nothing, after Take offline; or moved with
// `take` from the public service it replaces: takeDomain). The route is the name's: its `target`, the CNAME the owner
// adds once, is its own name (`rte-…`), which stays through Take offline, every Deploy and a replaced App Service
// (domainRecords). A mobilynet whose service routes still answer the service's own name (`svc-…`) gives no target.
//
// Leases: mobilynet has none yet. The lease calls (client.js takeLease, renewLease, releaseLease) exist in the shape
// the engine asks mobilynet for, and its stand-in answers them; until mobilynet builds them, an adapter made without
// `leases: true` takes none, which is safe only while one editor deploys a project's environment (Managed today:
// the workspace's own editor is the only writer).
import { LABEL } from "../../record.js";
import { LINK_NEEDS_RELEASE, SETTINGS_NEED_RELEASE } from "../../steps.js";
import { MOBILYNET_INTERFACES, RELEASE_TASKS, SERVICE_SETTINGS_FALLBACK, needAs, serviceUpload } from "./declaration.js";

const RESOURCE_KIND_OF = Object.freeze(Object.fromEntries(Object.entries(MOBILYNET_INTERFACES).map(([kind, name]) => [name, kind])));
// mobilynet's names for an App Service and a hosted service: 1 to 64 lowercase letters, digits and hyphens.
const HOSTED_NAME_MAX = 40;
// How mobilynet counts against its project's quotas (engine-support M12): an App Service's instances, each its size's
// vCPUs and memory; a hosted service's machine, with its vCPUs, memory and data disk.
const QUOTA_COUNTS = Object.freeze({ service: Object.freeze(["vcpus", "memoryGib"]), resource: Object.freeze(["machines", "vcpus", "memoryGib", "diskGib"]) });
// An instance leaving (a count lowered, a refresh replacing it, its service deleted) leaves the load balancer and gets
// this long to finish the requests it has, then a stop signal and as long again: mobilynet's shortest drain, which
// genesis/stack.md has no line to change.
const DRAIN_SECONDS = 30;
// A route's own name, which stays while the route does, where a service's own name (`svc-…`) changes with the service.
const ROUTE_NAME = /^rte-/u;
// The states in which mobilynet holds a link (hostedLinks.js HELD): its consumer has or is being given its need's
// settings, and a second link of that need is refused (`need_linked`). One `revoking` or `revoked` has ended: removed,
// or ended with a refresh of its consumer that failed or was aborted, which ends every link the release the consumer
// still runs doesn't name (engine-support M14), whichever Deploy made it.
const HELD_LINK_STATES = Object.freeze(["issuing", "active", "failed"]);

/**
 * A link mobilynet takes only with the service's new release under way, as the engine's own refusal
 * (LINK_NEEDS_RELEASE): mobilynet checks a link of an App Service against the release it runs, else against the one
 * its refresh in progress moves it to (engine-support M14), so it refuses `422 validation_failed` one the release it
 * runs doesn't name (`need`: "declares no need"), one of a service that runs no release yet, and one asked while that
 * refresh is queued or hasn't read its release (`consumer`: "no release built yet", "isn't read yet", which the client
 * marks to be tried again). Any other refusal is mobilynet's, as it gave it.
 * @param {any} error
 */
function linkRefusal(error) {
  const fields = error?.code === "validation_failed" ? error.details?.fieldErrors ?? {} : {};
  const waits = /declares no need/u.test(fields.need ?? "") || /release/u.test(fields.consumer ?? "");
  if (!waits) return error;
  return Object.assign(new Error(error.message), { code: LINK_NEEDS_RELEASE, retryable: error.retryable, details: error.details, cause: error });
}

/**
 * A replace of a service's settings mobilynet takes only with its new release, as the engine's own refusal
 * (SETTINGS_NEED_RELEASE): mobilynet checks a replace against the release the service runs (serviceFields.js
 * checkSettings). It takes a name that release doesn't declare as a plain setting or a secret (decided 19 Nov), so a
 * Production Env entry, which no release declares, goes in a replace whatever the release; it refuses `422
 * validation_failed` one giving a setting the release declares otherwise (a secret as a plain setting), `422
 * settings_missing` one lacking a setting only the release it runs requires, and `409 invalid_state` one asked while the
 * service's first release is still under way. The engine then gives them after the release, which is also where a
 * value that fits no release is refused again, as mobilynet refused it. One tried again later (a service busy) is
 * mobilynet's, as it gave it.
 * @param {any} error
 */
function settingsRefusal(error) {
  const waits = !error?.retryable && ["validation_failed", "settings_missing", "invalid_state"].includes(error?.code);
  if (!waits) return error;
  return Object.assign(new Error(error.message), { code: SETTINGS_NEED_RELEASE, retryable: false, status: error.status, details: error.details, cause: error });
}

/**
 * @param {object} options
 * @param {ReturnType<typeof import("./client.js").createMobilynetClient>} options.client
 * @param {string} options.project the mobilynet project's id
 * @param {string} [options.region]
 * @param {boolean} [options.leases] whether mobilynet takes leases (its stand-in does; mobilynet not yet)
 * @param {boolean} [options.releaseTasks] whether mobilynet runs a release's task once per refresh (its stand-in does;
 *   mobilynet not yet: RELEASE_TASKS)
 */
function createMobilynetAdapter({ client, project, region = "us", leases = false, releaseTasks = RELEASE_TASKS }) {
  const calls = client.project(project);

  /** The adapter's region as mobilynet lists it now, or null when it lists none of that id. */
  async function regionRead() {
    return (await client.listRegions()).find((one) => one.id === region) ?? null;
  }

  /** Each resource kind's hosted app of the catalogue, its default size and its sizes. */
  async function resourcesOffered() {
    const catalogue = await client.readHostedCatalogue();
    const resources = {};
    for (const entry of catalogue.items) {
      const kind = RESOURCE_KIND_OF[entry.interface.id];
      if (!kind || resources[kind]) continue;
      resources[kind] = {
        app: entry.app,
        defaultSize: entry.defaultSize,
        sizes: entry.sizes.map((size) => ({ name: size.name, vcpus: size.vcpus, memoryGib: size.memoryGib, dataDiskGib: size.dataDiskGib, monthlyNano: size.monthlyNano }))
      };
    }
    return resources;
  }

  /**
   * The offer: App Service sizes by price, the load balancer's price, each resource kind's hosted app and sizes, and
   * the project's quotas with their use, which the Plan counts what a Deploy adds against.
   */
  async function offer() {
    const [prices, resources, quotas] = await Promise.all([client.readPrices(), resourcesOffered(), calls.readQuotas()]);
    const sizes = prices.sizes.filter((size) => size.kind === "instance" && size.price)
      .map((size) => ({ name: size.name, vcpus: size.vcpus, memoryGib: size.memoryGib, monthlyNano: String(size.price.monthlyNano) }));
    const balancer = prices.inForce.prices.find((row) => row.kind === "load_balancer");
    const counted = new Set(Object.values(QUOTA_COUNTS).flat());
    return {
      title: "mobilynet",
      currency: prices.inForce.currency,
      sizes,
      balancer: balancer ? { monthlyNano: balancer.monthlyNano } : null,
      resources,
      quota: {
        quotas: quotas.filter((line) => counted.has(line.quota)).map(({ quota, unit, limit, used }) => ({ quota, unit, limit, used })),
        counts: QUOTA_COUNTS
      }
    };
  }

  /**
   * The links mobilynet holds of a hosted service Vibe64 made, `[{ id, service, need }]` (`service` the consuming App
   * Service's id); null for one Vibe64 didn't make, which no step links, or one gone since it was listed.
   * @param {any} one the hosted service as mobilynet lists it
   */
  async function linksHeld(one) {
    if (!one.labels?.[LABEL.deployment]) return null;
    let listed;
    try {
      listed = await client.listHostedLinks(one.id);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
    return listed.filter((link) => HELD_LINK_STATES.includes(link.state))
      .map((link) => ({ id: link.id, service: link.consumer?.kind === "service" ? link.consumer.id : null, need: link.need ?? null }));
  }

  /**
   * Every App Service and hosted service of the project, as the plan, the steps and the record read them: `{ id, name,
   * kind, labels, size, instances, ... }`, a service with its exposure, version, refresh, healthy count, internal
   * name, connections, last error and the names its routes send it (`hosts`), a resource with its kind, state and the
   * links mobilynet holds of it (`links`, null for a hosted service Vibe64 didn't make).
   */
  async function inventory() {
    const [services, listed] = await Promise.all([calls.listServices(), calls.listHostedServices()]);
    const hosted = listed.filter((one) => one.state !== "deleted");
    const links = await Promise.all(hosted.map(linksHeld));
    return [
      ...services.filter((one) => one.state !== "deleted").map((one) => ({
        id: one.id,
        name: one.name,
        kind: "service",
        labels: one.labels ?? {},
        size: one.size,
        instances: one.instances?.wanted ?? null,
        exposure: one.exposure,
        state: one.state,
        version: one.version,
        refresh: one.refresh ?? null,
        healthy: one.instances?.healthy ?? 0,
        internalName: one.internalName ?? null,
        connections: (one.connections ?? []).map(({ to, port }) => ({ to, port })),
        lastError: one.lastError ?? null,
        hosts: (one.routes ?? []).map((route) => route.host)
      })),
      ...hosted.map((one, index) => ({
        id: one.id,
        name: one.name,
        kind: "resource",
        labels: one.labels ?? {},
        size: one.size,
        resourceKind: RESOURCE_KIND_OF[one.interface] ?? null,
        state: one.state,
        lastError: one.lastError ?? null,
        links: links[index]
      }))
    ];
  }

  return Object.freeze({
    provider: "mobilynet",
    title: "mobilynet",
    project,
    offer,
    inventory,
    /** The proxies an app believes: the edge's addresses in the region, before it. */
    async trustedProxies() {
      const found = await regionRead();
      return ["loopback", ...(found?.edge?.addresses ?? [])].join(",");
    },
    /**
     * How many settings and secrets an App Service of the region holds now, its links' among them, which a service's
     * settings are counted against (declaration.js servicePackagesProblem): the region's `serviceSettingsMax`, 199
     * where every host of the region runs agent 2.9.0 or later and 49 while one runs an earlier agent; where mobilynet
     * doesn't say, SERVICE_SETTINGS_FALLBACK, what such a host holds.
     */
    async serviceSettingsMax() {
      const held = (await regionRead())?.serviceSettingsMax;
      return Number.isSafeInteger(held) && held > 0 ? held : SERVICE_SETTINGS_FALLBACK;
    },
    /** A resource's hosted service's name, made once: the app's and the resource's. */
    hostedName: (app, resource) => `${app}-${resource}`.toLowerCase().replace(/[^a-z0-9-]/gu, "-").slice(0, HOSTED_NAME_MAX).replace(/-+$/u, ""),
    /** The need a resource's link fills in every service. */
    needOf: (resource) => needAs(resource),
    /** Makes a resource's hosted service, labelled. */
    createResource: async ({ name, kind, size, labels }, { idempotencyKey }) => {
      const { app } = (await resourcesOffered())[kind];
      return (await calls.createHostedService({ app, name, size, region, labels }, { idempotencyKey })).hostedService;
    },
    resizeResource: (id, size, { idempotencyKey }) => client.changeHostedService(id, { size }, { idempotencyKey }),
    linkResource: async (id, serviceId, need, { idempotencyKey }) => {
      try {
        return (await client.linkHostedService(id, { consumer: { service: serviceId }, need }, { idempotencyKey })).link;
      } catch (error) {
        throw linkRefusal(error);
      }
    },
    listLinks: (id) => client.listHostedLinks(id),
    /**
     * A resource's backups as an owner reads them (`hosted:read`): its point-in-time window (`from`, and `to`, null
     * while it reaches the newest point, `latest`), the reason they fail while they do, and its machine's disk backups
     * (how often, the newest first, each with when it was taken and until when it can be restored).
     * @param {string} id the hosted service's id
     */
    backupsOf: async (id) => {
      const backups = await client.readHostedBackups(id);
      // A hosted service runs one app, whose backups are its data's.
      const app = backups.apps?.[0] ?? null;
      const disk = backups.disk ?? null;
      return {
        enabled: backups.enabled === true,
        pointInTime: app?.restorable ? { from: app.restorable.from, to: app.restorable.to ?? null, latest: app.lastLogAt ?? null } : null,
        failure: app?.failure?.message ?? null,
        disk: disk
          ? {
            made: disk.server === "making",
            everyHours: disk.everyHours ?? null,
            failure: disk.failure?.message ?? null,
            backups: (disk.backups ?? []).map((one) => ({ at: one.at, restorableUntil: one.restorableUntil }))
          }
          : null
      };
    },
    unlinkResource: (id, linkId) => client.unlinkHostedService(id, linkId),
    /** Deletes a resource's hosted service and its data (deleteResource, never a Deploy), its links with it. */
    deleteResource: (id) => client.deleteHostedService(id, { revokeLinks: true }),
    /** A service's upload: the archive with its declaration at the root. */
    serviceUpload,
    /** Covers the domain with one of the project's, made when it has none. */
    async ensureDomain(name, { idempotencyKey }) {
      const domains = await calls.listDomains();
      const parent = name.split(".").slice(1).join(".");
      if (domains.some((one) => one.name === name || one.name === `*.${parent}`)) return null;
      return calls.createDomain(name, { idempotencyKey });
    },
    /**
     * What the owner adds to the domain's DNS, as the other adapters answer it: mobilynet's TXT (and a wildcard's
     * challenge CNAME) while its domain is unverified, and the CNAME of the name to its route's own name while it has a
     * route, sending to nothing (Offline) too; `target` that name, null where mobilynet answers no route's own name.
     * @param {string} name
     */
    async domainRecords(name) {
      const [domains, routes] = await Promise.all([calls.listDomains(), calls.listRoutes()]);
      const parent = name.split(".").slice(1).join(".");
      const domain = domains.find((one) => one.name === name) ?? domains.find((one) => one.name === `*.${parent}`) ?? null;
      const route = routes.find((one) => one.host === name) ?? null;
      const proving = domain && domain.state !== "verified";
      return {
        domain: name,
        certificate: route?.certificate?.state ?? null,
        live: route?.live === true,
        waitingFor: route ? route.waitingFor ?? null : proving ? "domain" : null,
        target: ROUTE_NAME.test(route?.target ?? "") ? route.target : null,
        records: [
          ...(proving ? domain.records.map((one) => ({ name: `${one.name}.`, type: one.type, data: one.type === "CNAME" ? `${one.value}.` : one.value })) : []),
          ...(route ? [{ name: `${name}.`, type: "CNAME", data: `${route.target}.` }] : [])
        ]
      };
    },
    /** A release of a service's app from its upload: `{ version }`. */
    uploadRelease: async (app, upload) => (await calls.createRelease(app, { archive: upload.bytes, sha256: upload.sha256 })).release,
    /**
     * Whether a refresh runs a release's task once before any instance starts (a capability the engine reads): mobilynet
     * has no such task yet (the engine's ask M-C), so the adapter runs none unless made with `releaseTasks: true`, as its
     * stand-in is; its declarations then carry the task and their serve scripts no Migrate (declaration.js).
     */
    releaseTasks,
    /**
     * The task a service's declaration runs once per refresh asked to, before its instances: `migrate`, or null. A
     * declaration with a migrate task its serve script no longer runs is refused where mobilynet runs no task: its
     * migrations would never run.
     */
    taskOf(declaration) {
      if (!declaration?.tasks?.migrate) return null;
      if (!releaseTasks) {
        throw Object.assign(new Error(`${declaration.name}'s release declares a migrate task, which mobilynet runs no `
          + "release task for yet; its serve script must migrate (servicePackages with releaseTasks off)."), { code: "deployment_release_tasks_unsupported" });
      }
      return "migrate";
    },
    /** Hands an App Service a new release, its refresh running `task` first when given: `{ version, refreshId }`. */
    async releaseService(id, upload, { task = null } = {}) {
      const answer = await client.createServiceRelease(id, { archive: upload.bytes, sha256: upload.sha256 }, { task });
      return { version: answer.release.version, refreshId: answer.refresh?.id ?? null };
    },
    /**
     * Makes an App Service, labelled, with mobilynet's drain: internal ones with no routes, public ones routed at the
     * domain (none while `domain` is null: another public service has it, which takeDomain moves it from).
     */
    async createService({ name, exposure, size, instances, app, version, settings, secrets, domain, connections, labels, task = null }, { idempotencyKey }) {
      const { service, refresh } = await calls.createService({
        name,
        region,
        exposure,
        size,
        instances,
        drainSeconds: DRAIN_SECONDS,
        app: { name: app, version },
        settings,
        secrets,
        ...(exposure === "public" ? { routes: domain ? [{ host: domain, tls: "edge" }] : [] } : {}),
        ...(connections.length > 0 ? { connections } : {}),
        labels,
        ...(task ? { task } : {})
      }, { idempotencyKey });
      return { id: service.id, refreshId: refresh?.id ?? null };
    },
    /**
     * How a refresh went, as mobilynet answers it, with its task's (`task: { name, state, exitCode, output }`, its
     * last lines of output) where it ran one.
     */
    readRefresh: (id, refreshId) => client.readServiceRefresh(id, refreshId),
    /** Replaces an App Service's own settings and secrets: its refresh's id, null when mobilynet took them at once. */
    async putSettings(id, { settings, secrets }, { idempotencyKey }) {
      try {
        return (await client.putServiceSettings(id, { settings, secrets }, { idempotencyKey })).refresh?.id ?? null;
      } catch (error) {
        throw settingsRefusal(error);
      }
    },
    changeService: async (id, change, { idempotencyKey }) => (await client.changeService(id, change, { idempotencyKey })).refresh?.id ?? null,
    /**
     * Routes the domain to a public App Service: its route made or taken, and with `take` moved from the service that
     * has it, in one call; mobilynet refuses a name a VPS, a group or another service has, without `take`, `409
     * name_taken`.
     */
    takeDomain: async (id, domain, { take, idempotencyKey }) => {
      await client.changeService(id, { routes: [{ host: domain, tls: "edge", ...(take ? { take: true } : {}) }] }, { idempotencyKey });
    },
    deleteService: (id) => client.deleteService(id),
    /** The port a service reaches another on: every service listens on 3000. */
    servicePort: 3000,
    lease: leases
      ? Object.freeze({
        take: async (name, holder, seconds) => (await client.takeLease({ name, holder, seconds })).lease,
        renew: async (id, seconds) => (await client.renewLease(id, { seconds })).lease,
        release: (id) => client.releaseLease(id)
      })
      : null
  });
}

export { DRAIN_SECONDS, createMobilynetAdapter };
