import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { bindingExportLines, declarationNeeds } from "../../packages/vibe64-deploy/src/adapters/mobilynet/declaration.js";
import { PACKAGE_MAX_BYTES, archiveProblem, declaredSettingsOf, packProduction } from "../../packages/vibe64-deploy/src/package.js";

// The archive a deploy sends: the saved commit packed by git, with the files Vibe64 makes for it, and how the service
// script turns the settings mobilynet gives a linked need into the names the app's bindings read.
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

test("the commit is packed with its declaration at the root and its scripts in vibe64-app, and refused when too big or holding Vibe64's own files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-deploy-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const { git, commit } = await repository(app, { "package.json": "{}\n", "server.js": "// app\n", "genesis/stack.md": "# Stack\n" });
  const scratch = path.join(root, "scratch");
  await mkdir(scratch);
  const made = { declaration: { name: "books", settings: { APP_ENV: {}, PORT: {} } }, scripts: { "vibe64-app/build": "b\n", "vibe64-app/serve": "s\n" } };
  assert.equal(await archiveProblem({ commit, git }), null);
  const { archive, sha256 } = await packProduction({ commit, git, scratch, made });
  const bytes = Buffer.from(archive, "base64");
  const { createHash } = await import("node:crypto");
  assert.equal(sha256, createHash("sha256").update(bytes).digest("hex"));
  const file = path.join(root, "package.tar.gz");
  await writeFile(file, bytes);
  const listed = (await exec("tar", ["-tzf", file])).stdout.split("\n").filter(Boolean).sort();
  assert.deepEqual(listed, ["genesis/", "genesis/stack.md", "mobilynet.json", "package.json", "server.js", "vibe64-app/build", "vibe64-app/serve"]);
  assert.deepEqual(JSON.parse((await exec("tar", ["-xOzf", file, "mobilynet.json"])).stdout), made.declaration);
  assert.equal((await exec("tar", ["-xOzf", file, "vibe64-app/serve"])).stdout, "s\n");
  assert.deepEqual(declaredSettingsOf(made.declaration), ["APP_ENV", "PORT"]);

  // A commit that brings its own declaration or scripts folder is refused, naming the fix.
  const own = await repository(path.join(root, "own"), { "mobilynet.json": "{}\n", "vibe64-app/serve": "x\n" });
  assert.equal((await archiveProblem(own)).code, "production_own_declaration");
  const folder = await repository(path.join(root, "folder"), { "vibe64-app/serve": "x\n" });
  assert.match((await archiveProblem(folder)).message, /has its own vibe64-app, where Vibe64 puts the build and service scripts/u);

  // An archive past the limit (about 48 MiB unless given) is refused with its size.
  assert.equal(PACKAGE_MAX_BYTES, 50_282_496);
  await assert.rejects(packProduction({ commit, git, scratch, made, maxBytes: bytes.length - 1 }), (error) => error.code === "vibe64_production_package_too_large"
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
