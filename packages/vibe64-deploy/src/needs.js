// Production's needs: what a project's app needs to run, read only from its genesis/stack.md and said in no provider's
// words. The editor reads them from the saved commit's Stack (needsOfStack.js): the Deployment section's services (each
// public or internal, its instances, the smallest machine it runs on, the services it reaches, its own settings and
// sandbox allowances), Generated secrets and Setup code, and each `genesis-resource` of `## Resources` with its
// preferred bindings (the names the app reads). Every service uses every resource. An adapter turns them into a priced plan for its provider; nothing here names a provider, a size or a
// price.

// The resource kinds Production runs, each with the binding semantics a declaration may name (public Vibe64's
// resourceEnvironment.js): a database (mysql or postgresql), Redis and an S3 bucket. Any other kind is refused,
// naming the fix in genesis/stack.md.
const NEED_KINDS = Object.freeze({
  mysql: Object.freeze({ title: "MySQL database", bindings: Object.freeze(["host", "port", "database", "username", "password", "url"]) }),
  postgresql: Object.freeze({ title: "PostgreSQL database", bindings: Object.freeze(["host", "port", "database", "username", "password", "url"]) }),
  redis: Object.freeze({ title: "Redis", bindings: Object.freeze(["url"]) }),
  bucket: Object.freeze({ title: "File bucket", bindings: Object.freeze(["bucket", "region", "endpoint", "accessKeyId", "secretAccessKey", "driver"]) })
});
// The Deployment grammar's own limits on a service's `- Instances:` and on its services.
const INSTANCES_LIMIT = 100;
const SERVICES_MAX = 8;
const SERVICE_ID = /^[a-z][a-z0-9-]{0,15}$/u;
const SANDBOX_ALLOWANCES = Object.freeze(["fuse", "gvisor"]);
// The settings Production gives every service itself, and the instance facts (V64_*): no service sets one. Nor does
// one set STAGING_REACHES_REAL_PEOPLE, which only a host's Staging that real people use is given, or APP_REDIRECT_HOSTS,
// the domain's other names Production gives the public service.
const HOST_SETTINGS = Object.freeze([
  "APP_ENV", "STAGING_REACHES_REAL_PEOPLE", "HOST", "PORT", "APP_PUBLIC_URL", "TRUSTED_PROXIES", "APP_REDIRECT_HOSTS"
]);
// Nor SIDE_EFFECTS, which APP_ENV replaced: a JSKIT app refuses to start while it is set.
const RETIRED_SETTINGS = Object.freeze(["SIDE_EFFECTS"]);
const RESOURCES_MAX = 8;
const SECRETS_MAX = 20;
const RESOURCE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/u;
const SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
// The fix every refusal of the Stack names: the coding agent can make it.
const STACK_FIX = "Declare it in genesis/stack.md (the coding agent can do this), Save, then deploy to production.";

/**
 * Why `needs` is not Production's needs shape, or "": `{ services: [{ id, exposure, reached, instances: { min, max,
 * start }, atLeast, reaches: [{ service, setting }], settings, sandbox, builtWith? }], resources: [{ id, kind, bindings }],
 * supplied: [{ id, kind, settings, allowEmpty }], generatedSecrets, setupCode }`, each binding a semantic of its kind
 * naming a setting, no setting bound twice. `supplied` are the resources Production does not make, whose settings the
 * person enters in the Production Env (`allowEmpty` those that may stay empty).
 * @param {unknown} needs
 */
function needsProblem(needs) {
  if (!isRecord(needs)) return "needs is an object.";
  const unknown = Object.keys(needs).find((key) => !["services", "resources", "supplied", "generatedSecrets", "setupCode"].includes(key));
  if (unknown) return `needs has no field "${unknown}".`;
  if (!Array.isArray(needs.resources) || needs.resources.length > RESOURCES_MAX) return `needs.resources lists at most ${RESOURCES_MAX}.`;
  const ids = new Set();
  const bound = new Set();
  for (const resource of needs.resources) {
    if (!isRecord(resource) || !RESOURCE_ID.test(String(resource.id || "")) || ids.has(resource.id)) {
      return "Each of needs.resources has its own id, such as database.";
    }
    ids.add(resource.id);
    const kind = NEED_KINDS[resource.kind];
    if (!Object.hasOwn(NEED_KINDS, String(resource.kind)) || !kind) return `needs.resources ${resource.id} is one of ${Object.keys(NEED_KINDS).join(", ")}.`;
    const bindings = Object.entries(isRecord(resource.bindings) ? resource.bindings : {});
    if (bindings.length === 0) return `needs.resources ${resource.id} binds at least one setting.`;
    for (const [semantic, name] of bindings) {
      if (!kind.bindings.includes(semantic) || !SETTING_NAME.test(String(name || "")) || bound.has(name)) {
        return `needs.resources ${resource.id} binds ${semantic}, which a ${resource.kind} resource has not, or a setting bound twice.`;
      }
      bound.add(name);
    }
  }
  if (!Array.isArray(needs.supplied) || needs.supplied.length > RESOURCES_MAX) return `needs.supplied lists at most ${RESOURCES_MAX}.`;
  for (const resource of needs.supplied) {
    const names = (list) => Array.isArray(list) && list.length <= 20 && list.every((name) => SETTING_NAME.test(String(name || "")) && !bound.has(name));
    if (!isRecord(resource) || !RESOURCE_ID.test(String(resource.id || "")) || ids.has(resource.id) || typeof resource.kind !== "string"
      || !names(resource.settings) || !names(resource.allowEmpty)) {
      return "Each of needs.supplied is { id, kind, settings, allowEmpty }, its own id and settings no resource binds.";
    }
    ids.add(resource.id);
  }
  const secrets = needs.generatedSecrets;
  if (!Array.isArray(secrets) || secrets.length > SECRETS_MAX || secrets.some((name) => !SETTING_NAME.test(String(name || "")) || bound.has(name))) {
    return `needs.generatedSecrets lists at most ${SECRETS_MAX} settings' names, none a resource's.`;
  }
  if (typeof needs.setupCode !== "string" || (needs.setupCode && (!SETTING_NAME.test(needs.setupCode) || bound.has(needs.setupCode)))) {
    return "needs.setupCode is a setting's name, or empty.";
  }
  const given = new Set([...secrets, needs.setupCode].filter(Boolean));
  return servicesProblem(needs.services, bound, given);
}

/**
 * Why `services` are not the needs' services, or "": 1 to 8, each id once, exactly one public; `reached` each only
 * when internal; 1 <= min <= start <= max <= 100; `atLeast` null or whole positive numbers; each `reaches` another of
 * these services under a setting of its own; `settings` its own; `sandbox` from the closed set. A service's own setting
 * is never one the host gives, a resource binds, a generated secret or the setup code.
 * @param {unknown} services @param {Set<string>} bound @param {Set<string>} given
 */
function servicesProblem(services, bound, given) {
  if (!Array.isArray(services) || services.length < 1 || services.length > SERVICES_MAX) return `needs.services lists 1 to ${SERVICES_MAX}.`;
  const ids = services.map((service) => (isRecord(service) ? service.id : undefined));
  if (ids.some((id) => !SERVICE_ID.test(String(id || ""))) || new Set(ids).size !== ids.length) {
    return "Each of needs.services has its own id: a lowercase letter, then up to 15 lowercase letters, digits and hyphens.";
  }
  if (services.filter((service) => service.exposure === "public").length !== 1) return "needs.services has exactly one public service.";
  for (const service of services) {
    const at = `needs.services ${service.id}`;
    const unknown = Object.keys(service).find((key) => !["id", "exposure", "reached", "instances", "atLeast", "reaches", "settings", "sandbox", "builtWith"].includes(key));
    if (unknown) return `${at} has no field "${unknown}".`;
    // The service whose build it shares (builds.js), which leads its own; none from before shared builds: its own.
    const lead = services.find((one) => one.id === (service.builtWith ?? service.id));
    if (!lead || (lead.builtWith ?? lead.id) !== lead.id) return `${at} is built with itself or with a service built with itself.`;
    if (!["public", "internal"].includes(service.exposure)) return `${at} is public or internal.`;
    if (!["any", "each"].includes(service.reached) || (service.reached === "each" && service.exposure !== "internal")) {
      return `${at} is reached at any instance, or at each instance when it is internal.`;
    }
    const { min, max, start } = isRecord(service.instances) ? service.instances : {};
    if (![min, max, start].every(Number.isInteger) || !(min >= 1 && min <= start && start <= max && max <= INSTANCES_LIMIT)) {
      return `${at} runs 1 <= min <= start <= max <= ${INSTANCES_LIMIT} instances.`;
    }
    const atLeast = service.atLeast;
    if (atLeast !== null && !(isRecord(atLeast) && Object.keys(atLeast).length === 2
      && [atLeast.vcpus, atLeast.memoryGib].every((value) => Number.isInteger(value) && value > 0))) {
      return `${at} needs at least whole positive vCPUs and GiB, or nothing.`;
    }
    const names = new Set();
    const own = (name) => {
      const ok = SETTING_NAME.test(String(name || "")) && !names.has(name) && !bound.has(name) && !given.has(name)
        && !HOST_SETTINGS.includes(name) && !RETIRED_SETTINGS.includes(name) && !String(name).startsWith("V64_");
      names.add(name);
      return ok;
    };
    if (!Array.isArray(service.reaches) || !service.reaches.every((reach) => isRecord(reach) && reach.service !== service.id
      && ids.includes(reach.service) && own(reach.setting))) {
      return `${at} reaches other services of these needs, each under a setting of its own that no resource binds and the host doesn't give.`;
    }
    if (!isRecord(service.settings) || !Object.entries(service.settings).every(([name, value]) => typeof value === "string" && own(name))) {
      return `${at} settings are its own: names no resource binds, the host doesn't give and no other of its settings uses.`;
    }
    if (!Array.isArray(service.sandbox) || service.sandbox.some((allowance) => !SANDBOX_ALLOWANCES.includes(allowance))) {
      return `${at} sandbox allows only ${SANDBOX_ALLOWANCES.join(" and ")}.`;
    }
  }
  return "";
}

/** The settings a made resource's bindings fill: Production sets them, so the Production Env may not. @param {{ resources: any[] }} needs */
function boundSettings(needs) {
  return new Set(needs.resources.flatMap((resource) => Object.values(resource.bindings)));
}

/**
 * The app's name at the provider: the Vibe64 project's own name as a provider's app name takes it (a lowercase letter,
 * then up to 31 lowercase letters, digits and hyphens), never a name guessed from the app's files. Both ends make it.
 * @param {string} project
 */
function productionAppName(project) {
  const name = String(project || "").toLowerCase().replace(/[^a-z0-9-]/gu, "-");
  return (/^[a-z]/u.test(name) ? name : `p-${name}`).slice(0, 32).replace(/-+$/u, "");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { HOST_SETTINGS, INSTANCES_LIMIT, NEED_KINDS, SERVICES_MAX, STACK_FIX, boundSettings, needsProblem, productionAppName };
