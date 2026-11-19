// One line of a Deployment section at a time: the entries every Deployment may have, each read and checked alone.
// applicationDeployment.js reads the section; deploymentServices.js its `### Service` and `### Resource` parts.
import {
  backtickedArguments,
  invalidStackOperation,
  oneLineText,
  processArguments,
  projectGlobs
} from "./stackOperation.js";

const ERROR_CODE = "VIBE64_DEPLOYMENT_INVALID";
const STEP_LINE = /^- (Prepare|Build|Migrate|Serve) `([^`\r\n]+)`:[ \t]+(.+)$/u;
const RESTORE_PATHS_PREFIX = "- Recreate on restore: ";
const GENERATED_SECRETS_PREFIX = "- Generated secrets: ";
const SETUP_CODE_PREFIX = "- Setup code: ";
const SANDBOX_ALLOWS_PREFIX = "- Sandbox allows: ";
// The system packages the application's steps and service need beyond its runtimes, by the names of the package
// collection (nixpkgs) a host that builds the application's machine installs them from: an attribute such as `git` or
// `python313Packages.pip`, or one output of it after `^`, such as `gcc-unwrapped^lib`.
const PACKAGES_PREFIX = "- Packages: ";
const PACKAGES_MAX = 200;
const PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}(?:\^[A-Za-z_][A-Za-z0-9_-]{0,31})?$/u;
// How many identical copies of the application a host may run at once behind
// one address: one unless the application says it shares nothing between
// requests that lives in one copy (files it writes, sign-ins kept in memory).
const INSTANCES_PREFIX = "- Instances: up to ";
const INSTANCES_MAX = 100;
// What an application's own commands and service may do beyond an ordinary
// sandbox, from a closed set. A host grants only what its owner permits.
const VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES = Object.freeze(["fuse", "gvisor"]);
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
// The host gives every step APP_ENV, the environment it deploys to; no step, Generated secret or Setup code sets
// it, nor SIDE_EFFECTS, which APP_ENV replaced, nor STAGING_REACHES_REAL_PEOPLE, which a host gives a Staging only
// while its owner marks that real people use it.
const HOST_OWNED_ENVIRONMENT = Object.freeze({
  APP_ENV: "Deployment never sets APP_ENV: the host gives every step the environment it deploys to. Remove APP_ENV from Deployment.",
  SIDE_EFFECTS: "SIDE_EFFECTS was replaced by APP_ENV, which the host gives every step. Remove SIDE_EFFECTS from Deployment.",
  STAGING_REACHES_REAL_PEOPLE: "Deployment never sets STAGING_REACHES_REAL_PEOPLE: the host gives it to a Staging only "
    + "while the project's owner marks that real people use that Staging. Remove STAGING_REACHES_REAL_PEOPLE from Deployment."
});
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
  `${PACKAGES_PREFIX}\`package\`...`,
  `${INSTANCES_PREFIX}\`count\``,
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

function packages(source, deploymentPath, line) {
  const values = backtickedArguments(
    source.slice(PACKAGES_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Packages",
    line,
    { maximum: Infinity }
  );
  if (values.length > PACKAGES_MAX) invalid(deploymentPath, `Deployment Packages names at most ${PACKAGES_MAX} packages.`, line);
  const wrong = values.find((value) => !PACKAGE_NAME.test(value));
  if (wrong !== undefined) {
    invalid(
      deploymentPath,
      `Deployment Packages names packages as nixpkgs does, such as \`git\` or \`python313Packages.pip\`, or one output `
        + `after ^, such as \`gcc-unwrapped^lib\`; ${JSON.stringify(wrong)} isn't one.`,
      line
    );
  }
  if (new Set(values).size !== values.length) invalid(deploymentPath, "Deployment Packages names a package twice.", line);
  return values;
}

function instancesMax(source, deploymentPath, line) {
  const [count] = backtickedArguments(
    source.slice(INSTANCES_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Instances",
    line,
    { count: 1 }
  );
  if (!/^[1-9][0-9]{0,2}$/u.test(count) || Number(count) > INSTANCES_MAX) {
    invalid(deploymentPath, `Deployment Instances is a whole number from 1 to ${INSTANCES_MAX}, such as \`4\`.`, line);
  }
  return Number(count);
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
  const hostOwned = Object.keys(HOST_OWNED_ENVIRONMENT).find((name) => argv.some((value) => value.startsWith(`${name}=`)));
  if (hostOwned) invalid(deploymentPath, HOST_OWNED_ENVIRONMENT[hostOwned], line);
  return {
    label: oneLineText(match[2], ERROR_CODE, deploymentPath, "Deployment step label", line),
    argv,
    role: match[1].toLowerCase()
  };
}

export {
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  ENVIRONMENT_NAME,
  ERROR_CODE,
  GENERATED_SECRETS_PREFIX,
  HOST_OWNED_ENVIRONMENT,
  INSTANCES_MAX,
  INSTANCES_PREFIX,
  PACKAGES_PREFIX,
  RESTORE_PATHS_PREFIX,
  SANDBOX_ALLOWS_PREFIX,
  SETUP_CODE_PREFIX,
  STEP_LINE,
  STEP_ROLE_ORDER,
  VIBE64_DEPLOYMENT_SANDBOX_ALLOWANCES,
  deploymentStep,
  disposablePaths,
  generatedSecrets,
  instancesMax,
  invalid,
  packages,
  sandboxAllowances,
  setupCode
};
