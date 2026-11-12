import {
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  processArguments,
  projectGlobs,
  projectPath,
  runtimeArguments,
  stackOperationHash,
  uniqueSorted,
  unknownEntryMessage
} from "./stackOperation.js";

const VIBE64_APPLICATION_DEPLOYMENT_CONTRACT = "vibe64.application-deployment.v1";
const VIBE64_APPLICATION_DEPLOYMENT_SECTION = "Deployment";
const ERROR_CODE = "VIBE64_DEPLOYMENT_INVALID";
const STEP_LINE = /^- (Prepare|Build|Migrate|Serve) `([^`\r\n]+)`:[ \t]+(.+)$/u;
const RESTORE_PATHS_PREFIX = "- Recreate on restore: ";
const GENERATED_SECRETS_PREFIX = "- Generated secrets: ";
const SETUP_CODE_PREFIX = "- Setup code: ";
const SANDBOX_ALLOWS_PREFIX = "- Sandbox allows: ";
// What an application's own commands and service may do beyond an ordinary
// sandbox, from a closed set. A host grants only what its owner permits.
const VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES = Object.freeze(["fuse", "gvisor"]);
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
// The host owns SIDE_EFFECTS (live or simulate) and gives it to every step; the project never sets it.
const SIDE_EFFECTS_NAME = "SIDE_EFFECTS";
const SIDE_EFFECTS_OWNED_BY_HOST = "Deployment never sets SIDE_EFFECTS: the host gives it to every step, live only when the deployment's owner chose to act for real.";
const STEP_ROLE_ORDER = Object.freeze({
  prepare: 0,
  build: 1,
  migrate: 2,
  serve: 3
});

const DEPLOYMENT_STEP_ROLES = Object.keys(STEP_ROLE_ORDER).map((role) => role[0].toUpperCase() + role.slice(1));
const DEPLOYMENT_ENTRY_FORMS = Object.freeze([
  "- Workdir: `path`",
  "- Runtimes: `runtime`...",
  `${RESTORE_PATHS_PREFIX}\`glob\`...`,
  `${GENERATED_SECRETS_PREFIX}\`NAME\`...`,
  `${SETUP_CODE_PREFIX}\`NAME\``,
  `${SANDBOX_ALLOWS_PREFIX}${VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES.map((name) => `\`${name}\``).join(" ")}`,
  "- Ready when: `GET` `/path` returns `200`",
  `- ${DEPLOYMENT_STEP_ROLES.join("|")} \`label\`: \`command\` \`argument\`...`
]);

function invalid(deploymentPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, deploymentPath, message, line, details);
}

function disposablePaths(source, deploymentPath, line) {
  return projectGlobs(
    source.slice(RESTORE_PATHS_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Recreate on restore paths",
    line
  );
}

function generatedSecrets(source, deploymentPath, line) {
  const values = backtickedArguments(
    source.slice(GENERATED_SECRETS_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Generated secrets",
    line
  );
  if (values.some((value) => !ENVIRONMENT_NAME.test(value))) {
    invalid(deploymentPath, "Deployment Generated secrets must be uppercase environment variable names.", line);
  }
  if (new Set(values).size !== values.length) {
    invalid(deploymentPath, "Deployment contains a duplicate Generated secrets name.", line);
  }
  return values;
}

function setupCode(source, deploymentPath, line) {
  const [name] = backtickedArguments(
    source.slice(SETUP_CODE_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Setup code",
    line,
    { count: 1 }
  );
  if (!ENVIRONMENT_NAME.test(name)) {
    invalid(deploymentPath, "Deployment Setup code must be an uppercase environment variable name.", line);
  }
  return name;
}

function sandboxAllowances(source, deploymentPath, line) {
  const values = backtickedArguments(
    source.slice(SANDBOX_ALLOWS_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Sandbox allows",
    line
  );
  if (values.some((value) => !VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES.includes(value))) {
    invalid(
      deploymentPath,
      `Deployment Sandbox allows takes only ${VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES.map((name) => `\`${name}\``).join(" and ")}.`,
      line
    );
  }
  if (new Set(values).size !== values.length) {
    invalid(deploymentPath, "Deployment Sandbox allows names an allowance twice.", line);
  }
  return [...values].sort();
}

function deploymentStep(match, deploymentPath, line) {
  const argv = processArguments(match[3], ERROR_CODE, deploymentPath, "Deployment command", line);
  if (argv.some((value) => /\{(?:host|port)\}/u.test(value))) {
    invalid(
      deploymentPath,
      "Deployment commands take no {host} or {port} placeholders; Serve reads HOST and PORT from its environment.",
      line
    );
  }
  if (argv.some((value) => value.startsWith(`${SIDE_EFFECTS_NAME}=`))) {
    invalid(deploymentPath, SIDE_EFFECTS_OWNED_BY_HOST, line);
  }
  return {
    label: oneLineText(match[2], ERROR_CODE, deploymentPath, "Deployment step label", line),
    argv,
    role: match[1].toLowerCase()
  };
}

function emptyDeployment() {
  return {
    version: 1,
    artifact: { disposablePaths: [] },
    workdir: ".",
    runtimeRequirements: [],
    generatedSecrets: [],
    setupCode: "",
    sandboxAllowances: [],
    readiness: null,
    steps: []
  };
}

function parseVibe64DeploymentLines(lines, options = {}) {
  const {
    path: deploymentPath = "genesis/stack.md#Deployment"
  } = options;
  if (!Array.isArray(lines)) {
    invalid(deploymentPath, "Deployment must be supplied as exact Stack section lines.");
  }
  if (isExplicitlyEmptyStackSection(lines)) return emptyDeployment();

  const result = emptyDeployment();
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
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
    const step = source.match(STEP_LINE);
    if (step) {
      result.steps.push(deploymentStep(step, deploymentPath, line));
      continue;
    }
    invalid(deploymentPath, unknownEntryMessage("Deployment entry", source, DEPLOYMENT_ENTRY_FORMS), line);
  }
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
  if ([...result.generatedSecrets, result.setupCode].includes(SIDE_EFFECTS_NAME)) {
    invalid(deploymentPath, SIDE_EFFECTS_OWNED_BY_HOST);
  }
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
  return result;
}

function vibe64DeploymentInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Deployment section");
  const diagnostics = [...(section.diagnostics || [])];
  let parsed = emptyDeployment();
  if (section.status === "ready") parsed = parseVibe64DeploymentLines(section.lines);
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
    readiness: parsed.readiness,
    steps: parsed.steps
  };
  return {
    contract: VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
    status,
    stackHash: section.stackHash,
    recipeHash: status === "ready" ? stackOperationHash(recipe) : "",
    components: [...(section.components || [])],
    source: section.source || null,
    runtimeRequirements: uniqueSorted(parsed.runtimeRequirements),
    resources: structuredClone(environment.resources || []),
    ...recipe,
    diagnostics
  };
}

export {
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
};
