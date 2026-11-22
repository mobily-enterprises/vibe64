import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  bumpConnectedDependencies,
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep,
  stopConnectedSync,
  syncConnectedRepositories
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { packArchive } from "../../packages/vibe64-deploy/src/package.js";
import { startFakeNpmRegistry, writePackage } from "./fakeNpmRegistry.js";

const exec = promisify(execFile);
const repository = "https://github.com/example/lib";

/** What Vibe64's command runner answers, from a plain child process with the registry's env. */
function commandRunner(env, calls = []) {
  return async ({ command, args, cwd, timeout }) => {
    calls.push([command, ...args]);
    try {
      const { stdout, stderr } = await exec(command, args, { cwd, env, timeout, maxBuffer: 64 * 1024 * 1024 });
      return { ok: true, stdout, stderr };
    } catch (error) {
      return { ok: false, stdout: String(error.stdout || ""), stderr: String(error.stderr || ""), error: error.message };
    }
  };
}

const sharedSource = "module.exports = { instance: Symbol('shared') };\n";

/**
 * A published @proof/lib (1.0.0 at the top, 0.9.0 nested under @proof/other) installed in an app,
 * and a session copy of its repository: @proof/lib 1.1.0, an npm workspace, needing `extra`, which
 * the app lacks.
 */
async function fixture(t, { libDependencies = { shared: "^1.0.0", extra: "^1.0.0" } } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-connected-npm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = await startFakeNpmRegistry(root);
  t.after(() => registry.close());
  const published = path.join(root, "published");
  await writePackage(path.join(published, "shared"), { name: "shared", version: "1.0.0", main: "index.js" }, { "index.js": sharedSource });
  await writePackage(path.join(published, "extra"), { name: "extra", version: "1.0.0", main: "index.js" }, { "index.js": "module.exports = 'extra';\n" });
  for (const version of ["0.9.0", "1.0.0"]) {
    await writePackage(path.join(published, `lib-${version}`), {
      name: "@proof/lib", version, main: "index.js", dependencies: { shared: "^1.0.0" }
    }, { "index.js": `exports.message = 'published ${version}'; exports.shared = require('shared');\n` });
  }
  await writePackage(path.join(published, "other"), {
    name: "@proof/other", version: "1.0.0", main: "index.js", dependencies: { "@proof/lib": "0.9.0" }
  }, { "index.js": "module.exports = require('@proof/lib');\n" });
  for (const dir of ["shared", "extra", "lib-0.9.0", "lib-1.0.0", "other"]) await registry.publish(path.join(published, dir));

  const app = path.join(root, "session", "source");
  await writePackage(app, {
    name: "app", version: "1.0.0", private: true,
    dependencies: { "@proof/lib": "1.0.0", "@proof/other": "1.0.0", shared: "1.0.0" }
  }, { ".gitignore": "node_modules/\n" });
  await exec("npm", ["install"], { cwd: app, env: registry.env });
  await exec("git", ["init", "-q", "--initial-branch=main"], { cwd: app });
  await exec("git", ["add", "--all"], { cwd: app });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "app"], { cwd: app });

  const copy = path.join(root, "session", "connected", "lib");
  await writePackage(copy, { name: "lib-repository", private: true, workspaces: ["packages/*"] });
  const libDir = path.join(copy, "packages", "lib");
  await writePackage(libDir, {
    name: "@proof/lib", version: "1.1.0", main: "index.js", files: ["index.js", "lib/"], dependencies: libDependencies
  }, {
    "index.js": "exports.message = require('./lib/message'); exports.shared = require('shared'); exports.extra = require('extra');\n",
    "lib/message.js": "module.exports = 'connected 1.1.0';\n",
    "notes.md": "Not published.\n"
  });
  // The checkout's own installed copy of shared: a link to the checkout would load this one.
  await writePackage(path.join(copy, "node_modules", "shared"), { name: "shared", version: "1.0.0", main: "index.js" }, { "index.js": sharedSource });
  await exec("git", ["init", "-q", "--initial-branch=main"], { cwd: copy });

  const repositories = [{ name: "Lib", repository, relationship: "dependency", type: "npm", sourceRoot: copy }];
  const calls = [];
  const runCommand = commandRunner(registry.env, calls);
  const step = action => runConnectedAdapterStep({ action, repository, repositories, sessionSourceRoot: app, runCommand });
  const proof = async () => (await inspectConnectedAdapters({ repositories, sessionSourceRoot: app }))[0];
  const tracked = () => Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(app, file), "utf8")));
  const node = async (script) => (await exec(process.execPath, ["-e", script], { cwd: app })).stdout.trim();
  return { root, app, copy, libDir, registry, repositories, calls, runCommand, step, proof, tracked, node };
}

async function installedVersion(dir) {
  return JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).version;
}

async function filesBelow(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesBelow(dir, relative));
    else files.push(relative);
  }
  return files.sort();
}

test("npm: every installed copy, nested ones included, becomes exactly what the connected package publishes, sharing the app's dependencies", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  const before = await f.tracked();
  assert.equal((await f.proof()).inEffect, false);

  const applied = await f.step("apply");
  assert.equal(applied.ok, true, applied.error);
  assert.match(applied.output, /installed extra@\^1\.0\.0 .* without saving/u);
  assert.match(applied.output, /@proof\/lib 1\.1\.0 in effect in 2 installed copies/u);

  const top = path.join(f.app, "node_modules", "@proof", "lib");
  const nested = path.join(f.app, "node_modules", "@proof", "other", "node_modules", "@proof", "lib");
  for (const dir of [top, nested]) {
    assert.equal(await installedVersion(dir), "1.1.0");
    // npm's own packlist: package.json and the `files`; never notes.md.
    assert.deepEqual(await filesBelow(dir), ["index.js", "lib/message.js", "package.json"]);
  }
  // One instance of a shared dependency: the swapped package loads the app's own, not the checkout's.
  assert.equal(await f.node("const lib = require('@proof/lib'); console.log(lib.message, lib.shared === require('shared'), lib.extra)"),
    "connected 1.1.0 true extra");
  assert.equal(await f.node("console.log(require('@proof/other').message)"), "connected 1.1.0");

  // The missing dependency is installed, and nothing Git tracks changes.
  assert.equal(await installedVersion(path.join(f.app, "node_modules", "extra")), "1.0.0");
  assert.deepEqual(await f.tracked(), before);
  assert.equal((await exec("git", ["status", "--porcelain", "--ignored=no"], { cwd: f.app })).stdout, "");

  assert.deepEqual(await f.proof(), { name: "Lib", repository, type: "npm", sourceRoot: f.copy, inEffect: true, reason: "" });
  const proved = await f.step("proof");
  assert.equal(proved.ok, true, proved.error);
  // The gap is never hidden: the check says what Staging and Production use until a release.
  assert.match(proved.output,
    /Lib: this session runs the connected @proof\/lib(?: at [0-9a-f]{12})?; Staging and Production use the published 1\.0\.0 until 1\.1\.0 is published/u);

  // Applying again changes nothing and installs nothing.
  f.calls.length = 0;
  assert.equal((await f.step("apply")).ok, true);
  assert.equal(f.calls.some(call => call[0] === "npm" && call[1] === "install"), false);
  assert.equal((await f.proof()).inEffect, true);
});

test("npm: the proof fails the moment a swap is undone, and applying again puts it back", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.step("apply")).ok, true);
  const top = path.join(f.app, "node_modules", "@proof", "lib");

  await writeFile(path.join(top, "lib", "message.js"), "module.exports = 'edited in node_modules';\n");
  const edited = await f.proof();
  assert.equal(edited.inEffect, false);
  assert.match(edited.reason, /lib\/message\.js no longer holds the connected source/u);
  const failedProof = await f.step("proof");
  assert.equal(failedProof.ok, false);
  assert.match(failedProof.error, /Connected Lib is not in effect/u);

  // An ordinary install puts the lockfile's published copy back.
  await exec("npm", ["install"], { cwd: f.app, env: f.registry.env });
  assert.equal(await installedVersion(top), "1.0.0");
  const reinstalled = await f.proof();
  assert.equal(reinstalled.inEffect, false);
  assert.match(reinstalled.reason, /the published @proof\/lib 1\.0\.0|no longer holds/u);

  assert.equal((await f.step("apply")).ok, true);
  assert.equal(await installedVersion(top), "1.1.0");
  assert.equal(await f.node("console.log(require('@proof/lib').message)"), "connected 1.1.0");
  assert.equal((await f.proof()).inEffect, true);
});

test("npm: a disconnected repository's packages are the published copies again", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.step("apply")).ok, true);
  const lines = await restoreDisconnected({ repositories: [], sessionSourceRoot: f.app });
  assert.equal(lines.length, 2);
  assert.equal(await installedVersion(path.join(f.app, "node_modules", "@proof", "lib")), "1.0.0");
  assert.equal(await installedVersion(path.join(f.app, "node_modules", "@proof", "other", "node_modules", "@proof", "lib")), "0.9.0");
  assert.equal(await f.node("console.log(require('@proof/lib').message)"), "published 1.0.0");
  assert.equal((await f.proof()).inEffect, false);
});

test("npm: a saved file reaches every installed copy while the session runs; a new file puts the connection in effect again", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.step("apply")).ok, true);
  const events = [];
  let notify = () => {};
  const next = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No sync within 10 s: ${JSON.stringify(events)}`)), 10_000);
    notify = event => { clearTimeout(timer); resolve(event); };
  });
  const session = { sessionId: "sync-proof" };
  await syncConnectedRepositories({
    sessionId: session.sessionId, repositories: f.repositories, sessionSourceRoot: f.app, runCommand: f.runCommand,
    onEvent: event => { events.push(event); notify(event); }
  });
  t.after(() => stopConnectedSync(session.sessionId));

  const saved = next();
  const savedAt = Date.now();
  await writeFile(path.join(f.libDir, "lib", "message.js"), "module.exports = 'saved once';\n");
  const synced = await saved;
  const reachedMs = Date.now() - savedAt;
  assert.equal(synced.kind, "synced");
  t.diagnostic(`save reached both installed copies in ${reachedMs} ms (sync itself ${synced.ms} ms)`);
  assert.equal(await f.node("console.log(require('@proof/lib').message, require('@proof/other').message)"), "saved once saved once");
  assert.equal((await f.proof()).inEffect, true);

  // A file npm now publishes needs its packlist again: the connection is put in effect again.
  const added = next();
  await writeFile(path.join(f.libDir, "lib", "more.js"), "module.exports = 'more';\n");
  await writeFile(path.join(f.libDir, "index.js"),
    "exports.message = require('./lib/message'); exports.more = require('./lib/more'); exports.shared = require('shared');\n");
  const reapplied = await added;
  assert.ok(["reapplied", "synced"].includes(reapplied.kind), JSON.stringify(events));
  // The two saves may arrive as one change or two; wait for the copy to hold both.
  for (let attempt = 0; attempt < 100 && !(await f.proof()).inEffect; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await f.node("console.log(require('@proof/lib').more)"), "more");
  assert.deepEqual(await filesBelow(path.join(f.app, "node_modules", "@proof", "lib")), ["index.js", "lib/message.js", "lib/more.js", "package.json"]);
  assert.equal((await f.proof()).inEffect, true);

  await stopConnectedSync(session.sessionId);
  await writeFile(path.join(f.libDir, "lib", "message.js"), "module.exports = 'after stop';\n");
  const stale = await f.proof();
  assert.equal(stale.inEffect, false);
  assert.match(stale.reason, /changed in the connected copy and is not synced yet/u);
});

test("npm: Vibe64 refuses to swap a copy Git tracks", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  await exec("git", ["add", "--force", "node_modules/@proof/lib"], { cwd: f.app });
  const applied = await f.step("apply");
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "vibe64_connected_npm_tracked");
  assert.match(applied.error, /tracks node_modules\/@proof\/lib\/.* in Git/u);
  assert.equal(await installedVersion(path.join(f.app, "node_modules", "@proof", "lib")), "1.0.0");
});

test("npm: a tree that does not ignore node_modules gets it excluded before the swap", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.app, ".gitignore"), "");
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "no ignore"], { cwd: f.app });
  assert.equal((await f.step("apply")).ok, true);
  assert.match(await readFile(path.join(f.app, ".git", "info", "exclude"), "utf8"), /^\/node_modules$/mu);
  assert.equal((await exec("git", ["status", "--porcelain"], { cwd: f.app })).stdout, "");
});

test("npm: a Save after the swap commits none of it, so Production's package (and Staging's clone) holds only published inputs", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  // The worst case: a tree that does not ignore node_modules.
  await writeFile(path.join(f.app, ".gitignore"), "");
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "no ignore"], { cwd: f.app });
  assert.equal((await f.step("apply")).ok, true);
  await writeFile(path.join(f.app, "server.js"), "// The session's own work.\n");
  // As Save records the session's work.
  await exec("git", ["add", "--all"], { cwd: f.app });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "saved"], { cwd: f.app });
  const committed = (await exec("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: f.app })).stdout.trim().split("\n");
  assert.deepEqual(committed, [".gitignore", "package-lock.json", "package.json", "server.js"]);
  const scratch = path.join(f.root, "scratch");
  await mkdir(scratch);
  const git = async args => (await exec("git", args, { cwd: f.app })).stdout;
  const { bytes } = await packArchive({ commit: (await git(["rev-parse", "HEAD"])).trim(), git, scratch, scripts: {} });
  await writeFile(path.join(f.root, "production.tar.gz"), bytes);
  const archived = (await exec("tar", ["-tzf", path.join(f.root, "production.tar.gz")])).stdout.split("\n").filter(Boolean);
  assert.deepEqual(archived.filter(entry => entry.includes("node_modules")), []);
  // A fresh install of what was saved (what Production builds from, and Staging clones) is the published package.
  const fresh = path.join(f.root, "fresh");
  await exec("git", ["clone", "-q", f.app, fresh]);
  await exec("npm", ["ci"], { cwd: fresh, env: f.registry.env });
  assert.equal(await installedVersion(path.join(fresh, "node_modules", "@proof", "lib")), "1.0.0");
});

test("npm: Save moves the project to the connected version once it is published, never before, and the swap stays", { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.step("apply")).ok, true);
  const before = await f.tracked();
  const lockedVersion = async () => JSON.parse(await readFile(path.join(f.app, "package-lock.json"), "utf8")).packages["node_modules/@proof/lib"];

  // Not reachable: nothing changes and the line says it could not check.
  const offline = commandRunner({ ...f.registry.env, npm_config_registry: "http://127.0.0.1:9/", npm_config_fetch_retries: "0" }, []);
  const unreachable = await bumpConnectedDependencies({ repositories: f.repositories, sessionSourceRoot: f.app, runCommand: offline });
  assert.deepEqual(unreachable.bumped, []);
  assert.match(unreachable.lines.join("\n"), /Lib: could not check whether @proof\/lib@1\.1\.0 is published/u);
  assert.deepEqual(await f.tracked(), before);

  // Not published yet: nothing changes, and the gap is shown.
  const unpublished = await bumpConnectedDependencies({ repositories: f.repositories, sessionSourceRoot: f.app, runCommand: f.runCommand });
  assert.deepEqual(unpublished.bumped, []);
  assert.deepEqual(unpublished.lines, [
    "[Connected] Lib: this session runs the connected @proof/lib; Staging and Production use the published 1.0.0 until 1.1.0 is published, which Save then moves this project to."
  ]);
  assert.deepEqual(await f.tracked(), before);
  assert.deepEqual((await f.proof()).published, [{ package: "@proof/lib", connected: "1.1.0", locked: "1.0.0" }]);

  // Published: package.json (keeping its exact style) and the lockfile move to the registry's 1.1.0; node_modules keeps the swap.
  await f.registry.publish(f.libDir);
  const moved = await bumpConnectedDependencies({ repositories: f.repositories, sessionSourceRoot: f.app, runCommand: f.runCommand });
  assert.deepEqual(moved.bumped, [{ name: "Lib", package: "@proof/lib", from: "1.0.0", to: "1.1.0" }]);
  assert.deepEqual(moved.lines, [
    "[Connected] Lib: Staging and Production now use the published @proof/lib@1.1.0.",
    "[Connected] Lib: this session runs the connected @proof/lib; Staging and Production use the published 1.1.0."
  ]);
  assert.equal(JSON.parse(await readFile(path.join(f.app, "package.json"), "utf8")).dependencies["@proof/lib"], "1.1.0");
  assert.equal((await lockedVersion()).version, "1.1.0");
  assert.match((await lockedVersion()).resolved, /^http:\/\/127\.0\.0\.1:\d+\/-\/proof-lib-1\.1\.0\.tgz$/u);
  assert.equal((await f.proof()).inEffect, true);
  assert.equal(await f.node("console.log(require('@proof/lib').message)"), "connected 1.1.0");

  // Already there: nothing to do.
  const again = await bumpConnectedDependencies({ repositories: f.repositories, sessionSourceRoot: f.app, runCommand: f.runCommand });
  assert.deepEqual(again.bumped, []);
});

test("npm: a dependency no registry version satisfies refuses the swap and says which", { timeout: 120_000 }, async t => {
  const f = await fixture(t, { libDependencies: { shared: "^2.0.0" } });
  const before = await f.tracked();
  const applied = await f.step("apply");
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "vibe64_connected_npm_dependency_failed");
  assert.match(applied.error, /@proof\/lib needs shared@\^2\.0\.0, found 1\.0\.0/u);
  assert.deepEqual(await f.tracked(), before);
  assert.equal(await installedVersion(path.join(f.app, "node_modules", "@proof", "lib")), "1.0.0");
  const proof = await f.proof();
  assert.equal(proof.inEffect, false);
});

test("npm: a connection no tree installs is refused by name", { timeout: 60_000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.libDir, "package.json"), JSON.stringify({ name: "@proof/unused", version: "1.0.0" }));
  const applied = await f.step("apply");
  assert.equal(applied.ok, false);
  assert.equal(applied.code, "vibe64_connected_npm_unused");
  assert.match(applied.error, /no tree of this session installs any of its packages \(@proof\/unused\)/u);
});
