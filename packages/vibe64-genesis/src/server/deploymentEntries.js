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
// The folders of the build's home a host that builds the application afresh each time keeps from one build to the
// next, such as a package manager's download cache or a store that installs each pinned version of a tool once: `~/`
// then 1 to 16 plain segments, at most 1024 characters, as a mobilynet build's cache takes them. A host whose home
// outlives builds keeps them anyway; one whose builds start empty and keep nothing ignores the line. What a step finds
// there is the step's to check by the version or hash it pins: a host only puts back what the same project's last
// build of the app left.
const BUILD_CACHE_PREFIX = "- Kept between builds: ";
const BUILD_CACHE_MAX = 10;
const BUILD_CACHE_SEGMENT = /^[A-Za-z0-9._@+-]{1,255}$/u;
const BUILD_CACHE_PATH_MAX = 1024;
// The script a host that builds the application's machine runs on it once, as root, before Prepare, keeping what it
// writes to the system (programs under /opt and /usr, configuration under /etc) read-only for every machine built with
// the same script, packages and base: mobilynet's setup layer. A committed file of the project, by its path from the
// project's root: 1 to 16 plain names, none starting with -, at most 1024 characters, so every host takes it as it is.
const MACHINE_SETUP_PREFIX = "- Machine setup: ";
const MACHINE_SETUP_SEGMENT = /^[A-Za-z0-9._@+][A-Za-z0-9._@+-]{0,254}$/u;
const MACHINE_SETUP_PATH_MAX = 1024;
// How many identical copies of the application a host may run at once behind
// one address: one unless the application says it shares nothing between
// requests that lives in one copy (files it writes, sign-ins kept in memory).
const INSTANCES_PREFIX = "- Instances: up to ";
const INSTANCES_MAX = 100;
// Who deploys the application's Production when a host's Deploy to production doesn't (the project's own release
// tooling, say): the name a person knows it by and the https address where its Production is deployed, kept only here.
// A host's Deploy page shows it with a link there and its deploy engine refuses Production, naming it; Staging reads the
// rest of the section as before. A service's own `- Production: `N` instances` is another line, under its heading.
const PRODUCTION_PREFIX = "- Production: ";
const PRODUCTION_MANAGED_LINE = /^- Production: managed by `([^`\r\n]*)` at `([^`\r\n]*)`$/u;
const PRODUCTION_MANAGER_NAME_MAX = 60;
// Words of letters, digits and . & ' + ( ) _ - between single spaces, starting with a letter or digit.
const PRODUCTION_MANAGER_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{N}.&'+()_-]| (?! |$))*$/u;
const PRODUCTION_MANAGER_URL_MAX = 2048;
// A Production released as one signed prebuilt release of an app a provider's machine already runs: the release's name
// (by the rule a Production manager's name follows) and the command that builds it at the saved commit, leaving
// output.tar and manifest.json in the folder V64_RELEASE_DIR names, which the release key's holder signs where the key is.
const SIGNED_RELEASE_PREFIX = "- Signed release";
const SIGNED_RELEASE_LINE = /^- Signed release `([^`\r\n]+)`:[ \t]+(.+)$/u;
// What the host gives the release's command: the saved commit, the folder it leaves the release in, and the release
// key's fingerprint its manifest names.
const SIGNED_RELEASE_ENVIRONMENT = Object.freeze(["V64_COMMIT", "V64_RELEASE_DIR", "V64_RELEASE_KEY"]);
// RFC 3986's characters, so the address is shown and linked exactly as written.
const URL_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/u;
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
  `${BUILD_CACHE_PREFIX}\`~/folder\`...`,
  `${MACHINE_SETUP_PREFIX}\`path\``,
  `${INSTANCES_PREFIX}\`count\``,
  `${PRODUCTION_PREFIX}managed by \`name\` at \`https://address\``,
  `${SIGNED_RELEASE_PREFIX} \`name\`: \`command\` \`argument\`...`,
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

function buildCache(source, deploymentPath, line) {
  const values = backtickedArguments(
    source.slice(BUILD_CACHE_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Kept between builds",
    line,
    { maximum: Infinity }
  );
  if (values.length > BUILD_CACHE_MAX) {
    invalid(deploymentPath, `Deployment Kept between builds names at most ${BUILD_CACHE_MAX} folders.`, line);
  }
  const wrong = values.find((value) => {
    const segments = value.startsWith("~/") ? value.slice(2).split("/") : [];
    return value.length > BUILD_CACHE_PATH_MAX || segments.length === 0 || segments.length > 16
      || segments.some((segment) => !BUILD_CACHE_SEGMENT.test(segment) || segment === "." || segment === "..");
  });
  if (wrong !== undefined) {
    invalid(
      deploymentPath,
      "Deployment Kept between builds names folders of the build's home as `~/` then plain names, such as "
        + `\`~/.cache/pip\`, never . or ..; ${JSON.stringify(wrong)} isn't one.`,
      line
    );
  }
  if (new Set(values).size !== values.length) invalid(deploymentPath, "Deployment Kept between builds names a folder twice.", line);
  return values;
}

function machineSetup(source, deploymentPath, line) {
  const [value] = backtickedArguments(
    source.slice(MACHINE_SETUP_PREFIX.length),
    ERROR_CODE,
    deploymentPath,
    "Deployment Machine setup",
    line,
    { count: 1 }
  );
  const segments = value.split("/");
  if (value.length > MACHINE_SETUP_PATH_MAX || segments.length > 16
    || segments.some((segment) => !MACHINE_SETUP_SEGMENT.test(segment) || segment === "." || segment === "..")) {
    invalid(
      deploymentPath,
      "Deployment Machine setup names one committed file of the project by its path from the project's root, plain names "
        + `separated by /, such as \`deploy/machine-setup.sh\`, never . or ..; ${JSON.stringify(value)} isn't one.`,
      line
    );
  }
  return value;
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

function productionManagedBy(source, deploymentPath, line) {
  const match = source.match(PRODUCTION_MANAGED_LINE);
  if (!match) {
    invalid(
      deploymentPath,
      "Deployment Production says who deploys Production instead of a host, such as "
        + "`- Production: managed by `Example Console` at `https://console.example.com/deployments``; a service's "
        + "`- Production: `N` instances` goes under its ### Service heading.",
      line
    );
  }
  const [, name, url] = match;
  if (name.length > PRODUCTION_MANAGER_NAME_MAX || !PRODUCTION_MANAGER_NAME.test(name)) {
    invalid(
      deploymentPath,
      `Deployment Production names who manages it in 1 to ${PRODUCTION_MANAGER_NAME_MAX} letters, digits, single spaces `
        + `and . & ' + ( ) _ -, starting with a letter or digit, such as \`Example Console\`; ${JSON.stringify(name)} isn't one.`,
      line
    );
  }
  if (!httpsAddress(url)) {
    invalid(
      deploymentPath,
      "Deployment Production gives the https address where Production is managed, such as "
        + `\`https://console.example.com/deployments\`, without a user name or password; ${JSON.stringify(url)} isn't one.`,
      line
    );
  }
  return { name, url };
}

// `- Signed release `name`: `command` `argument`...`: the release's name and the command that builds it, a command as
// a step's is, which serves nothing and sets none of the names the host gives it.
function signedRelease(source, deploymentPath, line) {
  const match = source.match(SIGNED_RELEASE_LINE);
  if (!match) {
    invalid(
      deploymentPath,
      "Deployment Signed release names the release and the command that builds it at the saved commit, such as "
        + "`- Signed release `Control plane release`: `sh` `release/signed-release.sh``.",
      line
    );
  }
  const [, name, command] = match;
  if (name.length > PRODUCTION_MANAGER_NAME_MAX || !PRODUCTION_MANAGER_NAME.test(name)) {
    invalid(
      deploymentPath,
      `Deployment Signed release names the release in 1 to ${PRODUCTION_MANAGER_NAME_MAX} letters, digits, single spaces `
        + `and . & ' + ( ) _ -, starting with a letter or digit, such as \`Control plane release\`; ${JSON.stringify(name)} isn't one.`,
      line
    );
  }
  const argv = processArguments(command, ERROR_CODE, deploymentPath, "Deployment Signed release command", line);
  if (argv.some((value) => /\{(?:host|port)\}/u.test(value))) {
    invalid(deploymentPath, "Deployment Signed release's command takes no {host} or {port} placeholders: it builds a release and serves nothing.", line);
  }
  const hostOwned = Object.keys(HOST_OWNED_ENVIRONMENT).find((owned) => argv.some((value) => value.startsWith(`${owned}=`)));
  if (hostOwned) invalid(deploymentPath, HOST_OWNED_ENVIRONMENT[hostOwned], line);
  const given = SIGNED_RELEASE_ENVIRONMENT.find((owned) => argv.some((value) => value.startsWith(`${owned}=`)));
  if (given) {
    invalid(deploymentPath, `Deployment Signed release never sets ${given}: the host gives the command ${SIGNED_RELEASE_ENVIRONMENT.slice(0, -1).join(", ")} and ${SIGNED_RELEASE_ENVIRONMENT.at(-1)}.`, line);
  }
  return { name, argv };
}

// An https address with its host right after `https://`, as written: a parser takes `https:///path` as the host `path`.
function httpsAddress(value) {
  const scheme = "https://";
  if (!value.startsWith(scheme) || value.length > PRODUCTION_MANAGER_URL_MAX || !URL_CHARACTERS.test(value)) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return Boolean(parsed.hostname) && !parsed.username && !parsed.password
    && value.slice(scheme.length).toLowerCase().startsWith(parsed.hostname);
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
  BUILD_CACHE_PREFIX,
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  ENVIRONMENT_NAME,
  ERROR_CODE,
  GENERATED_SECRETS_PREFIX,
  HOST_OWNED_ENVIRONMENT,
  INSTANCES_MAX,
  INSTANCES_PREFIX,
  MACHINE_SETUP_PREFIX,
  PACKAGES_PREFIX,
  PRODUCTION_PREFIX,
  RESTORE_PATHS_PREFIX,
  SANDBOX_ALLOWS_PREFIX,
  SETUP_CODE_PREFIX,
  SIGNED_RELEASE_PREFIX,
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
  productionManagedBy,
  sandboxAllowances,
  setupCode,
  signedRelease
};
