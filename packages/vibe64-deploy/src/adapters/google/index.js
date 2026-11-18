import { imageUpload } from "../../image.js";
import { needAs } from "../mobilynet/declaration.js";
import { HEALTH_RANGES, SERVICE_PORT, createGoogleBase } from "./base.js";
import { createGoogleFrontends } from "./frontends.js";
import { offerOf } from "./prices.js";
import { createGoogleReleases } from "./releases.js";
import { createGoogleResources } from "./resources.js";
import { createGoogleServices } from "./services.js";

// The Google Cloud adapter: what the engine's plan and steps ask of a provider, in Google Cloud's REST calls
// (client.js), for one Google Cloud project and region. Each service is a Cloud Run service (public: ingress only from
// the external Application Load Balancer; internal: internal ingress, reached at its own https address), or, when it
// needs whole machines of its own (a size from the offer's machineSizes: a sandbox allowance, or reached at each
// instance), a regional managed instance group of Compute Engine machines running its image (machine.js), public behind
// the same load balancer, internal behind an internal passthrough load balancer whose DNS name it is reached at. Every
// service has its own runtime service account. Machines are on the shared network's subnet, tagged per service; Cloud
// Run services leave through Direct VPC egress from a subnet of their own. Reaches is a firewall rule opening the
// reached machines' port, to the reaching service's tag (or, from Cloud Run, to Cloud Run's subnet: its egress carries
// no tag an ingress rule matches). An internal Cloud Run service takes no firewall rule: its internal ingress lets in
// every service of the project's network. A postgresql or mysql resource is a Cloud SQL instance on a
// private address of the shared network; a bucket is Cloud Storage, reached through its S3-compatible XML API with an
// HMAC key per service. Secrets are Secret Manager's, read by the service's account; logs are Cloud Logging's. The
// domain is a Certificate Manager certificate with a DNS authorisation, on the load balancer's address. Each service's
// image is built by Cloud Build from its upload (image.js) into Artifact Registry.
//
// Everything a deployment makes carries Vibe64's labels in Google's form (names.js), where Google keeps labels: Cloud
// Run services, instance templates (so a group's machines), Cloud SQL instances, buckets, secrets and certificates; the
// inventory reads them back, and the steps act only on what the record holds. The parts of an item (its load balancer
// pieces, its account, its secrets, its firewall rule) are named from the item and go with it. What every deployment of
// the project shares (the network, its NAT, the registry, the build bucket, the peering Cloud SQL uses) is made once,
// named vibe64-*, and never deleted by a step.
//
// Links: a service is given each resource's settings when it is made or handed a release, as the release it runs needs
// them (its declaration, kept beside its source in the build bucket), so its first instances start with them; the
// engine's link step then finds the credential made and answers it. Google has no leases: an adapter takes none, safe
// while one editor deploys an environment.
//
// Its parts: base.js (each API's calls, Google's operations, what the project's deployments share, accounts and
// secrets), releases.js (builds), resources.js (Cloud SQL, Cloud Storage and their credentials), frontends.js (firewall
// rules, load balancers, the domain) and services.js (Cloud Run services and groups of machines).

// Where a request reaches a Cloud Run container from: Cloud Run's own front end, on a link-local address.
const CLOUD_RUN_PEER = "169.254.0.0/16";
const HOSTED_NAME_MAX = 40;

/**
 * @param {object} options
 * @param {ReturnType<typeof import("./client.js").createGoogleClient>} options.client
 * @param {string} options.project the Google Cloud project's id
 * @param {string} options.region such as us-central1
 * @param {string} options.nixpkgs the 40-character NixOS/nixpkgs commit images take their packages from
 * @param {string} [options.buildServiceAccount] the email of the account Cloud Build runs as, where the project has no default
 * @param {(ms: number) => Promise<void>} [options.pause] between reads of an operation Google is still at
 * @param {number} [options.waitTries] how many reads of an operation before the step is tried again later
 */
function createGoogleAdapter({ client, project, region, nixpkgs, buildServiceAccount, pause, waitTries }) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(String(project ?? ""))) throw new TypeError("project is the Google Cloud project's id.");
  if (!/^[a-z]+-[a-z]+[0-9]$/u.test(String(region ?? ""))) throw new TypeError("region is a Google Cloud region, such as us-central1.");
  if (!/^[0-9a-f]{40}$/u.test(String(nixpkgs ?? ""))) throw new TypeError("nixpkgs is the 40-character commit of NixOS/nixpkgs images take their packages from.");
  const base = createGoogleBase({ client, project, region, buildServiceAccount, ...(pause ? { pause } : {}), ...(waitTries ? { waitTries } : {}) });
  const releases = createGoogleReleases(base);
  const resources = createGoogleResources(base);
  const frontends = createGoogleFrontends(base);
  const services = createGoogleServices({ ...base, ...releases, ...resources, ...frontends });

  return Object.freeze({
    provider: "google",
    title: "Google Cloud",
    project,
    region,
    /** The offer: Cloud Run shapes, machine types for services that need machines, Cloud SQL tiers, the bucket, at list price. */
    offer: () => offerOf((serviceId) => client.listAll("cloudbilling", `v1/services/${serviceId}/skus`, "skus", { currencyCode: "USD" }, { size: 5000 }), region),
    /** Every service and resource of the project in the region, with its labels read back. */
    inventory: async () => [...await services.servicesNow(), ...await resources.resourcesNow()],
    /** The proxies an app believes: Google's front ends, which the load balancer's requests come from. */
    trustedProxies: async () => ["loopback", ...HEALTH_RANGES, CLOUD_RUN_PEER].join(","),
    /** A resource's name, made once: the app's and the resource's (a bucket adds a digest of the project). */
    hostedName: (app, resource) => `${app}-${resource}`.toLowerCase().replace(/[^a-z0-9-]/gu, "-").slice(0, HOSTED_NAME_MAX).replace(/-+$/u, ""),
    needOf: (resource) => needAs(resource),
    createResource: resources.createResource,
    resizeResource: resources.resizeResource,
    linkResource: resources.linkResource,
    unlinkResource: resources.unlinkResource,
    deleteResource: resources.deleteResource,
    /** A service's upload: the archive with its Containerfile, and the declaration its release keeps. */
    serviceUpload: (archive, declaration) => ({ ...imageUpload(archive, declaration, { nixpkgs }), declaration }),
    ensureDomain: frontends.ensureDomain,
    domainRecords: frontends.domainRecords,
    uploadRelease: releases.uploadRelease,
    releaseService: services.releaseService,
    createService: services.createService,
    readRefresh: services.readRefresh,
    putSettings: services.putSettings,
    changeService: services.changeService,
    deleteService: services.deleteService,
    servicePort: SERVICE_PORT,
    lease: null
  });
}

export { createGoogleAdapter };
