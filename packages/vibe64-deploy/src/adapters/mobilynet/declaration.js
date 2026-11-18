// The mobilynet adapter's declaration: the package Vibe64 hands mobilynet for an app, its mobilynet.json and its two
// scripts, in mobilynet's build model of 16 Nov 2026. mobilynet builds the release from source in a throwaway build VM
// by the declaration's `build` block, keeps the folder as the app's read-only output and runs the app as a service, as
// the app's own login.
//
// mobilynet runs `start` and `check` as root, and the build can write any file of the output. So neither runs a file of
// the app's: start is `install`, which copies the settings mobilynet keeps for root into a file only the app's login
// reads, and check is `curl` asking the app's health path. Both are programs on the machine's PATH, outside the app's
// folder. The app's own code runs only in its service, as its login.

/** Where in the release the app's scripts go: `build` (the build VM runs it) and `serve` (the service). */
const APP_SCRIPTS_FOLDER = "vibe64-app";
const BUILD_SCRIPT = `${APP_SCRIPTS_FOLDER}/build`;
const SERVE_SCRIPT = `${APP_SCRIPTS_FOLDER}/serve`;

// The nixpkgs packages of each runtime pack a Deployment can name (node26 for the Stack's nodejs), as mobilynet's base
// index names them. A pack not here can't be declared yet: playwright's browsers are not in the index.
const RUNTIME_PACKAGES = Object.freeze({
  composer: Object.freeze(["php84", "php84Packages.composer"]),
  cpp: Object.freeze(["binutils", "gcc", "clang", "lld", "cmake", "ninja", "gnumake", "pkg-config", "gdb", "lldb"]),
  git: Object.freeze(["git"]),
  mariadb: Object.freeze(["mariadb"]),
  node26: Object.freeze(["nodejs_26", "corepack"]),
  php: Object.freeze(["php84"]),
  postgresql: Object.freeze(["postgresql_16"]),
  python: Object.freeze(["python313", "python313Packages.pip", "python313Packages.virtualenv"])
});
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
// The folders a runtime's builds keep for the next build of the same app.
const RUNTIME_CACHES = Object.freeze({ node26: Object.freeze(["~/.npm"]) });
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
  return `/run/vibe64-apps/${name}/settings.json`;
}

/** A word as the shell reads it back, in single quotes. @param {string} text */
function shellWord(text) {
  return `'${String(text).replace(/'/gu, "'\\''")}'`;
}

/** The lines that print a step's name and run its command. @param {string} role @param {Step | null | undefined} step */
function stepLines(role, step) {
  if (!step?.command) return [];
  return [`printf '%s\\n' ${shellWord(`${role}: ${step.label || role}`)}`, step.command];
}

/**
 * An app's package: its mobilynet.json (`declaration`) and the scripts it names (`scripts`, each by its path in the
 * release). The build runs Prepare then Build; the service exports the app's settings (and Serve's defaults for those
 * they leave out), then runs Migrate then Serve, as the app's login on `port`. Every step is a shell command, run in
 * `workdir`. No setting has a value here.
 * @param {object} app
 * @param {string} app.name the app's name on the VPS
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
 * @typedef {{ command: string, label?: string }} Step
 */
function appPackage({
  name, login, port, healthPath, runtimes, settings, workdir = ".", steps, needs = [], bindingLines = [], packages = [], sandboxAllowances = []
}) {
  const machineFeatures = machineFeaturesOf(sandboxAllowances);
  const declaration = {
    name,
    requiredPackages: requiredPackagesOf(runtimes, packages),
    build: {
      command: `bash ${BUILD_SCRIPT}`,
      cache: [...new Set(runtimes.flatMap((runtime) => RUNTIME_CACHES[runtime] ?? []))],
      output: ["."]
    },
    start: `install -D --owner=${login} --mode=0400 /run/mobilynet/apps/${name}/settings.json ${settingsFileForLogin(name)}`,
    services: [{ name: "web", command: `bash ${SERVE_SCRIPT}`, user: login, port, healthPath }],
    // About 100 of the 110 seconds mobilynet gives check, asking again while the service starts.
    check: "curl --fail --silent --show-error --output /dev/null --retry 30 --retry-delay 3 --retry-all-errors "
      + `--retry-max-time 100 --max-time 10 http://127.0.0.1:${port}${healthPath}`,
    logins: [{ name: login }],
    settings,
    ...(machineFeatures.length > 0 ? { machineFeatures } : {}),
    ...(needs.length > 0 ? { needs } : {})
  };
  const intoWorkdir = workdir === "." ? [] : [`cd -- ${shellWord(workdir)}`];
  const build = [
    "#!/usr/bin/env bash",
    "# Made by Vibe64: mobilynet's build VM runs this in the release's folder, which it then keeps as the app.",
    "set -euo pipefail",
    ...intoWorkdir,
    ...stepLines("Prepare", steps.prepare),
    ...stepLines("Build", steps.build),
    ""
  ];
  const serve = [
    "#!/usr/bin/env bash",
    "# Made by Vibe64: the app's service. It exports the settings start left for this login, then migrates and serves.",
    "set -euo pipefail",
    `settings=${shellWord(settingsFileForLogin(name))}`,
    `if [ ! -r "$settings" ]; then echo "No settings at $settings: the app's start step writes them." >&2; exit 1; fi`,
    "while IFS= read -r -d '' key && IFS= read -r -d '' value; do export \"$key=$value\"; done < <(",
    "  jq -j 'to_entries[] | select(.key | test(\"^[A-Za-z_][A-Za-z0-9_]*$\")) | .key, \"\\u0000\", (.value | tostring), \"\\u0000\"' \"$settings\")",
    // The app's folder is read-only, so sign-ins kept in files live where the setting says, in the login's home.
    "if [ -n \"${AUTH_LOCAL_STORE_DIR:-}\" ]; then mkdir -p -- \"$AUTH_LOCAL_STORE_DIR\"; fi",
    ...bindingLines,
    ...Object.entries(steps.serve.defaults ?? {})
      .map(([key, value]) => `if [ -z "\${${key}+set}" ]; then export ${key}=${shellWord(value)}; fi`),
    ...intoWorkdir,
    ...stepLines("Migrate", steps.migrate),
    steps.serve.command,
    ""
  ];
  return { declaration, scripts: { [BUILD_SCRIPT]: build.join("\n"), [SERVE_SCRIPT]: serve.join("\n") } };
}

// How Production's neutral needs (needs.js) become mobilynet's. A resource kind is one of mobilynet's interfaces, which a
// hosted service provides and an app's release declares as a need (`needs: [{ interface, as }]` in its mobilynet.json);
// linking the hosted service to the App Service gives the app the interface's fields as settings named `<AS>_<FIELD>`
// (mobilynet's needSettingName). The declaration names the needs and writes, in the app's service script, the settings
// the app's own bindings name from those; the steps link each hosted service under the same `as`.

/** mobilynet's interface for each resource kind Production runs. */
const MOBILYNET_INTERFACES = Object.freeze({ mysql: "mysql", postgresql: "postgresql", redis: "redis", bucket: "s3" });
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

export {
  APP_SCRIPTS_FOLDER,
  MOBILYNET_INTERFACES,
  appHome,
  appPackage,
  bindingExportLines,
  declarationNeeds,
  healthPathProblem,
  machineFeaturesOf,
  needAs,
  needSetting,
  packagesProblem,
  unsupportedRuntimes,
  unsupportedSandboxAllowances
};
