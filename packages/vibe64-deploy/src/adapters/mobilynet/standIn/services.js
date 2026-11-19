import { INSTANCE_SIZES, isRecord, labelsMatch, labelsOf, needSettings, pageOf, projectLabel, thingName } from "./catalogue.js";
import { createStandInServiceEngine, fieldsOf, settingsMissing, settingsMissingWords, specOf, tooManySettings, undeclaredErrors, valuesOf } from "./serviceEngine.js";
import { createStandInServiceLogs } from "./serviceLogs.js";

// mobilynet's App Services as its stand-in answers them (openApiServices.js, and its machines package's services.js,
// serviceViews.js, serviceEngine.js and serviceLinks.js): a service is one app on a count of instances of an `a-`
// size, made from a release its mobilynet project has (`app: { name, version }`, releases.js), public behind the load
// balancer (its routes, the route group on its `mobilynet-service` label) or internal (no routes, reached inside its
// project as `<name>.<project label>.internal`, each instance as `<instance>.<that>`). `connections` open a port of
// another service of the project to its instances. Every change of what its instances run is a refresh, one at a time
// per service, in order, which moves one step each time the stand-in moves on (serviceEngine.js). A count change places
// or drains instances at once, outside any refresh; a delete is `deleting`, then `deleted` at the next step, its
// instances and routes gone. A link of a hosted service gives a service its need's settings (`<AS>_<FIELD>`) through a
// settings refresh, which only the link sets or takes out (hosted.js). Labels (engine-support M2) are set at create and
// replaced whole by a PATCH, which starts no refresh; a list filters by them. A create, a count raised or a size made
// larger is admitted by the project's spending cap and its vCPU and memory quotas, instances times size (M12, M13).
// Faults: `instancesUnhealthy` (a refresh's new instances never get healthy, every one or those its function picks:
// it fails `instance_never_healthy`), `noCapacity` (a count raise answers `409 no_capacity`) and `releaseBuildFails`.
// A replace takes a name the release the service runs doesn't declare as a plain setting or a secret, text of up to
// 4096 characters, but never one mobilynet's runtime sets or a need's link sets (undeclaredErrors), and leaves the
// service at most the adapter's SERVICE_SETTINGS_MAX settings and secrets in all, its links' among them.
// STAND-IN ONLY: ids are the stand-in's own (`svc_s000123`), a connection makes no allow rule (`ruleId` null), a
// release's settings are checked only for the required ones its declaration declares (a replace also for the names it
// doesn't declare), unlinking a link made ahead queues a settings refresh rather than changing its refresh ahead, and a
// service's route, before the service has a port, shows `{ host, tls, target }` alone.

/** The label every instance of a service carries, so a public service's route group sends to them. */
const SERVICE_LABEL = "mobilynet-service";
const APP_NAME = /^[a-z][a-z0-9-]{0,40}$/u;
const OPEN_REFRESH = Object.freeze(["queued", "building", "rolling", "aborting"]);
const RUNNING_REFRESH = Object.freeze(["building", "rolling", "aborting"]);
// The refreshes that move a service to another release; the others (settings, size) keep the one it runs.
const MOVING_KINDS = Object.freeze(["create", "release", "rollback"]);
const COVER_WORDS = "No domain of this project covers this name: add the domain first.";

/**
 * The task a create or a release asks its refresh to run once, before any instance starts: one its release declares
 * (STAND-IN ONLY: the shape the engine asks mobilynet for, its M-C), or none.
 * @param {(fieldErrors: Record<string, string>) => any} invalid @param {any} release @param {unknown} name
 */
function taskOf(invalid, release, name) {
  if (name === undefined || name === null || name === "") return { task: null };
  if (typeof name !== "string" || !Object.hasOwn(release.declaration?.tasks ?? {}, name)) {
    return { refusal: invalid({ task: `The release declares no task ${JSON.stringify(name)}: name one of its tasks.` }) };
  }
  return { task: { name, state: "pending", exitCode: null, output: [] } };
}

/**
 * @param {any} world the stand-in's world
 * @param {object} parts
 * @param {ReturnType<typeof import("./releases.js").createStandInReleases>} parts.releases a project's releases
 * @param {{ coveringDomain: (projectId: string, host: string) => any, routeLive: (routeId: string) => boolean }} parts.network
 */
function createStandInServices(world, { releases, network }) {
  const { routes, faults, failure, answer, once, nextId, at, now } = world;
  /** @type {Map<string, any>} */
  const services = new Map();
  /** @type {Map<string, any>} each refresh, by id, in the order made */
  const refreshes = new Map();
  /** @type {Map<string, any>} each instance, by id, in the order started */
  const instances = new Map();
  const logs = createStandInServiceLogs(world, instances);
  /** What else holds a name in a mobilynet project (its hosted services), and what a deleted service's links do. */
  const hooks = { nameTaken: () => false, consumerGone: () => {}, refreshFailed: () => {} };

  const { invalid } = releases;
  const { notFound } = world;
  const invalidState = (state) => failure(409, "invalid_state", `This can't be done while it is ${state.replaceAll("_", " ")}.`, { state });
  const internalName = (named) => `${named.name}.${projectLabel(named.projectId)}.internal`;
  const stepOf = (step, instanceId = null, detail = null) => ({ at: at(), step, ...(instanceId ? { instanceId } : {}), ...(detail ? { detail } : {}) });
  /** What `instances` of a size take of the project's quotas. @param {number} count @param {string} size */
  const taking = (count, size) => ({ vcpus: count * INSTANCE_SIZES[size].vcpus, memoryGib: count * INSTANCE_SIZES[size].memoryGib });

  /** A service's refreshes, oldest first. @param {string} serviceId */
  const refreshesOf = (serviceId) => [...refreshes.values()].filter((one) => one.serviceId === serviceId);
  /** The refresh under way, or the next queued. @param {string} serviceId */
  function currentRefresh(serviceId) {
    const open = refreshesOf(serviceId).filter((one) => OPEN_REFRESH.includes(one.state));
    return open.find((one) => RUNNING_REFRESH.includes(one.state)) ?? open[0] ?? null;
  }
  /** A service's instances not gone, oldest first. @param {string} serviceId */
  const liveOf = (serviceId) => [...instances.values()].filter((one) => one.serviceId === serviceId && one.rotation !== "gone");
  /** The release a service's refresh moves to, or the one it runs. @param {any} service @param {string | null} version */
  const releaseOf = (service, version) => (version ? releases.named(service.projectId, service.app, version) : null);
  /** The declaration of the release a service runs, or null before its first. @param {any} service */
  const declarationOf = (service) => releaseOf(service, service.version)?.declaration ?? null;
  /** The settings the needs of a declaration declare, which only a link sets. @param {any} declaration */
  const linkedNames = (declaration) => (declaration?.needs ?? []).flatMap((need) => needSettings(need).map((entry) => entry.name));
  /** A public service's own name, its routes' CNAME target; null for an internal one. @param {any} service */
  const targetOf = (service) => (service.exposure === "public" ? thingName(service) : null);
  /** Whether a route is one of a service's. @param {any} service @param {any} route */
  const routeOf = (service, route) => route.group?.label.key === SERVICE_LABEL && route.group.label.value === service.id;

  /** A service's routes as its view shows them, each made one with its id and whether it is live. @param {any} service */
  function routesView(service) {
    const target = targetOf(service);
    return service.routes.map(({ host, tls }) => {
      const made = routes.find((route) => routeOf(service, route) && route.host === host);
      return made ? { host, tls, target, id: made.id, live: network.routeLive(made.id) } : { host, tls, target };
    });
  }

  /** A service as mobilynet's API shows it (serviceViews.js): its settings and secrets by name. @param {any} service */
  function view(service) {
    const serving = liveOf(service.id).filter((one) => one.rotation !== "draining");
    const current = currentRefresh(service.id);
    return {
      id: service.id,
      projectId: service.projectId,
      name: service.name,
      region: service.region,
      exposure: service.exposure,
      size: service.size,
      state: service.state,
      instances: {
        wanted: service.instances,
        running: serving.filter((one) => one.state === "running").length,
        inRotation: serving.filter((one) => one.rotation === "in").length,
        healthy: serving.filter((one) => one.health === "healthy").length
      },
      app: service.app,
      version: service.version,
      previousVersion: service.previousVersion,
      refresh: current ? { id: current.id, kind: current.kind, state: current.state, toVersion: current.toVersion } : null,
      healthCheck: { ...service.healthCheck },
      drainSeconds: service.drainSeconds,
      port: service.port,
      healthPath: service.healthPath,
      settings: Object.keys(service.settings).sort(),
      secrets: Object.keys(service.secrets).sort(),
      target: targetOf(service),
      routes: routesView(service),
      connections: service.connections.map((connection) => ({ ...connection, ruleId: null })),
      internalName: internalName(service),
      labels: { ...service.labels },
      lastError: service.lastError ? structuredClone(service.lastError) : null,
      createdAt: service.createdAt,
      changedAt: service.changedAt
    };
  }

  /** A refresh as mobilynet shows it. @param {any} refresh */
  const refreshView = (refresh) => (refresh ? {
    id: refresh.id,
    serviceId: refresh.serviceId,
    kind: refresh.kind,
    state: refresh.state,
    fromVersion: refresh.fromVersion,
    toVersion: refresh.toVersion,
    buildId: refresh.buildId,
    steps: structuredClone(refresh.steps),
    ...(refresh.task ? { task: { name: refresh.task.name, state: refresh.task.state, exitCode: refresh.task.exitCode ?? null, output: [...(refresh.task.output ?? [])] } } : {}),
    error: refresh.error ? structuredClone(refresh.error) : null,
    createdAt: refresh.createdAt,
    startedAt: refresh.startedAt,
    finishedAt: refresh.finishedAt
  } : null);

  /** An instance as mobilynet shows it. @param {any} service @param {any} instance */
  const instanceView = (service, instance) => ({
    id: instance.id,
    name: instance.name,
    privateAddress: instance.privateAddress,
    state: instance.state,
    version: instance.version,
    size: instance.size,
    rotation: instance.rotation,
    health: instance.health,
    healthChangedAt: instance.healthChangedAt,
    healthyAt: instance.healthyAt,
    startedAt: instance.startedAt,
    internalName: `${instance.name}.${internalName(service)}`,
    removedReason: instance.removedReason,
    removedAt: instance.removedAt,
    logsUntil: instance.logsUntil
  });

  /** An event of the service's mobilynet project. */
  const event = (service, type, details) => world.emitIn(service.projectId, type, { kind: "service", id: service.id }, details);

  /** @param {any} service @param {Record<string, unknown>} changes */
  function patch(service, changes) {
    Object.assign(service, changes, { changedAt: at() });
    return service;
  }

  /** Connections only to another live service of the project. @param {string} projectId @param {string | null} serviceId @param {any[]} connections */
  function connectableRefusal(projectId, serviceId, connections) {
    const errors = {};
    for (const [index, { to }] of connections.entries()) {
      const other = services.get(to);
      if (!other || other.id === serviceId || other.projectId !== projectId || ["deleting", "deleted"].includes(other.state)) {
        errors[`connections.${index}.to`] = "No machine or other service of this project has this id.";
      }
    }
    return Object.keys(errors).length > 0 ? invalid(errors) : null;
  }

  /** A service's routes checked as asked: each covered by a domain of its project, its name free there. */
  function routesRefusal(projectId, serviceId, asked) {
    for (const [index, { host }] of asked.entries()) {
      if (!network.coveringDomain(projectId, host)) return invalid({ [`routes.${index}.host`]: COVER_WORDS });
      const taken = routes.find((route) => route.projectId === projectId && route.host === host);
      const own = taken?.group?.label.key === SERVICE_LABEL && taken.group.label.value === serviceId;
      if (taken && !own) return failure(409, "name_taken", `The name "${host}" is already taken here.`, { name: host });
    }
    return null;
  }

  /**
   * Makes a service's route rows what it asks for (serviceNetwork.js syncRoutes): one per name on its label, its port
   * and health path, edge TLS, made once it has a port; rows no longer asked for go. @param {any} service
   */
  function syncRoutes(service) {
    const asked = service.state === "deleted" ? [] : service.routes.map((route) => route.host);
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      if (routeOf(service, routes[index]) && !asked.includes(routes[index].host)) routes.splice(index, 1);
    }
    if (!service.port) return;
    for (const route of routes.filter((one) => routeOf(service, one))) {
      Object.assign(route, { port: service.port, healthPath: service.healthPath });
    }
    for (const host of asked) {
      if (routes.some((route) => route.projectId === service.projectId && route.host === host)) continue;
      const domain = network.coveringDomain(service.projectId, host);
      if (!domain) continue;
      routes.push({
        id: nextId("rte"),
        projectId: service.projectId,
        host,
        domainId: domain.id,
        vpsId: null,
        group: { label: { key: SERVICE_LABEL, value: service.id } },
        port: service.port,
        tls: "edge",
        healthPath: service.healthPath,
        region: service.region,
        certificate: null,
        createdAt: at(),
        changedAt: at()
      });
    }
  }

  /** A service's changes of settings still queued, oldest first. @param {string} serviceId */
  const queuedSettings = (serviceId) => refreshesOf(serviceId).filter((one) => one.state === "queued" && one.kind === "settings");

  /** The settings and secrets a service runs with once its open refreshes ran (serviceLinks.js settingsAhead). */
  function settingsAhead(service) {
    const open = refreshesOf(service.id);
    const queued = open.filter((one) => one.state === "queued" && one.kind === "settings").at(-1);
    const running = open.find((one) => RUNNING_REFRESH.includes(one.state));
    const target = queued?.target ?? running?.target ?? {};
    return { settings: { ...(target.settings ?? service.settings) }, secrets: { ...(target.secrets ?? service.secrets) } };
  }

  /** Queues a refresh of a service (design 9.4); it runs once those before it ended. */
  function queueRefresh(service, { kind, toVersion, target = {}, task = null }) {
    const refresh = {
      id: nextId("rfr"),
      serviceId: service.id,
      kind,
      task,
      state: "queued",
      fromVersion: service.version,
      toVersion,
      buildId: null,
      target,
      steps: [],
      error: null,
      createdAt: at(),
      startedAt: null,
      finishedAt: null
    };
    refreshes.set(refresh.id, refresh);
    return refresh;
  }

  /**
   * A change of settings or size (services.js changeOrRefresh): a refresh of a service that runs a release, its
   * settings checked against that release now; a service whose first release failed takes it at once; one whose first
   * release is still under way refuses it. @returns {{ refusal: any } | { refresh: any }}
   */
  function changeOrRefresh(service, { kind, target }) {
    if (!service.version) {
      if (service.state !== "failed") return { refusal: invalidState(service.state) };
      patch(service, { ...(target.settings ? { settings: target.settings } : {}), ...(target.secrets ? { secrets: target.secrets } : {}), ...(target.size ? { size: target.size } : {}) });
      return { refresh: null };
    }
    if (kind === "settings") {
      const missing = settingsMissing(declarationOf(service), target);
      if (missing.length > 0) return { refusal: failure(422, "settings_missing", settingsMissingWords(missing), { settings: missing }) };
    }
    return { refresh: queueRefresh(service, { kind, toVersion: service.version, target }) };
  }

  /** Refuses a change to a service being deleted. @param {any} service */
  const unchangeable = (service) => (["deleting", "deleted"].includes(service.state) ? invalidState(service.state) : null);

  const engine = createStandInServiceEngine(world, {
    services, instances, releases, hooks, liveOf, currentRefresh, releaseOf, stepOf, patch, event, syncRoutes
  });

  /** `POST /v1/projects/{p}/services` (createService). @param {string} projectId @param {any} body */
  function create(projectId, body) {
    const input = isRecord(body) ? body : {};
    const checked = fieldsOf(invalid, input);
    if (checked.refusal) return checked.refusal;
    const { fields } = checked;
    if (!isRecord(input.app)) return invalid({ app: "The service's app: { git: { url, commit, path }, deployKey? }, or { version } of a release the project has." });
    const app = input.app.name ?? fields.name;
    if (typeof app !== "string" || !APP_NAME.test(app)) return invalid({ "app.name": "An app's name: a lowercase letter, then up to 40 lowercase letters, digits and hyphens." });
    if (input.app.version === undefined) return invalid({ app: "The stand-in makes a service from { name, version } of a release the project has only." });
    if (typeof input.app.version !== "string" || input.app.version.length === 0 || input.app.version.length > 64) return invalid({ "app.version": "A version of the app's releases." });
    const values = valuesOf(invalid, input);
    if (values.refusal) return values.refusal;
    const labelled = labelsOf(input.labels ?? {});
    if (labelled.errors) return invalid(labelled.errors);
    const release = releases.named(projectId, app, input.app.version);
    if (!release) return notFound("release");
    if (release.state === "retired") return failure(409, "invalid_state", "This can't be done while it is retired.", { state: "retired", version: release.version });
    if (nameTaken(projectId, fields.name) || hooks.nameTaken(projectId, fields.name)) return failure(409, "name_taken", `The name "${fields.name}" is already taken here.`, { name: fields.name });
    const refused = connectableRefusal(projectId, null, fields.connections) ?? routesRefusal(projectId, null, fields.routes)
      ?? world.admit(projectId, taking(fields.instances, fields.size));
    if (refused) return refused;
    const service = {
      id: nextId("svc"),
      projectId,
      ...fields,
      app,
      version: null,
      previousVersion: null,
      port: null,
      healthPath: null,
      ...values.values,
      labels: labelled.labels,
      state: "creating",
      lastError: null,
      createdAt: at(),
      changedAt: at(),
      deletedAt: null
    };
    const task = taskOf(invalid, release, input.task);
    if (task.refusal) return task.refusal;
    services.set(service.id, service);
    const refresh = queueRefresh(service, { kind: "create", toVersion: release.version, task: task.task });
    event(service, "service.created", { name: service.name, exposure: service.exposure, instances: service.instances, version: release.version });
    return answer(202, { service: view(service), refresh: refreshView(refresh) });
  }

  /** `PATCH /v1/services/{id}` (changeService): its count, size, health check, drain, routes, connections or labels. */
  function change(service, body) {
    const input = isRecord(body) ? body : {};
    const checked = fieldsOf(invalid, input, service);
    if (checked.refusal) return checked.refusal;
    const { fields } = checked;
    const labelled = input.labels === undefined ? null : labelsOf(input.labels);
    if (labelled?.errors) return invalid(labelled.errors);
    const raising = fields.instances !== undefined && fields.instances > service.instances;
    const growing = fields.size !== undefined && INSTANCE_SIZES[fields.size].vcpus + INSTANCE_SIZES[fields.size].memoryGib
      > INSTANCE_SIZES[service.size].vcpus + INSTANCE_SIZES[service.size].memoryGib;
    const count = fields.instances ?? service.instances;
    const before = taking(service.instances, service.size);
    const after = taking(count, fields.size ?? service.size);
    const refused = unchangeable(service)
      ?? (fields.connections ? connectableRefusal(service.projectId, service.id, fields.connections) : null)
      ?? (fields.routes ? routesRefusal(service.projectId, service.id, fields.routes) : null)
      ?? (raising && faults.noCapacity ? failure(409, "no_capacity", "The region has no room for that many instances now; the count stays as it was.") : null)
      ?? (raising || growing ? world.admit(service.projectId, { vcpus: after.vcpus - before.vcpus, memoryGib: after.memoryGib - before.memoryGib }) : null);
    if (refused) return refused;
    if (fields.instances !== undefined && fields.instances !== service.instances) {
      if (raising && service.version && !currentRefresh(service.id)) {
        const serving = liveOf(service.id).filter((one) => one.rotation !== "draining").length;
        for (let made = serving; made < fields.instances; made += 1) engine.startInstance(service, specOf(service), null);
      }
      event(service, "service.instances_changed", { from: service.instances, to: fields.instances });
    }
    const { size, ...rest } = fields;
    patch(service, { ...rest, ...(labelled ? { labels: labelled.labels } : {}) });
    if (labelled) event(service, "service.changed", { fields: ["labels"] });
    if (fields.routes) syncRoutes(service);
    let refresh = null;
    if (size && size !== service.size) {
      const changed = changeOrRefresh(service, { kind: "size", target: { size } });
      if (changed.refusal) return changed.refusal;
      ({ refresh } = changed);
    }
    return answer(refresh ? 202 : 200, { service: view(service), refresh: refreshView(refresh) });
  }

  /**
   * `PUT /v1/services/{id}/settings` (replaceServiceSettings): a need's settings are its link's alone, and kept, those
   * of the release its refresh ahead moves it to too (M14); the whole set is checked against the release it runs
   * (serviceFields.js checkSettings), which takes a name it doesn't declare as a plain setting or a secret, but not a
   * link's, so after a link made ahead, whose settings that release doesn't declare, a replace is refused until the
   * move ends.
   */
  function putSettings(service, body) {
    const refused = unchangeable(service);
    if (refused) return refused;
    const values = valuesOf(invalid, isRecord(body) ? body : {});
    if (values.refusal) return values.refusal;
    const declaration = declarationOf(service);
    const next = refreshAhead(service)?.declaration ?? null;
    const linked = [...new Set([...linkedNames(declaration), ...linkedNames(next)])];
    const given = [...Object.keys(values.values.settings), ...Object.keys(values.values.secrets)].filter((name) => linked.includes(name));
    if (given.length > 0) {
      const needOf = (name) => [declaration, next].flatMap((one) => one?.needs ?? []).find((need) => needSettings(need).some((entry) => entry.name === name)).as;
      return invalid(Object.fromEntries(given.map((name) => [name, `Set by the link of its need ${needOf(name)} to a hosted service alone: link or unlink it instead.`])));
    }
    const ahead = settingsAhead(service);
    const picked = (from) => Object.fromEntries(Object.entries(from).filter(([name]) => linked.includes(name)));
    const target = { settings: { ...values.values.settings, ...picked(ahead.settings) }, secrets: { ...values.values.secrets, ...picked(ahead.secrets) } };
    const crowded = tooManySettings(target);
    if (crowded) return invalid(crowded);
    if (service.version) {
      const declared = [...Object.keys(isRecord(declaration.settings) ? declaration.settings : {}), ...linkedNames(declaration)];
      const errors = undeclaredErrors(declared, linked, target);
      if (errors) return invalid(errors);
    }
    const changed = changeOrRefresh(service, { kind: "settings", target });
    if (changed.refusal) return changed.refusal;
    return answer(changed.refresh ? 202 : 200, { service: view(service), refresh: refreshView(changed.refresh) });
  }

  /** `POST /v1/services/{id}/releases` (createServiceRelease): an upload, built, then a refresh onto it. */
  function release(service, body, contentSha256, taskName) {
    const refused = unchangeable(service);
    if (refused) return refused;
    const made = releases.upload(service.projectId, service.app, body, contentSha256);
    if (made.refusal) return made.refusal;
    const task = taskOf(invalid, made.release, taskName);
    if (task.refusal) return task.refusal;
    const refresh = queueRefresh(service, { kind: "release", toVersion: made.release.version, task: task.task });
    return answer(202, {
      release: releases.view(made.release),
      build: made.started ? { id: made.release.buildId, state: "queued" } : null,
      service: view(service),
      refresh: refreshView(refresh)
    });
  }

  /** `POST /v1/services/{id}/actions/rollback` (rollBackService). */
  function rollBack(service) {
    const refused = unchangeable(service);
    if (refused) return refused;
    if (!service.previousVersion) return failure(409, "no_previous_version", "This service has no previous version to roll back to.");
    const refresh = queueRefresh(service, { kind: "rollback", toVersion: service.previousVersion });
    return answer(202, { service: view(service), refresh: refreshView(refresh) });
  }

  /** `DELETE /v1/services/{id}` (deleteService): its refreshes stop, then it drains and goes. */
  function remove(service) {
    if (service.state !== "deleting") {
      for (const refresh of refreshesOf(service.id).filter((one) => OPEN_REFRESH.includes(one.state))) {
        if (refresh.state !== "queued") refresh.steps.push(stepOf("aborted", null, "The service was deleted."));
        Object.assign(refresh, { state: "aborted", finishedAt: at() });
      }
      patch(service, { state: "deleting" });
    }
    return answer(202, { service: view(service) });
  }

  /** A change whose Idempotency-Key is optional: kept with its answer when given. */
  const idempotent = (key, fingerprint, make) => (key ? once(key, fingerprint, make) : make());

  /** `POST /v1/projects/{p}/apps/{app}/releases` (addProjectRelease): 202 `{ release }`, building. */
  function projectRelease(projectId, app, body, contentSha256) {
    if (!APP_NAME.test(app)) return invalid({ app: "An app's name: a lowercase letter, then up to 40 lowercase letters, digits and hyphens." });
    const made = releases.upload(projectId, app, body, contentSha256);
    return made.refusal ?? answer(202, { release: releases.view(made.release) });
  }

  /**
   * Answers a request about App Services, or null when it is none of them.
   * @param {{ method: string, path: string, params: URLSearchParams, body: any, idempotencyKey?: string, contentSha256?: string, caller: any }} request
   */
  function request({ method, path, params, body, idempotencyKey, contentSha256, caller }) {
    const inProject = /^\/v1\/projects\/([^/]+)\/(services|apps\/([^/]+)\/releases)$/u.exec(path);
    if (inProject) {
      const projectId = decodeURIComponent(inProject[1]);
      if (!world.reaches(caller, projectId)) return notFound("project");
      if (inProject[2] === "services" && method === "POST") return once(idempotencyKey, `${projectId} service ${JSON.stringify(body)}`, () => create(projectId, body));
      if (inProject[2] === "services" && method === "GET") {
        const listed = [...services.values()].filter((one) => one.projectId === projectId && one.state !== "deleted" && labelsMatch(one.labels, params));
        return answer(200, pageOf(listed.reverse().map(view), params));
      }
      if (inProject[3] !== undefined && method === "POST") return projectRelease(projectId, decodeURIComponent(inProject[3]), body, contentSha256);
      return null;
    }
    const servicePath = /^\/v1\/services\/([^/]+)(\/.*)?$/u.exec(path);
    if (!servicePath) return null;
    const service = services.get(decodeURIComponent(servicePath[1]));
    if (!service || service.state === "deleted" || !world.reaches(caller, service.projectId)) return notFound("service");
    const rest = servicePath[2] ?? "";
    const route = `${method} ${rest}`;
    if (route === "GET ") return answer(200, { service: view(service) });
    if (route === "PATCH ") return idempotent(idempotencyKey, `${service.id} change ${JSON.stringify(body)}`, () => change(service, body));
    if (route === "DELETE ") return remove(service);
    if (route === "PUT /settings") return idempotent(idempotencyKey, `${service.id} settings ${JSON.stringify(body)}`, () => putSettings(service, body));
    if (route === "POST /releases") return release(service, body, contentSha256, params.get("task"));
    if (route === "POST /actions/rollback") return idempotent(idempotencyKey, `${service.id} rollback`, () => rollBack(service));
    if (route === "GET /instances") {
      const withRemoved = params.get("removed") === "true";
      const listed = [...instances.values()].filter((one) => one.serviceId === service.id && (one.rotation !== "gone"
        || (withRemoved && Date.parse(one.logsUntil) > now().getTime())));
      return answer(200, pageOf(listed.map((one) => instanceView(service, one)), params));
    }
    if (route === "GET /refreshes") return answer(200, pageOf(refreshesOf(service.id).reverse().map(refreshView), params));
    if (route === "GET /logs") return logs.read(service, params);
    const refreshPath = /^\/refreshes\/([^/]+)$/u.exec(rest);
    if (refreshPath && method === "GET") {
      const refresh = refreshes.get(decodeURIComponent(refreshPath[1]));
      if (!refresh || refresh.serviceId !== service.id) return notFound("refresh");
      return answer(200, { refresh: refreshView(refresh) });
    }
    return null;
  }

  /**
   * A service's refresh ahead (engine-support M14, serviceLinks.js refreshAhead): the refresh in progress (`building`
   * or `rolling`; one runs at a time) when it moves the service to another release than the one it runs (its first, a
   * release, a rollback), with that release's declaration (an upload's, read at its intake). Every refresh still
   * queued runs after it, and an aborting one moves the service nowhere. Null without one.
   * @param {any} service @returns {{ refresh: any, declaration: any } | null}
   */
  function refreshAhead(service) {
    const refresh = refreshesOf(service.id).find((one) => ["building", "rolling"].includes(one.state));
    if (!refresh || !MOVING_KINDS.includes(refresh.kind) || refresh.toVersion === service.version) return null;
    return { refresh, declaration: releaseOf(service, refresh.toVersion)?.declaration ?? null };
  }

  /**
   * A service as a link reaches it (serviceLinks.js linkConsumer): of the hosted service's project and not being
   * deleted, with the declaration of the release it runs (null before its first), its refresh ahead, and `pending`
   * while a move can't be checked yet: that refresh hasn't read its release, or a refresh moving the service is still
   * queued.
   * @param {string} serviceId @param {string} projectId
   */
  function linkConsumer(serviceId, projectId) {
    const service = services.get(serviceId);
    if (!service || service.projectId !== projectId || ["deleting", "deleted"].includes(service.state)) return { refusal: notFound("service") };
    const ahead = refreshAhead(service);
    const queued = refreshesOf(service.id).some((one) => one.state === "queued" && MOVING_KINDS.includes(one.kind));
    return { service, declaration: declarationOf(service), ahead, pending: Boolean((ahead && !ahead.declaration) || queued) };
  }

  /**
   * A link made ahead (M14, serviceLinks.js intoRefreshAhead): its settings and secrets join its refresh ahead's
   * target and each change of settings queued behind it, so none runs without them; the instances that refresh started
   * already are drained (`link_changed`), and its roll starts them again with them.
   * @param {any} service @param {any} ahead the refresh ahead @param {{ settings: Record<string, string>, secrets: Record<string, string> }} values
   */
  function linkSettingsAhead(service, ahead, { settings, secrets }) {
    for (const refresh of [ahead, ...queuedSettings(service.id)]) {
      refresh.target = {
        ...refresh.target,
        settings: { ...(refresh.target.settings ?? service.settings), ...settings },
        secrets: { ...(refresh.target.secrets ?? service.secrets), ...secrets }
      };
    }
    engine.restartFresh(service, ahead, "link_changed");
  }

  /** Takes ended links' settings out of each change of settings still queued (M14, serviceLinks.js dropLinkSettings). */
  function dropLinkSettings(service, names) {
    const kept = (values) => Object.fromEntries(Object.entries(values).filter(([name]) => !names.includes(name)));
    for (const refresh of queuedSettings(service.id)) refresh.target = { ...refresh.target, settings: kept(refresh.target.settings), secrets: kept(refresh.target.secrets) };
  }

  /** A link's settings given to or taken out of a service (serviceLinks.js linkSettings): a settings refresh. */
  function linkSettings(service, { settings = {}, secrets = {}, remove: names = [] }) {
    if (["deleting", "deleted"].includes(service.state)) return { refresh: null };
    const ahead = settingsAhead(service);
    const kept = (values) => Object.fromEntries(Object.entries(values).filter(([name]) => !names.includes(name)));
    return changeOrRefresh(service, { kind: "settings", target: { settings: { ...kept(ahead.settings), ...settings }, secrets: { ...kept(ahead.secrets), ...secrets } } });
  }

  /** Whether a mobilynet project has a live service by that name. */
  function nameTaken(projectId, name) {
    return [...services.values()].some((one) => one.projectId === projectId && one.name === name && one.state !== "deleted");
  }

  /** What a project's live services take of its quotas: their instances asked for, times their sizes. @param {string} projectId */
  function usage(projectId) {
    const used = { vcpus: 0, memoryGib: 0 };
    for (const one of services.values()) {
      if (one.projectId !== projectId || ["deleting", "deleted"].includes(one.state)) continue;
      const took = taking(one.instances, one.size);
      used.vcpus += took.vcpus;
      used.memoryGib += took.memoryGib;
    }
    return used;
  }

  /** The instances a service's route group sends to: those in rotation. @param {string} serviceId */
  const serving = (serviceId) => liveOf(serviceId).filter((one) => one.rotation === "in").map((one) => one.id);

  /** A service with its settings' and secrets' values, as its instances read them, for tests. @param {any} service */
  const heldView = (service) => ({ ...view(service), settings: { ...service.settings }, secrets: { ...service.secrets }, deletedAt: service.deletedAt });

  const controls = Object.freeze({
    /** Every service, deleted ones too, with its settings' and secrets' values. */
    all: () => [...services.values()].map(heldView),
    /** One service with its values, or null. @param {string} id */
    service: (id) => (services.has(id) ? heldView(services.get(id)) : null),
    /**
     * A service's instances, gone ones too, each with the settings and secrets it started with and its own
     * `_mobilynet` (`mobilynet`), as its app reads them. @param {string} id
     */
    instances: (id) => [...instances.values()].filter((one) => one.serviceId === id).map((one) => ({
      ...instanceView(services.get(id), one), settings: { ...one.settings }, secrets: { ...one.secrets }, mobilynet: structuredClone(one.mobilynet), refreshId: one.refreshId
    })),
    /**
     * Sets what an instance's logs say (`GET /v1/services/{id}/logs`), its service's secrets then masked as mobilynet
     * masks them. @param {string} instanceId @param {string} text
     */
    setLogs: (instanceId, text) => logs.set(instanceId, text),
    /** A service's refreshes, oldest first, each with its target. @param {string} id */
    refreshes: (id) => refreshesOf(id).map((one) => ({ ...refreshView(one), target: structuredClone(one.target), ...(one.task ? { task: structuredClone(one.task) } : {}) })),
    /** Whether one service's instances reach another's on a port: a connection of the first to the second. */
    reaches: (fromId, toId, port) => {
      const from = services.get(fromId);
      const to = services.get(toId);
      return Boolean(from && to && ![from.state, to.state].some((state) => ["deleting", "deleted"].includes(state))
        && from.connections.some((connection) => connection.to === toId && connection.port === port));
    }
  });

  return Object.freeze({
    request,
    advance: () => {
      logs.advance();
      engine.advance();
    },
    linkConsumer,
    linkSettings,
    linkSettingsAhead,
    dropLinkSettings,
    nameTaken,
    usage,
    serving,
    useHooks: (given) => Object.assign(hooks, given),
    controls
  });
}

export { SERVICE_LABEL, createStandInServices };
