import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { composerAdapter } from "../../packages/vibe64-project/src/server/connectedAdapters/composer.js";
import {
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { writeManagedGitExcludes } from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";

// Composer itself runs in the toolchain proof (vibe64ConnectedAdapterProofs, examples/…/composer); here
// a fake answers as composer and PHP do, so every rule of the adapter is checked in milliseconds.
const exec = promisify(execFile);
const repository = "https://github.com/example/library";
const trackedLock = {
  packages: [{ name: "acme/library", version: "1.0.0", dist: { type: "zip", url: "https://repo.example.invalid/acme/library/1.0.0.zip" } }],
  "packages-dev": []
};

async function git(cwd, ...args) {
  return exec("git", args, { cwd });
}

/**
 * Answers as Vibe64's command runner would: git for real; `composer update` with COMPOSER set locks
 * each path repository and links vendor/<package> to it; the PHP probe prints the install path.
 */
function fakeToolchain(app, calls, overrides = {}) {
  return async ({ command, args, cwd, env = {} }) => {
    calls.push({ command, args, cwd, env });
    if (command === "git") {
      try {
        const { stdout, stderr } = await exec("git", args, { cwd });
        return { ok: true, stdout, stderr };
      } catch (error) {
        return { ok: false, stdout: String(error.stdout || ""), stderr: String(error.stderr || ""), error: error.message };
      }
    }
    if (command === "composer" && args[0] === "update") {
      if (env.COMPOSER !== "composer.connected.json") return { ok: false, stdout: "", stderr: "composer would write the tracked lock" };
      const manifest = JSON.parse(await readFile(path.join(cwd, env.COMPOSER), "utf8"));
      const lockPath = path.join(cwd, "composer.connected.lock");
      const lock = JSON.parse(await readFile(lockPath, "utf8").catch(() => "{\"packages\":[]}"));
      for (const repo of manifest.repositories.filter(entry => entry.type === "path")) {
        const { name } = JSON.parse(await readFile(path.join(repo.url, "composer.json"), "utf8"));
        lock.packages = [
          ...lock.packages.filter(entry => entry.name !== name),
          { name, version: repo.options.versions[name], dist: { type: "path", url: repo.url, reference: "abc123" } }
        ];
        const vendorPath = path.join(cwd, "vendor", name);
        await rm(vendorPath, { recursive: true, force: true });
        await mkdir(path.dirname(vendorPath), { recursive: true });
        await symlink(path.relative(path.dirname(vendorPath), repo.url), vendorPath);
      }
      await writeFile(lockPath, `${JSON.stringify(lock, null, 4)}\n`);
      await writeFile(path.join(cwd, "vendor", "autoload.php"), "<?php\n");
      return { ok: true, stdout: "Generating autoload files\n", stderr: "" };
    }
    if (command === "composer" && args[0] === "show") {
      if (env.COMPOSER !== "composer.json") return { ok: false, stdout: "", stderr: "show read the derived manifest" };
      return overrides.show || { ok: true, stdout: JSON.stringify({ name: args.at(-1), versions: overrides.versions || ["1.0.0"] }), stderr: "" };
    }
    if (command === "composer" && args[0] === "require") {
      if (env.COMPOSER !== "composer.json") return { ok: false, stdout: "", stderr: "require read the derived manifest" };
      const [name, version] = args.find(arg => arg.includes(":")).split(":");
      const manifest = JSON.parse(await readFile(path.join(cwd, "composer.json"), "utf8"));
      manifest.require[name] = version;
      await writeFile(path.join(cwd, "composer.json"), `${JSON.stringify(manifest, null, 4)}\n`);
      const lock = JSON.parse(await readFile(path.join(cwd, "composer.lock"), "utf8"));
      lock.packages = lock.packages.map(entry => (entry.name === name
        ? { ...entry, version, dist: { type: "zip", url: `https://repo.example.invalid/${name}/${version}.zip` } }
        : entry));
      await writeFile(path.join(cwd, "composer.lock"), `${JSON.stringify(lock, null, 4)}\n`);
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command === "php") {
      const name = args.at(-1);
      return overrides.php || { ok: true, stdout: path.join(app, "vendor", "composer", "..", name), stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected ${command}` };
  };
}

/** A committed app requiring acme/library 1.0.0 (locked) and a session copy of acme/library. */
async function composerFixture(t, { libraryName = "acme/library", libraryVersion = "1.0.0" } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vibe64-composer-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const library = path.join(root, "connected", "library");
  await mkdir(app, { recursive: true });
  await mkdir(library, { recursive: true });
  await writeFile(path.join(library, "composer.json"), `${JSON.stringify({ name: libraryName, ...(libraryVersion ? { version: libraryVersion } : {}), type: "library" }, null, 2)}\n`);
  await writeFile(path.join(app, "composer.json"), `${JSON.stringify({
    name: "acme/app",
    require: { php: ">=8.1", "acme/library": "^1.0" },
    repositories: { "packagist.org": false }
  }, null, 4)}\n`);
  await writeFile(path.join(app, "composer.lock"), `${JSON.stringify(trackedLock, null, 4)}\n`);
  await writeFile(path.join(app, ".gitignore"), "/vendor/\n");
  await git(app, "init", "-q");
  await git(app, "add", "-A");
  await git(app, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "baseline");
  const repositories = [{
    name: "Library",
    repository,
    relationship: "dependency",
    type: "composer",
    sourceRoot: library
  }];
  return { app, library, repositories };
}

/** The step's first line says so; the index may add the Staging and Production versions after it. */
function assertInEffect(result) {
  assert.equal(result.ok, true, result.error);
  assert.equal(result.output.split("\n")[0], "[Connected] Library is in effect.");
}

function step(fixture, action, runCommand) {
  return runConnectedAdapterStep({ action, repository, repositories: fixture.repositories, sessionSourceRoot: fixture.app, runCommand });
}

async function status(fixture) {
  const [proof] = await inspectConnectedAdapters({ repositories: fixture.repositories, sessionSourceRoot: fixture.app });
  return proof;
}

async function excludeBlock(app) {
  const text = await readFile(path.join(app, ".git", "info", "exclude"), "utf8");
  const lines = text.split("\n");
  const begin = lines.indexOf("# BEGIN Vibe64 managed connected composer packages files");
  return lines.slice(begin + 1, lines.indexOf("# END Vibe64 managed connected composer packages files")).filter(line => !line.includes("vibe64-backup"));
}

test("composer: apply derives the manifest and lock, keeps them and vendor out of Git, and installs the connected copy", async t => {
  const fixture = await composerFixture(t);
  const calls = [];
  const runCommand = fakeToolchain(fixture.app, calls);
  const tracked = await Promise.all(["composer.json", "composer.lock"].map(file => readFile(path.join(fixture.app, file), "utf8")));

  const applied = await step(fixture, "apply", runCommand);
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.output, "[Connected] Library: acme/library 1.0.0 in effect from its connected copy.");
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.app, "composer.connected.json"), "utf8")), {
    name: "acme/app",
    require: { php: ">=8.1", "acme/library": "^1.0" },
    repositories: [
      { type: "path", url: fixture.library, options: { symlink: true, versions: { "acme/library": "1.0.0" } } },
      { "packagist.org": false }
    ]
  });
  const composer = calls.find(call => call.command === "composer");
  assert.deepEqual(composer.args, ["update", "--no-interaction", "--no-progress", "acme/library"]);
  assert.deepEqual(composer.env, { COMPOSER: "composer.connected.json", COMPOSER_NO_AUDIT: "1" });
  assert.equal(await readlink(path.join(fixture.app, "vendor", "acme", "library")), path.join("..", "..", "..", "connected", "library"));
  assert.deepEqual(await excludeBlock(fixture.app), ["/composer.connected.json", "/composer.connected.lock", "/vendor"]);
  assert.deepEqual(await Promise.all(["composer.json", "composer.lock"].map(file => readFile(path.join(fixture.app, file), "utf8"))), tracked);
  assert.equal((await git(fixture.app, "status", "--porcelain")).stdout, "");

  // Applying again changes nothing it owns: the same manifest, and the lock starts again from the tracked one.
  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  const proof = await step(fixture, "proof", runCommand);
  assertInEffect(proof);
  assert.deepEqual(calls.at(-1).args.slice(-1), ["acme/library"]);
  assert.equal(calls.at(-1).command, "php");

  const before = calls.length;
  assert.equal((await status(fixture)).inEffect, true);
  assert.equal(calls.length, before, "session status reads files and runs nothing");
});

test("composer: the proof says exactly why once the connection is undone", async t => {
  const fixture = await composerFixture(t);
  const calls = [];
  const runCommand = fakeToolchain(fixture.app, calls);
  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  const vendorPath = path.join(fixture.app, "vendor", "acme", "library");

  // An ordinary composer install puts the published package back in place of the link.
  await rm(vendorPath);
  await mkdir(vendorPath);
  const notLinked = "vendor/acme/library is not a link to the connected copy (an ordinary composer install puts the published package back); "
    + "prepare the workspace again.";
  assert.equal((await step(fixture, "proof", runCommand)).error, `Connected Library is not in effect: ${notLinked}`);
  assert.equal((await status(fixture)).reason, notLinked);

  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  const elsewhere = fakeToolchain(fixture.app, calls, { php: { ok: true, stdout: "/srv/published/acme/library", stderr: "" } });
  assert.equal(
    (await step(fixture, "proof", elsewhere)).error,
    `Connected Library is not in effect: PHP's autoloader finds acme/library at /srv/published/acme/library, not the connected copy ${fixture.library}.`
  );

  const lockPath = path.join(fixture.app, "composer.connected.lock");
  await writeFile(lockPath, await readFile(path.join(fixture.app, "composer.lock"), "utf8"));
  assert.equal((await status(fixture)).reason, "composer.connected.lock does not lock acme/library to the connected copy; prepare the workspace again.");

  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  const manifestPath = path.join(fixture.app, "composer.connected.json");
  await writeFile(manifestPath, "{}\n");
  assert.equal((await status(fixture)).reason, "composer.connected.json no longer matches composer.json and the connected copies; prepare the workspace again.");
  await rm(manifestPath);
  assert.equal((await status(fixture)).reason, "composer.connected.json is missing; prepare the workspace to take acme/library from the connected copy.");
});

test("composer: a derived file or installed package that Git tracks is refused, and so is a package the app does not use", async t => {
  const fixture = await composerFixture(t);
  const runCommand = fakeToolchain(fixture.app, []);
  await writeFile(path.join(fixture.app, "composer.connected.json"), "{}\n");
  await git(fixture.app, "add", "composer.connected.json");
  await git(fixture.app, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "track it");
  const refused = await step(fixture, "apply", runCommand);
  assert.equal(refused.code, "vibe64_connected_derived_tracked");
  assert.match(refused.error, /tracks composer\.connected\.json in Git/u);

  const vendored = await composerFixture(t);
  await mkdir(path.join(vendored.app, "vendor", "acme", "library"), { recursive: true });
  await writeFile(path.join(vendored.app, "vendor", "acme", "library", "composer.json"), "{}\n");
  await git(vendored.app, "add", "-f", "vendor");
  await git(vendored.app, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "vendor");
  assert.equal((await step(vendored, "apply", fakeToolchain(vendored.app, []))).code, "vibe64_connected_derived_tracked");

  const unused = await composerFixture(t, { libraryName: "acme/other" });
  const calls = [];
  const result = await step(unused, "apply", fakeToolchain(unused.app, calls));
  assert.equal(result.code, "vibe64_connected_composer_unused");
  assert.equal(
    result.error,
    "Connected Library: the session's composer.json and composer.lock do not use acme/other, so nothing would take it from the connected copy."
  );
  assert.equal(calls.length, 0);
});

test("composer: once no Composer connection remains, the derived files and the links go", async t => {
  const fixture = await composerFixture(t);
  assert.equal((await step(fixture, "apply", fakeToolchain(fixture.app, []))).ok, true);
  const lines = await restoreDisconnected({ repositories: [], sessionSourceRoot: fixture.app });
  assert.deepEqual(lines, [
    "[Connected] composer: removed composer.connected.json, composer.connected.lock, vendor/acme/library; "
      + "the next composer install puts the published packages back."
  ]);
  for (const file of ["composer.connected.json", "composer.connected.lock", "vendor/acme/library"]) {
    await assert.rejects(readlink(path.join(fixture.app, file)).catch(() => readFile(path.join(fixture.app, file))), { code: "ENOENT" });
  }
  assert.deepEqual(await excludeBlock(fixture.app), []);
  assert.deepEqual(await readFile(path.join(fixture.app, "composer.json"), "utf8").then(JSON.parse).then(manifest => manifest.name), "acme/app");
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: fixture.app }), []);
});

/** The adapter's context, as the index builds it, for the lifecycle steps the index drives. */
function lifecycle(fixture, runCommand) {
  return {
    connection: fixture.repositories[0],
    connections: fixture.repositories,
    repositories: fixture.repositories,
    sessionSourceRoot: fixture.app,
    trees: [fixture.app],
    runCommand,
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected composer packages" })
  };
}

async function tracked(app) {
  return Promise.all(["composer.json", "composer.lock"].map(file => readFile(path.join(app, file), "utf8")));
}

test("composer: locked reads the version the connected copy declares and the one the tracked lock holds, running nothing", async t => {
  const declared = await composerFixture(t, { libraryVersion: "v1.1.0" });
  assert.deepEqual(await composerAdapter.locked(lifecycle(declared, null)), [{ package: "acme/library", connected: "1.1.0", locked: "1.0.0" }]);
  const unversioned = await composerFixture(t, { libraryVersion: "" });
  assert.deepEqual(await composerAdapter.locked(lifecycle(unversioned, null)), [{ package: "acme/library", connected: null, locked: "1.0.0" }]);
  const unused = await composerFixture(t, { libraryName: "acme/other" });
  assert.deepEqual(await composerAdapter.locked(lifecycle(unused, null)), []);
});

test("composer: Save moves composer.json and composer.lock to the published version the copy declares, and the swap still holds", async t => {
  const fixture = await composerFixture(t, { libraryVersion: "1.1.0" });
  const calls = [];
  assert.equal((await step(fixture, "apply", fakeToolchain(fixture.app, calls))).ok, true);
  const published = fakeToolchain(fixture.app, calls, { versions: ["1.1.0", "1.0.0"] });

  const result = await composerAdapter.bump(lifecycle(fixture, published));
  assert.deepEqual(result.bumped, [{ package: "acme/library", from: "1.0.0", to: "1.1.0" }]);
  assert.equal(result.lines[0], "[Connected] Library: Staging and Production now use the published acme/library 1.1.0.");
  const required = calls.find(call => call.args[0] === "require");
  assert.deepEqual(required.args, ["require", "acme/library:1.1.0", "--no-install", "--no-interaction", "--no-progress"]);
  assert.deepEqual(required.env, { COMPOSER: "composer.json", COMPOSER_NO_AUDIT: "1" });
  assert.equal(JSON.parse(await readFile(path.join(fixture.app, "composer.json"), "utf8")).require["acme/library"], "1.1.0");
  assert.equal(JSON.parse(await readFile(path.join(fixture.app, "composer.lock"), "utf8")).packages[0].version, "1.1.0");
  assert.deepEqual(await composerAdapter.locked(lifecycle(fixture, null)), [{ package: "acme/library", connected: "1.1.0", locked: "1.1.0" }]);
  assertInEffect(await step(fixture, "proof", published));
});

test("composer: an unpublished version, an unknown package, an unreachable registry or the same version move nothing", async t => {
  const fixture = await composerFixture(t, { libraryVersion: "1.1.0" });
  assert.equal((await step(fixture, "apply", fakeToolchain(fixture.app, []))).ok, true);
  const before = await tracked(fixture.app);
  const calls = [];

  assert.deepEqual(await composerAdapter.bump(lifecycle(fixture, fakeToolchain(fixture.app, calls, { versions: ["1.0.0"] }))), { bumped: [], lines: [] });
  const unknown = { show: { ok: false, stdout: "", stderr: "\n  [InvalidArgumentException]\n  Package \"acme/library\" not found\n" } };
  assert.deepEqual(await composerAdapter.bump(lifecycle(fixture, fakeToolchain(fixture.app, calls, unknown))), { bumped: [], lines: [] });
  const unreachable = {
    show: { ok: false, stdout: "", stderr: "In CurlDownloader.php line 390:\n  The \"https://repo.packagist.org/packages.json\" file could not be downloaded (HTTP/2 503)\n" }
  };
  assert.deepEqual(await composerAdapter.bump(lifecycle(fixture, fakeToolchain(fixture.app, calls, unreachable))), {
    bumped: [],
    lines: [
      "[Connected] Library: could not check whether acme/library 1.1.0 is published: "
        + "The \"https://repo.packagist.org/packages.json\" file could not be downloaded (HTTP/2 503)."
    ]
  });
  assert.equal(calls.filter(call => call.args[0] === "require").length, 0);
  assert.deepEqual(await tracked(fixture.app), before);

  const same = await composerFixture(t);
  const sameCalls = [];
  assert.deepEqual(await composerAdapter.bump(lifecycle(same, fakeToolchain(same.app, sameCalls, { versions: ["1.0.0"] }))), { bumped: [], lines: [] });
  assert.equal(sameCalls.length, 0);
});

test("composer: at the locked version, the copy is compared with the commit composer.lock names, so unreleased changes show", async t => {
  const fixture = await composerFixture(t, { libraryVersion: "" });
  const gitOnly = async ({ command, args, cwd }) => {
    assert.equal(command, "git");
    try {
      const { stdout, stderr } = await exec("git", args, { cwd });
      return { ok: true, stdout, stderr, exitCode: 0 };
    } catch (error) {
      return { ok: false, stdout: String(error.stdout || ""), stderr: String(error.stderr || ""), exitCode: error.code };
    }
  };
  await git(fixture.library, "init", "-q");
  await git(fixture.library, "add", "-A");
  await git(fixture.library, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "1.0.0");
  const reference = (await git(fixture.library, "rev-parse", "HEAD")).stdout.trim();
  const lock = structuredClone(trackedLock);
  lock.packages[0].source = { type: "git", url: repository, reference };
  await writeFile(path.join(fixture.app, "composer.lock"), `${JSON.stringify(lock, null, 4)}\n`);

  const locked = { package: "acme/library", connected: null, locked: "1.0.0" };
  assert.deepEqual(await composerAdapter.locked(lifecycle(fixture, gitOnly)), [{ ...locked, unreleased: false }]);
  // Without Git nothing is claimed.
  assert.deepEqual(await composerAdapter.locked(lifecycle(fixture, null)), [locked]);
  await writeFile(path.join(fixture.library, "src.php"), "<?php\n");
  assert.deepEqual(await composerAdapter.locked(lifecycle(fixture, gitOnly)), [{ ...locked, unreleased: true }]);
  // A copy that declares another version is Save's to move to, not a change at the same one.
  await writeFile(path.join(fixture.library, "composer.json"), `${JSON.stringify({ name: "acme/library", version: "1.1.0", type: "library" }, null, 2)}\n`);
  assert.deepEqual(await composerAdapter.locked(lifecycle(fixture, gitOnly)), [{ ...locked, connected: "1.1.0" }]);
});
