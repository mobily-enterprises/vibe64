// The AWS adapter: what the engine's plan and steps ask of a provider, in AWS's calls (client.js), for one deployment
// in one region of one AWS account. Each service runs its release's image, built at AWS by CodeBuild into ECR
// (build.js): on Fargate behind the deployment's Application Load Balancer when public, reached through the
// deployment's private names (Cloud Map) when internal; or, when it has a sandbox allowance or is reached at each
// instance, on whole machines of its own, an EC2 Auto Scaling group (services.js, machine.js). Reaches are security
// group rules on the port. A postgresql resource is RDS for PostgreSQL, a mysql one RDS for MariaDB (a standby copy is
// Multi-AZ), a bucket private S3 with a key that reaches it alone (resources.js); redis is refused with its reason
// (offer.js). Secrets are Secrets Manager's, logs CloudWatch Logs', the domain's certificate ACM's, validated by DNS
// (domain.js). The network is the deployment's own VPC, with no NAT gateway (base.js).
//
// Everything the adapter makes carries Vibe64's tags (record.js LABEL), and is named v64-<the deployment id's last
// eight>-<part>, so no two deployments' things meet. The inventory reads only what carries this deployment's tags, and
// every call that changes a thing first reads it and refuses one that doesn't (`aws_not_ours`).
//
// The credential is the client's: the person's own keys, signed here, or a gateway that signs for a short-lived token.
// AWS has no leases: an adapter takes none, safe while one editor deploys an environment.
import { imageUpload } from "../../image.js";
import { needAs } from "../mobilynet/declaration.js";
import { uploadRelease } from "./build.js";
import { SERVICE_PORT, VPC_CIDR, createContext, slug } from "./context.js";
import { domainRecords, ensureDomain } from "./domain.js";
import { readOffer } from "./offer.js";
import { createResource, deleteResource, resizeResource, resourcesNow } from "./resources.js";
import { changeService, createService, deleteService, linkResource, putSettings, readRefresh, releaseService, servicesNow, unlinkResource } from "./services.js";

// AWS's list prices change rarely: the offer is read again after this long.
const OFFER_MS = 15 * 60_000;

/**
 * @param {object} options
 * @param {ReturnType<typeof import("./client.js").createAwsClient>} options.client
 * @param {{ id: string, app: string, environment: string } | null} [options.deployment] the record's deploymentId, app and
 *   environment: the deployment the adapter reads and changes (without one it gives the offer alone)
 * @param {string} options.nixpkgs the 40-character NixOS/nixpkgs commit images take their packages from
 * @param {() => number} [options.now]
 */
function createAwsAdapter({ client, deployment = null, nixpkgs, now = () => Date.now() }) {
  if (!/^[0-9a-f]{40}$/u.test(String(nixpkgs ?? ""))) throw new TypeError("nixpkgs is the 40-character commit of NixOS/nixpkgs images take their packages from.");
  if (deployment && !(/^dep_[a-z2-7]{8,}$/u.test(String(deployment.id)) && deployment.app && deployment.environment)) {
    throw new TypeError("deployment is the record's { id, app, environment }.");
  }
  const ctx = createContext({ client, deployment, now });

  /** The offer, from AWS's list prices, read again after a while. */
  async function offer() {
    if (!ctx.cache.offer || now() - ctx.cache.offer.at > OFFER_MS) ctx.cache.offer = { at: now(), value: await readOffer(client) };
    return structuredClone(ctx.cache.offer.value);
  }

  /** The deployment's services and resources at AWS, as the plan, the steps and the record read them. */
  async function inventory() {
    if (!deployment) return [];
    return [...await servicesNow(ctx), ...await resourcesNow(ctx)];
  }

  return Object.freeze({
    provider: "aws",
    title: "AWS",
    region: client.region,
    offer,
    inventory,
    /** The proxies an app believes: the load balancer's private addresses, which are in the deployment's VPC. */
    trustedProxies: async () => `loopback,${VPC_CIDR}`,
    /** A resource's name at AWS (a database's identifier). */
    hostedName: (app, resource) => (deployment ? ctx.nameOf(resource) : slug(`${app}-${resource}`)),
    /** The need a resource's link fills in every service. */
    needOf: (resource) => needAs(resource),
    servicePort: SERVICE_PORT,
    createResource: (spec) => createResource(ctx, spec),
    resizeResource: (id, size) => resizeResource(ctx, id, size),
    linkResource: (id, serviceId, need) => linkResource(ctx, id, serviceId, need),
    unlinkResource: (id, linkId) => unlinkResource(ctx, id, linkId),
    /** Deletes a resource and its data (deleteResource, never a Deploy). */
    deleteResource: (id) => deleteResource(ctx, id),
    /** A service's upload: the archive with its Containerfile, and its declaration, which is kept beside it. */
    serviceUpload: (archive, declaration) => ({ ...imageUpload(archive, declaration, { nixpkgs }), declaration }),
    ensureDomain: (domain, options) => ensureDomain(ctx, domain, options),
    /** The DNS records the owner adds for the domain, and its certificate's status. */
    domainRecords: (domain) => domainRecords(ctx, domain),
    /** Keeps a release and starts its image's build: `{ version }`, the image's tag. */
    uploadRelease: (app, upload) => uploadRelease(ctx, app, upload),
    releaseService: (id, upload) => releaseService(ctx, id, upload),
    createService: (spec, options) => createService(ctx, spec, options),
    readRefresh: (id, refreshId) => readRefresh(ctx, id, refreshId),
    putSettings: (id, values) => putSettings(ctx, id, values),
    changeService: (id, change) => changeService(ctx, id, change),
    deleteService: (id) => deleteService(ctx, id),
    lease: null
  });
}

export { createAwsAdapter };
