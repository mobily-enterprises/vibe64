// A Deployment's `### Service` and `### Resource` parts: each service's lines, the checks between services once the
// section is read, and those that need the Stack's `## Resources`.
import { DEPLOYMENT_SERVICE_ID, DEPLOYMENT_SERVICES_MAX } from "../shared/deploymentServiceNames.js";
import {
  STACK_RESOURCE_ID,
  backtickedArguments,
  httpReadinessLine,
  oneLineText,
  stackResourcesById,
  unknownEntryMessage
} from "./stackOperation.js";
import {
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  ENVIRONMENT_NAME,
  ERROR_CODE,
  HOST_OWNED_ENVIRONMENT,
  INSTANCES_MAX,
  INSTANCES_PREFIX,
  PACKAGES_PREFIX,
  PRODUCTION_PREFIX,
  SANDBOX_ALLOWS_PREFIX,
  SIGNED_RELEASE_PREFIX,
  STEP_LINE,
  VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES,
  deploymentStep,
  invalid,
  packages,
  sandboxAllowances
} from "./deploymentEntries.js";

// Services: each kind of process of the application (their ids and count: shared/deploymentServiceNames.js).
const SERVICE_HEADING = /^### Service `([^`\r\n]*)`:[ \t]+(.+)$/u;
const RESOURCE_HEADING = /^### Resource `([^`\r\n]*)`$/u;
const SERVICE_ID = DEPLOYMENT_SERVICE_ID;
const SERVICES_MAX = DEPLOYMENT_SERVICES_MAX;
// Public: behind a load balancer at the environment's address. Internal: no public address, reached only over the
// private network by the services that name it.
const SERVICE_EXPOSURES = Object.freeze(["public", "internal"]);
// Whether the services that reach an internal one reach any of its instances, or each one by its own address.
const SERVICE_REACHED = Object.freeze({ "any instance": "any", "each instance": "each" });
const SERVICE_PRODUCTION_UNITS = /^- Production: `([^`\r\n]*)` instances?$/u;
const SERVICE_INSTANCES = /^- Instances: `([^`\r\n]*)` to `([^`\r\n]*)`$/u;
const SERVICE_NEEDS_AT_LEAST = /^- Needs at least: `([^`\r\n]*)` vCPU, `([^`\r\n]*)` GiB memory$/u;
const SERVICE_REACHES = /^- Reaches: `([^`\r\n]*)` as `([^`\r\n]*)`$/u;
const SERVICE_SETTING = /^- Setting `([^`\r\n]*)`:[ \t]+(.+)$/u;
const ONE_VALUE = (label) => new RegExp(`^- ${label}: \`([^\`\\r\\n]*)\`$`, "u");
const SERVICE_EXPOSURE = ONE_VALUE("Exposure");
const SERVICE_REACHED_LINE = ONE_VALUE("Reached");
const RESOURCE_DEVELOPMENT = ONE_VALUE("Development");
// How development provides a bucket: the app keeps its files in its own folder, or the person enters a bucket's
// settings (the default).
const RESOURCE_DEVELOPMENT_MODES = Object.freeze(["local folder", "own bucket"]);
// The settings a host gives every service itself, and its instance facts (V64_*): no service's Reaches or Setting
// names one. Nor does one name STAGING_REACHES_REAL_PEOPLE, which a host gives a Staging only while its owner marks
// that real people use it.
const HOST_OWNED_SETTINGS = Object.freeze(["APP_ENV", "HOST", "PORT", "APP_PUBLIC_URL", "TRUSTED_PROXIES"]);
const HOST_OWNED_SETTING_PREFIX = "V64_";
const STAGING_REAL_PEOPLE_SETTING = "STAGING_REACHES_REAL_PEOPLE";
// The domain's other names, which Production gives the public service while its domain has any.
const REDIRECT_SETTING = "APP_REDIRECT_HOSTS";

const DEPLOYMENT_HEADING_FORMS = Object.freeze(["### Service `id`: summary", "### Resource `id`"]);
const DEPLOYMENT_SERVICE_ENTRY_FORMS = Object.freeze([
  "- Exposure: `public` or `internal`",
  "- Serve `label`: `command` `argument`...",
  "- Ready when: `GET` `/path` returns `200`",
  "- Instances: `min` to `max`",
  "- Needs at least: `N` vCPU, `N` GiB memory",
  "- Production: `N` instances",
  "- Reached: `any instance` or `each instance`",
  "- Reaches: `service` as `SETTING`",
  "- Setting `NAME`: `value`",
  `${PACKAGES_PREFIX}\`package\`...`,
  `${SANDBOX_ALLOWS_PREFIX}${VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES.map((name) => `\`${name}\``).join(" ")}`
]);
const DEPLOYMENT_RESOURCE_ENTRY_FORMS = Object.freeze([
  `- Development: ${RESOURCE_DEVELOPMENT_MODES.map((mode) => `\`${mode}\``).join(" or ")}`
]);
// The entries a Deployment with services keeps above its first heading, shared by every service.
const SHARED_ENTRY_FORMS = Object.freeze(DEPLOYMENT_ENTRY_FORMS.filter((form) => (
  ![SANDBOX_ALLOWS_PREFIX, INSTANCES_PREFIX, "- Ready when: "].some((prefix) => form.startsWith(prefix))
)).map((form) => form.replace(`|${DEPLOYMENT_STEP_ROLES.at(-1)} `, " ")));


/** Why a setting's name can't be a service's own, or "". @param {string} name */
function hostOwnedSetting(name) {
  if (HOST_OWNED_SETTINGS.includes(name)) return `${name} is a setting the host gives every service itself`;
  if (name === STAGING_REAL_PEOPLE_SETTING) {
    return `${name} is the host's, given to a Staging only while the project's owner marks that real people use it`;
  }
  if (name === REDIRECT_SETTING) return `${name} is the host's, given to the public service while its domain has other names`;
  if (name.startsWith(HOST_OWNED_SETTING_PREFIX)) {
    return `${name} starts with ${HOST_OWNED_SETTING_PREFIX}, which names the facts the host gives each instance`;
  }
  return "";
}

function serviceDraft(match, deploymentPath, line, services) {
  const id = match[1];
  if (!SERVICE_ID.test(id)) {
    invalid(
      deploymentPath,
      `A service's id is a lowercase letter, then up to 15 lowercase letters, digits and hyphens, such as \`web\`; ${JSON.stringify(id)} isn't one.`,
      line
    );
  }
  if (services.some((service) => service.id === id)) invalid(deploymentPath, `Deployment declares service \`${id}\` twice.`, line);
  if (services.length === SERVICES_MAX) invalid(deploymentPath, `A Deployment declares at most ${SERVICES_MAX} services.`, line);
  return {
    id,
    summary: oneLineText(match[2], ERROR_CODE, deploymentPath, "Service summary", line),
    line,
    lines: {},
    settingLines: {},
    exposure: "",
    reached: "",
    serve: null,
    readyWhen: null,
    instances: null,
    production: null,
    atLeast: null,
    reaches: [],
    settings: {},
    packages: [],
    sandboxAllowances: []
  };
}

function wholeNumber(value, { min = 1, max = 100 } = {}) {
  return /^[1-9][0-9]{0,3}$/u.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
}

// One line under `### Service`; `fail` refuses with the service named.
function parseServiceLine(service, source, deploymentPath, line) {
  const fail = (message) => invalid(deploymentPath, `Service \`${service.id}\`: ${message}`, line);
  const once = (field) => {
    if (Object.hasOwn(service.lines, field)) fail(`it has a second ${field} line.`);
    service.lines[field] = line;
  };
  const step = source.match(STEP_LINE);
  if (step) {
    if (step[1] !== "Serve") {
      fail(`${step[1]} is the whole Deployment's, since one build serves every service: put it above the first ### heading.`);
    }
    once("Serve");
    const serve = deploymentStep(step, deploymentPath, line);
    service.serve = { label: serve.label, argv: serve.argv };
    return;
  }
  if (source.startsWith("- Exposure: ")) {
    once("Exposure");
    service.exposure = source.match(SERVICE_EXPOSURE)?.[1] ?? "";
    if (!SERVICE_EXPOSURES.includes(service.exposure)) fail("Exposure is `public` or `internal`.");
    return;
  }
  if (source.startsWith("- Reached: ")) {
    once("Reached");
    service.reached = SERVICE_REACHED[source.match(SERVICE_REACHED_LINE)?.[1]] ?? "";
    if (!service.reached) fail("Reached is `any instance` or `each instance`.");
    return;
  }
  if (source.startsWith("- Ready when: ")) {
    once("Ready when");
    const readiness = httpReadinessLine(source, ERROR_CODE, deploymentPath, `Service \`${service.id}\` readiness`, line);
    service.readyWhen = { method: readiness.method, path: readiness.path, status: readiness.status };
    return;
  }
  if (source.startsWith("- Instances: ")) {
    once("Instances");
    const match = source.match(SERVICE_INSTANCES);
    const min = wholeNumber(match?.[1] ?? "", { max: INSTANCES_MAX });
    const max = wholeNumber(match?.[2] ?? "", { max: INSTANCES_MAX });
    if (min === null || max === null || min > max) {
      fail(`Instances is a range of whole numbers from 1 to ${INSTANCES_MAX}, the least first, such as \`- Instances: \`1\` to \`6\`\`.`);
    }
    service.instances = { min, max };
    return;
  }
  if (source.startsWith("- Needs at least: ")) {
    once("Needs at least");
    const match = source.match(SERVICE_NEEDS_AT_LEAST);
    const vcpus = wholeNumber(match?.[1] ?? "", { max: 1024 });
    const memoryGib = wholeNumber(match?.[2] ?? "", { max: 4096 });
    if (vcpus === null || memoryGib === null) {
      fail("Needs at least takes whole numbers of vCPUs and GiB, such as `- Needs at least: `2` vCPU, `4` GiB memory`.");
    }
    service.atLeast = { vcpus, memoryGib };
    return;
  }
  if (source.startsWith(`${PRODUCTION_PREFIX}managed by `)) {
    fail("who manages Production is the whole Deployment's: put `- Production: managed by` above the first ### heading.");
  }
  if (source.startsWith(SIGNED_RELEASE_PREFIX)) {
    fail("a signed release is the whole Deployment's: put `- Signed release` above the first ### heading.");
  }
  if (source.startsWith(PRODUCTION_PREFIX)) {
    once("Production");
    const count = wholeNumber(source.match(SERVICE_PRODUCTION_UNITS)?.[1] ?? "", { max: INSTANCES_MAX });
    if (count === null) fail("Production says how many instances Production starts with, such as `- Production: `2` instances`.");
    service.production = count;
    return;
  }
  if (source.startsWith("- Reaches: ")) {
    const match = source.match(SERVICE_REACHES);
    if (!match) fail("Reaches names a service and the setting that gets its address: `- Reaches: `service` as `SETTING``.");
    service.reaches.push({ service: match[1], setting: match[2], line });
    return;
  }
  if (source.startsWith("- Setting ")) {
    const match = source.match(SERVICE_SETTING);
    if (!match) fail("A setting is `- Setting `NAME`: `value``.");
    const [value] = backtickedArguments(match[2], ERROR_CODE, deploymentPath, `Service \`${service.id}\` Setting ${match[1]}`, line, { count: 1 });
    settingName(service, match[1], deploymentPath, line);
    service.settings[match[1]] = value;
    service.settingLines[match[1]] = line;
    return;
  }
  if (source.startsWith(PACKAGES_PREFIX)) {
    once("Packages");
    service.packages = packages(source, deploymentPath, line);
    return;
  }
  if (source.startsWith(SANDBOX_ALLOWS_PREFIX)) {
    once("Sandbox allows");
    service.sandboxAllowances = sandboxAllowances(source, deploymentPath, line);
    return;
  }
  if (SHARED_ENTRY_FORMS.some((form) => source.startsWith(form.slice(0, form.indexOf(":") + 1)))) {
    fail(`${source.slice(2, source.indexOf(":"))} is the whole Deployment's: put it above the first ### heading.`);
  }
  invalid(deploymentPath, unknownEntryMessage(`Service \`${service.id}\` entry`, source, DEPLOYMENT_SERVICE_ENTRY_FORMS), line);
}

// A name a service's Reaches or Setting gives its process: an environment variable's, the host's never, and once.
function settingName(service, name, deploymentPath, line) {
  const fail = (message) => invalid(deploymentPath, `Service \`${service.id}\`: ${message}`, line);
  if (!ENVIRONMENT_NAME.test(name)) fail(`${JSON.stringify(name)} isn't a setting's name: use capitals, digits and _, such as \`API_URL\`.`);
  // SIDE_EFFECTS, which APP_ENV replaced, is no setting at all: a JSKIT app refuses to start while it is set.
  if (name === "SIDE_EFFECTS") fail(HOST_OWNED_ENVIRONMENT.SIDE_EFFECTS);
  const hostOwned = hostOwnedSetting(name);
  if (hostOwned) fail(`${hostOwned}; give the setting another name.`);
  if (Object.hasOwn(service.settings, name) || service.reaches.some((reach) => reach.setting === name && reach.line !== line)) {
    fail(`it names the setting ${name} twice.`);
  }
}

function resourceDraft(match, deploymentPath, line, resources) {
  const id = match[1];
  if (!STACK_RESOURCE_ID.test(id)) {
    invalid(deploymentPath, `### Resource names a resource of ## Resources by its id, such as \`files\`; ${JSON.stringify(id)} isn't one.`, line);
  }
  if (resources.has(id)) invalid(deploymentPath, `Deployment has a second ### Resource \`${id}\`.`, line);
  return { id, line, development: "", developmentLine: 0 };
}

function parseResourceLine(resource, source, deploymentPath, line) {
  if (source.startsWith("- Development: ")) {
    if (resource.developmentLine) invalid(deploymentPath, `Resource \`${resource.id}\` has a second Development line.`, line);
    resource.development = source.match(RESOURCE_DEVELOPMENT)?.[1] ?? "";
    resource.developmentLine = line;
    if (!RESOURCE_DEVELOPMENT_MODES.includes(resource.development)) {
      invalid(deploymentPath, `Resource \`${resource.id}\`: Development is \`local folder\` or \`own bucket\`.`, line);
    }
    return;
  }
  invalid(
    deploymentPath,
    `${unknownEntryMessage(`Resource \`${resource.id}\` entry`, source, DEPLOYMENT_RESOURCE_ENTRY_FORMS)} `
      + "The Deployment's own entries come before the first ### heading.",
    line
  );
}

// Each service's own checks, once the whole section is read, and those between services.
function finishServices(drafts, result, deploymentPath) {
  const ids = drafts.map((service) => service.id);
  for (const service of drafts) {
    const fail = (message, line = service.line) => invalid(deploymentPath, `Service \`${service.id}\`: ${message}`, line);
    for (const [field, value] of [["Exposure", service.exposure], ["Serve", service.serve], ["Ready when", service.readyWhen], ["Instances", service.instances]]) {
      if (!value) fail(`it needs a${field === "Exposure" || field === "Instances" ? "n" : ""} ${field} line: ${DEPLOYMENT_SERVICE_ENTRY_FORMS.find((form) => form.startsWith(field === "Serve" ? "- Serve" : `- ${field}:`))}.`);
    }
    if (service.reached && service.exposure === "public") {
      fail("Reached is for an internal service; a public one is reached at its address.", service.lines.Reached);
    }
    const production = service.production ?? service.instances.min;
    if (production < service.instances.min || production > service.instances.max) {
      fail(`Production starts with ${production} instances, outside its Instances, ${service.instances.min} to ${service.instances.max}.`, service.lines.Production);
    }
    for (const reach of service.reaches) {
      if (reach.service === service.id) fail("a service doesn't reach itself.", reach.line);
      if (!ids.includes(reach.service)) {
        fail(`there is no service \`${reach.service}\`; this Deployment's services are ${ids.map((id) => `\`${id}\``).join(", ")}. Fix the name in its Reaches line.`, reach.line);
      }
      if (service.reaches.filter((other) => other.service === reach.service).length > 1) fail(`it reaches \`${reach.service}\` twice.`, reach.line);
      settingName(service, reach.setting, deploymentPath, reach.line);
    }
    for (const name of [...service.reaches.map((reach) => reach.setting), ...Object.keys(service.settings)]) {
      if (result.generatedSecrets.includes(name) || result.setupCode === name) {
        const at = service.reaches.find((reach) => reach.setting === name)?.line ?? service.settingLines[name];
        fail(`${name} is the Deployment's ${result.setupCode === name ? "Setup code" : "generated secret"}, which every service gets already; give the setting another name.`, at);
      }
    }
  }
  const publicServices = drafts.filter((service) => service.exposure === "public");
  if (publicServices.length !== 1) {
    invalid(
      deploymentPath,
      publicServices.length === 0
        ? "A Deployment with services has exactly one public service: give one of them `- Exposure: `public``."
        : `A Deployment with services has exactly one public service; ${publicServices.map(({ id }) => `\`${id}\``).join(" and ")} are both public.`,
      publicServices[1]?.line ?? drafts[0].line
    );
  }
  return drafts.map((service) => ({
    id: service.id,
    summary: service.summary,
    exposure: service.exposure,
    reached: service.reached || "any",
    serve: service.serve,
    readyWhen: service.readyWhen,
    instances: { min: service.instances.min, max: service.instances.max, production: service.production ?? service.instances.min },
    atLeast: service.atLeast,
    reaches: service.reaches.map(({ service: reached, setting }) => ({ service: reached, setting })),
    settings: service.settings,
    packages: service.packages,
    sandboxAllowances: service.sandboxAllowances
  }));
}

// The checks that need `## Resources`: a `### Resource` names one of them, `Development` is a bucket's, and no
// service's Reaches or Setting takes a name a resource binds.
function checkAgainstResources(located, declarations, deploymentPath) {
  const resources = stackResourcesById(declarations);
  for (const resource of located.resources.values()) {
    const declared = resources.get(resource.id);
    if (!declared) {
      invalid(
        deploymentPath,
        `### Resource \`${resource.id}\`: genesis/stack.md's ## Resources declares no resource \`${resource.id}\`${resources.size
          ? `; its resources are ${[...resources.keys()].map((id) => `\`${id}\``).join(", ")}`
          : ""}.`,
        resource.line
      );
    }
    if (resource.development && declared.kind !== "bucket") {
      invalid(deploymentPath, `Resource \`${resource.id}\`: Development says how development provides a bucket, and \`${resource.id}\` is a ${declared.kind} resource.`, resource.developmentLine);
    }
  }
  const boundBy = new Map();
  for (const resource of resources.values()) {
    for (const alternative of Array.isArray(resource.environmentAlternatives) ? resource.environmentAlternatives : []) {
      for (const name of Object.values(alternative?.bindings ?? {})) if (typeof name === "string") boundBy.set(name, resource.id);
    }
  }
  for (const service of located.services) {
    const named = [
      ...service.reaches.map((reach) => [reach.setting, reach.line]),
      ...Object.entries(service.settingLines)
    ];
    for (const [name, line] of named) {
      if (boundBy.has(name)) {
        invalid(deploymentPath, `Service \`${service.id}\`: ${name} is the setting resource \`${boundBy.get(name)}\` binds; give the setting another name.`, line);
      }
    }
  }
}

export {
  DEPLOYMENT_HEADING_FORMS,
  DEPLOYMENT_RESOURCE_ENTRY_FORMS,
  DEPLOYMENT_SERVICE_ENTRY_FORMS,
  RESOURCE_HEADING,
  SERVICE_HEADING,
  checkAgainstResources,
  finishServices,
  parseResourceLine,
  parseServiceLine,
  resourceDraft,
  serviceDraft
};
