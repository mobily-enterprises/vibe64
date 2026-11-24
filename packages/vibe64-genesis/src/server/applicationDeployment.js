import {
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  isExplicitlyEmptyStackSection,
  projectPath,
  runtimeArguments,
  stackOperationHash,
  uniqueSorted,
  unknownEntryMessage
} from "./stackOperation.js";
import {
  BUILD_CACHE_PREFIX,
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  ERROR_CODE,
  GENERATED_SECRETS_PREFIX,
  HOST_OWNED_ENVIRONMENT,
  INSTANCES_PREFIX,
  MACHINE_SETUP_PREFIX,
  PACKAGES_PREFIX,
  RESTORE_PATHS_PREFIX,
  SANDBOX_ALLOWS_PREFIX,
  SETUP_CODE_PREFIX,
  STEP_LINE,
  STEP_ROLE_ORDER,
  VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES,
  buildCache,
  deploymentStep,
  disposablePaths,
  generatedSecrets,
  instancesMax,
  invalid,
  machineSetup,
  packages,
  sandboxAllowances,
  setupCode
} from "./deploymentEntries.js";
import {
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
} from "./deploymentServices.js";


// v2: a Deployment may describe several services under `### Service` headings and say how development provides a
// resource under `### Resource`; a Deployment without them is one public service, `web`, exactly as v1 read it.
// An optional line added within v2 (Kept between builds, Machine setup) keeps v2: a Deployment without it reads and
// hashes as before, and a reader without it refuses the line as an unknown entry rather than skipping it.
const VIBE64_APPLICATION_DEPLOYMENT_CONTRACT = "vibe64.application-deployment.v2";
// What a host recorded with a release made before services: such a release reads exactly as a v2 Deployment without
// `### Service` headings.
const VIBE64_APPLICATION_DEPLOYMENT_V1_CONTRACT = "vibe64.application-deployment.v1";
const VIBE64_APPLICATION_DEPLOYMENT_SECTION = "Deployment";

function emptyDeployment() {
  return {
    version: 1,
    artifact: { disposablePaths: [] },
    workdir: ".",
    runtimeRequirements: [],
    generatedSecrets: [],
    setupCode: "",
    sandboxAllowances: [],
    packages: [],
    instances: { max: 1 },
    readiness: null,
    steps: [],
    buildCache: [],
    machineSetup: "",
    services: [],
    deploymentResources: {}
  };
}

// The section, with each service's and resource's lines for the checks only the inspection can make.
function parseDeployment(lines, deploymentPath) {
  if (!Array.isArray(lines)) {
    invalid(deploymentPath, "Deployment must be supplied as exact Stack section lines.");
  }
  const located = { services: [], resources: new Map() };
  if (isExplicitlyEmptyStackSection(lines)) return { result: emptyDeployment(), located };

  const result = emptyDeployment();
  const seen = new Set();
  // A Deployment with services says each one's Serve, Ready when, Instances and Sandbox allows under its heading.
  const withServices = lines.some((text) => text.trim().startsWith("### Service "));
  let scope = null;
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
    if (source.startsWith("#")) {
      const service = source.match(SERVICE_HEADING);
      const resource = service ? null : source.match(RESOURCE_HEADING);
      if (service) {
        scope = { service: serviceDraft(service, deploymentPath, line, located.services) };
        located.services.push(scope.service);
      } else if (resource) {
        scope = { resource: resourceDraft(resource, deploymentPath, line, located.resources) };
        located.resources.set(scope.resource.id, scope.resource);
      } else {
        invalid(deploymentPath, unknownEntryMessage("Deployment heading", source, DEPLOYMENT_HEADING_FORMS), line);
      }
      continue;
    }
    if (scope?.service) {
      parseServiceLine(scope.service, source, deploymentPath, line);
      continue;
    }
    if (scope?.resource) {
      parseResourceLine(scope.resource, source, deploymentPath, line);
      continue;
    }
    const step = source.match(STEP_LINE);
    if (withServices && (
      step?.[1] === "Serve"
      || [SANDBOX_ALLOWS_PREFIX, INSTANCES_PREFIX, "- Ready when: ", "- Instances: "].some((prefix) => source.startsWith(prefix))
    )) {
      invalid(
        deploymentPath,
        `In a Deployment with services, each service says its own Serve, Ready when, Instances and Sandbox allows: move \`${source}\` under its \`### Service\` heading.`,
        line
      );
    }
    if (source.startsWith("- Workdir: ")) {
      if (seen.has("workdir")) invalid(deploymentPath, "Duplicate Deployment Workdir.", line);
      seen.add("workdir");
      const workdir = backtickedArguments(
        source.slice("- Workdir: ".length),
        ERROR_CODE,
        deploymentPath,
        "Deployment Workdir",
        line,
        { count: 1 }
      )[0];
      result.workdir = projectPath(
        workdir,
        ERROR_CODE,
        deploymentPath,
        "Deployment workdir",
        line
      );
      continue;
    }
    if (source.startsWith("- Runtimes: ")) {
      if (seen.has("runtimes")) invalid(deploymentPath, "Duplicate Deployment Runtimes.", line);
      seen.add("runtimes");
      result.runtimeRequirements = runtimeArguments(
        source.slice("- Runtimes: ".length),
        ERROR_CODE,
        deploymentPath,
        "Deployment runtimes",
        line
      );
      continue;
    }
    if (source.startsWith(RESTORE_PATHS_PREFIX)) {
      if (seen.has("restore-paths")) {
        invalid(deploymentPath, "Duplicate Deployment Recreate on restore entry.", line);
      }
      seen.add("restore-paths");
      result.artifact.disposablePaths = disposablePaths(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(GENERATED_SECRETS_PREFIX)) {
      if (seen.has("generated-secrets")) {
        invalid(deploymentPath, "Duplicate Deployment Generated secrets entry.", line);
      }
      seen.add("generated-secrets");
      result.generatedSecrets = generatedSecrets(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(SETUP_CODE_PREFIX)) {
      if (seen.has("setup-code")) invalid(deploymentPath, "Duplicate Deployment Setup code.", line);
      seen.add("setup-code");
      result.setupCode = setupCode(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(SANDBOX_ALLOWS_PREFIX)) {
      if (seen.has("sandbox-allows")) invalid(deploymentPath, "Duplicate Deployment Sandbox allows.", line);
      seen.add("sandbox-allows");
      result.sandboxAllowances = sandboxAllowances(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(PACKAGES_PREFIX)) {
      if (seen.has("packages")) invalid(deploymentPath, "Duplicate Deployment Packages.", line);
      seen.add("packages");
      result.packages = packages(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(BUILD_CACHE_PREFIX)) {
      if (seen.has("build-cache")) invalid(deploymentPath, "Duplicate Deployment Kept between builds.", line);
      seen.add("build-cache");
      result.buildCache = buildCache(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(MACHINE_SETUP_PREFIX)) {
      if (seen.has("machine-setup")) invalid(deploymentPath, "Duplicate Deployment Machine setup.", line);
      seen.add("machine-setup");
      result.machineSetup = machineSetup(source, deploymentPath, line);
      continue;
    }
    if (source.startsWith(INSTANCES_PREFIX)) {
      if (seen.has("instances")) invalid(deploymentPath, "Duplicate Deployment Instances.", line);
      seen.add("instances");
      result.instances = { max: instancesMax(source, deploymentPath, line) };
      continue;
    }
    if (source.startsWith("- Ready when: ")) {
      if (seen.has("readiness")) invalid(deploymentPath, "Duplicate Deployment Ready when.", line);
      seen.add("readiness");
      result.readiness = httpReadinessLine(
        source,
        ERROR_CODE,
        deploymentPath,
        "Deployment readiness",
        line
      );
      continue;
    }
    if (step) {
      result.steps.push(deploymentStep(step, deploymentPath, line));
      continue;
    }
    invalid(deploymentPath, unknownEntryMessage("Deployment entry", source, DEPLOYMENT_ENTRY_FORMS), line);
  }
  if (withServices) {
    for (let index = 1; index < result.steps.length; index += 1) {
      if (STEP_ROLE_ORDER[result.steps[index].role] < STEP_ROLE_ORDER[result.steps[index - 1].role]) {
        invalid(deploymentPath, `Deployment steps must be ordered ${DEPLOYMENT_STEP_ROLES.slice(0, -1).join(", ")}.`);
      }
    }
    checkSharedEntries(result, deploymentPath);
    result.services = finishServices(located.services, result, deploymentPath);
    // What a reader of one service takes from the section: the public service's Serve, health and instances, after
    // the shared steps, and every service's sandbox allowances (one approval covers them all).
    const web = result.services.find((service) => service.exposure === "public");
    result.steps.push({ label: web.serve.label, argv: [...web.serve.argv], role: "serve" });
    result.readiness = { kind: "http", ...web.readyWhen };
    result.instances = { max: web.instances.max };
    result.sandboxAllowances = [...new Set(result.services.flatMap((service) => service.sandboxAllowances))].sort();
  } else {
    if (result.steps.length === 0) {
      invalid(deploymentPath, "## Deployment needs at least one command or exactly `- Nothing.`.");
    }
    const serveSteps = result.steps.filter(({ role }) => role === "serve");
    if (serveSteps.length !== 1 || result.steps.at(-1).role !== "serve") {
      invalid(deploymentPath, "Deployment needs exactly one final Serve step.");
    }
    for (let index = 1; index < result.steps.length; index += 1) {
      if (STEP_ROLE_ORDER[result.steps[index].role] < STEP_ROLE_ORDER[result.steps[index - 1].role]) {
        invalid(
          deploymentPath,
          `Deployment steps must be ordered ${DEPLOYMENT_STEP_ROLES.slice(0, -1).join(", ")}, then ${DEPLOYMENT_STEP_ROLES.at(-1)}.`
        );
      }
    }
    if (!result.readiness) invalid(deploymentPath, "Deployment needs one Ready when entry.");
    checkSharedEntries(result, deploymentPath);
    // Without services, the Deployment is one public service, web.
    const serve = result.steps.at(-1);
    result.services = [{
      id: "web",
      summary: "",
      exposure: "public",
      reached: "any",
      serve: { label: serve.label, argv: [...serve.argv] },
      readyWhen: { method: result.readiness.method, path: result.readiness.path, status: result.readiness.status },
      instances: { min: 1, max: result.instances.max, production: 1 },
      atLeast: null,
      reaches: [],
      settings: {},
      packages: [],
      sandboxAllowances: [...result.sandboxAllowances]
    }];
  }
  result.deploymentResources = Object.fromEntries([...located.resources.values()]
    .map((resource) => [resource.id, resource.development ? { development: resource.development } : {}]));
  return { result, located };
}

function checkSharedEntries(result, deploymentPath) {
  const hostOwned = Object.keys(HOST_OWNED_ENVIRONMENT)
    .find((name) => [...result.generatedSecrets, result.setupCode].includes(name));
  if (hostOwned) invalid(deploymentPath, HOST_OWNED_ENVIRONMENT[hostOwned]);
  if (result.generatedSecrets.includes(result.setupCode)) {
    invalid(deploymentPath, "Deployment Setup code is generated already; leave it out of Generated secrets.");
  }
  if (
    result.artifact.disposablePaths.length > 0
    && !result.steps.some(({ role }) => role === "prepare")
  ) {
    invalid(
      deploymentPath,
      "Deployment may recreate paths on restore only when it declares a Prepare step."
    );
  }
}

function parseVibe64DeploymentLines(lines, options = {}) {
  const {
    path: deploymentPath = "genesis/stack.md#Deployment"
  } = options;
  return parseDeployment(lines, deploymentPath).result;
}

function vibe64DeploymentInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Deployment section");
  const diagnostics = [...(section.diagnostics || [])];
  let parsed = emptyDeployment();
  let withServices = false;
  if (section.status === "ready") {
    const deploymentPath = "genesis/stack.md#Deployment";
    const read = parseDeployment(section.lines, deploymentPath);
    checkAgainstResources(read.located, environment.resources, deploymentPath);
    parsed = read.result;
    withServices = read.located.services.length > 0;
  }
  const status = diagnostics.length > 0
    ? "blocked"
    : parsed.steps.length > 0 ? "ready" : "unconfigured";
  const recipe = {
    version: parsed.version,
    artifact: parsed.artifact,
    workdir: parsed.workdir,
    runtimeRequirements: parsed.runtimeRequirements,
    generatedSecrets: parsed.generatedSecrets,
    setupCode: parsed.setupCode,
    sandboxAllowances: parsed.sandboxAllowances,
    packages: parsed.packages,
    instances: parsed.instances,
    readiness: parsed.readiness,
    steps: parsed.steps,
    buildCache: parsed.buildCache,
    machineSetup: parsed.machineSetup
  };
  // A Deployment without services, resource lines, Kept between builds or Machine setup hashes as v1 did, so its recipe
  // keeps its identity; each joins the hash when the Stack says it.
  const { buildCache: kept, machineSetup: setup, ...v1Recipe } = recipe;
  const hashed = {
    ...v1Recipe,
    ...(kept.length > 0 ? { buildCache: kept } : {}),
    ...(setup ? { machineSetup: setup } : {}),
    ...(withServices ? { services: parsed.services } : {}),
    ...(Object.keys(parsed.deploymentResources).length > 0 ? { deploymentResources: parsed.deploymentResources } : {})
  };
  return {
    contract: VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
    status,
    stackHash: section.stackHash,
    recipeHash: status === "ready" ? stackOperationHash(hashed) : "",
    components: [...(section.components || [])],
    source: section.source || null,
    runtimeRequirements: uniqueSorted(parsed.runtimeRequirements),
    resources: structuredClone(environment.resources || []),
    ...recipe,
    services: parsed.services,
    deploymentResources: parsed.deploymentResources,
    diagnostics
  };
}

export {
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_HEADING_FORMS,
  DEPLOYMENT_RESOURCE_ENTRY_FORMS,
  DEPLOYMENT_SERVICE_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  VIBE64_APPLICATION_DEPLOYMENT_V1_CONTRACT,
  VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
};
