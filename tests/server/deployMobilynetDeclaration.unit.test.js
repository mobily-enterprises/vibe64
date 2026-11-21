import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  appPackage,
  bindingField,
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

test("a python app's build points the release's native modules at the libraries its runtime declares, and a node app's build is as before", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-python-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { declaration, scripts } = appPackage({
    ...SHOP,
    runtimes: ["python"],
    workdir: "app",
    steps: { prepare: { command: "touch prepared", label: "Install dependencies" }, serve: { command: ".venv/bin/python -m shop" } }
  });
  assert.deepEqual(declaration.requiredPackages, ["bash", "coreutils", "curl", "jq", "python313", "python313Packages.pip",
    "python313Packages.virtualenv", "gcc-unwrapped^lib", "zlib"]);
  assert.deepEqual(declaration.build, { packages: ["patchelf"], command: "bash vibe64-app/build.sh", cache: [], output: ["."] });

  // A release as Prepare leaves it, its venv beside the work folder. A stand-in patchelf answers --print-needed from a
  // file's first line ("ELF" and its NEEDED names), fails on any other file as on one that isn't ELF, and records each
  // --add-rpath.
  const release = path.join(root, "release");
  const site = path.join(release, ".venv/lib/python3.13/site-packages");
  const objects = {
    "numpy/_core/_multiarray_umath.cpython-313-x86_64-linux-gnu.so": "ELF libstdc++.so.6 libm.so.6 libc.so.6",
    "numpy.libs/libscipy_openblas64_-fdde5778.so": "ELF libm.so.6 libc.so.6",
    "scipy.libs/libgfortran-040039e1.so.5.0.0": "ELF libquadmath-96973f99.so.0.0.0 libz.so.1 libc.so.6",
    "scipy/_lib/_ccallback_c.cpython-313-x86_64-linux-gnu.so": "ELF libgcc_s.so.1 libc.so.6",
    "_cffi_backend.cpython-313-x86_64-linux-gnu.so": "ELF libc.so.6",
    "notes.so": "not ELF, but libstdc++.so.6",
    "numpy/_core/include/numpy/ndarraytypes.h": "ELF libstdc++.so.6"
  };
  for (const [file, text] of Object.entries(objects)) {
    await mkdir(path.dirname(path.join(site, file)), { recursive: true });
    await writeFile(path.join(site, file), `${text}\n`);
  }
  await symlink("numpy/_core/_multiarray_umath.cpython-313-x86_64-linux-gnu.so", path.join(site, "linked.so"));
  await mkdir(path.join(release, "app"), { recursive: true });
  for (const [file, text] of Object.entries(scripts)) {
    await mkdir(path.dirname(path.join(release, file)), { recursive: true });
    await writeFile(path.join(release, file), text);
  }
  const record = path.join(root, "rpaths");
  await mkdir(path.join(root, "bin"));
  await writeFile(path.join(root, "bin/patchelf"), [
    "#!/usr/bin/env bash",
    "case \"$1\" in",
    "  --print-needed) read -r first needed < \"$2\"; [ \"$first\" = ELF ] || exit 1; tr ' ' '\\n' <<< \"$needed\" ;;",
    `  --add-rpath) printf '%s %s\\n' "\${3#${release}/}" "$2" >> ${record} ;;`,
    "  *) exit 2 ;;",
    "esac",
    ""
  ].join("\n"), { mode: 0o755 });
  const { stdout } = await exec("bash", ["vibe64-app/build.sh"], { cwd: release, env: { PATH: `${path.join(root, "bin")}:${process.env.PATH}` } });
  assert.equal(stdout, "Prepare: Install dependencies\nPython: point native modules at the C++ runtime and zlib\n");
  assert.ok(await readFile(path.join(release, "app/prepared")).then(() => true), "Prepare ran in the work folder");
  // Only the shared objects that need one of the libraries, each once, the folders of the packages that hold them.
  const folders = "/nix/var/mobilynet/packages/gcc-unwrapped^lib/lib:/nix/var/mobilynet/packages/zlib/lib";
  assert.deepEqual((await readFile(record, "utf8")).trim().split("\n").sort(), [
    `.venv/lib/python3.13/site-packages/numpy/_core/_multiarray_umath.cpython-313-x86_64-linux-gnu.so ${folders}`,
    `.venv/lib/python3.13/site-packages/scipy.libs/libgfortran-040039e1.so.5.0.0 ${folders}`,
    `.venv/lib/python3.13/site-packages/scipy/_lib/_ccallback_c.cpython-313-x86_64-linux-gnu.so ${folders}`
  ]);

  // A node app's declaration and build are what they were: no build packages, no step.
  const node = appPackage(SHOP);
  assert.equal("packages" in node.declaration.build, false);
  assert.equal(node.scripts["vibe64-app/build.sh"], [
    "#!/usr/bin/env bash",
    "# Made by Vibe64: mobilynet's build VM runs this in the release's folder, which it then keeps as the app.",
    "set -euo pipefail",
    "printf '%s\\n' 'Prepare: Install dependencies'",
    "npm ci --include=dev",
    "printf '%s\\n' 'Build: Build'",
    "npm run build",
    ""
  ].join("\n"));
});

test("with release tasks, the service only serves and the release's migrate task exports the same settings, then migrates in the work folder", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-published-app-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = (role) => ({ command: `printf '%s %s %s\\n' ${role} "\${NODE_ENV-unset}" "$(basename "$PWD")" >> ${root}/steps` });
  const settingsFile = path.join(root, "settings.json");
  const { declaration, scripts } = appPackage({
    ...SHOP,
    workdir: "app",
    releaseTasks: true,
    steps: { prepare: record("prepare"), build: record("build"), migrate: record("migrate"), serve: { ...record("serve"), defaults: SHOP.steps.serve.defaults } }
  });
  assert.deepEqual(declaration.tasks, { migrate: { command: "bash vibe64-app/migrate-web.sh", user: "shop", timeoutSeconds: 900 } });
  assert.deepEqual(Object.keys(scripts).sort(), ["vibe64-app/build.sh", "vibe64-app/migrate-web.sh", "vibe64-app/serve-web.sh"]);
  await mkdir(path.join(root, "release/app"), { recursive: true });
  for (const [file, text] of Object.entries(scripts)) {
    await mkdir(path.dirname(path.join(root, "release", file)), { recursive: true });
    await writeFile(path.join(root, "release", file), text.replace("/run/app-settings/shop/settings.json", settingsFile));
  }
  const run = (file) => exec("bash", [file], { cwd: path.join(root, "release"), env: { PATH: process.env.PATH } });
  await writeFile(settingsFile, JSON.stringify({ NODE_ENV: "staging" }));
  await run("vibe64-app/serve-web.sh");
  assert.equal(await readFile(path.join(root, "steps"), "utf8"), "serve staging app\n", "the service migrates nothing");
  await run("vibe64-app/migrate-web.sh");
  assert.equal(await readFile(path.join(root, "steps"), "utf8"), "serve staging app\nmigrate staging app\n");

  // An app with no Migrate step has no task; without release tasks the service migrates as it starts, as before.
  assert.equal(appPackage({ ...SHOP, releaseTasks: true, steps: { ...SHOP.steps, migrate: null } }).declaration.tasks, undefined);
  const plain = appPackage(SHOP);
  assert.equal(plain.declaration.tasks, undefined);
  assert.deepEqual(Object.keys(plain.scripts).sort(), ["vibe64-app/build.sh", "vibe64-app/serve-web.sh"]);
  assert.match(plain.scripts["vibe64-app/serve-web.sh"], /npm run db:migrate/u);
});

test("each binding reads the link field it is given, and a URL or a bucket's driver none, so an owner sees which field fills which name", () => {
  assert.deepEqual(
    ["host", "port", "database", "username", "password", "url", "sslmode"].map((semantic) => bindingField("postgresql", semantic)),
    ["host", "port", "database", "user", "password", null, null]
  );
  assert.equal(bindingField("mysql", "username"), "user");
  assert.deepEqual(
    ["bucket", "region", "endpoint", "accessKeyId", "secretAccessKey", "driver"].map((semantic) => bindingField("bucket", semantic)),
    ["bucket", "region", "endpoint", "accessKeyId", "secretAccessKey", null]
  );
  assert.equal(bindingField("redis", "url"), null);
  assert.equal(bindingField("mongodb", "host"), null, "a kind Production doesn't make has no fields");
});
