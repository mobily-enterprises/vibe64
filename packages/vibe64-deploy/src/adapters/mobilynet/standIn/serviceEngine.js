import { EDGE_ADDRESSES, INSTANCE_SIZES, REGIONS, isRecord, randomText } from "./catalogue.js";

// The App Services stand-in's fields and engine (services.js), as mobilynet's machines package checks a service's
// fields (serviceFields.js) and moves a service (serviceEngine.js): each `advance()` takes every service's refresh one
// step on (queued, built, then rolled), keeps a service with no refresh under way at its count, and ends a delete. An
// instance starts with its service's settings and secrets and its own `_mobilynet` (serviceEngine.js: its instance id
// and hostname, private address, service, service id, project id, version and the edge's addresses), which its app
// reads beside them and no declaration can name.

const SERVICE_NAME = /^[a-z](?:[a-z0-9-]{0,38}[a-z0-9])?$/u;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;
const EXPOSURES = Object.freeze(["public", "internal"]);
const LIMITS = Object.freeze({ instances: 100, routes: 20, connections: 20, minDrainSeconds: 30, maxDrainSeconds: 600, logsKeptDays: 7 });
const HEALTH_CHECK_DEFAULTS = Object.freeze({ intervalSeconds: 5, timeoutSeconds: 2, healthyAfter: 2, unhealthyAfter: 3 });
const HEALTH_CHECK_BOUNDS = Object.freeze({ intervalSeconds: [2, 60], timeoutSeconds: [1, 30], healthyAfter: [1, 10], unhealthyAfter: [1, 10] });
const MAX_SECRET = 4096;
// The refreshes that keep the release a service runs (serviceEngine.js SAME_RELEASE; this stand-in has no base change).
const SAME_RELEASE = Object.freeze(["settings", "size"]);
const DAY_MS = 24 * 60 * 60 * 1000;
/** The setting every instance's app gets beside its service's (machines' shared/services.js INSTANCE_SETTING). */
const INSTANCE_SETTING = "_mobilynet";

/** The first service of a release's declaration with a port: the one the load balancer sends to. @param {any} declaration */
function servedOf(declaration) {
  const declared = Array.isArray(declaration?.services) ? declaration.services : [];
  return declared.find((entry) => entry?.port) ?? null;
}

/** A health check as given over the one it had, or its field errors. @param {unknown} given @param {any} current */
function healthCheckOf(given, current) {
  if (!isRecord(given)) return { errors: { healthCheck: "An object of intervalSeconds, timeoutSeconds, healthyAfter and unhealthyAfter." } };
  const check = { ...(current ?? HEALTH_CHECK_DEFAULTS), ...given };
  const errors = {};
  for (const name of Object.keys(given)) if (!Object.hasOwn(HEALTH_CHECK_BOUNDS, name)) errors[`healthCheck.${name}`] = "Not a health check timing.";
  for (const [name, [min, max]] of Object.entries(HEALTH_CHECK_BOUNDS)) {
    if (!Number.isInteger(check[name]) || check[name] < min || check[name] > max) errors[`healthCheck.${name}`] = `A whole number from ${min} to ${max}.`;
  }
  return Object.keys(errors).length > 0 ? { errors } : { check };
}

/** A service's routes as given, or their field errors. @param {unknown} given @param {string} exposure */
function routesOf(given, exposure) {
  if (!Array.isArray(given) || given.length > LIMITS.routes) return { errors: { routes: `A list of up to ${LIMITS.routes} routes.` } };
  if (exposure === "internal" && given.length > 0) return { errors: { routes: "An internal service has no routes: it is reached only inside its project." } };
  const errors = {};
  const hosts = given.map((route, index) => {
    if (!isRecord(route) || typeof route.host !== "string" || !HOSTNAME.test(route.host)) errors[`routes.${index}.host`] = "A hostname, such as shop.example.com.";
    else if ((route.tls ?? "edge") !== "edge") errors[`routes.${index}.tls`] = "A service's routes end TLS at the edge: edge.";
    return isRecord(route) ? route.host : null;
  });
  hosts.forEach((host, index) => {
    if (host && hosts.indexOf(host) !== index) errors[`routes.${index}.host`] = "Named twice.";
  });
  return Object.keys(errors).length > 0 ? { errors } : { routes: given.map((route) => ({ host: route.host, tls: "edge" })) };
}

/** A service's connections as given, or their field errors. @param {unknown} given */
function connectionsOf(given) {
  if (!Array.isArray(given) || given.length > LIMITS.connections) return { errors: { connections: `A list of up to ${LIMITS.connections} connections.` } };
  const errors = {};
  for (const [index, connection] of given.entries()) {
    if (!isRecord(connection) || typeof connection.to !== "string") errors[`connections.${index}.to`] = "The id of a machine or a service of this project.";
    if (!Number.isInteger(connection?.port) || connection.port < 1 || connection.port > 65535) errors[`connections.${index}.port`] = "A port from 1 to 65535.";
  }
  return Object.keys(errors).length > 0 ? { errors } : { connections: given.map((connection) => ({ to: connection.to, port: connection.port })) };
}

/**
 * The fields of a create or change, checked as serviceFields.js checks them; the first wrong one refused, as mobilynet
 * throws on the first. A service's name, region and exposure are its create's alone; its labels are checked apart.
 * @param {(fieldErrors: Record<string, string>) => any} invalid the stand-in's refusal of those fields
 * @param {any} input @param {{ exposure?: string, healthCheck?: any }} [current]
 * @returns {{ refusal: any } | { fields: Record<string, any> }}
 */
function fieldsOf(invalid, input, current = {}) {
  const creating = !current.exposure;
  const fields = {};
  if (creating) {
    if (typeof input.name !== "string" || !SERVICE_NAME.test(input.name)) {
      return { refusal: invalid({ name: "Use 1 to 40 lowercase letters, digits and hyphens, starting with a letter and ending with a letter or digit." }) };
    }
    if (!REGIONS.includes(input.region)) return { refusal: invalid({ region: `Choose one of ${REGIONS.join(", ")}.` }) };
    if (!EXPOSURES.includes(input.exposure ?? "public")) return { refusal: invalid({ exposure: `Either ${EXPOSURES.join(" or ")}.` }) };
    Object.assign(fields, { name: input.name, region: input.region, exposure: input.exposure ?? "public" });
  }
  const exposure = fields.exposure ?? current.exposure;
  if (input.size !== undefined || creating) {
    if (!Object.hasOwn(INSTANCE_SIZES, input.size)) return { refusal: invalid({ size: `Choose one of ${Object.keys(INSTANCE_SIZES).join(", ")}.` }) };
    fields.size = input.size;
  }
  if (input.instances !== undefined || creating) {
    if (!Number.isInteger(input.instances) || input.instances < 1 || input.instances > LIMITS.instances) {
      return { refusal: invalid({ instances: `A whole number from 1 to ${LIMITS.instances}.` }) };
    }
    fields.instances = input.instances;
  }
  if (input.healthCheck !== undefined || creating) {
    const checked = healthCheckOf(input.healthCheck ?? {}, current.healthCheck);
    if (checked.errors) return { refusal: invalid(checked.errors) };
    fields.healthCheck = checked.check;
  }
  if (input.drainSeconds !== undefined || creating) {
    const drain = input.drainSeconds ?? LIMITS.minDrainSeconds;
    if (!Number.isInteger(drain) || drain < LIMITS.minDrainSeconds || drain > LIMITS.maxDrainSeconds) {
      return { refusal: invalid({ drainSeconds: `A whole number of seconds from ${LIMITS.minDrainSeconds} to ${LIMITS.maxDrainSeconds}.` }) };
    }
    fields.drainSeconds = drain;
  }
  if (input.routes !== undefined || creating) {
    const checked = routesOf(input.routes ?? [], exposure);
    if (checked.errors) return { refusal: invalid(checked.errors) };
    fields.routes = checked.routes;
  }
  if (input.connections !== undefined || creating) {
    const checked = connectionsOf(input.connections ?? []);
    if (checked.errors) return { refusal: invalid(checked.errors) };
    fields.connections = checked.connections;
  }
  return { fields };
}

/**
 * Settings as given and secrets, each a secret's text (serviceFields.js valuesOf).
 * @param {(fieldErrors: Record<string, string>) => any} invalid @param {any} input
 */
function valuesOf(invalid, input) {
  const errors = {};
  if (input.settings !== undefined && input.settings !== null && !isRecord(input.settings)) errors.settings = "An object of setting names and values.";
  if (input.secrets !== undefined && input.secrets !== null && !isRecord(input.secrets)) errors.secrets = "An object of secret names and their text.";
  for (const [name, value] of Object.entries(isRecord(input.secrets) ? input.secrets : {})) {
    if (typeof value !== "string" || value.length > MAX_SECRET) errors[`secrets.${name}`] = `Text of up to ${MAX_SECRET} characters.`;
  }
  for (const name of [...Object.keys(isRecord(input.settings) ? input.settings : {}), ...Object.keys(isRecord(input.secrets) ? input.secrets : {})]) {
    if (name === INSTANCE_SETTING) errors[name] = `${INSTANCE_SETTING} is MobilyNet's own setting for each instance.`;
  }
  if (Object.keys(errors).length > 0) return { refusal: invalid(errors) };
  return { values: { settings: { ...(isRecord(input.settings) ? input.settings : {}) }, secrets: { ...(isRecord(input.secrets) ? input.secrets : {}) } } };
}

/** The required settings a declaration declares that the values lack. */
function settingsMissing(declaration, { settings, secrets }) {
  return Object.entries(isRecord(declaration?.settings) ? declaration.settings : {})
    .filter(([name, setting]) => setting?.required === true && settings[name] === undefined && secrets[name] === undefined)
    .map(([name]) => name);
}
const settingsMissingWords = (names) => `The app needs ${names.join(", ")}: give each in settings, or a secret one in secrets.`;

/**
 * Whether a release's declaration takes a service's values (serviceEngine.js releaseRefusal): a public service's app
 * declares a port, and every required setting is given. Null when it takes them.
 */
function releaseRefusal(service, declaration, values) {
  if (service.exposure === "public" && !servedOf(declaration)) return { code: "port_missing", message: "The app declares no service with a port for the load balancer." };
  const missing = settingsMissing(declaration, values);
  return missing.length > 0 ? { code: "settings_missing", message: settingsMissingWords(missing), details: { settings: missing } } : null;
}

/** What a service's instances run now, or what a refresh moves them to. @param {any} service @param {any} [refresh] */
function specOf(service, refresh = null) {
  const target = refresh?.target ?? {};
  return {
    version: refresh ? refresh.toVersion : service.version,
    size: target.size ?? service.size,
    settings: target.settings ?? service.settings,
    secrets: target.secrets ?? service.secrets
  };
}

/**
 * @param {any} world the stand-in's world
 * @param {object} parts the services stand-in's own
 * @param {Map<string, any>} parts.services each service, by id
 * @param {Map<string, any>} parts.instances each instance, by id, in the order started
 * @param {{ advance: () => void }} parts.releases its projects' releases, each built a step on before the services move
 * @param {{ consumerGone: (kind: string, id: string) => void, refreshFailed: (service: any) => void }} parts.hooks what a
 *   deleted service's links do, and a failed refresh's
 * @param {(serviceId: string) => any[]} parts.liveOf a service's instances not gone, oldest first
 * @param {(serviceId: string) => any} parts.currentRefresh a service's refresh under way, or the next queued
 * @param {(service: any, version: string | null) => any} parts.releaseOf the release of a service's app at a version
 * @param {(step: string, instanceId?: string | null, detail?: string | null) => any} parts.stepOf a refresh's step
 * @param {(service: any, changes: Record<string, unknown>) => any} parts.patch a change of a service
 * @param {(service: any, type: string, details: any) => void} parts.event an event of the service's project
 * @param {(service: any) => void} parts.syncRoutes makes a service's route rows what it asks for
 */
function createStandInServiceEngine(world, parts) {
  const { services, instances, releases, hooks, liveOf, currentRefresh, releaseOf, stepOf, patch, event, syncRoutes } = parts;
  const { faults, nextId, at, now } = world;
  let placed = 0;

  /** Starts one instance of a service with what it runs (`spec`) and its own `_mobilynet`, pending until healthy. */
  function startInstance(service, spec, refreshId) {
    const index = placed++;
    const id = nextId("vps");
    const name = `${service.name}-${randomText({ alphabet: "base32", length: 8 })}`;
    const privateAddress = `10.65.${Math.floor(index / 250)}.${(index % 250) + 2}`;
    const instance = {
      id,
      serviceId: service.id,
      name,
      privateAddress,
      state: "creating",
      version: spec.version,
      size: spec.size,
      settings: { ...spec.settings },
      secrets: { ...spec.secrets },
      mobilynet: {
        instanceId: id,
        hostname: name,
        privateAddress,
        service: service.name,
        serviceId: service.id,
        projectId: service.projectId,
        version: spec.version,
        edgeAddresses: [...EDGE_ADDRESSES]
      },
      rotation: "pending",
      health: "unknown",
      healthChangedAt: null,
      healthyAt: null,
      startedAt: at(),
      removedReason: null,
      removedAt: null,
      logsUntil: null,
      refreshId
    };
    instances.set(instance.id, instance);
    return instance;
  }

  /** An instance healthy and in rotation. @param {any} instance */
  function joined(instance) {
    Object.assign(instance, { state: "running", rotation: "in", health: "healthy", healthChangedAt: at(), healthyAt: at() });
  }

  /** An instance removed, its logs kept 7 days. @param {any} instance @param {string} reason */
  function removed(instance, reason) {
    Object.assign(instance, {
      state: "deleted",
      rotation: "gone",
      removedReason: instance.removedReason ?? reason,
      removedAt: at(),
      logsUntil: new Date(now().getTime() + LIMITS.logsKeptDays * DAY_MS).toISOString()
    });
  }

  /** A refresh's end, failed: the service keeps what it ran (serviceEngine.js endRefresh). */
  function failRefresh(service, refresh, error, step) {
    if (step) refresh.steps.push(stepOf(step, null, error.message));
    Object.assign(refresh, { state: "failed", error, finishedAt: at() });
    for (const instance of liveOf(service.id).filter((one) => one.refreshId === refresh.id)) removed(instance, "refresh_failed");
    patch(service, { state: service.version ? "running" : "failed", lastError: error });
    event(service, "service.refresh_failed", { refreshId: refresh.id, kind: refresh.kind, version: refresh.toVersion, error: { code: error.code, message: error.message } });
    hooks.refreshFailed(service);
  }

  /** A refresh's instances started without what a link made since gives them: drained, to be started again. */
  function restartFresh(service, refresh, reason) {
    for (const instance of liveOf(service.id).filter((one) => one.refreshId === refresh.id)) {
      removed(instance, reason);
      refresh.steps.push(stepOf("instance_removed", instance.id, reason));
    }
  }

  /** A refresh's end, succeeded: the service moves onto what it brought. */
  function succeedRefresh(service, refresh) {
    Object.assign(refresh, { state: "succeeded", finishedAt: at() });
    const moved = refresh.toVersion !== service.version;
    const { target } = refresh;
    patch(service, {
      state: "running",
      version: refresh.toVersion,
      previousVersion: moved ? service.version : service.previousVersion,
      ...(target.size ? { size: target.size } : {}),
      ...(target.settings ? { settings: { ...target.settings } } : {}),
      ...(target.secrets ? { secrets: { ...target.secrets } } : {}),
      lastError: null
    });
    syncRoutes(service);
    event(service, "service.refresh_succeeded", { refreshId: refresh.id, kind: refresh.kind, version: refresh.toVersion });
  }

  /**
   * A refresh's task, run once on a temporary instance of what the refresh moves to (its release, settings, secrets and
   * links' settings), never in rotation, before any instance starts (STAND-IN ONLY: the engine's ask of mobilynet, its
   * M-C). The task keeps the names of the settings it ran with. A failure (`releaseTaskFails`: `true`, exit 1; `{
   * exitCode, output }`, those) fails the refresh `release_task_failed` with nothing rolled out. Answers whether it passed.
   */
  function runTask(service, refresh, release) {
    const { task } = refresh;
    const spec = specOf(service, refresh);
    const machine = nextId("vps");
    const declared = release.declaration.tasks?.[task.name] ?? {};
    Object.assign(task, { state: "running", machine, command: declared.command, settings: [...Object.keys(spec.settings), ...Object.keys(spec.secrets)].sort(), startedAt: at() });
    refresh.steps.push(stepOf("task_started", machine, task.name));
    const fault = faults.releaseTaskFails;
    if (fault) {
      const exitCode = fault === true ? 1 : Number(fault.exitCode ?? 1);
      const output = fault === true ? ["Migration failed."] : [...(fault.output ?? [])];
      Object.assign(task, { state: "failed", exitCode, output, finishedAt: at() });
      refresh.steps.push(stepOf("task_failed", machine, `exit ${exitCode}`));
      const last = output.at(-1);
      failRefresh(service, refresh, {
        code: "release_task_failed",
        message: `The release's task ${task.name} exited ${exitCode}${last ? `: ${last}` : "."}`,
        details: { task: task.name, exitCode, output }
      }, null);
      return false;
    }
    Object.assign(task, { state: "succeeded", exitCode: 0, output: [`${task.name}: done`], finishedAt: at() });
    refresh.steps.push(stepOf("task_succeeded", machine, task.name));
    return true;
  }

  /** A building refresh's next step: its release built, or failed, or still building. */
  function build(service, refresh) {
    // A change of settings or size starts on the release the service runs as it starts (serviceEngine.js
    // currentRefresh, SAME_RELEASE), not the one it ran when it was queued: one queued behind a move runs on the
    // release that move brought.
    if (refresh.state === "queued" && SAME_RELEASE.includes(refresh.kind)) Object.assign(refresh, { fromVersion: service.version, toVersion: service.version });
    const release = releaseOf(service, refresh.toVersion);
    if (refresh.state === "queued") {
      Object.assign(refresh, { state: "building", startedAt: at(), buildId: release?.buildId ?? null });
      refresh.steps.push(stepOf("build_started", null, refresh.buildId));
      // A build done already passes in the same step (`instantBuilds`), as mobilynet's reconcile passes a reused one.
      if (!faults.instantBuilds) return;
    }
    if (!release || release.build === "building") return;
    if (release.build === "failed") {
      const message = release.error?.named ? release.error.message : "The release's build or its check failed.";
      failRefresh(service, refresh, { code: "app_build_failed", message, details: { buildId: release.buildId } }, "build_failed");
      return;
    }
    const refused = releaseRefusal(service, release.declaration, specOf(service, refresh));
    if (refused) {
      failRefresh(service, refresh, refused, "build_failed");
      return;
    }
    refresh.steps.push(stepOf("build_passed", null, release.buildId));
    if (refresh.task && !runTask(service, refresh, release)) return;
    refresh.state = "rolling";
    const served = servedOf(release.declaration);
    patch(service, { state: service.version ? "refreshing" : "creating", port: served?.port ?? null, healthPath: served?.healthPath ?? null });
    syncRoutes(service);
  }

  /**
   * A rolling refresh's next step (design 9.4): old instances drained before go; new ones started before join once
   * healthy, each taking one old one out of rotation, or the refresh fails when they never get healthy; then the next
   * new one starts (a create's all at once), until its wanted count of new ones serves alone.
   */
  function roll(service, refresh) {
    for (const instance of liveOf(service.id).filter((one) => one.refreshId !== refresh.id && one.rotation === "draining")) {
      removed(instance, "replaced");
      refresh.steps.push(stepOf("instance_removed", instance.id));
    }
    const fresh = () => liveOf(service.id).filter((one) => one.refreshId === refresh.id);
    const old = () => liveOf(service.id).filter((one) => one.refreshId !== refresh.id);
    const pending = fresh().filter((one) => one.rotation === "pending");
    if (pending.length > 0) {
      if (faults.instancesUnhealthy) {
        for (const instance of pending) refresh.steps.push(stepOf("instance_never_healthy", instance.id), stepOf("instance_draining", instance.id));
        failRefresh(service, refresh, { code: "instance_never_healthy", message: "A new instance never became healthy; the previous version kept serving." }, null);
        return;
      }
      const serving = old().filter((one) => one.rotation === "in");
      for (const [index, instance] of pending.entries()) {
        joined(instance);
        refresh.steps.push(stepOf("instance_healthy", instance.id), stepOf("instance_joined", instance.id));
        if (serving[index]) {
          serving[index].rotation = "draining";
          refresh.steps.push(stepOf("instance_draining", serving[index].id));
        }
      }
      return;
    }
    const inRotation = fresh().filter((one) => one.rotation === "in").length;
    if (inRotation < service.instances) {
      const count = refresh.kind === "create" || old().length === 0 ? service.instances - inRotation : 1;
      for (let made = 0; made < count; made += 1) {
        const instance = startInstance(service, specOf(service, refresh), refresh.id);
        refresh.steps.push(stepOf("instance_started", instance.id));
      }
      return;
    }
    const outOfTurn = old().find((one) => one.rotation !== "draining");
    if (outOfTurn) {
      outOfTurn.rotation = "draining";
      refresh.steps.push(stepOf("instance_draining", outOfTurn.id));
      return;
    }
    if (old().length > 0) return;
    succeedRefresh(service, refresh);
  }

  /**
   * A service with no refresh under way, running a release: drained instances go, pending ones join once healthy
   * (never, with `instancesUnhealthy`), a missing one starts, and one past its count drains.
   */
  function steady(service) {
    if (!service.version || service.state !== "running") return;
    for (const instance of liveOf(service.id).filter((one) => one.rotation === "draining")) removed(instance, "count_lowered");
    if (!faults.instancesUnhealthy) for (const instance of liveOf(service.id).filter((one) => one.rotation === "pending")) joined(instance);
    const serving = liveOf(service.id);
    for (let made = serving.length; made < service.instances; made += 1) startInstance(service, specOf(service), null);
    const inRotation = serving.filter((one) => one.rotation === "in");
    if (inRotation.length > service.instances) inRotation.at(-1).rotation = "draining";
  }

  /** A deleting service's end: its instances and routes gone, `service.deleted`, its links' consumer gone. */
  function finishDelete(service) {
    for (const instance of liveOf(service.id)) removed(instance, "service_deleted");
    patch(service, { state: "deleted", deletedAt: at() });
    syncRoutes(service);
    event(service, "service.deleted", { name: service.name });
    hooks.consumerGone("service", service.id);
  }

  /** Moves every service one step on, after its project's releases built. */
  function advance() {
    releases.advance();
    for (const service of services.values()) {
      if (service.state === "deleted") continue;
      if (service.state === "deleting") {
        finishDelete(service);
        continue;
      }
      const refresh = currentRefresh(service.id);
      if (!refresh) steady(service);
      else if (refresh.state === "queued" || refresh.state === "building") {
        build(service, refresh);
        // mobilynet's reconcile rolls a refresh in the pass its build passed, starting its first instances then.
        if (faults.instantBuilds && refresh.state === "rolling") roll(service, refresh);
      } else if (refresh.state === "rolling") roll(service, refresh);
    }
  }

  return Object.freeze({
    advance,
    restartFresh,
    startInstance
  });
}

export { INSTANCE_SETTING, createStandInServiceEngine, fieldsOf, settingsMissing, settingsMissingWords, specOf, valuesOf };
