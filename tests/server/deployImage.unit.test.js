import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { CONTAINERFILE, imagePackages, imagePackagesProblem, imageUpload } from "../../packages/vibe64-deploy/src/image.js";
import { settingsPerService, withRootFile } from "../../packages/vibe64-deploy/src/package.js";
import { workersStack } from "../fixtures/deployWorkersApp.js";

// The release as an OCI image: each service's declaration and scripts, the Containerfile its upload carries, and the
// serve script run for real with bash, its settings from the environment.
const NIXPKGS = "0123456789abcdef0123456789abcdef01234567";

/** Each entry of a gzip tarball by its name. @param {Buffer} archive */
function entriesOf(archive) {
  const tar = gunzipSync(archive);
  const entries = {};
  for (let at = 0; at + 512 <= tar.length && tar.subarray(at, at + 512).some((byte) => byte !== 0);) {
    const name = tar.subarray(at, at + 100).toString("latin1").replace(/\0.*$/su, "");
    const size = Number.parseInt(tar.subarray(at + 124, at + 136).toString("latin1").replace(/\0.*$/su, "").trim() || "0", 8);
    entries[name] = tar.subarray(at + 512, at + 512 + size).toString("utf8");
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function packagesOf(edit) {
  const stack = workersStack(edit);
  return { ...stack, ...imagePackages({ app: "shop", deployment: stack.deployment, needs: stack.needs, settings: settingsPerService(stack.needs), defaults: { LOG_LEVEL: "info" } }) };
}

test("each service's declaration names its image's packages, port, health path, machine features, needs and settings", () => {
  const { declarations, scripts } = packagesOf();
  assert.deepEqual(Object.keys(declarations), ["web", "workers"]);
  const { web, workers } = declarations;
  assert.deepEqual([web.name, web.service, web.port, web.healthPath, web.reached, web.machineFeatures], ["shop-web", "web", 3000, "/api/health", "any", []]);
  assert.deepEqual([workers.name, workers.reached, workers.machineFeatures], ["shop-workers", "each", ["fuse", "userns"]]);
  // The base's, the runtime's (nodejs as node26), the shared Packages and the service's own, each once.
  assert.deepEqual(web.packages, ["bash", "coreutils", "curl", "jq", "nodejs_26", "corepack", "git", "ripgrep"]);
  assert.deepEqual(workers.packages, ["bash", "coreutils", "curl", "jq", "nodejs_26", "corepack", "git", "ripgrep", "xvfb"]);
  assert.deepEqual(web.needs, [{ resource: "database", kind: "postgresql", as: "V64_DATABASE" }, { resource: "files", kind: "bucket", as: "V64_FILES" }]);
  assert.deepEqual(web.needs, workers.needs);
  assert.deepEqual(Object.keys(web.settings).sort(), ["APP_ENV", "APP_PUBLIC_URL", "HOST", "PORT", "SESSION_SECRET", "SETUP_CODE", "TRUSTED_PROXIES", "WORKERS_URL"]);
  assert.equal(web.settings.SESSION_SECRET.secret, true);
  assert.equal(Object.hasOwn(workers.settings, "SETUP_CODE"), false);
  assert.deepEqual(Object.keys(scripts).sort(), ["vibe64-app/build.sh", "vibe64-app/serve-web.sh", "vibe64-app/serve-workers.sh"]);
  assert.match(scripts["vibe64-app/build.sh"], /printf '%s\\n' 'Prepare: Install dependencies'\nnpm ci\nprintf '%s\\n' 'Build: Build'\nnpm run build\n/u);
  // No settings file, no mobilynet object: the container's environment is its settings.
  for (const name of ["vibe64-app/serve-web.sh", "vibe64-app/serve-workers.sh"]) {
    assert.doesNotMatch(scripts[name], /settings\.json|_mobilynet|\/run\//u);
  }
});

test("a service's upload carries its Containerfile: nixpkgs at one commit, the build, its own serve script as a user of its own", () => {
  const { declarations } = packagesOf();
  const archive = withRootFile(gzipSync(Buffer.alloc(1024)), "server.js", "// the app");
  const upload = imageUpload(archive.bytes, declarations.workers, { nixpkgs: NIXPKGS });
  assert.match(upload.sha256, /^[0-9a-f]{64}$/u);
  const entries = entriesOf(upload.bytes);
  assert.equal(entries["server.js"], "// the app");
  const file = entries[CONTAINERFILE];
  assert.equal(CONTAINERFILE, "vibe64-app/Containerfile");
  const lines = file.split("\n");
  assert.match(lines[1], /^FROM docker\.io\/nixos\/nix:/u);
  assert.ok(lines.includes(`  'github:NixOS/nixpkgs/${NIXPKGS}#xvfb'`), file);
  assert.equal(lines.filter((line) => line.includes(`github:NixOS/nixpkgs/${NIXPKGS}#`)).length, declarations.workers.packages.length);
  for (const line of ["RUN bash vibe64-app/build.sh", "USER 10001:10001", "EXPOSE 3000", 'ENTRYPOINT ["bash", "/srv/app/vibe64-app/serve-workers.sh"]']) {
    assert.ok(lines.includes(line), `${line} in\n${file}`);
  }
  // The same declaration and archive, the same bytes; a branch or a short name is never a revision.
  assert.equal(imageUpload(archive.bytes, declarations.workers, { nixpkgs: NIXPKGS }).sha256, upload.sha256);
  for (const nixpkgs of ["nixos-unstable", "0123456", undefined]) {
    assert.throws(() => imageUpload(archive.bytes, declarations.workers, { nixpkgs }), /40-character commit of NixOS\/nixpkgs/u);
  }
});

test("the serve script maps the resources' settings to the app's names, gives the instance facts and refuses a reached-each instance without its address", async (t) => {
  // Serve prints the environment, Migrate says it ran: the script is run for real.
  const edit = (lines) => lines.map((line) => line
    .replace("- Serve `Start`: `node` `server.js`", "- Serve `Start`: `env`")
    .replace("- Serve `Start the workers`: `node` `worker.js`", "- Serve `Start the workers`: `env`")
    .replace("- Migrate `Migrate database`: `npm` `run` `db:migrate`", "- Migrate `Migrate database`: `echo` `migrated`"));
  const { scripts } = packagesOf(edit);
  const folder = await mkdtemp(path.join(tmpdir(), "deploy-image-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(scripts)) {
    await writeFile(path.join(folder, path.basename(name)), text);
  }
  const given = {
    PATH: process.env.PATH, HOME: folder, HOSTNAME: "web-abc12",
    V64_DATABASE_HOST: "10.20.0.3", V64_DATABASE_PORT: "5432", V64_DATABASE_DATABASE: "shop", V64_DATABASE_USER: "shop-web", V64_DATABASE_PASSWORD: "pw",
    V64_FILES_BUCKET: "shop-files", V64_FILES_ENDPOINT: "https://storage.googleapis.com", V64_FILES_ACCESS_KEY_ID: "GOOG1", V64_FILES_SECRET_ACCESS_KEY: "sk",
    V64_FILES_REGION: "auto", LOG_LEVEL: "debug"
  };
  const run = (script, env) => spawnSync("bash", [path.join(folder, script)], { cwd: folder, env, encoding: "utf8" });

  const web = run("serve-web.sh", given);
  assert.equal(web.status, 0, web.stderr);
  const printed = Object.fromEntries(web.stdout.split("\n").filter((line) => line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  assert.match(web.stdout, /^migrated$/mu);
  assert.deepEqual([printed.DB_HOST, printed.DB_PORT, printed.DB_NAME, printed.DB_USER, printed.DB_PASSWORD], ["10.20.0.3", "5432", "shop", "shop-web", "pw"]);
  assert.deepEqual([printed.FILES_BUCKET, printed.FILES_ENDPOINT, printed.FILES_KEY_ID, printed.FILES_SECRET, printed.FILES_REGION], ["shop-files", "https://storage.googleapis.com", "GOOG1", "sk", "auto"]);
  // The instance facts: the hostname as its id, a work folder made in its home; Serve's defaults under what is set.
  assert.deepEqual([printed.V64_INSTANCE_ID, printed.V64_WORK_DIR, printed.NODE_ENV, printed.LOG_LEVEL], ["web-abc12", path.join(folder, "work"), "production", "debug"]);

  // workers is reached at each instance: without its own address it stops, naming why; with it, it serves.
  const refused = run("serve-workers.sh", given);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Service workers is reached at each instance, so it needs this instance's own address in V64_INSTANCE_URL/u);
  const workers = run("serve-workers.sh", { ...given, V64_INSTANCE_ID: "shop-workers-x1", V64_INSTANCE_URL: "http://shop-workers-x1.us-central1-a.c.p1.internal:3000", V64_WORK_DIR: path.join(folder, "srv") });
  assert.equal(workers.status, 0, workers.stderr);
  assert.match(workers.stdout, /^V64_INSTANCE_URL=http:\/\/shop-workers-x1\.us-central1-a\.c\.p1\.internal:3000$/mu);
  assert.match(workers.stdout, /^V64_INSTANCE_ID=shop-workers-x1$/mu);
  assert.match(workers.stdout, /^WORKER_MODE=jobs$/mu);
});

test("a Stack an image can't hold is refused, naming the service or the runtime", () => {
  const playwright = workersStack((lines) => lines.map((line) => (line === "- Runtimes: `nodejs`" ? "- Runtimes: `nodejs` `playwright`" : line)));
  assert.deepEqual(imagePackagesProblem(playwright.deployment), {
    code: "vibe64_image_runtime_unsupported",
    message: "The Deployment needs playwright, which an image can't hold yet. Remove it from the Stack's - Runtimes: line, Save, then try again."
  });
  assert.throws(() => imagePackages({ app: "shop", deployment: playwright.deployment, needs: playwright.needs, settings: {} }),
    (error) => error.code === "vibe64_image_runtime_unsupported" && error.status === 422);
  assert.equal(imagePackagesProblem({ status: "blocked", diagnostics: [{ message: "No Serve line." }] }).code, "vibe64_image_deployment_unready");
  assert.equal(imagePackagesProblem(workersStack().deployment), null);
});
