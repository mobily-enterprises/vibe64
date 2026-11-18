// The release as an OCI image, for a provider that runs containers: each service's image is built at the provider, by
// its own build service, from the one archive (package.js packArchive) with this module's scripts in vibe64-app/ and a
// Containerfile added for that service (imageUpload). No Vibe64 credential is in the build. The image installs the
// service's packages from nixpkgs, the same attribute names mobilynet's declarations require (the base's, the runtime's,
// the Deployment's shared Packages and the service's own), at the nixpkgs revision the editor names, then runs the
// shared build script (Prepare, Build) and serves as a user of its own on port 3000.
//
// In the container every setting is an environment variable the provider gives (a secret one from its secret store),
// each resource's fields among them as `V64_<RESOURCE>_<FIELD>`, the names mobilynet's needs give, so the serve script
// maps them to the names the app reads as mobilynet's does (bindingExportLines). The instance facts are those the
// runtime gives (V64_INSTANCE_ID, V64_PRIVATE_ADDRESS, V64_INSTANCE_URL, V64_WORK_DIR): a service reached at each
// instance stops without V64_INSTANCE_URL, naming why.
import { withRootFile } from "./package.js";
import {
  APP_SCRIPTS_FOLDER,
  SERVICE_PORT,
  STACK_RUNTIME_PACKS,
  bindingExportLines,
  commandOf,
  healthPathProblem,
  machineFeaturesOf,
  needAs,
  requiredPackagesOf,
  serviceAppName,
  shellWord,
  stepLines,
  unsupportedRuntimes,
  unsupportedSandboxAllowances
} from "./adapters/mobilynet/declaration.js";

const BUILD_SCRIPT = `${APP_SCRIPTS_FOLDER}/build.sh`;
const CONTAINERFILE = `${APP_SCRIPTS_FOLDER}/Containerfile`;
// The image every service's is built on: Nix itself, which installs the packages. To pin by digest at the first real
// build.
const NIX_IMAGE = "docker.io/nixos/nix:2.28.4";
// Where the release is in the image, and the user the service runs as.
const APP_ROOT = "/srv/app";
// The Nix profile the service's packages are installed into, beside the release.
const PACKAGES_PROFILE = "/srv/packages";
const APP_USER = "10001:10001";
const APP_HOME = "/home/app";
// The nixpkgs the packages come from: one commit of NixOS/nixpkgs, never a branch, so a build is the same every time.
const NIXPKGS_REVISION = /^[0-9a-f]{40}$/u;

/** A refusal a caller shows as it is, with its code and HTTP status. */
function imageError({ code, message }) {
  return Object.assign(new Error(message), { code, status: 422 });
}

/**
 * Why no image can be made for these services, as `{ code, message }`, or null: a Deployment that isn't ready, a
 * runtime or sandbox allowance an image can't hold yet, or a health path the provider can't ask. Each names the service.
 * (A package's name is the grammar's to check: the Deployment section refuses one nixpkgs wouldn't name.)
 * @param {any} deployment the Stack's Deployment section as public Vibe64 inspected it (v2)
 */
function imagePackagesProblem(deployment) {
  if (deployment?.status !== "ready" || !Array.isArray(deployment.services) || deployment.services.length === 0) {
    return {
      code: "vibe64_image_deployment_unready",
      message: `Vibe64 makes each service's image from the Stack's Deployment section, which isn't ready: ${deployment?.diagnostics?.[0]?.message || "the Stack has none."}`
    };
  }
  const runtimes = deployment.runtimeRequirements.map((runtime) => STACK_RUNTIME_PACKS[runtime] ?? runtime);
  const unsupported = unsupportedRuntimes(runtimes);
  if (unsupported.length > 0) {
    return {
      code: "vibe64_image_runtime_unsupported",
      message: `The Deployment needs ${unsupported.join(", ")}, which an image can't hold yet. Remove it from the Stack's - Runtimes: line, Save, then try again.`
    };
  }
  for (const service of deployment.services) {
    const allowances = unsupportedSandboxAllowances(service.sandboxAllowances);
    if (allowances.length > 0) {
      return { code: "vibe64_image_sandbox_unsupported", message: `Service ${service.id}'s - Sandbox allows: names ${allowances.join(", ")}, which an image can't hold yet.` };
    }
    const health = healthPathProblem(service.readyWhen.path);
    if (health) return { code: "vibe64_image_health_path_invalid", message: `Service ${service.id}: ${health}` };
  }
  return null;
}

/**
 * The serve script's lines that give the instance facts the runtime has: V64_INSTANCE_ID (the runtime's, else the
 * container's hostname), V64_WORK_DIR (the runtime's, else a folder in the user's home, made), and V64_PRIVATE_ADDRESS
 * and V64_INSTANCE_URL as given. A service reached at each instance stops without V64_INSTANCE_URL.
 * @param {{ service: string, reached: "any" | "each" }} service
 */
function containerFactLines({ service, reached }) {
  const lines = [
    'export V64_INSTANCE_ID="${V64_INSTANCE_ID:-${HOSTNAME:-}}"',
    'export V64_WORK_DIR="${V64_WORK_DIR:-$HOME/work}"',
    'mkdir -p -- "$V64_WORK_DIR"'
  ];
  if (reached !== "each") return lines;
  return [
    ...lines,
    'if [ -z "${V64_INSTANCE_URL:-}" ]; then',
    `  echo ${shellWord(`Service ${service} is reached at each instance, so it needs this instance's own address in V64_INSTANCE_URL, `
      + "which the machine running it gives each instance.")} >&2`,
    "  exit 1",
    "fi"
  ];
}

/**
 * Each service's image package: its declaration (what the adapter and the build read) and the scripts, by their path
 * in the release. The build script is the one every service shares; each service has its own serve script. Refuses
 * with imagePackagesProblem's reason.
 * @param {object} options
 * @param {string} options.app the app's name (productionAppName)
 * @param {any} options.deployment the Stack's Deployment section as public Vibe64 inspected it (v2)
 * @param {object} options.needs needsOfStack's needs
 * @param {Record<string, Record<string, { secret: boolean, required: boolean }>>} options.settings each service's
 *   settings (package.js settingsPerService)
 * @param {Record<string, string>} [options.defaults] Serve's own defaults (the Stack's Environment defaults)
 * @returns {{ declarations: Record<string, { name: string, service: string, packages: string[], port: number, healthPath: string, reached: string, machineFeatures: string[], needs: Array<{ resource: string, kind: string, as: string }>, settings: Record<string, { secret: boolean, required: boolean }> }>, scripts: Record<string, string> }}
 */
function imagePackages({ app, deployment, needs, settings, defaults = {} }) {
  const problem = imagePackagesProblem(deployment);
  if (problem) throw imageError(problem);
  const runtimes = deployment.runtimeRequirements.map((runtime) => STACK_RUNTIME_PACKS[runtime]);
  const step = (role) => {
    const steps = deployment.steps.filter((entry) => entry.role === role);
    return steps.length === 0 ? null : { command: steps.map((entry) => commandOf(entry.argv)).join(" && "), label: steps.map((entry) => entry.label).join("; ") };
  };
  const workdir = deployment.workdir ?? ".";
  const intoWorkdir = workdir === "." ? [] : [`cd -- ${shellWord(workdir)}`];
  // As on mobilynet, a Node app's service runs in production mode; only the service, so Prepare keeps devDependencies.
  const serveDefaults = { ...defaults, ...(runtimes.includes("node26") ? { NODE_ENV: "production" } : {}) };
  const scripts = {
    [BUILD_SCRIPT]: [
      "#!/usr/bin/env bash",
      "# Made by Vibe64: the image's build runs this in the release's folder, which the image then keeps as the app.",
      "set -euo pipefail",
      ...intoWorkdir,
      ...stepLines("Prepare", step("prepare")),
      ...stepLines("Build", step("build")),
      ""
    ].join("\n")
  };
  const declarations = {};
  for (const service of deployment.services) {
    scripts[`${APP_SCRIPTS_FOLDER}/serve-${service.id}.sh`] = [
      "#!/usr/bin/env bash",
      `# Made by Vibe64: the app's service ${service.id} in its image. Its settings are the container's environment, each given `
        + "by the provider; it maps the resources' settings to the names the app reads, takes the instance's facts, then migrates and serves.",
      "set -euo pipefail",
      "if [ -n \"${AUTH_LOCAL_STORE_DIR:-}\" ]; then mkdir -p -- \"$AUTH_LOCAL_STORE_DIR\"; fi",
      ...bindingExportLines(needs),
      ...containerFactLines({ service: service.id, reached: service.reached }),
      ...Object.entries(service.settings).map(([key, value]) => `export ${key}=${shellWord(value)}`),
      ...Object.entries(serveDefaults).map(([key, value]) => `if [ -z "\${${key}+set}" ]; then export ${key}=${shellWord(value)}; fi`),
      ...intoWorkdir,
      ...stepLines("Migrate", step("migrate")),
      commandOf(service.serve.argv),
      ""
    ].join("\n");
    declarations[service.id] = {
      name: serviceAppName(app, service.id),
      service: service.id,
      packages: requiredPackagesOf(runtimes, [...deployment.packages, ...service.packages]),
      port: SERVICE_PORT,
      healthPath: service.readyWhen.path,
      reached: service.reached,
      machineFeatures: machineFeaturesOf(service.sandboxAllowances),
      needs: needs.resources.map((resource) => ({ resource: resource.id, kind: resource.kind, as: needAs(resource.id) })),
      settings: structuredClone(settings[service.id] ?? {})
    };
  }
  return { declarations, scripts };
}

/**
 * A service's Containerfile: its packages from nixpkgs at `nixpkgs` (a commit), the release, the shared build, then
 * its serve script as the entry point, run as the app's own user on its port.
 * @param {{ service: string, packages: string[], port: number }} declaration @param {{ nixpkgs: string }} source
 */
function containerfileOf({ service, packages, port }, { nixpkgs }) {
  if (!NIXPKGS_REVISION.test(String(nixpkgs ?? ""))) throw new TypeError("nixpkgs is the 40-character commit of NixOS/nixpkgs the packages come from.");
  return [
    `# Made by Vibe64: service ${service}'s image, built at the provider from this release.`,
    `FROM ${NIX_IMAGE}`,
    `RUN nix --extra-experimental-features 'nix-command flakes' profile install --profile ${PACKAGES_PROFILE} \\`,
    ...packages.map((name, index) => `  ${shellWord(`github:NixOS/nixpkgs/${nixpkgs}#${name}`)}${index < packages.length - 1 ? " \\" : ""}`),
    `ENV PATH=${PACKAGES_PROFILE}/bin:$PATH`,
    `WORKDIR ${APP_ROOT}`,
    `COPY . ${APP_ROOT}`,
    `RUN bash ${BUILD_SCRIPT}`,
    `RUN mkdir -p ${APP_HOME} && chown ${APP_USER} ${APP_HOME}`,
    `ENV HOME=${APP_HOME}`,
    `USER ${APP_USER}`,
    `EXPOSE ${port}`,
    `ENTRYPOINT ["bash", "${APP_ROOT}/${APP_SCRIPTS_FOLDER}/serve-${service}.sh"]`,
    ""
  ].join("\n");
}

/**
 * A service's upload: the archive with its Containerfile added, and its SHA-256.
 * @param {Buffer} archive packArchive's bytes (with imagePackages' scripts) @param {any} declaration imagePackages' declaration
 * @param {{ nixpkgs: string }} source
 */
function imageUpload(archive, declaration, source) {
  return withRootFile(archive, CONTAINERFILE, containerfileOf(declaration, source));
}

export { APP_ROOT, CONTAINERFILE, NIX_IMAGE, containerfileOf, imagePackages, imagePackagesProblem, imageUpload };
