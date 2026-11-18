// The mobilynet adapter: what the engine's plan and steps ask of a provider, in mobilynet's calls (client.js), for one
// mobilynet project and region. Each service is an App Service and each resource a hosted service of mobilynet's
// catalogue (its interface the resource's kind: mysql, postgresql, redis, s3 for a bucket), linked to every service
// under the resource's need (V64_<ID>). Its offer is mobilynet's App Service instance sizes with their list prices, the
// load balancer's and each hosted app's sizes, and the project's quotas with their use; its inventory every App Service
// and hosted service of the project with its labels, the only things the steps act on being those the record holds.
// Every App Service it makes drains for mobilynet's shortest time (DRAIN_SECONDS).
//
// Leases: mobilynet has none yet. The lease calls (client.js takeLease, renewLease, releaseLease) exist in the shape
// the engine asks mobilynet for, and its stand-in answers them; until mobilynet builds them, an adapter made without
// `leases: true` takes none, which is safe only while one editor deploys a project's environment (Managed today:
// the workspace's own editor is the only writer).
import { MOBILYNET_INTERFACES, needAs, serviceUpload } from "./declaration.js";

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

/**
 * @param {object} options
 * @param {ReturnType<typeof import("./client.js").createMobilynetClient>} options.client
 * @param {string} options.project the mobilynet project's id
 * @param {string} [options.region]
 * @param {boolean} [options.leases] whether mobilynet takes leases (its stand-in does; mobilynet not yet)
 */
function createMobilynetAdapter({ client, project, region = "us", leases = false }) {
  const calls = client.project(project);

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
   * Every App Service and hosted service of the project, as the plan, the steps and the record read them: `{ id, name,
   * kind, labels, size, instances, ... }`, a service with its exposure, version, refresh, healthy count, internal
   * name, connections and last error, a resource with its kind and state.
   */
  async function inventory() {
    const [services, hosted] = await Promise.all([calls.listServices(), calls.listHostedServices()]);
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
        lastError: one.lastError ?? null
      })),
      ...hosted.filter((one) => one.state !== "deleted").map((one) => ({
        id: one.id,
        name: one.name,
        kind: "resource",
        labels: one.labels ?? {},
        size: one.size,
        resourceKind: RESOURCE_KIND_OF[one.interface] ?? null,
        state: one.state,
        lastError: one.lastError ?? null
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
      const found = (await client.listRegions()).find((one) => one.id === region);
      return ["loopback", ...(found?.edge?.addresses ?? [])].join(",");
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
    linkResource: async (id, serviceId, need, { idempotencyKey }) => (await client.linkHostedService(id, { consumer: { service: serviceId }, need }, { idempotencyKey })).link,
    listLinks: (id) => client.listHostedLinks(id),
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
    /** A release of a service's app from its upload: `{ version }`. */
    uploadRelease: async (app, upload) => (await calls.createRelease(app, { archive: upload.bytes, sha256: upload.sha256 })).release,
    /** Hands an App Service a new release: `{ version, refreshId }`. */
    async releaseService(id, upload) {
      const answer = await client.createServiceRelease(id, { archive: upload.bytes, sha256: upload.sha256 });
      return { version: answer.release.version, refreshId: answer.refresh?.id ?? null };
    },
    /** Makes an App Service, labelled, with mobilynet's drain: internal ones with no routes, public ones routed at the domain. */
    async createService({ name, exposure, size, instances, app, version, settings, secrets, domain, connections, labels }, { idempotencyKey }) {
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
        ...(exposure === "public" ? { routes: [{ host: domain, tls: "edge" }] } : {}),
        ...(connections.length > 0 ? { connections } : {}),
        labels
      }, { idempotencyKey });
      return { id: service.id, refreshId: refresh?.id ?? null };
    },
    readRefresh: (id, refreshId) => client.readServiceRefresh(id, refreshId),
    putSettings: async (id, { settings, secrets }, { idempotencyKey }) => (await client.putServiceSettings(id, { settings, secrets }, { idempotencyKey })).refresh?.id ?? null,
    changeService: async (id, change, { idempotencyKey }) => (await client.changeService(id, change, { idempotencyKey })).refresh?.id ?? null,
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
