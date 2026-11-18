import { createHash, randomBytes } from "node:crypto";

import { createStandInCatalog } from "./standIn/catalog.js";
import { createStandInCompute } from "./standIn/compute.js";
import { createStandInPlatform } from "./standIn/platform.js";
import { createStandInRun } from "./standIn/run.js";
import { createStandInSql } from "./standIn/sql.js";
import { createStandInStorage } from "./standIn/storage.js";

// Google Cloud's stand-in for the deploy engine: a `fetch` that answers the requests the engine's Google client makes
// (client.js), in memory, in the shapes Google's REST references give, for one Google Cloud project: Compute Engine's
// network, firewall rules, load balancer parts, instance templates and regional managed instance groups with their
// machines (standIn/compute.js); Cloud Run services and their revisions (standIn/run.js); Cloud SQL instances, logins
// and databases (standIn/sql.js); Cloud Storage buckets, objects, bucket policies and HMAC keys (standIn/storage.js);
// service accounts, the project and its policy, Secret Manager, Certificate Manager, Artifact Registry, Cloud Build and
// Service Networking (standIn/platform.js); and the Cloud Billing Catalog's SKUs (standIn/catalog.js, example prices,
// not Google's). Nothing here reaches a network.
//
// It answers each API at https://<api>.googleapis.com/ (the direct pathway) and at `<gateway>/<api>/` (the same calls
// through a gateway). A request without the stand-in's token answers 401 UNAUTHENTICATED; `issueToken()` replaces the
// token, as a refresh would. Errors take each API's own shape: `{ error: { code, message, status } }` for the newer
// APIs, `{ error: { code, message, errors: [{ domain, reason, message }] } }` for Compute Engine, Cloud SQL and Cloud
// Storage.
//
// It checks what Google would refuse or fail on: a reference to a part that isn't there, a part deleted while another
// uses it, a name taken; and, as a revision or a machine starts, the image built into the registry and the service's
// account allowed to pull it and read each secret it names. Everything moves on only when `advance()` runs (tests call
// it; `autoAdvance` runs it before every request): builds run, revisions and machines start, databases boot,
// operations end. Faults, each a switch on `faults`:
//   down               every request fails with no answer, as fetch fails
//   buildFails         a build ends FAILURE
//   revisionFails      a Cloud Run revision never gets ready
//   machinesUnhealthy  a group's machines start but never pass their health check
//   stockout           a group's machines can't be made: no capacity in the zone
//
// Every request is kept in order (`requests()`: its API, method, path, query, JSON body or upload's SHA-256, and the
// status and error code it got).
// STAND-IN ONLY: operations end at the next advance, never part way; IAM checks only the roles the adapter grants;
// there is no traffic, so a firewall rule is read back (`reaches`) rather than tried; prices are examples.

const FAULTS = Object.freeze(["down", "buildFails", "revisionFails", "machinesUnhealthy", "stockout"]);
const NEWER_APIS = new Set(["run", "artifactregistry", "certificatemanager", "servicenetworking", "cloudbuild"]);

/**
 * @param {{ project?: string, projectNumber?: string, region?: string, gateway?: string, autoAdvance?: boolean, now?: () => Date }} [options]
 */
function createGoogleStandIn({
  project = "shop-standin", projectNumber = "123456789012", region = "us-central1", gateway = "https://gateway.standin/google", autoAdvance = false,
  now = () => new Date()
} = {}) {
  const gatewayUrl = new URL(gateway);
  let counter = 0;
  let token = `ya29.standin-${randomBytes(6).toString("hex")}`;
  const log = [];
  /** @type {Map<string, any>} the newer APIs' long-running operations, by name */
  const operations = new Map();
  /** @type {Map<string, { etag: string, bindings: Array<{ role: string, members: string[] }> }>} IAM policies by resource */
  const policies = new Map();

  const answer = (status, body) => ({ status, body });
  const world = {
    project,
    projectNumber,
    region,
    now,
    at: () => now().toISOString(),
    nextId: (prefix = "") => `${prefix}${String(++counter).padStart(6, "0")}`,
    faults: Object.fromEntries(FAULTS.map((name) => [name, false])),
    answer,
    /** A newer API's error. */
    error: (code, status, message, details) => answer(code, { error: { code, message, status, ...(details ? { details } : {}) } }),
    /** Compute Engine's, Cloud SQL's and Cloud Storage's error. */
    legacy: (code, reason, message) => answer(code, { error: { code, message, errors: [{ message, domain: "global", reason }] } }),
    /** Whether a project path names this project, by id or number. @param {string} value */
    isProject: (value) => value === project || value === projectNumber,
    /**
     * A newer API's long-running operation, ended (with `finish()`'s response, or its error) at the next advance.
     * @param {string} name @param {() => any} [finish] answers the response, or `{ error }`
     */
    operation: (name, finish = () => ({})) => {
      const operation = { name, done: false, finish };
      operations.set(name, operation);
      return { name, done: false, metadata: { createTime: world.at() } };
    },
    /** An IAM policy, made empty when new. @param {string} resource */
    policy: (resource) => {
      if (!policies.has(resource)) policies.set(resource, { etag: "BwYAAAAAAAA=", bindings: [] });
      return policies.get(resource);
    },
    /** A policy written over the one read, refused when it changed since (its etag). */
    setPolicy: (resource, policy) => {
      const current = world.policy(resource);
      if (policy?.etag && policy.etag !== current.etag) return null;
      const written = {
        etag: Buffer.from(`policy-${world.nextId()}`).toString("base64"),
        bindings: (policy?.bindings ?? []).map((binding) => ({ ...binding, members: [...(binding.members ?? [])] }))
      };
      policies.set(resource, written);
      return written;
    },
    /** Whether a policy gives a member a role. */
    allows: (resource, member, role) => world.policy(resource).bindings.some((binding) => binding.role === role && binding.members.includes(member)),
    /** A member deleted: every policy names it `deleted:` as Google does, so an account made again under its name is another. */
    forget: (member) => {
      for (const policy of policies.values()) {
        for (const binding of policy.bindings) binding.members = binding.members.map((one) => (one === member ? `deleted:${member}?uid=${world.nextId()}` : one));
      }
    }
  };

  const platform = createStandInPlatform(world);
  world.platform = platform;
  const storage = createStandInStorage(world);
  world.storage = storage;
  const compute = createStandInCompute(world);
  world.compute = compute;
  const run = createStandInRun(world);
  const sql = createStandInSql(world);
  const catalog = createStandInCatalog(world);

  /** Moves everything one step on. */
  function advance() {
    for (const operation of operations.values()) {
      if (operation.done) continue;
      const result = operation.finish();
      operation.done = true;
      operation.result = result;
    }
    platform.advance();
    compute.advance();
    run.advance();
    sql.advance();
  }

  /** A newer API's operation, as GET answers it. @param {string} name */
  function operationOf(name) {
    const operation = operations.get(name);
    if (!operation) return world.error(404, "NOT_FOUND", `Operation ${name} not found.`);
    if (!operation.done) return answer(200, { name, done: false });
    return answer(200, operation.result?.error ? { name, done: true, error: operation.result.error } : { name, done: true, response: operation.result ?? {} });
  }

  /** The API and path a URL names, or null: direct (https://<api>.googleapis.com/…) or through the gateway. @param {URL} url */
  function routeOf(url) {
    const direct = /^([a-z0-9]+)\.googleapis\.com$/u.exec(url.hostname);
    if (direct && url.protocol === "https:") return { api: direct[1], path: url.pathname.slice(1) };
    const base = gatewayUrl.pathname.replace(/\/+$/u, "");
    if (url.origin !== gatewayUrl.origin || !url.pathname.startsWith(`${base}/`)) return null;
    const [, api, path] = /^([a-z0-9]+)\/(.*)$/u.exec(url.pathname.slice(base.length + 1)) ?? [];
    return api ? { api, path } : null;
  }

  /** One request, answered `{ status, body }` or `{ status, bytes }`. */
  function answerOf(request) {
    if (request.authorization !== `Bearer ${token}`) {
      return world.error(401, "UNAUTHENTICATED", "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.");
    }
    if (autoAdvance) advance();
    const { api, method, path } = request;
    if (NEWER_APIS.has(api) && method === "GET" && /^v\d+\/(.*\/)?operations\/[^/]+$/u.test(path)) return operationOf(path.replace(/^v\d+\//u, ""));
    const module = { compute, run, sqladmin: sql, storage, cloudbilling: catalog }[api] ?? platform;
    return module.request(request) ?? world.error(404, "NOT_FOUND", `The stand-in has no ${method} ${api}/${path}.`);
  }

  /**
   * Google answering a request, as `fetch` does.
   * @param {string | URL} input @param {RequestInit} [init]
   */
  async function standInFetch(input, init = {}) {
    if (world.faults.down) throw new TypeError("fetch failed (the stand-in is down)");
    const url = new URL(String(input));
    const route = routeOf(url);
    if (!route) throw new TypeError(`fetch failed (the stand-in answers *.googleapis.com and ${gateway} only)`);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const contentType = headers.get("content-type");
    // Cloud Storage's media uploads (upload/storage/v1/…) carry the object's bytes, whatever their type.
    const upload = route.path.startsWith("upload/") && init.body !== undefined && init.body !== null;
    let body;
    let parseFailed = false;
    if (init.body !== undefined && init.body !== null && !upload) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        parseFailed = true;
      }
    }
    const bytes = upload ? Buffer.from(init.body) : null;
    const request = { ...route, method, query: url.searchParams, body, bytes, contentType, authorization: headers.get("authorization") };
    const answered = parseFailed ? world.error(400, "INVALID_ARGUMENT", "Invalid JSON payload received.") : answerOf(request);
    const error = answered.body?.error;
    log.push({
      api: route.api,
      method,
      path: route.path,
      query: Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => [name, url.searchParams.getAll(name)])),
      body: upload ? { upload: createHash("sha256").update(bytes).digest("hex") } : structuredClone(body ?? null),
      status: answered.status,
      errorCode: error ? String(error.errors?.[0]?.reason ?? error.status ?? error.code) : null
    });
    if (answered.bytes) return new Response(answered.bytes, { status: answered.status, headers: { "content-type": "application/octet-stream" } });
    return new Response(answered.status === 204 ? null : JSON.stringify(answered.body ?? {}), { status: answered.status, headers: { "content-type": "application/json" } });
  }

  return Object.freeze({
    project,
    projectNumber,
    region,
    gateway,
    fetch: standInFetch,
    /** The access token the stand-in takes now. */
    token: () => token,
    /** A new token in place of the last, as Google's token endpoint would give: the old one is refused from now. */
    issueToken: () => {
      token = `ya29.standin-${randomBytes(6).toString("hex")}`;
      return token;
    },
    advance,
    faults: world.faults,
    /** An IAM policy's bindings, by resource: `projects/<id>`, `secrets/<id>`, `repositories/<id>`, `buckets/<name>`. */
    policy: (resource) => structuredClone(world.policy(resource)),
    compute: compute.controls,
    run: run.controls,
    sql: sql.controls,
    storage: storage.controls,
    platform: platform.controls,
    catalog: catalog.controls,
    /**
     * Whether a firewall rule lets service `from` reach service `to` on a TCP port, both by name: the source a Cloud Run
     * service's egress subnet's range, a group's machines' tags; the target a group's machines' tags.
     */
    reaches: (from, to, port) => {
      const subnet = run.controls.egressSubnetOf(from);
      const range = subnet ? compute.get(subnet)?.ipCidrRange : null;
      return compute.controls.firewallAllows({ ranges: range ? [range] : [], tags: compute.controls.tagsOf(from) ?? [] }, compute.controls.tagsOf(to) ?? [], port);
    },
    /** What a service runs with, by name, whichever runs it: each setting's value, a secret one read from Secret Manager. */
    environmentOf: (name) => run.controls.environmentOf(name) ?? compute.controls.environmentOf(name),
    /** Every request asked, in order. */
    requests: () => structuredClone(log)
  });
}

export { createGoogleStandIn };
