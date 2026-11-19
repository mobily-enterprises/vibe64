import { createHash } from "node:crypto";

import { EDGE_ADDRESSES, HOST_REGIONS, REGIONS, REGION_NAMES, isRecord, routeName } from "./catalogue.js";

// mobilynet's regions, domains and routes as its stand-in answers them (openApiNetwork.js, its network package's
// domains.js and edgeRoutes.js). A domain belongs to one mobilynet project; its check verifies it once DNS shows its TXT
// value at `_mobilynet.<name>` and, for a wildcard, its challenge CNAME at `_acme-challenge.<name>`: DNS is what
// `useDns` names, and without one a check finds nothing; `verifyDomain` verifies one as its records would. A verified
// name belongs to one mobilynet project at a time: verifying it in another moves it (`moved`). A domain a route uses is
// not deleted (`409 domain_in_use`). A route is its name's: its `target`, the CNAME an owner adds once, is its own
// region-free name (`rte-<id>.routes.<apps domain>`) whatever it sends to, and it outlives what it sends to. A route
// sends to an App Service (`serviceId`, taking the service's port and health path), or to nothing: an App Service
// deleted, or no longer asking for the name, leaves its route kept, sending to nothing (`waitingFor` `target`), and
// the next service asking for the name takes it (services.js), as `take: true` moves it from another service. It is
// live once its domain is verified and its service has an instance in rotation. The routes API makes a route to a
// service, moves any route to another service, or deletes it.
// STAND-IN ONLY: the stand-in has no machines, so a route to a mobilynet machine or a group of them is refused `422`;
// it issues no certificate and has no offline edges or DNS of route names.

// A name: an exact one or a wildcard one level up, as mobilynet's domains take it.
const HOST = /^(?=.{1,253}$)(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const CHECK_EVERY_MS = 10 * 60_000;
const CHECK_FOR_MS = 7 * 24 * 60 * 60_000;
const DOMAIN_WORDS = Object.freeze({
  pending: "Waiting for DNS",
  verified: "Verified",
  failed: "Not verified in 7 days",
  moved: "Verified in another project"
});
const ROUTE_WAITING_WORDS = Object.freeze({
  domain: "Its domain to be verified",
  target: "Nothing to send it to: an App Service asking for its name takes it, or give it a machine, a group or an App Service",
  machines: "A machine of its group with a place"
});
const NO_MACHINES = "The stand-in has no machines: a route sends to an App Service of the project, or to nothing.";
const SERVICE_PORT = "A route to an App Service takes the service's port and health path.";
const CHALLENGE_ZONE = "acme.mobilynet.standin";

/**
 * @param {any} world the stand-in's world
 * @param {object} services the App Services routes send to
 * @param {(serviceId: string) => string[]} services.members the instances in rotation of an App Service, by its id
 * @param {(projectId: string, serviceId: unknown) => { id: string, region: string, port: number | null, healthPath: string | null } | null} services.routable
 *   a public App Service of the project that is not deleted, or null
 */
function createStandInNetwork(world, services) {
  const { routes, failure, answer, once, nextId, at, now, notFound } = world;
  /** @type {Map<string, any>} */
  const domains = new Map();
  /** @type {{ txt: (name: string) => string[], cname: (name: string) => string | null } | null} */
  let dns = null;
  const invalid = (fieldErrors) => failure(422, "validation_failed", `Check ${Object.keys(fieldErrors).join(", ")}.`, { fieldErrors });
  const later = (ms) => new Date(now().getTime() + ms).toISOString();
  const shown = (item) => structuredClone(item);
  /** Every region, with its edge's addresses and how many settings and secrets an App Service there holds now. */
  const regionList = () => REGIONS.map((id) => ({
    id, name: REGION_NAMES[id], state: "open", serviceSettingsMax: world.settingsMax(id),
    edge: { addresses: HOST_REGIONS.includes(id) ? [...EDGE_ADDRESSES] : [] }
  }));

  /** The mobilynet project's domain covering a name: the name itself, or a wildcard one level up. @param {string} projectId @param {string} host */
  function coveringDomain(projectId, host) {
    const parent = host.split(".").slice(1).join(".");
    const names = host.startsWith("*.") || !parent.includes(".") ? [host] : [host, `*.${parent}`];
    const own = [...domains.values()].filter((domain) => domain.projectId === projectId);
    for (const name of names) {
      const found = own.find((domain) => domain.name === name);
      if (found) return found;
    }
    return null;
  }

  /** @param {string} projectId @param {any} body */
  function createDomain(projectId, body) {
    const name = typeof body?.name === "string" ? body.name.toLowerCase() : "";
    if (!HOST.test(name)) return invalid({ name: "A name such as example.com or *.example.com." });
    if ([...domains.values()].some((domain) => domain.projectId === projectId && domain.name === name)) {
      return failure(409, "name_taken", `The name "${name}" is already taken here.`, { name });
    }
    const id = nextId("dom");
    const token = createHash("sha256").update(id).digest("hex").slice(0, 32);
    const bare = name.replace(/^\*\./u, "");
    const domain = {
      id,
      projectId,
      name,
      wildcard: name.startsWith("*."),
      state: "pending",
      stateWords: DOMAIN_WORDS.pending,
      records: [
        { type: "TXT", name: `_mobilynet.${bare}`, value: `mobilynet-verify=${token}` },
        ...(name.startsWith("*.") ? [{ type: "CNAME", name: `_acme-challenge.${bare}`, value: `${id.replace(/^dom_/u, "")}.${CHALLENGE_ZONE}` }] : [])
      ],
      lastSeen: { txt: [], cname: null },
      checkedAt: null,
      nextCheckAt: later(CHECK_EVERY_MS),
      verifiedAt: null,
      checkUntil: later(CHECK_FOR_MS),
      createdAt: at()
    };
    domains.set(id, domain);
    return answer(201, shown(domain));
  }

  /** A domain verified: the same name verified in another mobilynet project moves. @param {any} domain */
  function verify(domain) {
    for (const other of [...domains.values()].filter((one) => one !== domain && one.name === domain.name && one.state === "verified")) {
      Object.assign(other, { state: "moved", stateWords: DOMAIN_WORDS.moved, nextCheckAt: null });
    }
    Object.assign(domain, { state: "verified", stateWords: DOMAIN_WORDS.verified, verifiedAt: at(), checkUntil: null, nextCheckAt: null });
  }

  /** mobilynet's check now (domains.js checkNow): pending again if failed or moved, verified once DNS shows its records. */
  function checkNow(domain) {
    if (domain.state === "verified") return;
    if (domain.state === "failed" || domain.state === "moved") {
      Object.assign(domain, { state: "pending", stateWords: DOMAIN_WORDS.pending, checkUntil: later(CHECK_FOR_MS) });
    }
    const [txtRecord, challenge] = domain.records;
    const txt = dns ? dns.txt(txtRecord.name) : [];
    const cname = domain.wildcard && dns ? dns.cname(challenge.name) : null;
    Object.assign(domain, { lastSeen: { txt: txt.slice(0, 10), ...(domain.wildcard ? { cname } : {}) }, checkedAt: at(), nextCheckAt: later(CHECK_EVERY_MS) });
    if (txt.includes(txtRecord.value) && (!domain.wildcard || String(cname ?? "").toLowerCase().replace(/\.$/u, "") === challenge.value)) verify(domain);
  }

  /**
   * Why a route can't serve yet, or null: its domain unverified, then nothing to send to, then its service with no
   * instance in rotation. @param {any} route
   */
  function waitingOf(route) {
    if (domains.get(route.domainId)?.state !== "verified") return "domain";
    if (!route.serviceId) return "target";
    return services.members(route.serviceId).length === 0 ? "machines" : null;
  }

  /** A route as mobilynet answers it, its own name its target, its liveness worked out now. @param {any} route */
  function routeView(route) {
    const waitingFor = waitingOf(route);
    return {
      ...shown(route),
      target: routeName(route),
      live: waitingFor === null,
      waitingFor,
      waitingWords: waitingFor ? ROUTE_WAITING_WORDS[waitingFor] : null
    };
  }

  /** The route of a name in a mobilynet project, or null. @param {string} projectId @param {string} host */
  const routeOfHost = (projectId, host) => routes.find((one) => one.projectId === projectId && one.host === host) ?? null;

  /** A route sent to an App Service, which it takes the port, health path and region of. @param {any} route @param {any} service */
  function sendTo(route, service) {
    Object.assign(route, { serviceId: service.id, region: service.region, port: service.port, healthPath: service.healthPath, changedAt: at() });
    return route;
  }

  /**
   * A name sent to an App Service: its route made, or taken where it has one (kept, sending to nothing, or moved
   * from another service). Its project's domain covering the name is checked before.
   * @param {string} projectId @param {string} host @param {any} service
   */
  function sendNameTo(projectId, host, service) {
    const kept = routeOfHost(projectId, host);
    if (kept) return sendTo(kept, service);
    const route = {
      id: nextId("rte"), projectId, host, domainId: coveringDomain(projectId, host).id, serviceId: null, vpsId: null, group: null,
      port: null, tls: "edge", healthPath: null, region: service.region, certificate: null, createdAt: at(), changedAt: at()
    };
    routes.push(route);
    return sendTo(route, service);
  }

  /** A route kept sending to nothing: its id, name, domain, TLS mode, region and certificate stay. @param {any} route */
  function sendNowhere(route) {
    Object.assign(route, { serviceId: null, port: null, healthPath: null, changedAt: at() });
  }

  /** A route's name refused as another's: a route of the project has it. @param {string} host @param {any} route */
  const nameTaken = (host, route) => failure(409, "name_taken", `The name "${host}" is already taken here.`, { host, routeId: route.id });

  /** The target a routes call asks for (an App Service alone, here), or its field errors. @param {string} projectId @param {any} input @param {any} [route] */
  function targetOf(projectId, input, route = null) {
    if (input.vpsId !== undefined) return { errors: { vpsId: NO_MACHINES } };
    if (input.group !== undefined) return { errors: { group: NO_MACHINES } };
    const errors = {};
    for (const field of ["port", "healthPath"]) if (input[field] !== undefined) errors[field] = SERVICE_PORT;
    if ((input.tls ?? "edge") !== "edge") errors.tls = "The stand-in's routes end TLS at the edge: edge.";
    // A create names its service; a change may name another.
    const asked = input.serviceId !== undefined || !route;
    const service = asked ? services.routable(projectId, input.serviceId) : null;
    if (asked && !service) errors.serviceId = "A public App Service of this project.";
    return Object.keys(errors).length > 0 ? { errors } : { service };
  }

  /** `POST /v1/projects/{p}/routes` (createRoute): a name sent to an App Service. @param {string} projectId @param {any} body */
  function createRoute(projectId, body) {
    const input = isRecord(body) ? body : {};
    const host = typeof input.host === "string" ? input.host.toLowerCase() : "";
    if (!HOST.test(host) || host.startsWith("*.")) return invalid({ host: "A name such as www.example.com." });
    const target = targetOf(projectId, input);
    if (target.errors) return invalid(target.errors);
    if (!coveringDomain(projectId, host)) return invalid({ host: "No domain of this project covers this name: add the domain first." });
    const held = routeOfHost(projectId, host);
    if (held) return nameTaken(host, held);
    return answer(201, routeView(sendNameTo(projectId, host, target.service)));
  }

  /** `PATCH /v1/projects/{p}/routes/{r}` (updateRoute): any route moved to an App Service; its id, name and target stay. */
  function updateRoute(route, body) {
    const target = targetOf(route.projectId, isRecord(body) ? body : {}, route);
    if (target.errors) return invalid(target.errors);
    if (target.service) sendTo(route, target.service);
    return answer(200, routeView(route));
  }

  /**
   * Answers a request about regions, domains and routes, or null when it is none of them.
   * @param {{ method: string, path: string, params: URLSearchParams, body: any, idempotencyKey?: string, caller: any }} request
   */
  function request({ method, path, body, idempotencyKey, caller }) {
    if (path === "/v1/regions") return method === "GET" ? answer(200, { items: regionList() }) : null;
    const network = /^\/v1\/projects\/([^/]+)\/(domains|routes)(?:\/([^/]+)(\/.*)?)?$/u.exec(path);
    if (!network) return null;
    const [, rawProject, kind, rawId, rest = ""] = network;
    const projectId = decodeURIComponent(rawProject);
    if (!world.reaches(caller, projectId)) return notFound("project");
    if (rawId === undefined) {
      if (method === "POST" && kind === "domains") return once(idempotencyKey, `${projectId} domain ${JSON.stringify(body)}`, () => createDomain(projectId, body));
      if (method === "GET" && kind === "domains") {
        const held = [...domains.values()].filter((domain) => domain.projectId === projectId).sort((one, other) => one.name.localeCompare(other.name));
        return answer(200, { items: held.map(shown), next: null });
      }
      if (method === "GET" && kind === "routes") return answer(200, { items: routes.filter((route) => route.projectId === projectId).map(routeView), next: null });
      if (method === "POST" && kind === "routes") return once(idempotencyKey, `${projectId} route ${JSON.stringify(body)}`, () => createRoute(projectId, body));
      return null;
    }
    const id = decodeURIComponent(rawId);
    if (kind === "domains") {
      const domain = domains.get(id);
      if (!domain || domain.projectId !== projectId) return notFound("domain");
      if (method === "GET" && !rest) return answer(200, shown(domain));
      if (method === "POST" && rest === "/actions/check") {
        checkNow(domain);
        return answer(200, shown(domain));
      }
      if (method === "DELETE" && !rest) {
        const using = routes.filter((one) => one.domainId === domain.id).length;
        if (using > 0) return failure(409, "domain_in_use", `${using} route${using === 1 ? "" : "s"} still use${using === 1 ? "s" : ""} this domain: remove them first.`, { routes: using });
        domains.delete(domain.id);
        return answer(200, { removed: true });
      }
      return null;
    }
    const route = routes.find((one) => one.id === id && one.projectId === projectId);
    if (!route || rest) return route ? null : notFound("route");
    if (method === "GET") return answer(200, routeView(route));
    if (method === "PATCH") return updateRoute(route, body);
    if (method === "DELETE") {
      routes.splice(routes.indexOf(route), 1);
      return answer(200, { removed: true });
    }
    return null;
  }

  return Object.freeze({
    request,
    coveringDomain,
    routeView,
    routeOfHost,
    sendNameTo,
    sendNowhere,
    nameTaken,
    /** Names what DNS shows, which every domain's check reads from here on. */
    useDns: (resolver) => {
      dns = resolver;
    },
    /**
     * Verifies a mobilynet project's domain by its name, as its DNS records would once added.
     * @param {string} name @param {string} [projectId]
     */
    verifyDomain: (name, projectId) => {
      const named = [...domains.values()].filter((one) => one.name === name && (!projectId || one.projectId === projectId));
      if (named.length !== 1) throw new Error(`The stand-in has no one domain ${name}${projectId ? ` in ${projectId}` : ""}.`);
      verify(named[0]);
    },
    /** Every domain, as mobilynet answers them. */
    domains: () => [...domains.values()].map(shown),
    /** Every route, as mobilynet answers them, live or waiting as they are now. */
    routes: () => routes.map(routeView)
  });
}

export { createStandInNetwork };
