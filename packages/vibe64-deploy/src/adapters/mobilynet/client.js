import { performance } from "node:perf_hooks";

// The deploy engine's client of mobilynet's API (its OpenAPI document at mobilynet main c6af5ca3: openApiServices.js,
// openApiHosted.js, openApiSetups.js, openApiNetwork.js, openApiBilling.js): a mobilynet project's App Services and
// their releases, instances and refreshes, its hosted services and their links, its releases of an app, its domains
// and routes, the prices and the hosted catalogue. It takes `{ baseUrl, credential }`: mobilynet's address and either
// an API key of one mobilynet project (`mnk_…`) or a token source that refreshes a grant's access token. Every request
// is JSON both ways but an upload (a release's tarball, sent as its bytes with its SHA-256), carries the
// `Idempotency-Key` the caller gives, follows no redirect and is tried once: the engine's next step tries again with the
// same key. A refusal is a MobilynetError with mobilynet's `{ code, message, details, requestId }`.
// Three parts follow mobilynet's design for the engine (its docs/stages/engine-support.md at 7d775240, being built):
// labels on App Services and hosted services as mobilynet machines have them (M2: `labels` set at create, replaced whole by a PATCH,
// answered in reads and lists, a list filtered by `label=key:value`, each one matched); an App Service's instances times
// its size counted against the mobilynet project's vCPU and memory quotas (M12: `429 quota_exceeded` with `{ quota,
// limit }` at a create, a count raised or a size made larger, as a hosted service's machine already was); and a monthly
// spending cap (M13: once the month's spend reaches it, every new create and scale-up is `409 spending_cap_reached`
// with `{ projectId, capNano, spentNano, month, currency }`, while what runs keeps running and a release, a rollback, a
// scale-down or a delete still works; `GET …/spending-cap` reads it). The leases (`/v1/leases`: a named lease in the
// key's mobilynet project, its holder's text, at most 60 minutes, renewable, `409 lease_held` naming the holder while
// another holds it) are the shape the engine asks mobilynet for; mobilynet has none yet. Routes are as mobilynet's
// stable domain target change (being built, 20 Nov) makes them: a route is its name's, its `target` its own region-free
// name whatever it sends to, kept sending to nothing when its App Service goes or no longer asks for it, and taken by
// the next service asking for the name, or moved with `take`; until mobilynet runs it, a service's route answers the
// service's own name and goes with it.

// mobilynet's refusals that a retry of the same request would only repeat: the step waits for a person (a new key, a
// raised quota, more capacity, a choice) rather than for time.
const REFUSALS = new Set([
  "unauthenticated", "key_expired", "key_revoked", "address_not_allowed", "payment_required", "organisation_suspended",
  "scope_missing", "no_capacity", "quota_exceeded", "name_taken", "size_unknown", "size_not_offered", "validation_failed",
  "invalid_request", "idempotency_key_reused", "settings_missing", "invalid_state", "need_linked", "hosted_service_linked",
  "no_previous_version", "domain_in_use", "no_backup_store", "lease_held", "spending_cap_reached"
]);
// The refusals a token source may answer by refreshing its access token, once.
const TOKEN_REFUSALS = new Set(["unauthenticated", "key_expired"]);
// A page of mobilynet's listings, its largest.
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 20_000;
// An upload (a release's tarball: at most 1 GiB) has longer.
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** mobilynet's answer when it was not a success, or no answer at all (`status` null, code `unreachable`). */
class MobilynetError extends Error {
  /**
   * @param {{ status: number | null, code: string, message: string, details?: unknown, requestId?: string | null }} answer
   */
  constructor({ status, code, message, details = null, requestId = null }) {
    super(message);
    this.name = "MobilynetError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    // A refusal waits for a person; anything else (no answer, a 5xx, the rate limit) is tried again later, as is a
    // thing busy with another of its jobs (`409 invalid_state` "working") and a link to an App Service whose move
    // mobilynet can't check yet (`422`, `consumer`: its refresh queued or not yet read its release; M14).
    const busy = code === "invalid_state" && /** @type {any} */ (details)?.state === "working";
    const unread = code === "validation_failed" && /isn't read yet/u.test(/** @type {any} */ (details)?.fieldErrors?.consumer ?? "");
    this.retryable = busy || unread || (!REFUSALS.has(code) && status !== 404);
  }
}

/**
 * The `label` query a list is filtered by: `key:value` for each label, every one needed.
 * @param {Record<string, string> | undefined} labels
 */
function labelQuery(labels) {
  return Object.entries(labels ?? {}).map(([key, value]) => `${key}:${value}`);
}

/**
 * mobilynet's address: https, or http on this machine only (a stand-in or a tunnel).
 * @param {string} baseUrl
 */
function apiRoot(baseUrl) {
  const root = new URL(String(baseUrl ?? ""));
  if (root.protocol === "https:" || (root.protocol === "http:" && LOOPBACK.has(root.hostname))) return root;
  throw new TypeError(`mobilynet's address is https://…, or http:// on this machine only; ${root.protocol} was given.`);
}

/**
 * The credential's access token now: an API key as it is, or a token source's current token.
 * @param {string | { token: () => string | Promise<string>, refresh?: () => string | Promise<string> }} credential
 */
async function tokenOf(credential) {
  const token = typeof credential === "string" ? credential : await credential.token();
  if (typeof token !== "string" || token.length === 0) throw new TypeError("The mobilynet credential gave no token.");
  return token;
}

/**
 * The client.
 * @param {object} options
 * @param {string} options.baseUrl mobilynet's API, such as https://api.mobilynet.cloud
 * @param {string | { token: () => string | Promise<string>, refresh?: () => string | Promise<string> }} options.credential
 *   an API key of one mobilynet project, or a token source: `token()` its access token now, `refresh()` a new one after
 *   mobilynet refused the last (`401 unauthenticated` or `key_expired`), tried once a request
 * @param {typeof fetch} [options.fetch] the stand-in's in tests
 * @param {(entry: { method: string, path: string, idempotencyKey: string | null, status: number | null, errorCode: string | null, requestId: string | null, ms: number }) => void} [options.onRequest]
 *   told of each request, never its body: a body can hold secrets
 * @param {number} [options.timeoutMs]
 */
function createMobilynetClient({ baseUrl, credential, fetch: fetchImpl = globalThis.fetch, onRequest = () => {}, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const root = apiRoot(baseUrl);
  if (typeof credential !== "string" && typeof credential?.token !== "function") {
    throw new TypeError("A mobilynet credential is an API key, or a token source with token().");
  }

  /** One exchange with mobilynet: its status, body and request id, or the failure that left no answer. */
  async function exchange(method, path, { body, query, idempotencyKey, contentSha256 }, token) {
    const upload = Buffer.isBuffer(body);
    const url = new URL(path, root);
    for (const [name, value] of Object.entries(query ?? {})) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined && one !== null && one !== "") url.searchParams.append(name, String(one));
      }
    }
    const headers = { accept: "application/json", authorization: `Bearer ${token}`, "user-agent": "vibe64-deploy" };
    if (body !== undefined) headers["content-type"] = upload ? "application/gzip" : "application/json";
    if (upload) headers["mobilynet-content-sha256"] = String(contentSha256 ?? "");
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(upload ? Math.max(timeoutMs, UPLOAD_TIMEOUT_MS) : timeoutMs)
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { error: { code: `http_${response.status}`, message: "mobilynet's answer was not JSON." } };
    }
    return { status: response.status, body: parsed, requestId: response.headers.get("request-id") };
  }

  /**
   * One request: answered with mobilynet's body, or thrown as a MobilynetError. A token source refused its token gets
   * one refresh and the same request again.
   * @param {string} method
   * @param {string} path
   * @param {{ body?: unknown, query?: Record<string, unknown>, idempotencyKey?: string, contentSha256?: string }} [request]
   *   `body` as a Buffer is an upload, sent as it is with its SHA-256 (`contentSha256`)
   */
  async function call(method, path, request = {}) {
    let refreshed = false;
    for (;;) {
      const token = await tokenOf(credential);
      const started = performance.now();
      let answer = null;
      let failure = null;
      try {
        answer = await exchange(method, path, request, token);
      } catch (error) {
        failure = error;
      }
      const status = answer ? answer.status : null;
      const ok = status !== null && status >= 200 && status < 300;
      const errorBody = answer && !ok ? answer.body?.error ?? {} : null;
      const code = failure ? "unreachable" : errorBody ? String(errorBody.code || `http_${status}`) : null;
      onRequest({
        method,
        path,
        idempotencyKey: request.idempotencyKey ?? null,
        status,
        errorCode: code,
        requestId: answer?.requestId ?? errorBody?.requestId ?? null,
        ms: Math.round(performance.now() - started)
      });
      if (failure) throw new MobilynetError({ status: null, code: "unreachable", message: `mobilynet did not answer: ${failure.message}` });
      if (ok) return answer.body;
      if (status === 401 && TOKEN_REFUSALS.has(code) && !refreshed && typeof credential.refresh === "function") {
        refreshed = true;
        await credential.refresh();
        continue;
      }
      throw new MobilynetError({
        status,
        code,
        message: String(errorBody.message || `mobilynet answered ${status}`),
        details: errorBody.details ?? null,
        requestId: answer.requestId ?? errorBody.requestId ?? null
      });
    }
  }

  /** Every item of a paged listing, page after page. @param {string} path @param {Record<string, unknown>} [query] */
  async function listAll(path, query = {}) {
    const items = [];
    let after;
    do {
      const page = await call("GET", path, { query: { ...query, limit: PAGE_SIZE, after } });
      items.push(...page.items);
      after = page.next ?? undefined;
    } while (after);
    return items;
  }

  /** A read answered null when mobilynet has no such thing (404). @param {() => Promise<any>} read */
  async function orNull(read) {
    try {
      return await read();
    } catch (error) {
      if (error instanceof MobilynetError && error.status === 404) return null;
      throw error;
    }
  }

  /** A removal answered `{ removed: true }` when mobilynet no longer has it (404). @param {() => Promise<any>} remove */
  async function removedOn404(remove) {
    try {
      return await remove();
    } catch (error) {
      if (error instanceof MobilynetError && error.status === 404) return { removed: true };
      throw error;
    }
  }

  /** @param {string} serviceId */
  const servicePath = (serviceId) => `/v1/services/${encodeURIComponent(serviceId)}`;
  /** @param {string} hostedServiceId */
  const hostedPath = (hostedServiceId) => `/v1/hosted-services/${encodeURIComponent(hostedServiceId)}`;
  /** @param {string} leaseId */
  const leasePath = (leaseId) => `/v1/leases/${encodeURIComponent(leaseId)}`;

  /**
   * The calls within one mobilynet project.
   * @param {string} projectId
   */
  function project(projectId) {
    if (!projectId) throw new TypeError("A call within a mobilynet project needs the mobilynet project's id.");
    const projectAt = `/v1/projects/${encodeURIComponent(projectId)}`;
    /** @param {string} kind @param {string} id */
    const at = (kind, id) => `${projectAt}/${kind}/${encodeURIComponent(id)}`;
    return Object.freeze({
      projectId,
      /**
       * A domain name for the mobilynet project (`network:manage`), answered with the DNS records that verify it.
       * @param {string} name @param {{ idempotencyKey: string }} context
       */
      createDomain: (name, { idempotencyKey }) => call("POST", `${projectAt}/domains`, { body: { name }, idempotencyKey }),
      /** The mobilynet project's domains, every page. */
      listDomains: () => listAll(`${projectAt}/domains`),
      /** A domain, or null. @param {string} domainId */
      readDomain: (domainId) => orNull(() => call("GET", at("domains", domainId))),
      /** Checks a domain's DNS again now. @param {string} domainId */
      checkDomain: (domainId) => call("POST", `${at("domains", domainId)}/actions/check`, { body: {} }),
      /**
       * Removes a domain no route uses, with its certificate; one mobilynet no longer has is `{ removed: true }`. A
       * domain a route still uses is refused `409 domain_in_use`.
       * @param {string} domainId
       */
      deleteDomain: (domainId) => removedOn404(() => call("DELETE", at("domains", domainId))),
      /**
       * The mobilynet project's routes, every page: each a name's, its `target` its own name (`rte-…`), the CNAME its
       * owner adds once, whatever it sends to (`serviceId`, `vpsId`, `group`, or none while it sends to nothing).
       */
      listRoutes: () => listAll(`${projectAt}/routes`),
      /** A route: its target, whether it is live and what it waits for; null when there is none. @param {string} routeId */
      readRoute: (routeId) => orNull(() => call("GET", at("routes", routeId))),
      /**
       * A release of an app of the mobilynet project, uploaded as its tarball (`services:deploy`): `{ release }`, its
       * build begun on no machine, which an App Service is made from or refreshed onto. The same bytes again answer
       * the release they made; a declaration mobilynet refuses is `422 validation_failed` with its field errors.
       * @param {string} app @param {{ archive: Buffer, sha256: string }} upload
       */
      createRelease: (app, { archive, sha256 }) => call("POST", `${projectAt}/apps/${encodeURIComponent(app)}/releases`, { body: archive, contentSha256: sha256 }),
      /**
       * An App Service (`services:manage`): `{ service, refresh }`, `creating`, its first refresh (kind `create`) onto
       * the release `app` names (`{ name, version }`). Its name is its own among the project's services and hosted
       * services (`409 name_taken`); a route's name needs a domain of the project covering it, and its route, where it
       * has one, sends to it: made, taken (one kept sending to nothing), or with `take` moved from what it sends to,
       * which mobilynet otherwise refuses `409 name_taken` with `{ host, routeId }`; an internal one has no
       * routes and is reached as `<name>.<project label>.internal`; `connections` open a port of another service of
       * the project to its instances. Its instances times its size count against the project's vCPU and memory quotas
       * (`429 quota_exceeded`), and a project at its spending cap makes none (`409 spending_cap_reached`). `task` names a
       * task of the release's declaration its first refresh runs once before any instance starts (M-C, as a release's).
       * @param {{ name: string, region: string, exposure?: "public" | "internal", size: string, instances: number, app: { name?: string, version: string }, settings?: Record<string, unknown>, secrets?: Record<string, string>, routes?: Array<{ host: string, tls?: "edge", take?: boolean }>, connections?: Array<{ to: string, port: number }>, healthCheck?: object, drainSeconds?: number, labels?: Record<string, string>, task?: string }} spec
       * @param {{ idempotencyKey: string }} context
       */
      createService: (spec, { idempotencyKey }) => call("POST", `${projectAt}/services`, { body: spec, idempotencyKey }),
      /**
       * Every App Service of the mobilynet project, newest first, deleted ones left out (`services:read`); with
       * `labels`, those carrying every one.
       * @param {{ labels?: Record<string, string> }} [filter]
       */
      listServices: ({ labels } = {}) => listAll(`${projectAt}/services`, { label: labelQuery(labels) }),
      /**
       * A hosted service of the catalogue (`hosted:manage`): `{ hostedService, links, operation }`, `creating`, each of
       * its `links` (`[{ consumer: { service }, need? }]`) with its secret fields shown this once, never again. Its
       * machine counts against the project's quotas (`429 quota_exceeded`), and a project at its spending cap makes none
       * (`409 spending_cap_reached`).
       * @param {{ app: string, name?: string, size?: string, region?: string, settings?: Record<string, unknown>, links?: Array<{ consumer: object, need?: string }>, labels?: Record<string, string> }} spec
       * @param {{ idempotencyKey: string }} context
       */
      createHostedService: (spec, { idempotencyKey }) => call("POST", `${projectAt}/hosted-services`, { body: spec, idempotencyKey }),
      /**
       * Every hosted service of the mobilynet project, newest first, deleted ones left out (`hosted:read`); `app`,
       * `state` and `labels` narrow it.
       * @param {{ labels?: Record<string, string>, app?: string, state?: string }} [filter]
       */
      listHostedServices: ({ labels, app, state } = {}) => listAll(`${projectAt}/hosted-services`, { label: labelQuery(labels), app, state }),
      /**
       * The mobilynet project's monthly spending cap and this month's spend (`usage:read`): `{ projectId, capNano,
       * month, spentNano, state, currency, meteredUntil, changedAt }`, amounts as whole nano-units in decimal text, `state`
       * `none`, `under`, `warning` (80%) or `reached`, when creates and scale-ups are refused.
       */
      readSpendingCap: async () => (await call("GET", `${projectAt}/spending-cap`)).spendingCap,
      /**
       * The mobilynet project's quotas with their limits and use (any key of the project; mobilynet's readQuotas):
       * `[{ quota, unit, limit, used }]`, `machines`, `vcpus`, `memoryGib` and `diskGib` among them.
       */
      readQuotas: async () => (await call("GET", `${projectAt}/quotas`)).quotas,
      /**
       * One page of the mobilynet project's events after the id given, oldest first (`events:read`): `{ items, next }`.
       * @param {{ after?: string }} [cursor]
       */
      listEvents: ({ after } = {}) => call("GET", `${projectAt}/events`, { query: { after, limit: PAGE_SIZE } })
    });
  }

  return Object.freeze({
    project,
    /** mobilynet's price table in force and those scheduled, and every offered size with its price (any key). */
    readPrices: () => call("GET", "/v1/prices"),
    /**
     * Every region with its edge's addresses and how many settings and secrets an App Service there holds now
     * (`serviceSettingsMax`, its links' among them).
     */
    listRegions: async () => (await call("GET", "/v1/regions")).items,
    /** The apps that run as hosted services (any key): `{ currency, items }`, each its interface, sizes and prices. */
    readHostedCatalogue: () => call("GET", "/v1/hosted-services/catalogue"),
    /**
     * An App Service (`services:read`), or null when mobilynet has none by that id (deleted ones too). A public one has
     * its own name as `target` (`svc-…`, null for an internal one), and lists the routes sending to it (`routes`), each
     * with its id, its own name as its `target` and whether it is live.
     * @param {string} serviceId
     */
    readService: async (serviceId) => (await orNull(() => call("GET", servicePath(serviceId))))?.service ?? null,
    /**
     * Changes an App Service: `{ service, refresh }`. Its count (`instances`, `services:deploy`) changes at once, with
     * no refresh (`409 no_capacity` when its region has no room, the count kept); its size is a refresh (`202`); its
     * health check, drain, routes, connections and labels change at once (`services:manage`), labels replaced whole and
     * starting no refresh; a name its `routes` no longer hold keeps its route, sending to nothing. A count raised or a size made larger is refused past a quota (`429 quota_exceeded`) or at
     * the spending cap (`409 spending_cap_reached`); a count lowered or a smaller size never is.
     * @param {string} serviceId
     * @param {{ instances?: number, size?: string, healthCheck?: object, drainSeconds?: number, routes?: Array<{ host: string, tls?: "edge", take?: boolean }>, connections?: Array<{ to: string, port: number }>, labels?: Record<string, string> }} change
     * @param {{ idempotencyKey?: string }} [context]
     */
    changeService: (serviceId, change, { idempotencyKey } = {}) => call("PATCH", servicePath(serviceId), { body: change, idempotencyKey }),
    /**
     * Deletes an App Service (`services:manage`): `{ service }`, `deleting`, its refreshes stopped, its instances gone
     * with it and its routes kept, sending to nothing; one mobilynet no longer has answers `{ removed: true }`.
     * @param {string} serviceId
     */
    deleteService: (serviceId) => removedOn404(() => call("DELETE", servicePath(serviceId))),
    /**
     * Replaces an App Service's own settings and secrets (`services:manage`): `{ service, refresh }`, a refresh of kind
     * `settings`. Its needs' settings are its links' alone and kept: naming one is refused `422` under its name.
     * @param {string} serviceId @param {{ settings: Record<string, unknown>, secrets: Record<string, string> }} values
     * @param {{ idempotencyKey?: string }} [context]
     */
    putServiceSettings: (serviceId, { settings, secrets }, { idempotencyKey } = {}) => call("PUT", `${servicePath(serviceId)}/settings`, { body: { settings, secrets }, idempotencyKey }),
    /**
     * A new release of an App Service's app, uploaded as its tarball (`services:deploy`): `{ release, build, service,
     * refresh }`, a refresh of kind `release` onto it once it built; a refresh that fails leaves the version before
     * serving. `task` names a task of the release's declaration its refresh runs once, after its build passed and
     * before any instance starts (`?task=`; the shape the engine asks mobilynet for, its M-C: mobilynet has none yet).
     * @param {string} serviceId @param {{ archive: Buffer, sha256: string }} upload @param {{ task?: string | null }} [asked]
     */
    createServiceRelease: (serviceId, { archive, sha256 }, { task = null } = {}) => call("POST", `${servicePath(serviceId)}/releases`, {
      body: archive, contentSha256: sha256, ...(task ? { query: { task } } : {})
    }),
    /**
     * Rolls an App Service back to the version it ran before (`services:deploy`): `{ service, refresh }`, kind
     * `rollback`; `409 no_previous_version` when it has none.
     * @param {string} serviceId
     */
    rollBackService: (serviceId) => call("POST", `${servicePath(serviceId)}/actions/rollback`, { body: {} }),
    /**
     * An App Service's instances not gone (`services:read`), each its version, rotation and health; with `removed`,
     * those removed in the last 7 days too.
     * @param {string} serviceId @param {{ removed?: boolean }} [filter]
     */
    listServiceInstances: (serviceId, { removed } = {}) => listAll(`${servicePath(serviceId)}/instances`, { removed: removed ? "true" : undefined }),
    /**
     * An instance's logs (`services:read`), live or removed in the last 7 days, read from its host by an operation:
     * `{ instance, logs, readAt, operation }`, `logs` null (`202`) until that operation ends; the same call then answers
     * the lines (`200`) for a minute. mobilynet masks each of the service's secrets as `[secret]`.
     * @param {string} serviceId @param {{ instance?: string, unit?: string, since?: string, lines?: number }} which
     */
    readServiceLogs: (serviceId, { instance, unit, since, lines } = {}) => call("GET", `${servicePath(serviceId)}/logs`, { query: { instance, unit, since, lines } }),
    /**
     * A build's log from byte `after` (`GET /v1/builds/{id}/log`, `vps:read` or `packages:publish`): `{ text, next,
     * state, done }`, at most 256 KiB, `next` the byte to ask from next; with `wait` (0 to 25 seconds) and nothing new
     * it answers when text comes, the build ends or the wait passes.
     * @param {string} buildId @param {{ after?: number, wait?: number }} [from]
     */
    readBuildLog: (buildId, { after = 0, wait } = {}) => call("GET", `/v1/builds/${encodeURIComponent(buildId)}/log`, { query: { after, wait } }),
    /** An App Service's refreshes, newest first (`services:read`). @param {string} serviceId */
    listServiceRefreshes: (serviceId) => listAll(`${servicePath(serviceId)}/refreshes`),
    /** One refresh of an App Service with its steps (`services:read`). @param {string} serviceId @param {string} refreshId */
    readServiceRefresh: async (serviceId, refreshId) => (await call("GET", `${servicePath(serviceId)}/refreshes/${encodeURIComponent(refreshId)}`)).refresh,
    /** A hosted service (`hosted:read`), or null when mobilynet has none by that id (deleted ones too). @param {string} hostedServiceId */
    readHostedService: async (hostedServiceId) => (await orNull(() => call("GET", hostedPath(hostedServiceId))))?.hostedService ?? null,
    /**
     * Resizes a hosted service to another of its app's sizes, or replaces its labels (`hosted:manage`): `{ hostedService,
     * operation }`, `202` `resizing`, or `200` with no operation when its machine already is that size or only its
     * labels changed. A larger size is refused past a quota or at the spending cap, as a create is.
     * @param {string} hostedServiceId @param {{ size?: string, labels?: Record<string, string> }} change
     * @param {{ idempotencyKey?: string }} [context]
     */
    changeHostedService: (hostedServiceId, change, { idempotencyKey } = {}) => call("PATCH", hostedPath(hostedServiceId), { body: change, idempotencyKey }),
    /**
     * Deletes a hosted service (`hosted:manage`): `{ hostedService, operation }`, its data kept 72 hours. One with
     * links is refused `409 hosted_service_linked` unless `revokeLinks` ends them with it; one mobilynet no longer has
     * answers `{ removed: true }`.
     * @param {string} hostedServiceId @param {{ revokeLinks?: boolean }} [options]
     */
    deleteHostedService: (hostedServiceId, { revokeLinks = false } = {}) => removedOn404(() => call(
      "DELETE",
      hostedPath(hostedServiceId),
      revokeLinks ? { query: { links: "revoke" } } : {}
    )),
    /**
     * A hosted service's backups (`hosted:read`), as a machine's are read: `{ enabled, apps: [{ app, lastLog, lastLogAt,
     * failure, restorable: { from, to } | null }], bases, restoredFrom, disk: { enabled, available, server, everyHours,
     * failure, held, newest, storedBytes, backups: [{ label, at, restorableUntil, ... }] } }`, the disk's newest first.
     * @param {string} hostedServiceId
     */
    readHostedBackups: async (hostedServiceId) => (await call("GET", `${hostedPath(hostedServiceId)}/backups`)).backups,
    /** A hosted service's links not revoked (`hosted:read`), with no secret field. @param {string} hostedServiceId */
    listHostedLinks: (hostedServiceId) => listAll(`${hostedPath(hostedServiceId)}/links`),
    /**
     * Links a hosted service to a consumer, an App Service of its project (`hosted:manage` and `services:manage`):
     * `{ link, connection }`, `connection` with the secret fields shown this once. The consumer's need of the interface
     * gets its settings (`<AS>_<FIELD>`) through a settings refresh; `need` names one when it declares several.
     * @param {string} hostedServiceId
     * @param {{ consumer: { service: string }, need?: string }} link
     * @param {{ idempotencyKey?: string }} [context]
     */
    linkHostedService: (hostedServiceId, { consumer, need }, { idempotencyKey } = {}) => call(
      "POST",
      `${hostedPath(hostedServiceId)}/links`,
      { body: { consumer, ...(need === undefined ? {} : { need }) }, idempotencyKey }
    ),
    /**
     * Removes a link (`hosted:manage`): `{ link }`, `revoking` until its credential is gone, its need's settings taken
     * out of its consumer; one mobilynet no longer has answers `{ removed: true }`.
     * @param {string} hostedServiceId @param {string} linkId
     */
    unlinkHostedService: (hostedServiceId, linkId) => removedOn404(() => call("DELETE", `${hostedPath(hostedServiceId)}/links/${encodeURIComponent(linkId)}`)),
    /**
     * Takes a named lease in the credential's mobilynet project (`services:deploy`): `{ lease }`, `{ id, name, holder,
     * since, expiresAt }`, for at most 60 minutes. While another holds it, `409 lease_held` with its `holder`, `since`
     * and `expiresAt`.
     * @param {{ name: string, holder: string, seconds: number }} lease
     */
    takeLease: ({ name, holder, seconds }) => call("POST", "/v1/leases", { body: { name, holder, seconds } }),
    /** Renews a lease this credential holds for `seconds` from now. @param {string} leaseId @param {{ seconds: number }} renewal */
    renewLease: (leaseId, { seconds }) => call("PATCH", leasePath(leaseId), { body: { seconds } }),
    /** Gives a lease up; one already gone answers `{ removed: true }`. @param {string} leaseId */
    releaseLease: (leaseId) => removedOn404(() => call("DELETE", leasePath(leaseId)))
  });
}

export { MobilynetError, createMobilynetClient, labelQuery };
