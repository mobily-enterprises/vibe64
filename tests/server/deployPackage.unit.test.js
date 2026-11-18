import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { bindingExportLines, declarationNeeds, serviceUpload } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { PACKAGE_MAX_BYTES, archiveProblem, declaredSettingsOf, packArchive } from "../../packages/vibe64-deploy/src/package.js";

// The archive a deploy sends: the saved commit packed once by git with the scripts Vibe64 makes for it, each service's
// upload with its declaration, and how the service script turns the settings mobilynet gives a linked need into the
// names the app's bindings read.
const exec = promisify(execFile);

const NEEDS = Object.freeze({
  resources: [
    { id: "database", kind: "mysql", bindings: { host: "DB_HOST", port: "DB_PORT", database: "DB_NAME", username: "DB_USER", password: "DB_PASSWORD", url: "DATABASE_URL" } },
    { id: "uploads", kind: "bucket", bindings: { bucket: "STORAGE_BUCKET", region: "STORAGE_REGION", endpoint: "STORAGE_ENDPOINT", accessKeyId: "STORAGE_KEY_ID", secretAccessKey: "STORAGE_SECRET", driver: "STORAGE_DRIVER" } }
  ]
});

/** A repository with one commit of these files, and git run in it. */
async function repository(root, files) {
  const git = async (args) => (await exec("git", args, { cwd: root, env: { PATH: process.env.PATH, HOME: root } })).stdout;
  await mkdir(root, { recursive: true });
  await git(["init", "-q", "-b", "main"]);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  await git(["add", "-A"]);
  await git(["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "app"]);
  return { git, commit: (await git(["rev-parse", "HEAD"])).trim() };
}

test("the commit is packed once with Vibe64's scripts, each service's upload adds its declaration at the root, and Vibe64's own files or too big an archive are refused", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-deploy-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const { git, commit } = await repository(app, { "package.json": "{}\n", "server.js": "// app\n", "genesis/stack.md": "# Stack\n" });
  const scratch = path.join(root, "scratch");
  await mkdir(scratch);
  const scripts = { "vibe64-app/build.sh": "b\n", "vibe64-app/serve-web.sh": "w\n", "vibe64-app/serve-computers.sh": "c\n" };
  assert.equal(await archiveProblem({ commit, git }), null);
  const { bytes, sha256 } = await packArchive({ commit, git, scratch, scripts });
  const { createHash } = await import("node:crypto");
  assert.equal(sha256, createHash("sha256").update(bytes).digest("hex"));
  const listOf = async (archive, name) => {
    const file = path.join(root, `${name}.tar.gz`);
    await writeFile(file, archive);
    const read = async (entry) => (await exec("tar", ["-xOzf", file, entry])).stdout;
    return { files: (await exec("tar", ["-tzf", file])).stdout.split("\n").filter(Boolean).sort(), read };
  };
  // The archive carries no provider's declaration; every service's scripts are in it.
  const archive = await listOf(bytes, "archive");
  assert.deepEqual(archive.files, ["genesis/", "genesis/stack.md", "package.json", "server.js", "vibe64-app/build.sh",
    "vibe64-app/serve-computers.sh", "vibe64-app/serve-web.sh"]);
  assert.equal(await archive.read("vibe64-app/serve-computers.sh"), "c\n");
  // The same commit and scripts pack to the same bytes whenever they are packed: every entry, the scripts written now
  // among them, carries the commit's time, and the gzip header none. So a Deploy of an unchanged commit hands no
  // service its release again (steps.js releaseDigest).
  const later = path.join(root, "later");
  await mkdir(later);
  assert.equal((await packArchive({ commit, git, scratch: later, scripts })).sha256, sha256);
  const committed = Number.parseInt((await git(["show", "-s", "--format=%ct", commit])).trim(), 10);
  const tar = gunzipSync(bytes);
  const times = [];
  for (let at = 0; at + 512 <= tar.length && tar.subarray(at, at + 512).some((byte) => byte !== 0);) {
    const field = (offset, length) => Number.parseInt(tar.subarray(at + offset, at + offset + length).toString("latin1").replace(/\0.*$/su, "").trim() || "0", 8);
    times.push(field(136, 12));
    at += 512 + Math.ceil(field(124, 12) / 512) * 512;
  }
  assert.ok(times.length >= 7 && times.every((time) => time === committed), times.join(","));
  assert.equal(bytes.readUInt32LE(4), 0, "no time in the gzip header");

  // One service's upload: the same files and its declaration at the root, which tar reads back exactly.
  const declaration = { name: "books-web", settings: { APP_ENV: {}, PORT: {} }, long: "x".repeat(700) };
  const upload = serviceUpload(bytes, declaration);
  assert.equal(upload.sha256, createHash("sha256").update(upload.bytes).digest("hex"));
  assert.notEqual(upload.sha256, sha256);
  assert.deepEqual(serviceUpload(bytes, declaration), upload, "the same archive and declaration make the same upload");
  const uploaded = await listOf(upload.bytes, "upload");
  assert.deepEqual(uploaded.files, [...archive.files, "mobilynet.json"].sort());
  assert.deepEqual(JSON.parse(await uploaded.read("mobilynet.json")), declaration);
  assert.equal(await uploaded.read("server.js"), "// app\n");
  assert.deepEqual(declaredSettingsOf(declaration), ["APP_ENV", "PORT"]);

  // A commit that brings its own declaration or scripts folder is refused, naming the fix.
  const own = await repository(path.join(root, "own"), { "mobilynet.json": "{}\n", "vibe64-app/serve": "x\n" });
  assert.equal((await archiveProblem(own)).code, "production_own_declaration");
  const folder = await repository(path.join(root, "folder"), { "vibe64-app/serve": "x\n" });
  assert.match((await archiveProblem(folder)).message, /has its own vibe64-app, where Vibe64 puts the build and service scripts/u);

  // An archive past the limit (about 48 MiB unless given) is refused with its size.
  assert.equal(PACKAGE_MAX_BYTES, 50_282_496);
  await assert.rejects(packArchive({ commit, git, scratch, scripts, maxBytes: bytes.length - 1 }), (error) => error.code === "vibe64_production_package_too_large"
    && error.status === 422 && /^The packed app is 0\.0 MiB; Production takes at most 0\.0 MiB\. Keep built files/u.test(error.message));
});

test("each resource is a need by its interface, and the service sets the app's bound names from the need's settings", async () => {
  assert.deepEqual(declarationNeeds(NEEDS), [{ interface: "mysql", as: "V64_DATABASE" }, { interface: "s3", as: "V64_UPLOADS" }]);
  const { stdout } = await exec("bash", ["-c", `set -euo pipefail\n${bindingExportLines(NEEDS).join("\n")}\nenv | grep -E '^(DB_|DATABASE_URL|STORAGE_)' | sort`], {
    env: {
      PATH: process.env.PATH,
      V64_DATABASE_HOST: "db.internal", V64_DATABASE_PORT: "3306", V64_DATABASE_DATABASE: "books",
      V64_DATABASE_USER: "app", V64_DATABASE_PASSWORD: "p@ss/w:rd", V64_DATABASE_SSLMODE: "require",
      V64_UPLOADS_BUCKET: "books-files", V64_UPLOADS_REGION: "eu", V64_UPLOADS_ENDPOINT: "https://s3.eu.example",
      V64_UPLOADS_ACCESS_KEY_ID: "AKID", V64_UPLOADS_SECRET_ACCESS_KEY: "s3cr3t"
    }
  });
  // Each field as it is, a URL made of them with its parts URL-encoded, and the bucket's driver.
  assert.deepEqual(stdout.trim().split("\n"), [
    "DATABASE_URL=mysql://app:p%40ss%2Fw%3Ard@db.internal:3306/books",
    "DB_HOST=db.internal",
    "DB_NAME=books",
    "DB_PASSWORD=p@ss/w:rd",
    "DB_PORT=3306",
    "DB_USER=app",
    "STORAGE_BUCKET=books-files",
    "STORAGE_DRIVER=s3",
    "STORAGE_ENDPOINT=https://s3.eu.example",
    "STORAGE_KEY_ID=AKID",
    "STORAGE_REGION=eu",
    "STORAGE_SECRET=s3cr3t"
  ]);
});
