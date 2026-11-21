import { HOST_REGIONS, SERVICE_SETTINGS, previousTagNames } from "./standIn/catalogue.js";
import { createStandInHosted } from "./standIn/hosted.js";
import { createStandInNetwork } from "./standIn/network.js";
import { prices } from "./standIn/prices.js";
import { createStandInReleases } from "./standIn/releases.js";
import { createStandInServices } from "./standIn/services.js";

// mobilynet's stand-in for the deploy engine: a `fetch` that answers the requests the engine's client makes
// (client.js), in memory, with the shapes, states, errors and idempotency of mobilynet's API (its OpenAPI document at
// mobilynet main c6af5ca3), for a mobilynet organisation's projects: App Services made from a project's releases of an
// app, public or internal, with their connections, refreshes and instances, each instance with its `_mobilynet`
// (standIn/services.js, serviceEngine.js, releases.js); hosted services of the catalogue's four apps with several links
// each (standIn/hosted.js); regions, domains and routes (standIn/network.js); prices
// (standIn/prices.js); and the parts mobilynet is building for the engine (its docs/stages/engine-support.md at
// 7d775240): App Service instances in the project's vCPU and memory quotas beside its hosted services' machines (M12),
// read with their use as mobilynet's readQuotas answers them, and a monthly spending cap that refuses new creates and
// scale-ups (M13); and tags on App Services and hosted services, as mobilynet has them since its tags change (its
// docs/stages/tags.md): `tags` in a create's or a change's body and in every answer, a list filtered by `tag=name:value`,
// and tags' previous name, `labels` in a body or `label=` in a query, refused `422` under that name. Nothing here
// reaches a network.
//
// Keys: the stand-in starts with one mobilynet project (`projectId`) and one key of it (`key`) holding the scopes the
// engine's key holds (ENGINE_SCOPES) unless made with `scopes`; `addKey` makes others, of a project or of the
// organisation (`projectId: null`, which reaches every project). A request without a known key answers `401
// unauthenticated` (but `GET /v1/prices`, which needs none), a revoked one `401 key_revoked`, an expired one `401
// key_expired`; a route needing a scope the key lacks `403 scope_missing`; another project's things `404`, as if
// there were none.
//
// Everything moves on only when `advance()` runs (tests call it; `autoAdvance` runs it before every request): releases
// build, refreshes take a step, hosted services boot, links turn active. Faults, each a switch on `faults`:
//   down               every request fails with no answer, as fetch fails
//   noCapacity         a hosted service's create and a service's count raise answer no_capacity
//   instancesUnhealthy an App Service's new instances never get healthy: its refresh fails instance_never_healthy;
//                      `true`, every one; a function of the instance (its version, settings and secrets), those it
//                      answers true for, as an app that refuses a setting's value as it boots
//   neverBoots         new hosted services stay `creating`
//   releaseBuildFails  a release's build fails, and a refresh onto it fails app_build_failed: `true`, its build
//                      command exited; `{ code, message }`, that failure, the refresh naming its message too
//   instantBuilds      a refresh whose release is built already passes its build and starts its first instances in
//                      the step it starts, as mobilynet's reconcile does with a reused build (one transaction:
//                      currentRefresh, advanceBuild, roll), so it is never seen building: a production Deploy handed
//                      a service a release at 23:42:09 and its refresh's build_started, build_passed and first
//                      instance_started were all at 23:42:10 (18 Nov)
//   releaseTaskFails   a release's task a refresh runs (STAND-IN ONLY, the engine's ask M-C) fails, and so does the
//                      refresh, release_task_failed, before any instance starts: `true`, exit 1; `{ exitCode, output }`
//   olderHost          a host of each region with hosts runs an agent before 2.9.0, which takes 50 entries for an
//                      app: an App Service there holds 49 settings and secrets in all, as its region says, not 199
//
// Every request is kept in order (`requests()`: its method, path, query, Idempotency-Key, JSON body or upload's
// SHA-256, and the status and error code it got), so a test can see what was asked and of what.
// STAND-IN ONLY: leases (`/v1/leases`) and a release's tasks (a declaration's `tasks`, run once by a refresh a create
// or a release asks to: `task` in a create's body, `?task=` on a release's upload; the refresh's `task` says how it
// went) answer in the shape the engine asks mobilynet for (client.js), which mobilynet has not built yet; idempotency keys are kept across the organisation, not per key; at a create or
// scale-up the spending cap is asked before the quotas; there are no mobilynet machines, allow rules, webhooks or usage.

/**
 * The scopes the engine's key holds: App Services, hosted services, the network, events and usage; never a machine, project,
 * key, DNS, webhook or audit scope.
 */
const ENGINE_SCOPES = Object.freeze([
  "services:read", "services:deploy", "services:manage", "hosted:read", "hosted:manage", "network:read", "network:manage",
  "events:read", "usage:read"
]);
/** A project's quotas, as mobilynet's quotas.js gives an ordinary project. */
const DEFAULT_LIMITS = Object.freeze({ machines: 10, vcpus: 20, memoryGib: 40, diskGib: 1000 });
const QUOTAS = Object.freeze(Object.keys(DEFAULT_LIMITS));
// Each quota's unit, as mobilynet's machines.js QUOTAS name them.
const QUOTA_UNITS = Object.freeze({ machines: "machines", vcpus: "vCPU", memoryGib: "GiB of RAM", diskGib: "GiB of data disk" });
const FAULTS = Object.freeze([
  "down", "noCapacity", "instancesUnhealthy", "neverBoots", "releaseBuildFails", "instantBuilds", "releaseTaskFails", "olderHost"
]);
const LEASE_MAX_SECONDS = 3600;
const LEASE_TEXT = 200;
// mobilynet's Idempotency-Key: 1 to 128 printable characters (its idempotency.js).
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/u;

const ID = "[^/]+";
/** Each route's scope by method, as the OpenAPI document's `x-scopes` give them; the first pattern that matches decides. */
const ROUTES = Object.freeze([
  ["^/v1/(regions|hosted-services/catalogue)$", {}],
  [`^/v1/projects/${ID}/events$`, { GET: "events:read" }],
  [`^/v1/projects/${ID}/(domains|routes)(/${ID})?(/actions/check)?$`, { GET: "network:read", POST: "network:manage", PATCH: "network:manage", DELETE: "network:manage" }],
  [`^/v1/projects/${ID}/apps/${ID}/releases$`, { POST: "services:deploy" }],
  [`^/v1/projects/${ID}/services$`, { GET: "services:read", POST: "services:manage" }],
  [`^/v1/projects/${ID}/hosted-services$`, { GET: "hosted:read", POST: "hosted:manage" }],
  [`^/v1/projects/${ID}/spending-cap$`, { GET: "usage:read" }],
  [`^/v1/services/${ID}$`, { GET: "services:read", DELETE: "services:manage" }],
  [`^/v1/services/${ID}/settings$`, { PUT: "services:manage" }],
  [`^/v1/services/${ID}/(releases|actions/rollback)$`, { POST: "services:deploy" }],
  [`^/v1/services/${ID}/(instances|refreshes)(/${ID})?$`, { GET: "services:read" }],
  [`^/v1/services/${ID}/logs$`, { GET: "services:read" }],
  [`^/v1/builds/${ID}/log$`, { GET: "vps:read" }],
  [`^/v1/hosted-services/${ID}$`, { GET: "hosted:read", PATCH: "hosted:manage", DELETE: "hosted:manage" }],
  [`^/v1/hosted-services/${ID}/links(/${ID})?$`, { GET: "hosted:read", POST: "hosted:manage", DELETE: "hosted:manage" }],
  [`^/v1/hosted-services/${ID}/backups$`, { GET: "hosted:read" }],
  [`^/v1/leases(/${ID})?$`, { POST: "services:deploy", PATCH: "services:deploy", DELETE: "services:deploy" }]
].map(([pattern, methods]) => Object.freeze([new RegExp(pattern, "u"), Object.freeze(methods)])));
const SERVICE_PATH = new RegExp(`^/v1/services/${ID}$`, "u");
const BUILD_LOG_PATH = new RegExp(`^/v1/builds/(${ID})/log$`, "u");

/**
 * The scope a request needs, or null: a service's PATCH `services:manage` for any field but `instances`, which needs
 * `services:deploy` (mobilynet's services.js DEPLOY_FIELDS); the first missing one is named.
 * @param {string} method @param {string} path @param {any} body @param {Set<string>} held
 */
function missingScope(method, path, body, held) {
  if (method === "PATCH" && SERVICE_PATH.test(path)) {
    const fields = Object.keys(body && typeof body === "object" ? body : {}).filter((field) => body[field] !== undefined);
    const needed = [...(fields.some((field) => field !== "instances") ? ["services:manage"] : []), ...(fields.includes("instances") || fields.length === 0 ? ["services:deploy"] : [])];
    return needed.find((scope) => !held.has(scope)) ?? null;
  }
  // A build's log takes `packages:publish` in place of `vps:read` (mobilynet's buildModel.js buildReader).
  if (method === "GET" && BUILD_LOG_PATH.test(path) && held.has("packages:publish")) return null;
  const scope = ROUTES.find(([pattern]) => pattern.test(path))?.[1][method];
  return scope && !held.has(scope) ? scope : null;
}

/**
 * @param {{ now?: () => Date, autoAdvance?: boolean, scopes?: ReadonlyArray<string>, baseUrl?: string }} [options]
 */
function createMobilynetStandIn({ now = () => new Date(), autoAdvance = false, scopes = ENGINE_SCOPES, baseUrl = "https://api.mobilynet.standin" } = {}) {
  const origin = new URL(baseUrl).origin;
  let counter = 0;
  const nextId = (prefix) => `${prefix}_s${String(++counter).padStart(6, "0")}`;
  const at = () => now().toISOString();
  /** @type {Map<string, any>} each mobilynet project of the organisation */
  const projects = new Map();
  /** @type {Map<string, { token: string, projectId: string | null, scopes: Set<string>, state: string }>} each key, by its token */
  const keys = new Map();
  /** @type {Map<string, any>} each lease, by id */
  const leases = new Map();
  /** @type {Map<string, { fingerprint: string, answer: any }>} */
  const idempotency = new Map();
  const events = [];
  const log = [];

  const failure = (status, code, message, details = null) => ({ status, body: { error: { code, message, details, requestId: nextId("req") } } });
  /** mobilynet's `422 validation_failed`, `Check <fields>.` with the field errors. @param {Record<string, string>} fieldErrors */
  const invalid = (fieldErrors) => failure(422, "validation_failed", `Check ${Object.keys(fieldErrors).join(", ")}.`, { fieldErrors });
  const answer = (status, body) => ({ status, body });
  const month = () => at().slice(0, 7);

  const world = {
    now,
    at,
    nextId,
    failure,
    answer,
    faults: Object.fromEntries(FAULTS.map((name) => [name, false])),
    /** Every route (network.js makes, keeps and answers them; services.js asks names of them). */
    routes: [],
    /** How many settings and secrets an App Service of a region holds now, its links' among them. @param {string} region */
    settingsMax: (region) => (world.faults.olderHost && HOST_REGIONS.includes(region) ? SERVICE_SETTINGS.earlier : SERVICE_SETTINGS.current),
    /** mobilynet's `404 not_found`, `No such <resource>.` @param {string} resource */
    notFound: (resource) => failure(404, "not_found", `No such ${resource}.`),
    /** Whether a caller's key reaches a mobilynet project: its own, or any with an organisation key. */
    reaches: (caller, projectId) => projects.has(projectId) && (caller.projectId === null || caller.projectId === projectId),
    /** mobilynet's refusal of a key without a scope, or null when it holds it. */
    scopeRefusal: (caller, scope) => (caller.scopes.has(scope) ? null : failure(403, "scope_missing", `This needs the ${scope} scope.`, { scope })),
    /** An event of a mobilynet project. */
    emitIn: (projectId, type, resource, details) => {
      events.push({ id: String(events.length + 1), type, at: at(), projectId, resource, details });
    },
    /**
     * A request's Idempotency-Key: the answer it got again for the same request, `409 idempotency_key_reused` for
     * another, `400 invalid_request` without one; mobilynet keeps an answer only when the request did something.
     * @param {string | undefined} key @param {string} fingerprint @param {() => any} make
     */
    once: (key, fingerprint, make) => {
      if (!key || !IDEMPOTENCY_KEY.test(key)) return failure(400, "invalid_request", "Send an Idempotency-Key header (up to 128 characters) with every create.", { header: "Idempotency-Key" });
      const known = idempotency.get(key);
      if (known) return known.fingerprint === fingerprint ? known.answer : failure(409, "idempotency_key_reused", "This Idempotency-Key was used with another request.");
      const made = make();
      if (made.status < 400) idempotency.set(key, { fingerprint, answer: made });
      return made;
    },
    /**
     * Whether a mobilynet project may add what a create or scale-up adds (engine-support M12, M13): refused `409
     * spending_cap_reached` once its spend this month reached its cap, then `429 quota_exceeded` naming the first quota
     * it would pass. Null when it may.
     * @param {string} projectId @param {{ machines?: number, vcpus?: number, memoryGib?: number, diskGib?: number }} adding
     */
    admit: (projectId, adding) => {
      const project = projects.get(projectId);
      if (project.capNano !== null && project.spentNano >= project.capNano) {
        return failure(409, "spending_cap_reached", `The project has reached its spending cap for ${month()}: raise the cap, or remove something.`, {
          projectId, capNano: project.capNano.toString(), spentNano: project.spentNano.toString(), month: month(), currency: prices.currency
        });
      }
      const used = usedBy(projectId);
      for (const quota of QUOTAS) {
        const limit = project.limits[quota];
        if ((adding[quota] ?? 0) > 0 && used[quota] + adding[quota] > limit) {
          return failure(429, "quota_exceeded", `The project has used its quota of ${quota} (${limit}).`, { quota, limit });
        }
      }
      return null;
    }
  };

  /** What a mobilynet project's App Services and hosted services take of its quotas now. @param {string} projectId */
  function usedBy(projectId) {
    const used = { ...services.usage(projectId), machines: 0, diskGib: 0 };
    for (const [quota, amount] of Object.entries(hosted.usage(projectId))) used[quota] += amount;
    return used;
  }

  const releases = createStandInReleases(world);
  const network = createStandInNetwork(world, {
    members: (serviceId) => services.serving(serviceId),
    routable: (projectId, serviceId) => services.routable(projectId, serviceId)
  });
  const services = createStandInServices(world, { releases, network });
  const hosted = createStandInHosted(world, { services, prices });
  services.useHooks({ nameTaken: hosted.nameTaken, consumerGone: hosted.consumerGone, refreshFailed: hosted.refreshFailed });

  /** Moves everything one step on: releases build, services refresh, hosted services boot, links turn active. */
  function advance() {
    services.advance();
    hosted.advance();
  }

  /** A mobilynet project of the organisation, with mobilynet's default quotas, no spending cap and nothing spent. @param {string} name */
  function addProject(name) {
    const id = nextId("prj");
    projects.set(id, { id, name, limits: { ...DEFAULT_LIMITS }, capNano: null, spentNano: 0n, changedAt: null });
    return id;
  }

  /**
   * A key: of a mobilynet project, or of the organisation (`projectId: null`). Answers its token.
   * @param {{ projectId?: string | null, scopes?: ReadonlyArray<string> }} [key]
   */
  function addKey({ projectId = null, scopes: held = ENGINE_SCOPES } = {}) {
    const token = `mnk_standin_${nextId("key").slice(4)}`;
    keys.set(token, { token, projectId, scopes: new Set(held), state: "active" });
    return token;
  }

  const projectId = addProject("Production");
  const key = addKey({ projectId, scopes });

  /** The spending cap's view (engine-support M13). @param {any} project */
  function capView(project) {
    const { capNano, spentNano } = project;
    let state = "none";
    if (capNano !== null) state = spentNano >= capNano ? "reached" : spentNano * 10n >= capNano * 8n ? "warning" : "under";
    return {
      projectId: project.id,
      capNano: capNano === null ? null : capNano.toString(),
      month: month(),
      spentNano: spentNano.toString(),
      state,
      currency: prices.currency,
      meteredUntil: at(),
      changedAt: project.changedAt
    };
  }

  /** `POST /v1/leases`, `PATCH /v1/leases/{id}` and `DELETE /v1/leases/{id}`, in the caller's project. */
  function leaseRequest(method, path, body, caller) {
    const live = (lease) => Date.parse(lease.expiresAt) > now().getTime();
    const view = ({ id, name, holder, since, expiresAt }) => ({ id, name, holder, since, expiresAt });
    const until = (seconds) => new Date(now().getTime() + seconds * 1000).toISOString();
    const secondsWrong = (seconds) => !Number.isInteger(seconds) || seconds < 1 || seconds > LEASE_MAX_SECONDS;
    if (caller.projectId === null) return invalid({ key: "A lease is taken with a project's key." });
    if (path === "/v1/leases" && method === "POST") {
      const errors = {};
      for (const field of ["name", "holder"]) {
        if (typeof body?.[field] !== "string" || body[field].length === 0 || body[field].length > LEASE_TEXT) errors[field] = `Text of 1 to ${LEASE_TEXT} characters.`;
      }
      if (secondsWrong(body?.seconds)) errors.seconds = `A whole number of seconds from 1 to ${LEASE_MAX_SECONDS}.`;
      if (Object.keys(errors).length > 0) return invalid(errors);
      const held = [...leases.values()].find((lease) => lease.projectId === caller.projectId && lease.name === body.name && live(lease));
      if (held) {
        return failure(409, "lease_held", `${held.holder} holds ${held.name} since ${held.since}, until ${held.expiresAt}.`, {
          name: held.name, holder: held.holder, since: held.since, expiresAt: held.expiresAt
        });
      }
      for (const [id, lease] of leases) if (lease.projectId === caller.projectId && lease.name === body.name) leases.delete(id);
      const lease = { id: nextId("lse"), projectId: caller.projectId, name: body.name, holder: body.holder, since: at(), expiresAt: until(body.seconds) };
      leases.set(lease.id, lease);
      return answer(201, { lease: view(lease) });
    }
    const found = leases.get(decodeURIComponent(path.slice("/v1/leases/".length)));
    if (!found || found.projectId !== caller.projectId || !live(found)) return world.notFound("lease");
    if (method === "PATCH") {
      if (secondsWrong(body?.seconds)) return invalid({ seconds: `A whole number of seconds from 1 to ${LEASE_MAX_SECONDS}.` });
      found.expiresAt = until(body.seconds);
      return answer(200, { lease: view(found) });
    }
    if (method === "DELETE") {
      leases.delete(found.id);
      return answer(200, { removed: true });
    }
    return null;
  }

  /** The caller of a request by its bearer key, or its refusal. @param {string | null} authorization */
  function callerOf(authorization) {
    const token = /^Bearer (\S+)$/u.exec(authorization ?? "")?.[1];
    const found = token ? keys.get(token) : null;
    if (!found) return { refusal: failure(401, "unauthenticated", "Send an API key as Authorization: Bearer mnk_….") };
    if (found.state === "revoked") return { refusal: failure(401, "key_revoked", "This API key was revoked.") };
    if (found.state === "expired") return { refusal: failure(401, "key_expired", "This API key has expired.") };
    return { caller: found };
  }

  /** One request, answered `{ status, body }`. */
  function answerOf({ method, path, params, body, idempotencyKey, contentSha256, authorization }) {
    if (method === "GET" && path === "/v1/prices") return answer(200, prices.answer());
    const { caller, refusal } = callerOf(authorization);
    if (refusal) return refusal;
    const lacking = missingScope(method, path, body, caller.scopes);
    if (lacking) return world.scopeRefusal(caller, lacking);
    const previous = previousTagNames(body, params);
    if (previous) return invalid(previous);
    if (autoAdvance) advance();
    const request = { method, path, params, body, idempotencyKey, contentSha256, caller };
    const answered = network.request(request) ?? services.request(request) ?? hosted.request(request);
    if (answered) return answered;
    if (/^\/v1\/leases(\/[^/]+)?$/u.test(path)) return leaseRequest(method, path, body, caller) ?? world.notFound("route");
    const buildLog = method === "GET" ? BUILD_LOG_PATH.exec(path) : null;
    if (buildLog) {
      const part = releases.buildLog((id) => world.reaches(caller, id), decodeURIComponent(buildLog[1]), Number(params.get("after") || 0));
      return part ? answer(200, part) : world.notFound("build");
    }
    const projectPath = /^\/v1\/projects\/([^/]+)\/(events|spending-cap|quotas)$/u.exec(path);
    if (projectPath && method === "GET") {
      const id = decodeURIComponent(projectPath[1]);
      if (!world.reaches(caller, id)) return world.notFound("project");
      if (projectPath[2] === "spending-cap") return answer(200, { spendingCap: capView(projects.get(id)) });
      if (projectPath[2] === "quotas") {
        const used = usedBy(id);
        const quotas = QUOTAS.map((quota) => ({ quota, unit: QUOTA_UNITS[quota], limit: projects.get(id).limits[quota], used: used[quota] }));
        return answer(200, { quotas, rateLimits: { perSecond: 20, perMinute: 600 }, openRequests: [] });
      }
      const after = Number(params.get("after") || 0);
      const limit = Math.min(Number(params.get("limit") || 100), 100);
      const own = events.filter((event) => event.projectId === id && Number(event.id) > after);
      const page = own.slice(0, limit).map((event) => structuredClone(event));
      return answer(200, { items: page, next: own.length > limit ? page.at(-1).id : null });
    }
    return world.notFound("route");
  }

  /**
   * mobilynet answering a request, as `fetch` does: a Response with JSON and its `Request-Id`.
   * @param {string | URL} input @param {RequestInit} [init]
   */
  async function standInFetch(input, init = {}) {
    if (world.faults.down) throw new TypeError("fetch failed (the stand-in is down)");
    const url = new URL(String(input));
    if (url.origin !== origin) throw new TypeError(`fetch failed (the stand-in answers ${origin} only)`);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    const upload = headers.get("content-type") === "application/gzip";
    let body;
    let parseFailed = false;
    if (init.body !== undefined && init.body !== null) {
      if (upload) body = Buffer.from(init.body);
      else {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          parseFailed = true;
        }
      }
    }
    const request = {
      method,
      path: url.pathname,
      params: url.searchParams,
      body,
      idempotencyKey: headers.get("idempotency-key") ?? undefined,
      contentSha256: headers.get("mobilynet-content-sha256") ?? undefined,
      authorization: headers.get("authorization")
    };
    const answered = parseFailed ? failure(400, "invalid_request", "The body isn't JSON.") : answerOf(request);
    const requestId = answered.body?.error?.requestId ?? nextId("req");
    log.push({
      method,
      path: url.pathname,
      query: Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => [name, url.searchParams.getAll(name)])),
      idempotencyKey: request.idempotencyKey ?? null,
      body: upload ? { upload: request.contentSha256 ?? null } : structuredClone(body ?? null),
      status: answered.status,
      errorCode: answered.body?.error?.code ?? null
    });
    return new Response(JSON.stringify(answered.body), { status: answered.status, headers: { "content-type": "application/json", "request-id": requestId } });
  }

  /** @param {string} id */
  const projectNamed = (id) => {
    const found = projects.get(id);
    if (!found) throw new Error(`The stand-in has no mobilynet project ${id}.`);
    return found;
  };
  /** @param {string} token */
  const keyNamed = (token) => {
    const found = keys.get(token);
    if (!found) throw new Error("The stand-in has no such key.");
    return found;
  };

  return Object.freeze({
    baseUrl: origin,
    /** The mobilynet project the stand-in starts with, and its key. */
    projectId,
    key,
    fetch: standInFetch,
    advance,
    faults: world.faults,
    addProject,
    addKey,
    /** @param {string} token */
    revokeKey: (token) => {
      keyNamed(token).state = "revoked";
    },
    /** @param {string} token */
    expireKey: (token) => {
      keyNamed(token).state = "expired";
    },
    /** Sets some of a mobilynet project's quotas. @param {string} id @param {Partial<typeof DEFAULT_LIMITS>} limits */
    setQuota: (id, limits) => Object.assign(projectNamed(id).limits, limits),
    /** Sets a mobilynet project's monthly spending cap in nano-units, or removes it (null). @param {string} id @param {bigint | number | string | null} capNano */
    setSpendingCap: (id, capNano) => Object.assign(projectNamed(id), { capNano: capNano === null ? null : BigInt(capNano), changedAt: at() }),
    /** Adds to a mobilynet project's spend this month, as metering would. @param {string} id @param {bigint | number | string} nano */
    spend: (id, nano) => {
      projectNamed(id).spentNano += BigInt(nano);
    },
    useDns: network.useDns,
    verifyDomain: network.verifyDomain,
    domains: network.domains,
    routes: network.routes,
    /** A mobilynet project's releases of an app, with their builds and declarations. */
    releases: releases.list,
    /**
     * App Services: `all()`, `service(id)` with their values, `instances(id)` with `_mobilynet`, `refreshes(id)` (a task
     * a refresh ran with the names of the settings it ran with),
     * `reaches(from, to, port)`, and `setLogs(instanceId, text)`, what an instance's logs say.
     */
    services: services.controls,
    /** Hosted services: `all()`, `service(id)` with their links and secrets, `catalogue()`. */
    hosted: hosted.controls,
    /** The leases held now. */
    leases: () => [...leases.values()].filter((lease) => Date.parse(lease.expiresAt) > now().getTime()).map((lease) => ({ ...lease })),
    /** The events made, across the mobilynet projects. */
    events: () => events.map((event) => structuredClone(event)),
    /** Every request asked, in order. */
    requests: () => structuredClone(log)
  });
}

export { ENGINE_SCOPES, createMobilynetStandIn };
