// What every part of the AWS adapter shares: the client, the region and the one deployment it acts for, the names it
// gives what it makes and the tags it puts on everything. Everything carries Vibe64's tags (record.js LABEL): what the
// engine records carries its item's (`service.<id>`, `resource.<id>`), the parts the deployment shares (its network, its
// cluster, its roles, its load balancer, its build) `base.<part>`. The inventory reads back only what carries
// `vibe64-deployment`, and a call that changes a thing first checks it carries this deployment's.
import { LABEL } from "../../record.js";

// Every deployment's network: its own VPC, so the same range everywhere. The load balancer's private addresses are in
// it, which is why it is the proxies an app believes.
const VPC_CIDR = "10.64.0.0/16";
const SUBNETS = Object.freeze([{ part: "subnet-a", cidr: "10.64.0.0/20" }, { part: "subnet-b", cidr: "10.64.16.0/20" }]);
const SERVICE_PORT = 3000;

/** An error of the adapter's own, shaped as the engine reads a provider's: `code`, `retryable`, a message to act on. */
function adapterError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable, status: retryable ? 503 : 409 });
}

/** A name AWS takes: lowercase letters, digits and hyphens, no two hyphens together, none at either end. @param {string} text */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/-+/gu, "-").replace(/^-|-$/gu, "");
}

/** Tags as a plain object, from any of AWS's shapes: [{ Key, Value }], [{ key, value }] or a map. @param {unknown} tags */
function tagsOf(tags) {
  if (!tags) return {};
  if (!Array.isArray(tags)) return typeof tags === "object" ? { ...tags } : {};
  return Object.fromEntries(tags.map((tag) => [tag.Key ?? tag.key, tag.Value ?? tag.value ?? ""]));
}

/**
 * The context of one deployment at one AWS region.
 * @param {{ client: any, deployment?: { id: string, app: string, environment: string } | null, now?: () => number }} options
 */
function createContext({ client, deployment = null, now = () => Date.now() }) {
  const region = client.region;
  const short = deployment ? deployment.id.replace(/^dep_/u, "").slice(-8).toLowerCase() : "";

  /** The deployment this adapter acts for, or the refusal of a change made without one. */
  function own() {
    if (!deployment) throw new TypeError("This AWS adapter reads only: it was made without the deployment it would change.");
    return deployment;
  }

  /**
   * A thing's name: `v64-<deployment's 8>-<part>`, at most `max` characters. The eight are the deployment id's last
   * (40 random bits), so no two deployments' names meet, in an account or (for buckets) anywhere; the tags say which
   * app and environment a thing is.
   * @param {string} part @param {number} [max]
   */
  function nameOf(part, max = 63) {
    own();
    return slug(`v64-${short}-${part}`).slice(0, max).replace(/-$/u, "");
  }

  /**
   * The tags of an item of the record (`service.web`) or of a shared part (`base.network`), as a plain object.
   * @param {string} item
   */
  function tagsFor(item) {
    const { id, app, environment } = own();
    return { [LABEL.deployment]: id, [LABEL.app]: app, [LABEL.environment]: environment, [LABEL.item]: item };
  }

  /** Whether tags (in any shape) are this deployment's. @param {unknown} tags */
  function isOwn(tags) {
    return Boolean(deployment) && tagsOf(tags)[LABEL.deployment] === deployment.id;
  }

  return {
    client,
    region,
    deployment,
    short,
    own,
    nameOf,
    tagsFor,
    isOwn,
    now,
    /** The shared parts once made (base.js), the offer a while, what never changes once read (a task definition, a template version, a bucket's tags, a repository), and when this Deploy began waiting for a certificate. */
    cache: { base: null, offer: null, revisions: new Map(), bucketTags: new Map(), repositories: new Map(), waits: new Map() }
  };
}

/** Tags in EC2's TagSpecification, for a create of `type`. @param {string} type @param {Record<string, string>} tags */
function tagSpecification(type, tags) {
  return [{ ResourceType: type, Tag: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }];
}

/** Tags as [{ Key, Value }]. @param {Record<string, string>} tags */
function keyValueTags(tags) {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

/** Tags as [{ key, value }] (ECS, CodeBuild). @param {Record<string, string>} tags */
function lowerTags(tags) {
  return Object.entries(tags).map(([key, value]) => ({ key, value }));
}

/** Text as a whole-word idempotency token of at most `length` letters and digits, from the engine's key. */
function tokenOf(key, length = 32) {
  return String(key).replace(/[^A-Za-z0-9]/gu, "").slice(-length) || "vibe64";
}

export { SERVICE_PORT, SUBNETS, VPC_CIDR, adapterError, createContext, keyValueTags, lowerTags, slug, tagSpecification, tagsOf, tokenOf };
