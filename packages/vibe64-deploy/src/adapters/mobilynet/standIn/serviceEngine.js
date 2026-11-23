import { runtimeSets } from "../declaration.js";
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
const LIMITS = Object.freeze({ instances: 100, routes: 20, connections: 20, minDrainSeconds: 30, maxDrainSeconds: 600, logsKeptDays: 2 });
// How long a release task may run: its machine's start step's limit (machines' SERVICE_LIMITS.taskSeconds).
const TASK_SECONDS = 280;
// What a release task's failure says it did, by its outcome (machines' serviceTasks.js FAILURES).
const TASK_FAILURES = Object.freeze({ failed: "exited with an error", timeout: `ran past its ${TASK_SECONDS} seconds`, machine_failed: "couldn't run: its machine failed" });
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
    else if (![undefined, true, false].includes(route.take)) errors[`routes.${index}.take`] = "true to move the name's route from what it sends to now, or false.";
    return isRecord(route) ? route.host : null;
  });
  hosts.forEach((host, index) => {
    if (host && hosts.indexOf(host) !== index) errors[`routes.${index}.host`] = "Named twice.";
  });
  return Object.keys(errors).length > 0 ? { errors } : { routes: given.map((route) => ({ host: route.host, tls: "edge", take: route.take === true })) };
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
 * throws on the first. A service's name, region and exposure are its create's alone; its tags are checked apart.
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

/**
 * What a release brings of its service's settings (mobilynet main c3575399, serviceFields.js releaseValuesOf): its
 * `settings` and `secrets`, checked as a create's, and the names `remove` takes out (up to 200, each up to 64
 * characters); `brought` null when it brings none. A name both given and removed is refused.
 * @param {(fieldErrors: Record<string, string>) => any} invalid @param {any} input
 */
function broughtOf(invalid, input) {
  if ([input.settings, input.secrets, input.remove].every((given) => given === undefined || given === null)) return { brought: null };
  const values = valuesOf(invalid, input);
  if (values.refusal) return values;
  const remove = input.remove ?? [];
  if (!Array.isArray(remove) || remove.length > 200 || remove.some((name) => typeof name !== "string" || name.length === 0 || name.length > 64)) {
    return { refusal: invalid({ remove: "Up to 200 names of settings or secrets, each up to 64 characters." }) };
  }
  const both = remove.filter((name) => Object.hasOwn(values.values.settings, name) || Object.hasOwn(values.values.secrets, name));
  if (both.length > 0) return { refusal: invalid(Object.fromEntries(both.map((name) => [`remove.${name}`, "Given a value too: set it or remove it."]))) };
  return { brought: { ...values.values, remove: [...new Set(remove)].sort() } };
}

/**
 * A service's settings and secrets with what a release brings (serviceFields.js withReleaseValues): each name it sets
 * in place of the service's value, plain or secret, and each it removes gone. @param {any} service @param {any} brought
 */
function withBrought(service, { settings, secrets, remove }) {
  const gone = new Set([...remove, ...Object.keys(settings), ...Object.keys(secrets)]);
  const kept = (values) => Object.fromEntries(Object.entries(values ?? {}).filter(([name]) => !gone.has(name)));
  return { settings: { ...kept(service.settings), ...settings }, secrets: { ...kept(service.secrets), ...secrets } };
}

/**
 * The field errors of a replace's names the release a service runs doesn't declare (mobilynet's open settings, 19 Nov,
 * appSettings.js undeclaredProblem): each is taken as a plain setting or a secret, its value text of up to 4096
 * characters, but not a name mobilynet's runtime sets on every instance (the adapter's runtimeSets: PATH, HOME, LANG,
 * GIT_CONFIG_COUNT, GIT_CONFIG_KEY_*, GIT_CONFIG_VALUE_*, MOBILYNET_*), nor, in this stand-in, one a need's link sets.
 * mobilynet leaves V64_* names open, which are Vibe64's own. Null when none is refused.
 * @param {string[]} declared the names the release declares, its needs' settings among them
 * @param {string[]} linked the names a need's link sets, a refresh ahead's too
 * @param {{ settings: Record<string, unknown>, secrets: Record<string, unknown> }} target the settings and secrets replaced
 */
function undeclaredErrors(declared, linked, target) {
  const errors = {};
  for (const field of ["settings", "secrets"]) {
    for (const [name, value] of Object.entries(target[field]).filter(([one]) => !declared.includes(one))) {
      const sets = runtimeSets(name);
      if (linked.includes(name)) errors[`${field}.${name}`] = "The app declares no such setting.";
      else if (sets) {
        errors[`${field}.${name}`] = sets === name ? `MobilyNet sets ${name} itself on every instance: name it otherwise.`
          : `MobilyNet's own names start with ${sets}, which it sets on every instance: name it otherwise.`;
      } else if (typeof value !== "string" || value.length > MAX_SECRET) errors[`${field}.${name}`] = `Text of up to ${MAX_SECRET} characters.`;
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * A replace's refusal when the service would hold more than its region's limit of settings and secrets in all, its
 * links' among them (serviceFields.js checkSettings), or null.
 * @param {{ settings: Record<string, unknown>, secrets: Record<string, unknown> }} target the settings and secrets replaced
 * @param {number} most how many an App Service of its region holds now (the stand-in's settingsMax)
 */
function tooManySettings(target, most) {
  const held = Object.keys(target.settings).length + Object.keys(target.secrets).length;
  return held > most ? { settings: `At most ${most} settings and secrets in all, its links' among them, `
    + `as an instance takes no more: these would be ${held}.` } : null;
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
 * @param {{ advance: () => void, rebuild: (release: any) => void }} parts.releases its projects' releases, each built a
 *   step on before the services move
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
  const { services, instances, releases, logs, hooks, liveOf, currentRefresh, releaseOf, stepOf, patch, event, syncRoutes } = parts;
  const { faults, nextId, at, now } = world;
  let placed = 0;

  /** Whether an instance never gets healthy: every one, or those `instancesUnhealthy`'s function picks. @param {any} instance */
  const unhealthy = (instance) => (typeof faults.instancesUnhealthy === "function"
    ? faults.instancesUnhealthy(instance) === true : Boolean(faults.instancesUnhealthy));

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

  /** An instance removed, its logs kept 2 days. @param {any} instance @param {string} reason */
  function removed(instance, reason) {
    Object.assign(instance, {
      state: "deleted",
      rotation: "gone",
      removedReason: instance.removedReason ?? reason,
      removedAt: at(),
      logsUntil: new Date(now().getTime() + LIMITS.logsKeptDays * DAY_MS).toISOString()
    });
  }

  /** A refresh's release task's instance, while it lives. @param {any} refresh */
  const taskInstanceOf = (refresh) => [...instances.values()].find((one) => one.refreshId === refresh.id && one.rotation === "task") ?? null;

  /** A refresh's end, failed: the service keeps what it ran (serviceEngine.js endRefresh). */
  function failRefresh(service, refresh, error, step) {
    if (step) refresh.steps.push(stepOf(step, null, error.message));
    Object.assign(refresh, { state: "failed", error, finishedAt: at() });
    const tasked = taskInstanceOf(refresh);
    if (tasked) removed(tasked, "task_ended");
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

  /**
   * An aborting refresh's end, at the next step after its abort (serviceEngine.js roll, aborted): its release task's
   * instance and its new instances go, and the service keeps what it ran, as a failed refresh leaves it but with no
   * error. Its build goes on: only an End of the build ends it.
   */
  function endAborted(service, refresh) {
    const tasked = taskInstanceOf(refresh);
    if (tasked) removed(tasked, "task_ended");
    for (const instance of liveOf(service.id).filter((one) => one.refreshId === refresh.id)) {
      removed(instance, "refresh_failed");
      refresh.steps.push(stepOf("instance_draining", instance.id));
    }
    refresh.steps.push(stepOf("aborted"));
    Object.assign(refresh, { state: "aborted", finishedAt: at() });
    patch(service, { state: service.version ? "running" : "failed", lastError: null });
    event(service, "service.refresh_aborted", { refreshId: refresh.id, kind: refresh.kind, version: refresh.toVersion });
    hooks.refreshFailed(service);
  }

  /**
   * A refresh aborted (`POST .../refreshes/{rid}/actions/abort`, machines' serviceRefreshCalls.js abortRefresh): a
   * queued one ends `aborted` at once; one building or rolling is `aborting` until the next step ends it (endAborted).
   * False for one that ended or is aborting already, which mobilynet refuses `409 refresh_not_running`.
   */
  function abort(service, refresh) {
    if (!["queued", "building", "rolling"].includes(refresh.state)) return false;
    if (refresh.state !== "queued") refresh.state = "aborting";
    else {
      Object.assign(refresh, { state: "aborted", finishedAt: at() });
      event(service, "service.refresh_aborted", { refreshId: refresh.id, kind: refresh.kind });
      hooks.refreshFailed(service);
    }
    return true;
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
   * A refresh's release task (machines' serviceTasks.js run), after its build passed and before any instance starts:
   * one the release doesn't declare fails the refresh `release_task_not_declared`; else, at one pass, an instance of
   * what the refresh moves to (its release, settings, secrets and links' settings) starts with the task's command as
   * its start (rotation `task`, none of the service's instances: never in rotation or counted), step `task_started`;
   * at the next, it passed (`task_succeeded`) or, while `releaseTaskFails` is on (`true`, an exit; `{ outcome, output
   * }`, `failed`, `timeout` or `machine_failed`, its output the instance's logs), failed the refresh
   * `release_task_failed` with nothing rolled out. Either way its instance is removed, its logs kept. Answers whether
   * the refresh rolls now. STAND-IN ONLY: the task's command runs nothing; its instance's logs say it ran unless
   * `releaseTaskFails` gives them.
   */
  function runTask(service, refresh, release) {
    const name = refresh.task;
    if (refresh.steps.some((one) => one.step === "task_succeeded")) return true;
    if (!Object.hasOwn(release.declaration.tasks ?? {}, name)) {
      const message = `The release declares no release task ${JSON.stringify(name)}: name it under tasks in its mobilynet.json.`;
      failRefresh(service, refresh, { code: "release_task_not_declared", message, details: { task: name } }, "task_failed");
      return false;
    }
    const started = refresh.steps.find((one) => one.step === "task_started");
    if (!started) {
      const instance = startInstance(service, specOf(service, refresh), refresh.id);
      Object.assign(instance, { rotation: "task", task: name });
      logs.set(instance.id, `${name}: ${release.declaration.tasks[name].command}\n`);
      refresh.steps.push(stepOf("task_started", instance.id, name));
      return false;
    }
    const instance = instances.get(started.instanceId);
    const fault = faults.releaseTaskFails;
    removed(instance, "task_ended");
    if (fault) {
      const outcome = fault === true ? "failed" : String(fault.outcome ?? "failed");
      if (fault !== true && fault.output) logs.set(instance.id, `${fault.output.join("\n")}\n`);
      const message = `The release task ${name} ${TASK_FAILURES[outcome]}; nothing rolled out. Its output: GET /v1/services/${service.id}/logs?only=${instance.id}.`;
      failRefresh(service, refresh, { code: "release_task_failed", message, details: { task: name, instanceId: instance.id, outcome } }, "task_failed");
      return false;
    }
    refresh.steps.push(stepOf("task_succeeded", instance.id, name));
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
      // A release whose build was ended is built again as its next refresh starts, as mobilynet's serviceEngine.js
      // currentRefresh builds one whose build failed. STAND-IN ONLY: only an ended build, so that one failing as the
      // stand-in moves on, before the refresh asked with it starts, fails that refresh as before.
      if (release?.build === "failed" && release.error?.code === "cancelled") releases.rebuild(release);
      // A release that brings settings starts from the service's as they are now, with them (mobilynet's
      // currentRefresh): its instances and task start with them, the version it runs keeps its own, and the service
      // takes them only once it succeeded.
      if (refresh.brought) refresh.target = { ...refresh.target, ...withBrought(service, refresh.brought) };
      Object.assign(refresh, { state: "building", startedAt: at(), buildId: release?.buildId ?? null });
      refresh.steps.push(stepOf("build_started", null, refresh.buildId));
      // A build done already passes in the same step (`instantBuilds`), as mobilynet's reconcile passes a reused one.
      if (!faults.instantBuilds) return;
    }
    if (!release || release.build === "queued" || release.build === "building") return;
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
    if (!refresh.steps.some((one) => one.step === "build_passed")) refresh.steps.push(stepOf("build_passed", null, release.buildId));
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
      const sick = pending.filter(unhealthy);
      if (sick.length > 0) {
        for (const instance of sick) refresh.steps.push(stepOf("instance_never_healthy", instance.id), stepOf("instance_draining", instance.id));
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
   * (never, those `instancesUnhealthy` picks), a missing one starts, and one past its count drains.
   */
  function steady(service) {
    if (!service.version || service.state !== "running") return;
    for (const instance of liveOf(service.id).filter((one) => one.rotation === "draining")) removed(instance, "count_lowered");
    for (const instance of liveOf(service.id).filter((one) => one.rotation === "pending" && !unhealthy(one))) joined(instance);
    const serving = liveOf(service.id);
    for (let made = serving.length; made < service.instances; made += 1) startInstance(service, specOf(service), null);
    const inRotation = serving.filter((one) => one.rotation === "in");
    if (inRotation.length > service.instances) inRotation.at(-1).rotation = "draining";
  }

  /** A deleting service's end: its instances and routes gone, `service.deleted`, its links' consumer gone. */
  function finishDelete(service) {
    for (const instance of liveOf(service.id)) removed(instance, "service_deleted");
    for (const instance of [...instances.values()].filter((one) => one.serviceId === service.id && one.rotation === "task")) removed(instance, "task_ended");
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
      else if (refresh.state === "aborting") endAborted(service, refresh);
    }
  }

  return Object.freeze({
    abort,
    advance,
    restartFresh,
    startInstance
  });
}

export { INSTANCE_SETTING, broughtOf, createStandInServiceEngine, fieldsOf, settingsMissing, settingsMissingWords, specOf, tooManySettings, undeclaredErrors, valuesOf, withBrought };
