// The mobilynet adapter's declaration: the package Vibe64 hands mobilynet for each build of an app, its mobilynet.json
// and the scripts it runs, in mobilynet's build model of 16 Nov 2026. Every service builds from the one archive (the
// saved commit with the shared build script and one serve script per service). Services built together (builds.js:
// the same health path and sandbox allowances) are one app at mobilynet, named after their lead, `<app>-<lead>`, whose
// one upload is that archive with its one declaration at the root: mobilynet builds a release once (its project, app
// and upload's bytes), so each service's App Service runs that app's version and none builds it again. A service built
// alone is its own app, `<app>-<service>`, as every service was before. mobilynet builds the release from source in a
// throwaway build VM by the declaration's `build` block, keeps the folder as the app's read-only output and runs the app
// as a service, as the app's own login.
//
// An App Service runs every service its release declares, and checks the first one's health path. So a shared build's
// declaration has one service, `app`, whose script runs the service the instance's App Service is: the engine gives
// each its V64_SERVICE (builds.js), and `serve.sh` runs that service's own `serve-<service>.sh`, which exports its own
// settings and instance facts as before. Its packages are the shared ones and every service's own; a setting one of
// its services requires and another doesn't is declared optional, and the engine checks each service's own
// (steps.js requiredWithoutValue). The migrate task runs `migrate.sh`, which picks the service's script alike.
//
// mobilynet runs `start`, `check` and a release task as root, and the build can write any file of the output. So none
// runs a file of the app's: start is `install`, which copies the settings mobilynet keeps for root into a file only the
// app's login reads; check is `curl` asking the app's health path; the migrate task is `systemd-run`, which runs the
// release's migrate script as the app's login with those settings handed over as a credential (migrateTaskOf). Each is
// a program on the machine's PATH, outside the app's folder. The app's own code runs only as its login.
//
// Migrate is the release's `migrate` task (mobilynet's release tasks, its docs/stages/release-tasks.md, main 17340a6a):
// a refresh asked for it runs it once, on a temporary instance of the new release with the service's settings and
// links, after its build passed and before any instance starts, and fails with nothing rolled out when it fails. No
// serve script migrates, so an instance of any version may start on a database a later release migrated (a production
// Deploy, 23 Nov: an instance of the version before restarted with new settings, migrated as it started, and knex
// refused a database holding migrations its code lacked).
//
// A Deployment's machine setup script (`- Machine setup:`) is each declaration's `build.setup`: the archive carries it at
// its root as MACHINE_SETUP_FILE (package.js packArchive), and mobilynet runs it once per setup layer, as root, in the
// build VM before the build's command, keeping what it wrote to /opt, /usr and /etc read-only on every machine of the
// release (its docs/colleague-usage/setup-scripts.md and app-builds.md). A layer is the project's, base's, packages'
// and script's, so a service is built on its own layer once and reuses it until one of them changes.

import { SERVICE_SETTING, buildLeadsOf, serviceAppName } from "../../builds.js";
import { MACHINE_SETUP_FILE, stackSettingsPerService, withRootFile } from "../../package.js";

/**
 * Where in the release the app's scripts go: `build.sh` (the build VM runs it), `serve-<service>.sh` (a service) and
 * `migrate-<service>.sh` (that service's migrate task).
 */
const APP_SCRIPTS_FOLDER = "vibe64-app";
const BUILD_SCRIPT = `${APP_SCRIPTS_FOLDER}/build.sh`;
const DECLARATION_FILE = "mobilynet.json";
// The port every service listens on, which a service it reaches and the load balancer ask.
const SERVICE_PORT = 3000;
// mobilynet's own limits: app names (logins too) of at most 32 characters (builds.js APP_NAME_MAX), and the settings of an App Service (its open
// settings, 19 Nov 2026). An App Service holds at most as many settings and secrets in all, its links' among them, as
// its region says now (`GET /v1/regions`, `serviceSettingsMax`): one fewer than the entries the region's hosts take for
// an instance's app, one of them mobilynet's own, so 199 where every host runs agent 2.9.0 or later and 49 while one
// runs an earlier agent, which takes 50. The adapter reads it (serviceSettingsMax), and the engine counts all a service
// is given (the Stack's, its Production Env entries) with its links' (LINK_FIELDS) against it; where mobilynet doesn't
// say, against SERVICE_SETTINGS_FALLBACK, what an earlier host holds. No setting may take a name mobilynet's runtime
// sets on every instance (RUNTIME_NAMES, RUNTIME_PREFIXES), which an app exporting its settings would lose; mobilynet
// refuses one the release doesn't declare, and the engine refuses each before anything changes. V64_* names are
// Vibe64's own, which mobilynet leaves open and the engine keeps out of the Production Env (package.js envEntryProblem).
const SERVICE_SETTINGS_FALLBACK = 49;
const RUNTIME_NAMES = Object.freeze(["PATH", "HOME", "LANG", "GIT_CONFIG_COUNT"]);
const RUNTIME_PREFIXES = Object.freeze(["MOBILYNET_", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"]);
// The Stack's runtimes by the runtime packs below; a runtime not here can't be declared.
const STACK_RUNTIME_PACKS = Object.freeze({
  composer: "composer", cpp: "cpp", git: "git", mariadb: "mariadb", nodejs: "node26", php: "php", playwright: "playwright",
  postgresql: "postgresql", python: "python"
});

// The nixpkgs packages of each runtime pack a Deployment can name (node26 for the Stack's nodejs), as mobilynet's base
// index names them. A pack not here can't be declared yet: playwright's browsers are not in the index. python's last two
// are the libraries its build points native modules at (PYTHON_LIBRARY_LINES).
const RUNTIME_PACKAGES = Object.freeze({
  composer: Object.freeze(["php84", "php84Packages.composer"]),
  cpp: Object.freeze(["binutils", "gcc", "clang", "lld", "cmake", "ninja", "gnumake", "pkg-config", "gdb", "lldb"]),
  git: Object.freeze(["git"]),
  mariadb: Object.freeze(["mariadb"]),
  node26: Object.freeze(["nodejs_26", "corepack"]),
  php: Object.freeze(["php84"]),
  postgresql: Object.freeze(["postgresql_18"]),
  python: Object.freeze(["python313", "python313Packages.pip", "python313Packages.virtualenv", "gcc-unwrapped^lib", "zlib"])
});
// The python runtime's last build step, with patchelf, which only the build VM gets (the build block's `packages`). The
// native modules of pip's manylinux wheels (numpy, pandas, scipy) need libstdc++.so.6, libgcc_s.so.1 and libz.so.1 from
// the system, and python313's loader searches no system folder, so `import numpy` fails with "libstdc++.so.6: cannot
// open shared object file". Each shared object of the release that needs one of them gets the folders of the packages
// that hold them (gcc-unwrapped^lib, zlib) added to its RUNPATH, after its own, as auditwheel points one at the
// libraries its wheel bundles. Those are the machine's paths, the same in the build VM, so a venv built in
// /home/build/src still loads them from the app's folder, /nix/var/mobilynet/apps/<app>. A copy of the interpreter made
// to load them could not do that: a venv links to its interpreter by the build's path. Nothing goes into the
// environment, so no child process sees the libraries.
const PYTHON_LIBRARY_LINES = Object.freeze([
  "printf '%s\\n' 'Python: point native modules at the C++ runtime and zlib'",
  "while IFS= read -r -d '' object; do",
  "  needed=\"$(patchelf --print-needed \"$object\" 2> /dev/null)\" || continue",
  "  if grep -qxE 'libstdc\\+\\+\\.so\\.6|libgcc_s\\.so\\.1|libz\\.so\\.1' <<< \"$needed\"; then",
  "    patchelf --add-rpath '/nix/var/mobilynet/packages/gcc-unwrapped^lib/lib:/nix/var/mobilynet/packages/zlib/lib' \"$object\"",
  "  fi",
  "done < <(find \"$vibe64_release\" -type f \\( -name '*.so' -o -name '*.so.*' \\) -print0)"
]);
// What every package needs for its own steps: bash runs the scripts, install is start, curl is check, jq reads the
// settings in the service script.
const BASE_PACKAGES = Object.freeze(["bash", "coreutils", "curl", "jq"]);
// A package as mobilynet's declarations name one (its packageName.js): a nixpkgs attribute, or one output of it after ^.
// mobilynet resolves each against its base's index when it takes the release, and takes at most 200.
const PACKAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]{0,127}(?:\^[A-Za-z_][A-Za-z0-9_-]{0,31})?$/u;
const MAX_PACKAGES = 200;
// The machine's kernel features (mobilynet's machineFeatures) each of a Deployment's `- Sandbox allows:` needs:
// gVisor's rootless runsc makes its own user namespace, and a FUSE mount needs /dev/fuse.
const SANDBOX_MACHINE_FEATURES = Object.freeze({ fuse: Object.freeze(["fuse"]), gvisor: Object.freeze(["userns"]) });
// The folders a runtime's builds keep for the next build of the same app, beside the Deployment's own (its `- Kept
// between builds:`), as the declaration's build cache: mobilynet's build VM starts with an empty home, puts back what
// the project's last build of the app left in those folders before the command, and keeps them again after it
// (mobilynet's metal/hostd/build-vm/mobilynet-build-run, cache-restore and cache-save), at most MAX_BUILD_CACHE.
const RUNTIME_CACHES = Object.freeze({ node26: Object.freeze(["~/.npm"]) });
const MAX_BUILD_CACHE = 10;
// The characters mobilynet takes in a command's words; the health path is one of check's.
const COMMAND_WORD = /^[A-Za-z0-9._,:=@+/-]+$/u;

/** The runtime packs no package can declare yet. @param {ReadonlyArray<string>} runtimes */
function unsupportedRuntimes(runtimes) {
  return runtimes.filter((runtime) => !Object.hasOwn(RUNTIME_PACKAGES, runtime));
}

/** The packages a declaration requires: the base's, the runtimes' and the Deployment's own, each once. */
function requiredPackagesOf(runtimes, packages = []) {
  return [...new Set([...BASE_PACKAGES, ...runtimes.flatMap((runtime) => RUNTIME_PACKAGES[runtime] ?? []), ...packages])];
}

/**
 * Why a Deployment's `- Packages:` can't be declared, or "": a name mobilynet doesn't take as a package's, or more
 * packages with the base's and the runtimes' than a machine takes. A name of the right form that the base's nixpkgs
 * lacks is mobilynet's refusal, when it takes the release.
 * @param {ReadonlyArray<string>} packages @param {ReadonlyArray<string>} runtimes
 */
function packagesProblem(packages, runtimes) {
  const wrong = packages.filter((name) => !PACKAGE_NAME.test(name));
  if (wrong.length > 0) {
    return `${wrong.map((name) => JSON.stringify(name)).join(", ")} ${wrong.length === 1 ? "isn't a package's name" : "aren't packages' names"}: `
      + "give each as nixpkgs names it, such as git or python313Packages.pip, or one output of it after ^, such as gcc-unwrapped^lib.";
  }
  const count = requiredPackagesOf(runtimes, packages).length;
  return count > MAX_PACKAGES
    ? `With those every app and its runtimes need, that is ${count} packages, and mobilynet takes at most ${MAX_PACKAGES}.`
    : "";
}

/**
 * The folders a build keeps for the next build of the same app: the runtimes', then the Deployment's own, each once.
 * @param {ReadonlyArray<string>} runtimes @param {ReadonlyArray<string>} [kept] the Deployment's `- Kept between builds:`
 */
function buildCacheOf(runtimes, kept = []) {
  return [...new Set([...runtimes.flatMap((runtime) => RUNTIME_CACHES[runtime] ?? []), ...kept])];
}

/** The kernel features a Deployment's sandbox allowances need, sorted. @param {ReadonlyArray<string>} allowances */
function machineFeaturesOf(allowances) {
  return [...new Set(allowances.flatMap((allowance) => SANDBOX_MACHINE_FEATURES[allowance] ?? []))].sort();
}

/** The sandbox allowances no machine feature stands for yet. @param {ReadonlyArray<string>} allowances */
function unsupportedSandboxAllowances(allowances) {
  return allowances.filter((allowance) => !Object.hasOwn(SANDBOX_MACHINE_FEATURES, allowance));
}

/** Why a health path can't be check's, or "". @param {string} healthPath */
function healthPathProblem(healthPath) {
  if (typeof healthPath === "string" && healthPath.startsWith("/") && healthPath.length <= 200 && COMMAND_WORD.test(healthPath)) {
    return "";
  }
  return `The health path ${JSON.stringify(healthPath)} must start with / and hold only letters, digits and . _ , : = @ + / -.`;
}

/** The home mobilynet makes for a declared login, where the app keeps its files. @param {string} login */
function appHome(login) {
  return `/home/${login}`;
}

/** Where start leaves the app's settings for its login, until the next boot. @param {string} name */
function settingsFileForLogin(name) {
  return `/run/app-settings/${name}/settings.json`;
}

/** A word as the shell reads it back, in single quotes. @param {string} text */
function shellWord(text) {
  return `'${String(text).replace(/'/gu, "'\\''")}'`;
}

/** An argument list as one shell command: plain words as they are, any other in single quotes. @param {string[]} argv */
function commandOf(argv) {
  return argv.map((word) => (COMMAND_WORD.test(word) ? word : shellWord(word))).join(" ");
}

/** The serve script of a service. @param {string} service */
function serveScriptOf(service) {
  return `${APP_SCRIPTS_FOLDER}/serve-${service}.sh`;
}

/** The migrate task's script of a service. @param {string} service */
function migrateScriptOf(service) {
  return `${APP_SCRIPTS_FOLDER}/migrate-${service}.sh`;
}

// The name the migrate task's settings take in its credentials' folder ($CREDENTIALS_DIRECTORY).
const MIGRATE_SETTINGS = "settings.json";
// A shared build's one service and its scripts, which run the instance's service's own (dispatchScript).
const SHARED_SERVICE = "app";
const SHARED_SERVE_SCRIPT = `${APP_SCRIPTS_FOLDER}/serve.sh`;
const SHARED_MIGRATE_SCRIPT = `${APP_SCRIPTS_FOLDER}/migrate.sh`;

/**
 * The migrate task's command, which mobilynet runs as root in the app's folder in place of the machine's start (so no
 * start leaves the settings for the login): systemd-run runs the service's migrate script as its login, in that folder,
 * with the services' environment (mobilynet's service.env: PATH and git's settings) and the settings mobilynet gave root
 * copied by systemd into the script's own credentials' folder, readable by the login alone. It waits for the script
 * and exits as it did, its output (and how it ended) the task's instance's logs. One program and plain words, as
 * mobilynet takes a command; mobilynet stops it at its start step's 280 seconds.
 * @param {string} name the app's name @param {string} login @param {string} script
 */
function migrateTaskOf(name, login, script) {
  return [
    "systemd-run --pipe --wait --collect --service-type=exec --same-dir", `--uid=${login}`,
    "--property=EnvironmentFile=/etc/mobilynet/service.env", `--property=LoadCredential=${MIGRATE_SETTINGS}:/run/mobilynet/apps/${name}/settings.json`,
    `bash ${script}`
  ].join(" ");
}

/**
 * The instance-local folder a service's login writes and may run programs in: the work area mobilynet makes for each
 * declared login on the machine's data disk (`/srv/<login>`, mounted nosuid,nodev but not noexec), which goes with the
 * instance. A declared data path would be root's, and start, one command, couldn't also give it to the login.
 * @param {string} login
 */
function workDirOf(login) {
  return `/srv/${login}`;
}

/**
 * The serve script's lines that give the instance facts, read from the `_mobilynet` object mobilynet puts in each
 * instance's settings: V64_INSTANCE_ID (its hostname), V64_PRIVATE_ADDRESS, V64_WORK_DIR and, for a service reached at
 * each instance, V64_INSTANCE_URL, the address the services that reach it ask this instance at. An instance without
 * `_mobilynet` gets none of them, and a service reached at each instance stops, naming why.
 * @param {{ service: string, login: string, port: number, reached: "any" | "each" }} service
 */
function instanceFactLines({ service, login, port, reached }) {
  const lines = [
    "unset V64_INSTANCE_ID V64_PRIVATE_ADDRESS V64_INSTANCE_URL V64_WORK_DIR",
    `if jq -e '._mobilynet | type == "object"' "$settings" > /dev/null; then`,
    `  export V64_INSTANCE_ID="$(jq -r '._mobilynet.hostname // "" | tostring' "$settings")"`,
    `  export V64_PRIVATE_ADDRESS="$(jq -r '._mobilynet.privateAddress // "" | tostring' "$settings")"`,
    `  export V64_WORK_DIR=${shellWord(workDirOf(login))}`
  ];
  if (reached !== "each") return [...lines, "fi"];
  const url = `._mobilynet | select([.hostname, .service, .projectId] | all(type == "string" and length > 0))`
    + ` | "http://\\(.hostname).\\(.service).\\(.projectId | gsub("_"; "-")).internal:${port}"`;
  return [
    ...lines,
    `  V64_INSTANCE_URL="$(jq -r ${shellWord(url)} "$settings")"`,
    "  if [ -n \"$V64_INSTANCE_URL\" ]; then export V64_INSTANCE_URL; else unset V64_INSTANCE_URL; fi",
    "fi",
    "if [ -z \"${V64_INSTANCE_URL:-}\" ]; then",
    `  echo ${shellWord(`Service ${service} is reached at each instance, so it needs this instance's own address: its `
      + "settings have no _mobilynet with its hostname, service and projectId, which mobilynet gives each instance.")} >&2`,
    "  exit 1",
    "fi"
  ];
}

/** The lines that print a step's name and run its command. @param {string} role @param {Step | null | undefined} step */
function stepLines(role, step) {
  if (!step?.command) return [];
  return [`printf '%s\\n' ${shellWord(`${role}: ${step.label || role}`)}`, step.command];
}

/**
 * An app's package: its mobilynet.json (`declaration`) and the scripts it names (`scripts`, each by its path in the
 * release). The build runs Prepare then Build, then, for the python runtime, points the release's native modules at the
 * libraries it declares (PYTHON_LIBRARY_LINES); the service exports the app's settings (and Serve's defaults for those
 * they leave out), then runs Migrate then Serve, as the app's login on `port`. Every step is a shell command, run in
 * `workdir`. No setting has a value here.
 * @param {object} app
 * @param {string} app.name the app's name on the mobilynet machine
 * @param {string} app.login the login its service runs as
 * @param {number} app.port
 * @param {string} app.healthPath
 * @param {ReadonlyArray<string>} app.runtimes runtime packs, each one RUNTIME_PACKAGES has
 * @param {Record<string, { type: string, secret: boolean, required: boolean, description?: string }>} app.settings
 * @param {string} [app.workdir] the folder of the release the steps run in
 * @param {{ prepare?: Step | null, build?: Step | null, migrate?: Step | null, serve: Step & { defaults?: Record<string, string> } }} app.steps
 * @param {Array<{ interface: string, as: string }>} [app.needs] what the app needs a hosted service for, each giving it
 *   settings `<AS>_<FIELD>` once linked (mobilynetNeeds.js)
 * @param {string[]} [app.bindingLines] the service's lines, after the settings are exported, that set the names the
 *   app reads from those settings (mobilynetNeeds.js bindingExportLines)
 * @param {ReadonlyArray<string>} [app.packages] the Deployment's own packages (`- Packages:`), on top of the base's and
 *   the runtimes', each a name packagesProblem takes
 * @param {ReadonlyArray<string>} [app.sandboxAllowances] the Deployment's `- Sandbox allows:`, declared as the machine
 *   features they need (machineFeatures), each one SANDBOX_MACHINE_FEATURES has
 * @param {ReadonlyArray<string>} [app.buildCache] the Deployment's `- Kept between builds:`, folders of the build's home
 *   kept with the runtimes' for the next build (buildCacheOf)
 * @param {boolean} [app.machineSetup] whether the Deployment names a machine setup script, which the declaration's
 *   build.setup then names at the archive's root (MACHINE_SETUP_FILE)
 * @typedef {{ command: string, label?: string }} Step
 */
function appPackage({
  name, login, port, healthPath, runtimes, settings, workdir = ".", steps, needs = [], bindingLines = [], packages = [], sandboxAllowances = [],
  buildCache = [], machineSetup = false, service = "web", reached = "any", serviceSettings = {}
}) {
  const serveScript = serveScriptOf(service);
  // Migrate runs as the release's task, once per Deploy, never as an instance starts.
  const migrateScript = steps.migrate ? migrateScriptOf(service) : null;
  const machineFeatures = machineFeaturesOf(sandboxAllowances);
  const pythonLibraries = runtimes.includes("python");
  const declaration = {
    name,
    requiredPackages: requiredPackagesOf(runtimes, packages),
    build: {
      ...(pythonLibraries ? { packages: ["patchelf"] } : {}),
      ...(machineSetup ? { setup: MACHINE_SETUP_FILE } : {}),
      command: `bash ${BUILD_SCRIPT}`,
      cache: buildCacheOf(runtimes, buildCache),
      output: ["."]
    },
    start: `install -D --owner=${login} --mode=0400 /run/mobilynet/apps/${name}/settings.json ${settingsFileForLogin(name)}`,
    services: [{ name: service, command: `bash ${serveScript}`, user: login, port, healthPath }],
    // About 100 of the 110 seconds mobilynet gives check, asking again while the service starts.
    check: "curl --fail --silent --show-error --output /dev/null --retry 30 --retry-delay 3 --retry-all-errors "
      + `--retry-max-time 100 --max-time 10 http://127.0.0.1:${port}${healthPath}`,
    logins: [{ name: login }],
    settings,
    ...(machineFeatures.length > 0 ? { machineFeatures } : {}),
    ...(needs.length > 0 ? { needs } : {}),
    ...(migrateScript ? { tasks: { migrate: { command: migrateTaskOf(name, login, migrateScript) } } } : {})
  };
  const intoWorkdir = workdir === "." ? [] : [`cd -- ${shellWord(workdir)}`];
  const build = [
    "#!/usr/bin/env bash",
    "# Made by Vibe64: mobilynet's build VM runs this in the release's folder, which it then keeps as the app.",
    "set -euo pipefail",
    // The whole release's modules, wherever the steps put them: a venv may sit beside the work folder.
    ...(pythonLibraries ? ["vibe64_release=\"$PWD\""] : []),
    ...intoWorkdir,
    ...stepLines("Prepare", steps.prepare),
    ...stepLines("Build", steps.build),
    ...(pythonLibraries ? PYTHON_LIBRARY_LINES : []),
    ""
  ];
  // What the serve script and the migrate task both do first: export the settings (those start left for this login, or
  // the task's credential), the resources' names, the instance's facts and the service's own. The task's instance
  // serves nothing, so it needs no address of its own.
  const prologue = (settingsLines, facts) => [
    "set -euo pipefail",
    ...settingsLines,
    "while IFS= read -r -d '' key && IFS= read -r -d '' value; do export \"$key=$value\"; done < <(",
    "  jq -j 'to_entries[] | select(.key != \"_mobilynet\" and (.key | test(\"^[A-Za-z_][A-Za-z0-9_]*$\"))) | .key, \"\\u0000\", (.value | tostring), \"\\u0000\"' \"$settings\")",
    // The app's folder is read-only, so sign-ins kept in files live where the setting says, in the login's home.
    "if [ -n \"${AUTH_LOCAL_STORE_DIR:-}\" ]; then mkdir -p -- \"$AUTH_LOCAL_STORE_DIR\"; fi",
    ...bindingLines,
    ...instanceFactLines({ service, login, port, reached: facts }),
    // The service's own facts of the source (its `- Setting` lines), whatever the settings say.
    ...Object.entries(serviceSettings).map(([key, value]) => `export ${key}=${shellWord(value)}`),
    ...Object.entries(steps.serve.defaults ?? {})
      .map(([key, value]) => `if [ -z "\${${key}+set}" ]; then export ${key}=${shellWord(value)}; fi`),
    ...intoWorkdir
  ];
  const serve = [
    "#!/usr/bin/env bash",
    `# Made by Vibe64: the app's service ${service}. It exports the settings start left for this login and the instance's `
      + "facts, then serves; the release's migrate task migrates, once per Deploy.",
    ...prologue([
      `settings=${shellWord(settingsFileForLogin(name))}`,
      `if [ ! -r "$settings" ]; then echo "No settings at $settings: the app's start step writes them." >&2; exit 1; fi`
    ], reached),
    steps.serve.command,
    ""
  ];
  const scripts = { [BUILD_SCRIPT]: build.join("\n"), [serveScript]: serve.join("\n") };
  if (migrateScript) {
    scripts[migrateScript] = [
      "#!/usr/bin/env bash",
      `# Made by Vibe64: the release's migrate task for service ${service}, run once by a Deploy on a temporary instance of `
        + "the new release, before any of its instances starts, as the app's login. It exports the settings systemd-run "
        + "handed it, as the service does, then migrates.",
      ...prologue([
        `settings="\${CREDENTIALS_DIRECTORY:-}/${MIGRATE_SETTINGS}"`,
        `if [ ! -r "$settings" ]; then echo "No settings at $settings: the release task's systemd-run hands them over." >&2; exit 1; fi`
      ], "any"),
      ...stepLines("Migrate", steps.migrate),
      ""
    ].join("\n");
  }
  return { declaration, scripts };
}

// How Production's neutral needs (needs.js) become mobilynet's. A resource kind is one of mobilynet's interfaces, which a
// hosted service provides and an app's release declares as a need (`needs: [{ interface, as }]` in its mobilynet.json);
// linking the hosted service to the App Service gives the app the interface's fields as settings named `<AS>_<FIELD>`
// (mobilynet's needSettingName). The declaration names the needs and writes, in the app's service script, the settings
// the app's own bindings name from those; the steps link each hosted service under the same `as`.

/** mobilynet's interface for each resource kind Production runs. */
const MOBILYNET_INTERFACES = Object.freeze({ mysql: "mysql", postgresql: "postgresql", redis: "redis", bucket: "s3" });
/** The fields a link of each interface gives a service, each a setting `<AS>_<FIELD>` (mobilynet's interface registry). */
const DATABASE_FIELDS = Object.freeze(["host", "port", "database", "user", "password", "sslmode"]);
const LINK_FIELDS = Object.freeze({
  mysql: DATABASE_FIELDS,
  postgresql: DATABASE_FIELDS,
  redis: Object.freeze(["host", "port", "username", "password", "db"]),
  s3: Object.freeze(["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"])
});
const AS_MAX = 24;

/**
 * A resource's need name (`as`) at mobilynet: V64_ and its id in capitals, so it never meets a setting of the app's own.
 * @param {string} resourceId
 */
function needAs(resourceId) {
  return `V64_${String(resourceId).toUpperCase().replace(/[^A-Z0-9]/gu, "_")}`.slice(0, AS_MAX);
}

/** The setting mobilynet gives a need's field: `<AS>_<FIELD>`, camelCase as UPPER_SNAKE. @param {string} as @param {string} field */
function needSetting(as, field) {
  return `${as}_${field.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toUpperCase()}`;
}

/** The release declaration's needs. @param {{ resources: Array<{ id: string, kind: string }> }} needs */
function declarationNeeds(needs) {
  return needs.resources.map((resource) => ({ interface: MOBILYNET_INTERFACES[resource.kind], as: needAs(resource.id) }));
}

// Which interface field each binding semantic reads, where it reads one field.
const FIELD_OF = Object.freeze({
  database: Object.freeze({ host: "host", port: "port", database: "database", username: "user", password: "password" }),
  redis: Object.freeze({}),
  bucket: Object.freeze({ bucket: "bucket", region: "region", endpoint: "endpoint", accessKeyId: "accessKeyId", secretAccessKey: "secretAccessKey" })
});

/**
 * The field of a resource's link a binding semantic is given (`host`, `user`, `bucket`...), or null for one made from
 * several (a database's or Redis's `url`, the password with them) or a constant (a bucket's `driver`, `s3`).
 * @param {string} kind the resource's kind @param {string} semantic
 */
function bindingField(kind, semantic) {
  const group = kind === "mysql" || kind === "postgresql" ? "database" : kind;
  return FIELD_OF[group]?.[semantic] ?? null;
}

/**
 * The service script's lines that set each setting the app's bindings name from the need's settings: a field as it
 * is, a URL made of the fields (each part URL-encoded by jq), a bucket's driver as `s3`. They run after the settings
 * are exported, so a need's settings are there.
 * @param {{ resources: Array<{ id: string, kind: string, bindings: Record<string, string> }> }} needs
 */
function bindingExportLines(needs) {
  const lines = [];
  for (const resource of needs.resources) {
    const as = needAs(resource.id);
    const field = (name) => `\${${needSetting(as, name)}-}`;
    const group = resource.kind === "mysql" || resource.kind === "postgresql" ? "database" : resource.kind;
    for (const [semantic, name] of Object.entries(resource.bindings)) {
      if (FIELD_OF[group][semantic]) {
        lines.push(`export ${name}="${field(FIELD_OF[group][semantic])}"`);
      } else if (semantic === "driver") {
        lines.push(`export ${name}=s3`);
      } else if (semantic === "url" && group === "database") {
        const scheme = resource.kind === "mysql" ? "mysql" : "postgresql";
        const query = resource.kind === "postgresql" ? '+ (if $sslmode == "" then "" else "?sslmode=" + ($sslmode | @uri) end)' : "";
        lines.push(`export ${name}="$(jq -rn --arg user "${field("user")}" --arg password "${field("password")}" `
          + `--arg host "${field("host")}" --arg port "${field("port")}" --arg database "${field("database")}" `
          + `--arg sslmode "${field("sslmode")}" ${shellWord(`"${scheme}://" + ($user | @uri) + ":" + ($password | @uri) + "@" + $host + ":" + $port + "/" + ($database | @uri) ${query}`)})"`);
      } else if (semantic === "url" && group === "redis") {
        lines.push(`export ${name}="$(jq -rn --arg user "${field("username")}" --arg password "${field("password")}" `
          + `--arg host "${field("host")}" --arg port "${field("port")}" --arg db "${field("db")}" `
          + `${shellWord('"redis://" + ($user | @uri) + ":" + ($password | @uri) + "@" + $host + ":" + $port + "/" + $db')})"`);
      }
    }
  }
  return lines;
}

/** A refusal a caller shows as it is, with its code and HTTP status. */
function declarationError({ code, message }) {
  return Object.assign(new Error(message), { code, status: 422 });
}

/**
 * Whether mobilynet's runtime sets a name on every instance: the prefix it starts with or the name itself, else "".
 * @param {string} name
 */
function runtimeSets(name) {
  return RUNTIME_PREFIXES.find((prefix) => name.startsWith(prefix)) ?? (RUNTIME_NAMES.includes(name) ? name : "");
}

/**
 * Why mobilynet can't take a package for these services, as `{ code, message }`, or null: a Deployment that isn't
 * ready, a runtime or sandbox allowance no package can declare yet, a health path check can't ask, a service's
 * packages mobilynet can't take, a setting a service would be given by a name mobilynet's runtime sets, or a service
 * given more settings than its region holds, its Production Env entries and its links' counted with the Stack's. Each
 * names the service and the fix.
 * @param {any} deployment the Stack's Deployment section as public Vibe64 inspected it (v2)
 * @param {Record<string, Record<string, object>>} [settings] each service's settings (package.js settingsPerService)
 * @param {{ settingsMax?: number }} [limits] how many settings and secrets an App Service of the region holds now (the
 *   adapter's serviceSettingsMax), SERVICE_SETTINGS_FALLBACK when not given
 */
function servicePackagesProblem(deployment, settings = {}, { settingsMax = SERVICE_SETTINGS_FALLBACK } = {}) {
  if (deployment?.status !== "ready" || !Array.isArray(deployment.services) || deployment.services.length === 0) {
    return {
      code: "vibe64_app_package_deployment_unready",
      message: `Vibe64 makes mobilynet.json from the Stack's Deployment section, which isn't ready: ${deployment?.diagnostics?.[0]?.message || "the Stack has none."}`
    };
  }
  const runtimes = deployment.runtimeRequirements.map((runtime) => STACK_RUNTIME_PACKS[runtime] ?? runtime);
  const unsupported = unsupportedRuntimes(runtimes);
  if (unsupported.length > 0) {
    return {
      code: "vibe64_app_package_runtime_unsupported",
      message: `The Deployment needs ${unsupported.join(", ")}, which a mobilynet package can't declare yet. `
        + "Remove it from the Stack's - Runtimes: line, Save, then try again."
    };
  }
  const cache = buildCacheOf(runtimes, deployment.buildCache ?? []);
  if (cache.length > MAX_BUILD_CACHE) {
    return {
      code: "vibe64_app_package_build_cache_invalid",
      message: `A mobilynet build keeps at most ${MAX_BUILD_CACHE} folders between builds, its runtimes' among them `
        + `(${buildCacheOf(runtimes).join(", ")}), and the Deployment would keep ${cache.length}. Name fewer in genesis/stack.md's `
        + "- Kept between builds: (the coding agent can do this), Save, then deploy to production."
    };
  }
  // Every service is linked to each resource Production makes, whose link's fields mobilynet writes into its settings
  // and secrets. A service's names are each counted once (settingsPerService's keys: a generated secret or the setup
  // code the Env holds too is one); the setup code is counted even once the first account removed it from the Env, as
  // a first Deploy makes and sends it.
  const linked = (deployment.resources ?? []).reduce((sum, declared) => sum + (LINK_FIELDS[MOBILYNET_INTERFACES[declared?.resource?.kind]]?.length ?? 0), 0);
  // A service of a shared build is given one more, its V64_SERVICE.
  const leads = buildLeadsOf(deployment.services);
  const shared = (id) => deployment.services.some((other) => other.id !== id && leads[other.id] === leads[id]);
  for (const service of deployment.services) {
    const allowances = unsupportedSandboxAllowances(service.sandboxAllowances);
    if (allowances.length > 0) {
      return {
        code: "vibe64_app_package_sandbox_unsupported",
        message: `Service ${service.id}'s - Sandbox allows: names ${allowances.join(", ")}, which a mobilynet package can't declare yet.`
      };
    }
    const health = healthPathProblem(service.readyWhen.path);
    if (health) return { code: "vibe64_app_package_health_path_invalid", message: `Service ${service.id}: ${health}` };
    const packages = packagesProblem([...deployment.packages, ...service.packages], runtimes);
    if (packages) {
      return {
        code: "vibe64_app_package_packages_invalid",
        message: `genesis/stack.md's Deployment - Packages: for service ${service.id} can't be declared: ${packages} Fix it in `
          + "genesis/stack.md (the coding agent can do this), Save, then deploy to production."
      };
    }
    const names = Object.keys(settings[service.id] ?? {});
    const reserved = names.find((name) => runtimeSets(name));
    if (reserved) {
      const sets = runtimeSets(reserved);
      const stack = [...(deployment.generatedSecrets ?? []), deployment.setupCode, ...(service.reaches ?? []).map((reach) => reach.setting)];
      return {
        code: "vibe64_production_setting_reserved",
        message: `Service ${service.id} would be given ${reserved}, and mobilynet sets ${sets === reserved ? "that name" : `every name starting ${sets}`} `
          + "itself on every instance, so the app would lose it. "
          + (stack.includes(reserved) ? "Name it otherwise in genesis/stack.md (the coding agent can do this), Save, then deploy to production."
            : `Save its value in the Production Env under another name and remove ${reserved}, then deploy to production.`)
      };
    }
    const own = names.length + (shared(service.id) ? 1 : 0);
    const count = own + linked;
    if (count > settingsMax) {
      return {
        code: "vibe64_production_too_many_settings",
        message: `mobilynet gives an App Service at most ${settingsMax} settings and secrets in all, its links' among them, `
          + `and service ${service.id} would have ${count}: ${own} of its own and ${linked} from its links. Remove Production Env `
          + "entries it doesn't use, or give them only to the services that use them, then deploy to production."
      };
    }
  }
  return null;
}

/**
 * A shared build's dispatching script: it reads the service the instance's App Service is (its V64_SERVICE, in the
 * settings file `settingsLines` name) and runs that service's own script, or stops naming why.
 * @param {string} role what it runs, for its comment @param {string[]} settingsLines @param {Record<string, string>} scripts
 *   each service's own script by its id
 */
function dispatchScript(role, settingsLines, scripts) {
  const known = Object.keys(scripts);
  return [
    "#!/usr/bin/env bash",
    `# Made by Vibe64: the release's ${role}, shared by its services (${known.join(", ")}). It runs the script of the `
      + `service this instance's App Service is, which its ${SERVICE_SETTING} setting names.`,
    "set -euo pipefail",
    ...settingsLines,
    `service="$(jq -r '.${SERVICE_SETTING} // "" | tostring' "$settings")"`,
    "case \"$service\" in",
    ...Object.entries(scripts).map(([id, script]) => `  ${id}) exec bash ${script} ;;`),
    `  *) echo "${SERVICE_SETTING} is \\"$service\\", and this release runs ${known.join(" or ")}: the deploy gives each App Service its own." >&2; exit 1 ;;`,
    "esac",
    ""
  ].join("\n");
}

/** A setting's flags across a build's services: secret where any says so, required only where every one requires it. */
function unionSettings(each) {
  const names = [...new Set(each.flatMap((settings) => Object.keys(settings)))];
  return Object.fromEntries(names.map((name) => [name, {
    type: "string",
    secret: each.some((settings) => settings[name]?.secret === true),
    required: each.every((settings) => settings[name]?.required === true)
  }]));
}

/**
 * mobilynet's package for each build of a Deployment: one declaration per build (builds.js; each need's service's
 * `builtWith`, its own when the needs don't say), named `<app>-<lead>` and run as a login of that name, which builds
 * from the shared build script; every service needs every resource. A build of one service runs its own serve script,
 * as every service did before; a shared build runs `serve.sh`, which runs the instance's service's own (dispatchScript),
 * and takes the packages and settings of all its services (unionSettings). A declaration declares only the settings
 * the Stack names for its services, with their types and required flags (package.js stackSettingsPerService), and a
 * need per resource, whose settings its link gives: never a Production Env entry, which mobilynet takes in a settings
 * replace as a setting or a secret the release doesn't declare. So a release is made of the code and the Stack alone,
 * and a change of the Env is a change of settings, never a new release or build. Refuses with servicePackagesProblem's
 * reason.
 * @param {object} options
 * @param {string} options.app the app's name (productionAppName)
 * @param {any} options.deployment the Stack's Deployment section as public Vibe64 inspected it (v2)
 * @param {object} options.needs needsOfStack's needs
 * @param {Record<string, Record<string, { secret: boolean, required: boolean }>>} options.settings each service's
 *   settings (package.js settingsPerService), counted against mobilynet's limit
 * @param {number} [options.settingsMax] how many settings and secrets an App Service of the region holds now (the
 *   adapter's serviceSettingsMax), SERVICE_SETTINGS_FALLBACK when not given
 * @param {Record<string, string>} [options.defaults] Serve's own defaults beside the runtime's (the Stack's Environment
 *   defaults), which a setting overrides
 * @returns {{ declarations: Record<string, object>, scripts: Record<string, string> }} `declarations` by service id,
 *   the services of one build sharing one declaration
 */
function servicePackages({ app, deployment, needs, settings, settingsMax, defaults = {} }) {
  const problem = servicePackagesProblem(deployment, settings, { settingsMax });
  if (problem) throw declarationError(problem);
  const runtimes = deployment.runtimeRequirements.map((runtime) => STACK_RUNTIME_PACKS[runtime]);
  const step = (role) => {
    const steps = deployment.steps.filter((entry) => entry.role === role);
    return steps.length === 0 ? null : { command: steps.map((entry) => commandOf(entry.argv)).join(" && "), label: steps.map((entry) => entry.label).join("; ") };
  };
  // Like Heroku and Dokku, a Node app's service runs in production mode; only the service, so Prepare keeps the
  // devDependencies Build needs.
  const serveDefaults = { ...defaults, ...(runtimes.includes("node26") ? { NODE_ENV: "production" } : {}) };
  const declared = stackSettingsPerService(needs);
  const leadOf = (id) => needs.services.find((one) => one.id === id)?.builtWith ?? id;
  const builds = new Map();
  for (const service of deployment.services) builds.set(leadOf(service.id), [...(builds.get(leadOf(service.id)) ?? []), service]);
  const declarations = {};
  const scripts = {};
  for (const [lead, services] of builds) {
    const name = serviceAppName(app, lead);
    const shared = {
      name,
      login: name,
      port: SERVICE_PORT,
      healthPath: services[0].readyWhen.path,
      runtimes,
      settings: unionSettings(services.map((service) => declared[service.id] ?? {})),
      workdir: deployment.workdir,
      needs: declarationNeeds(needs),
      bindingLines: bindingExportLines(needs),
      packages: [...deployment.packages, ...services.flatMap((service) => service.packages)],
      sandboxAllowances: services[0].sandboxAllowances,
      buildCache: deployment.buildCache ?? [],
      machineSetup: Boolean(deployment.machineSetup)
    };
    const made = services.map((service) => appPackage({
      ...shared,
      service: service.id,
      reached: service.reached,
      steps: {
        prepare: step("prepare"),
        build: step("build"),
        migrate: step("migrate"),
        serve: { command: commandOf(service.serve.argv), label: service.serve.label, defaults: serveDefaults }
      },
      serviceSettings: service.settings
    }));
    for (const one of made) Object.assign(scripts, one.scripts);
    let declaration = made[0].declaration;
    if (services.length > 1) {
      const serving = Object.fromEntries(services.map((service) => [service.id, serveScriptOf(service.id)]));
      scripts[SHARED_SERVE_SCRIPT] = dispatchScript("service", [
        `settings=${shellWord(settingsFileForLogin(name))}`,
        `if [ ! -r "$settings" ]; then echo "No settings at $settings: the app's start step writes them." >&2; exit 1; fi`
      ], serving);
      declaration = { ...declaration, services: [{ ...declaration.services[0], name: SHARED_SERVICE, command: `bash ${SHARED_SERVE_SCRIPT}` }] };
      if (declaration.tasks?.migrate) {
        scripts[SHARED_MIGRATE_SCRIPT] = dispatchScript("migrate task", [
          `settings="\${CREDENTIALS_DIRECTORY:-}/${MIGRATE_SETTINGS}"`,
          `if [ ! -r "$settings" ]; then echo "No settings at $settings: the release task's systemd-run hands them over." >&2; exit 1; fi`
        ], Object.fromEntries(services.map((service) => [service.id, migrateScriptOf(service.id)])));
        declaration = { ...declaration, tasks: { ...declaration.tasks, migrate: { command: migrateTaskOf(name, name, SHARED_MIGRATE_SCRIPT) } } };
      }
    }
    for (const service of services) declarations[service.id] = declaration;
  }
  return { declarations, scripts };
}

/**
 * The upload of one service: the archive with that service's declaration at its root, and its SHA-256.
 * @param {Buffer} archive package.js packArchive's bytes @param {object} declaration
 */
function serviceUpload(archive, declaration) {
  return withRootFile(archive, DECLARATION_FILE, `${JSON.stringify(declaration, null, 2)}\n`);
}


export {
  APP_SCRIPTS_FOLDER,
  MOBILYNET_INTERFACES,
  SERVICE_PORT,
  SERVICE_SETTINGS_FALLBACK,
  STACK_RUNTIME_PACKS,
  appHome,
  appPackage,
  bindingExportLines,
  bindingField,
  commandOf,
  declarationNeeds,
  healthPathProblem,
  instanceFactLines,
  machineFeaturesOf,
  needAs,
  needSetting,
  packagesProblem,
  requiredPackagesOf,
  runtimeSets,
  serviceAppName,
  servicePackages,
  servicePackagesProblem,
  serviceUpload,
  shellWord,
  stepLines,
  unsupportedRuntimes,
  unsupportedSandboxAllowances,
  workDirOf
};
