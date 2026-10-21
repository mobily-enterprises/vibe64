import {
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  processArguments,
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
  "- Ready when: `GET` `/path` returns `200`",
  `- ${DEPLOYMENT_STEP_ROLES.join("|")} \`label\`: \`command\` \`argument\`...`
]);

function invalid(deploymentPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, deploymentPath, message, line, details);
}

function disposablePaths(source, deploymentPath, line) {
  const values = backtickedArguments(
    source.slice(RESTORE_PATHS_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Recreate on restore paths",
    line
  );
  if (values.some((value) => (
    value.startsWith("/")
    || value.includes("\\")
    || value.includes("***")
    || /[?[\]{}!]/u.test(value)
    || value.split("/").some((segment) => !segment || [".", ".."].includes(segment))
  ))) {
    invalid(
      deploymentPath,
      "Deployment Recreate on restore paths must be canonical project-relative globs using only * and ** wildcards.",
      line
    );
  }
  if (new Set(values).size !== values.length) {
    invalid(deploymentPath, "Deployment contains a duplicate Recreate on restore path.", line);
  }
  return values;
}

function deploymentStep(match, deploymentPath, line) {
  return {
    label: oneLineText(match[2], ERROR_CODE, deploymentPath, "Deployment step label", line),
    argv: processArguments(match[3], ERROR_CODE, deploymentPath, "Deployment command", line),
    role: match[1].toLowerCase()
  };
}

function emptyDeployment() {
  return {
    version: 1,
    artifact: { disposablePaths: [] },
    workdir: ".",
    runtimeRequirements: [],
    readiness: null,
    steps: []
  };
}

function parseVibe64DeploymentLines(lines, {
  path: deploymentPath = "genesis/stack.md#Deployment"
} = {}) {
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
      invalid(deploymentPath, `Deployment steps must be ordered ${DEPLOYMENT_STEP_ROLES.slice(0, -1).join(", ")}, then ${DEPLOYMENT_STEP_ROLES.at(-1)}.`);
    }
  }
  if (!result.readiness) invalid(deploymentPath, "Deployment needs one Ready when entry.");
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
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
};
