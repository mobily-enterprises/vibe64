import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  appPackage,
  healthPathProblem,
  machineFeaturesOf,
  packagesProblem,
  unsupportedRuntimes,
  unsupportedSandboxAllowances
} from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";

// The package Vibe64 hands mobilynet for an app: its mobilynet.json in mobilynet's build model, and its build and
// service scripts, run here by bash and jq as mobilynet would run them.
const exec = promisify(execFile);

const SHOP = Object.freeze({
  name: "shop",
  login: "shop",
  port: 3000,
  healthPath: "/api/health",
  runtimes: ["node26"],
  settings: { PORT: { type: "string", secret: false, required: true } },
  steps: {
    prepare: { command: "npm ci --include=dev", label: "Install dependencies" },
    build: { command: "npm run build", label: "Build" },
    migrate: { command: "npm run db:migrate", label: "Migrate database" },
    serve: { command: "npm start", label: "Start", defaults: { NODE_ENV: "production", TRUSTED_PROXIES: "loopback" } }
  }
});

test("an app's mobilynet.json is built by its build block, and its start and check run no file of the app's", () => {
  assert.deepEqual(appPackage(SHOP).declaration, {
    name: "shop",
    requiredPackages: ["bash", "coreutils", "curl", "jq", "nodejs_26", "corepack"],
    build: { command: "bash vibe64-app/build.sh", cache: ["~/.npm"], output: ["."] },
    start: "install -D --owner=shop --mode=0400 /run/mobilynet/apps/shop/settings.json /run/app-settings/shop/settings.json",
    services: [{ name: "web", command: "bash vibe64-app/serve-web.sh", user: "shop", port: 3000, healthPath: "/api/health" }],
    check: "curl --fail --silent --show-error --output /dev/null --retry 30 --retry-delay 3 --retry-all-errors "
      + "--retry-max-time 100 --max-time 10 http://127.0.0.1:3000/api/health",
    logins: [{ name: "shop" }],
    settings: { PORT: { type: "string", secret: false, required: true } }
  });
  assert.deepEqual(unsupportedRuntimes(["node26", "playwright", "python"]), ["playwright"]);
  assert.equal(healthPathProblem("/api/health"), "");
  for (const refused of ["api/health", "/health?full=1", "/a b", `/${"a".repeat(200)}`]) assert.notEqual(healthPathProblem(refused), "", refused);
});

test("a Deployment's own packages go on top of the base's and the runtime's, and its sandbox allowances become the machine features they need", () => {
  const { declaration } = appPackage({
    ...SHOP,
    packages: ["git", "gnutar", "jq", "python313Packages.pip", "gcc-unwrapped^lib"],
    sandboxAllowances: ["fuse", "gvisor"]
  });
  // Each once, in order: the base's, the runtime's, then the Deployment's.
  assert.deepEqual(declaration.requiredPackages, ["bash", "coreutils", "curl", "jq", "nodejs_26", "corepack", "git", "gnutar",
    "python313Packages.pip", "gcc-unwrapped^lib"]);
  assert.deepEqual(declaration.machineFeatures, ["fuse", "userns"]);
  assert.deepEqual(appPackage({ ...SHOP, sandboxAllowances: ["gvisor"] }).declaration.machineFeatures, ["userns"]);
  assert.equal("machineFeatures" in appPackage(SHOP).declaration, false, "no allowance, no machine feature");
  assert.deepEqual(machineFeaturesOf(["gvisor", "fuse", "gvisor"]), ["fuse", "userns"]);
  assert.deepEqual(unsupportedSandboxAllowances(["gvisor", "docker"]), ["docker"]);

  // A name mobilynet doesn't take as a package's is refused, naming it; so is more than a machine takes.
  assert.equal(packagesProblem(["git", "hunspellDicts.en_GB-ise", "gcc-unwrapped^lib"], ["node26"]), "");
  assert.match(packagesProblem(["git", "not a package", "gcc^lib^dev"], ["node26"]),
    /^"not a package", "gcc\^lib\^dev" aren't packages' names: give each as nixpkgs names it/u);
  assert.match(packagesProblem(["../git"], []), /^"\.\.\/git" isn't a package's name/u);
  const many = Array.from({ length: 195 }, (_, at) => `package${at}`);
  assert.equal(packagesProblem(many.slice(0, 194), ["node26"]), "");
  assert.match(packagesProblem(many, ["node26"]), /that is 201 packages, and mobilynet takes at most 200\./u);
});

test("the build script runs Prepare then Build, and the service exports its settings, then migrates and serves", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-published-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Each step writes what it saw; the service's settings file is the test's, where start would leave it.
  const record = (role) => ({ command: `printf '%s %s %s\\n' ${role} "\${NODE_ENV-unset}" "\${WEIRD-unset}" >> ${root}/steps` });
  const settingsFile = path.join(root, "settings.json");
  const { scripts } = appPackage({
    ...SHOP,
    workdir: "app",
    steps: { prepare: record("prepare"), build: record("build"), migrate: record("migrate"), serve: { ...record("serve"), defaults: SHOP.steps.serve.defaults } }
  });
  await mkdir(path.join(root, "release/app"), { recursive: true });
  for (const [file, text] of Object.entries(scripts)) {
    await mkdir(path.dirname(path.join(root, "release", file)), { recursive: true });
    await writeFile(path.join(root, "release", file), text.replace("/run/app-settings/shop/settings.json", settingsFile));
  }
  const run = (file) => exec("bash", [file], { cwd: path.join(root, "release"), env: { PATH: process.env.PATH } });

  await run("vibe64-app/build.sh");
  assert.equal(await readFile(path.join(root, "steps"), "utf8"), "prepare unset unset\nbuild unset unset\n");

  // Without its settings the service stops at once, naming where they should be.
  await assert.rejects(run("vibe64-app/serve-web.sh"), (error) => error.stderr.includes(`No settings at ${settingsFile}`));
  const signIns = path.join(root, "home/auth");
  await writeFile(settingsFile, JSON.stringify({ NODE_ENV: "staging", WEIRD: "it's $HOME `x`", AUTH_LOCAL_STORE_DIR: signIns, "bad-name": "x" }));
  await rm(path.join(root, "steps"));
  await run("vibe64-app/serve-web.sh");
  // A setting wins over Serve's default; quotes and $ stay as they are; Migrate runs before Serve, in the work folder.
  assert.equal(await readFile(path.join(root, "steps"), "utf8"), "migrate staging it's $HOME `x`\nserve staging it's $HOME `x`\n");
  assert.ok((await exec("test", ["-d", signIns]).then(() => true)), "the sign-in folder is made");
  assert.match(scripts["vibe64-app/serve-web.sh"], /^if \[ -z "\$\{TRUSTED_PROXIES\+set\}" \]; then export TRUSTED_PROXIES='loopback'; fi$/mu);
});
