import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { bundlerAdapter } from "../../packages/vibe64-project/src/server/connectedAdapters/bundler.js";
import {
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { writeManagedGitExcludes } from "../../packages/vibe64-project/src/server/projectEnvironmentFiles.js";

// Ruby and Bundler run in the toolchain proof (vibe64ConnectedAdapterProofs, examples/…/bundler); here a
// fake answers as they do, so every rule of the adapter is checked in milliseconds.
const exec = promisify(execFile);
const repository = "https://github.com/example/library";
const trackedLock = `GEM
  remote: https://rubygems.org/
  specs:
    acme_library (1.0.0)

PLATFORMS
  ruby

DEPENDENCIES
  acme_library (~> 1.0)

BUNDLED WITH
   2.6.9
`;

async function git(cwd, ...args) {
  return exec("git", args, { cwd });
}

/**
 * Answers as Vibe64's command runner would: git for real; Ruby prints a gemspec's name; `bundle config`
 * writes the local setting; `bundle install` locks each connected gem to its path; the load probe
 * reports what `bundle exec` loads.
 */
function fakeToolchain(calls, overrides = {}) {
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
    if (command === "ruby") return { ok: true, stdout: `${overrides.gemspecName || path.basename(args[2], ".gemspec")}\n`, stderr: "" };
    if (command === "bundle" && args[0] === "config") {
      const configPath = path.join(cwd, ".bundle", "config");
      const existing = await readFile(configPath, "utf8").catch(() => "---\n");
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, `${existing}BUNDLE_GEMFILE: "${args[4]}"\n`);
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command === "bundle" && args[0] === "install") {
      if (env.BUNDLE_GEMFILE !== path.join(cwd, "Gemfile.connected")) return { ok: false, stdout: "", stderr: "would install the tracked Gemfile" };
      const gemfile = await readFile(env.BUNDLE_GEMFILE, "utf8");
      const [, name, root] = /connected = \{ '([^']+)' => '([^']+)' \}/u.exec(gemfile);
      // The lock starts from the one Vibe64 seeded; its GEM section gives way to the path.
      const seeded = await readFile(`${env.BUNDLE_GEMFILE}.lock`, "utf8").catch(() => trackedLock);
      await writeFile(`${env.BUNDLE_GEMFILE}.lock`, `PATH\n  remote: ${root}\n  specs:\n    ${name} (1.0.0)\n\n${seeded.replace(/^GEM\n[\s\S]*?\n\n/u, "")}`);
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command === "bundle" && args[0] === "lock") {
      if (overrides.lock) return overrides.lock;
      if (env.BUNDLE_GEMFILE !== path.join(cwd, "Gemfile.vibe64-bump")) return { ok: false, stdout: "", stderr: "lock read another Gemfile" };
      const [, version] = /gem "acme_library", "([^"]+)"/u.exec(await readFile(env.BUNDLE_GEMFILE, "utf8"));
      const lock = await readFile(`${env.BUNDLE_GEMFILE}.lock`, "utf8");
      await writeFile(`${env.BUNDLE_GEMFILE}.lock`, lock.replace("acme_library (1.0.0)", `acme_library (${version})`).replace("(~> 1.0)", `(= ${version})`));
      return { ok: true, stdout: "Writing lockfile\n", stderr: "" };
    }
    if (command === "bundle" && args[0] === "exec") {
      if (overrides.probe) return overrides.probe;
      const config = await readFile(path.join(cwd, ".bundle", "config"), "utf8").catch(() => "");
      const root = await realpath(path.join(cwd, "..", "connected", "library"));
      return { ok: true, stdout: `gemfile=${config.includes("Gemfile.connected") ? "Gemfile.connected" : "Gemfile"}\nsource=path\npath=${root}\nloads=${root}/lib\n`, stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
  };
}

/** A committed app bundling acme_library 1.0.0 (locked) and a session copy of acme_library. */
async function bundlerFixture(t, { gemspec = "acme_library.gemspec", version = "1.0.0", gemfile = "gem \"acme_library\", \"~> 1.0\"\n" } = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vibe64-bundler-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, "app");
  const library = path.join(root, "connected", "library");
  await mkdir(app, { recursive: true });
  await mkdir(path.join(library, "lib"), { recursive: true });
  await writeFile(path.join(library, gemspec), "Gem::Specification.new { |spec| spec.name = 'acme_library'; spec.version = AcmeLibrary::VERSION }\n");
  await mkdir(path.join(library, "lib", "acme_library"), { recursive: true });
  await writeFile(path.join(library, "lib", "acme_library", "version.rb"), `module AcmeLibrary\n  VERSION = "${version}"\nend\n`);
  await writeFile(path.join(app, "Gemfile"), `source "https://rubygems.org"\n\n${gemfile}`);
  await writeFile(path.join(app, "Gemfile.lock"), trackedLock);
  await writeFile(path.join(app, ".gitignore"), "/.bundle/\n");
  await git(app, "init", "-q");
  await git(app, "add", "-A");
  await git(app, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "baseline");
  const repositories = [{
    name: "Library",
    repository,
    relationship: "dependency",
    type: "bundler",
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
  const lines = (await readFile(path.join(app, ".git", "info", "exclude"), "utf8")).split("\n");
  const begin = lines.indexOf("# BEGIN Vibe64 managed connected bundler packages files");
  return lines.slice(begin + 1, lines.indexOf("# END Vibe64 managed connected bundler packages files")).filter(line => !line.includes("vibe64-backup"));
}

test("bundler: apply derives the Gemfile and lock, selects them for bundle, keeps them out of Git, and installs the connected copy", async t => {
  const fixture = await bundlerFixture(t);
  const calls = [];
  const runCommand = fakeToolchain(calls);

  const applied = await step(fixture, "apply", runCommand);
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.output, "[Connected] Library: gem acme_library in effect from its connected copy.");
  assert.equal(await readFile(path.join(fixture.app, "Gemfile.connected"), "utf8"), `# Generated by Vibe64 for connected development. Untracked.
# Evaluates the tracked Gemfile, replacing each connected gem's source by its connected copy.
connected = { 'acme_library' => '${fixture.library}' }.freeze
declared = []
define_singleton_method(:gem) do |name, *args|
  path = connected[name]
  return super(name, *args) unless path
  declared << name
  options = args.last.is_a?(Hash) ? args.pop.dup : {}
  %i[git github gitlab bitbucket branch ref tag submodules glob source].each { |key| options.delete(key) }
  super(name, *args, options.merge(path: path))
end
eval_gemfile File.expand_path('Gemfile', __dir__)
# A connected gem the Gemfile does not declare itself (a dependency of one it does) still comes from its copy.
(connected.keys - declared).each { |name| gem name, path: connected[name] }
`);
  assert.deepEqual(calls.filter(call => call.command !== "git").map(call => [call.command, ...call.args.filter((_arg, at) => call.args[at - 1] !== "-e")]), [
    ["ruby", "-e", path.join(fixture.library, "acme_library.gemspec"), fixture.library],
    ["bundle", "config", "set", "--local", "gemfile", "Gemfile.connected"],
    ["bundle", "install", "--quiet"]
  ]);
  assert.deepEqual(calls.find(call => call.args[0] === "install").env, { BUNDLE_GEMFILE: path.join(fixture.app, "Gemfile.connected") });
  assert.deepEqual(await excludeBlock(fixture.app), ["/.bundle/config", "/Gemfile.connected", "/Gemfile.connected.lock"]);
  assert.equal(await readFile(path.join(fixture.app, "Gemfile.lock"), "utf8"), trackedLock);
  assert.equal((await git(fixture.app, "status", "--porcelain")).stdout, "");

  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  assertInEffect(await step(fixture, "proof", runCommand));
  assert.deepEqual(calls.at(-1).args.slice(0, 3), ["exec", "ruby", "-e"]);

  const before = calls.length;
  assert.equal((await status(fixture)).inEffect, true);
  assert.equal(calls.length, before, "session status reads files and runs nothing");
});

test("bundler: the proof says exactly why once the connection is undone", async t => {
  const fixture = await bundlerFixture(t);
  const calls = [];
  const runCommand = fakeToolchain(calls);
  assert.equal((await step(fixture, "apply", runCommand)).ok, true);

  // `bundle config unset --local gemfile`: bundle exec uses the tracked Gemfile again.
  await writeFile(path.join(fixture.app, ".bundle", "config"), "---\n");
  const unselected = ".bundle/config does not select Gemfile.connected, so bundle exec uses the published acme_library; prepare the workspace again.";
  assert.equal((await step(fixture, "proof", runCommand)).error, `Connected Library is not in effect: ${unselected}`);
  assert.equal((await status(fixture)).reason, unselected);

  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  const elsewhere = fakeToolchain(calls, {
    probe: { ok: true, stdout: "gemfile=Gemfile.connected\nsource=rubygems\npath=/gems/acme_library-1.0.0\nloads=/gems/acme_library-1.0.0/lib\n", stderr: "" }
  });
  assert.equal(
    (await step(fixture, "proof", elsewhere)).error,
    `Connected Library is not in effect: bundle exec loads acme_library from /gems/acme_library-1.0.0, not the connected copy ${fixture.library}.`
  );

  await writeFile(path.join(fixture.app, "Gemfile.connected.lock"), trackedLock);
  assert.equal((await status(fixture)).reason, "Gemfile.connected.lock does not lock acme_library to the connected copy; prepare the workspace again.");

  assert.equal((await step(fixture, "apply", runCommand)).ok, true);
  await writeFile(path.join(fixture.app, "Gemfile.connected"), "eval_gemfile 'Gemfile'\n");
  assert.equal((await status(fixture)).reason, "Gemfile.connected no longer matches the connected copies; prepare the workspace again.");
  await rm(path.join(fixture.app, "Gemfile.connected"));
  assert.equal((await status(fixture)).reason, "Gemfile.connected is missing; prepare the workspace to take acme_library from the connected copy.");
});

test("bundler: a tracked local setting, a gemspec named for another gem and a gem the app does not use are refused", async t => {
  const fixture = await bundlerFixture(t);
  await mkdir(path.join(fixture.app, ".bundle"), { recursive: true });
  await writeFile(path.join(fixture.app, ".bundle", "config"), "---\nBUNDLE_PATH: \"vendor/bundle\"\n");
  await git(fixture.app, "add", "-f", ".bundle/config");
  await git(fixture.app, "-c", "user.name=proof", "-c", "user.email=proof@example.com", "commit", "-qm", "track it");
  const refused = await step(fixture, "apply", fakeToolchain([]));
  assert.equal(refused.code, "vibe64_connected_derived_tracked");
  assert.match(refused.error, /tracks \.bundle\/config in Git/u);

  const misnamed = await bundlerFixture(t);
  const wrong = await step(misnamed, "apply", fakeToolchain([], { gemspecName: "acme-library" }));
  assert.equal(wrong.code, "vibe64_connected_bundler_gemspec_invalid");
  assert.equal(wrong.error, "Connected Library: acme_library.gemspec names the gem acme-library; Vibe64 needs the gemspec file named after its gem.");

  const unused = await bundlerFixture(t, { gemspec: "acme_other.gemspec" });
  const calls = [];
  const result = await step(unused, "apply", fakeToolchain(calls));
  assert.equal(result.code, "vibe64_connected_bundler_unused");
  assert.equal(result.error, "Connected Library: the session's Gemfile.lock does not use acme_other, so nothing would take it from the connected copy.");
  assert.equal(calls.length, 0);
});

test("bundler: once no Bundler connection remains, the derived files and the setting selecting them go, and the project's own settings stay", async t => {
  const fixture = await bundlerFixture(t);
  await mkdir(path.join(fixture.app, ".bundle"), { recursive: true });
  await writeFile(path.join(fixture.app, ".bundle", "config"), "---\nBUNDLE_PATH: \"vendor/bundle\"\n");
  assert.equal((await step(fixture, "apply", fakeToolchain([]))).ok, true);
  const lines = await restoreDisconnected({ repositories: [], sessionSourceRoot: fixture.app });
  assert.deepEqual(lines, ["[Connected] bundler: removed Gemfile.connected, Gemfile.connected.lock, the gemfile setting in .bundle/config."]);
  for (const file of ["Gemfile.connected", "Gemfile.connected.lock"]) {
    await assert.rejects(readFile(path.join(fixture.app, file)), { code: "ENOENT" });
  }
  assert.equal(await readFile(path.join(fixture.app, ".bundle", "config"), "utf8"), "---\nBUNDLE_PATH: \"vendor/bundle\"\n");
  assert.deepEqual(await excludeBlock(fixture.app), []);
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
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected bundler packages" })
  };
}

async function tracked(app) {
  return Promise.all(["Gemfile", "Gemfile.lock"].map(file => readFile(path.join(app, file), "utf8")));
}

test("bundler: locked reads the version the connected gem declares and the one the tracked lock holds, running nothing", async t => {
  const declared = await bundlerFixture(t, { version: "1.1.0" });
  assert.deepEqual(await bundlerAdapter.locked(lifecycle(declared, null)), [{ package: "acme_library", connected: "1.1.0", locked: "1.0.0" }]);
  const literal = await bundlerFixture(t);
  await writeFile(path.join(literal.library, "acme_library.gemspec"), "Gem::Specification.new { |spec| spec.name = 'acme_library'; spec.version = '1.2.0' }\n");
  assert.deepEqual(await bundlerAdapter.locked(lifecycle(literal, null)), [{ package: "acme_library", connected: "1.2.0", locked: "1.0.0" }]);
  const unused = await bundlerFixture(t, { gemspec: "acme_other.gemspec" });
  assert.deepEqual(await bundlerAdapter.locked(lifecycle(unused, null)), []);
});

test("bundler: Save pins the Gemfile and Gemfile.lock to the published version the copy declares, and the swap still holds", async t => {
  const fixture = await bundlerFixture(t, { gemfile: "gem \"acme_library\", \"~> 1.0\", require: false\n" });
  await writeFile(path.join(fixture.library, "lib", "acme_library", "version.rb"), "module AcmeLibrary\n  VERSION = \"1.1.0\"\nend\n");
  const calls = [];
  const runCommand = fakeToolchain(calls);
  assert.equal((await step(fixture, "apply", runCommand)).ok, true);

  const result = await bundlerAdapter.bump(lifecycle(fixture, runCommand));
  assert.deepEqual(result.bumped, [{ package: "acme_library", from: "1.0.0", to: "1.1.0" }]);
  assert.equal(result.lines[0], "[Connected] Library: Staging and Production now use the published acme_library 1.1.0.");
  const locked = calls.find(call => call.args[0] === "lock");
  assert.deepEqual(locked.args, ["lock", "--update", "acme_library"]);
  assert.deepEqual(locked.env, { BUNDLE_GEMFILE: path.join(fixture.app, "Gemfile.vibe64-bump") });
  assert.equal(await readFile(path.join(fixture.app, "Gemfile"), "utf8"), "source \"https://rubygems.org\"\n\ngem \"acme_library\", \"1.1.0\", require: false\n");
  assert.match(await readFile(path.join(fixture.app, "Gemfile.lock"), "utf8"), /^ {4}acme_library \(1\.1\.0\)$/mu);
  await assert.rejects(readFile(path.join(fixture.app, "Gemfile.vibe64-bump")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(fixture.app, "Gemfile.vibe64-bump.lock")), { code: "ENOENT" });
  assert.deepEqual(await bundlerAdapter.locked(lifecycle(fixture, null)), [{ package: "acme_library", connected: "1.1.0", locked: "1.1.0" }]);
  // The swap starts again from the moved lock.
  assert.match(await readFile(path.join(fixture.app, "Gemfile.connected.lock"), "utf8"), /^ {2}acme_library \(= 1\.1\.0\)$/mu);
  assertInEffect(await step(fixture, "proof", runCommand));
});

test("bundler: an unpublished version, an unreachable source, an undeclared gem or the same version move nothing", async t => {
  const fixture = await bundlerFixture(t, { version: "1.1.0" });
  assert.equal((await step(fixture, "apply", fakeToolchain([]))).ok, true);
  const before = await tracked(fixture.app);
  const unpublished = {
    lock: { ok: false, stdout: "", stderr: "Could not find gem 'acme_library (= 1.1.0)' in rubygems repository https://rubygems.org/ or installed locally.\n" }
  };
  assert.deepEqual(await bundlerAdapter.bump(lifecycle(fixture, fakeToolchain([], unpublished))), { bumped: [], lines: [] });
  const unreachable = { lock: { ok: false, stdout: "", stderr: "Could not reach host rubygems.org. Check your network connection and try again.\n" } };
  assert.deepEqual(await bundlerAdapter.bump(lifecycle(fixture, fakeToolchain([], unreachable))), {
    bumped: [],
    lines: [
      "[Connected] Library: could not check whether acme_library 1.1.0 is published: "
        + "Could not reach host rubygems.org. Check your network connection and try again."
    ]
  });
  assert.deepEqual(await tracked(fixture.app), before);
  await assert.rejects(readFile(path.join(fixture.app, "Gemfile.vibe64-bump")), { code: "ENOENT" });

  const undeclared = await bundlerFixture(t, { version: "1.1.0", gemfile: "gem \"acme_tools\"\n" });
  const calls = [];
  assert.deepEqual(await bundlerAdapter.bump(lifecycle(undeclared, fakeToolchain(calls))), {
    bumped: [],
    lines: ["[Connected] Library: the Gemfile does not declare acme_library itself, so Vibe64 leaves its locked 1.0.0."]
  });
  const same = await bundlerFixture(t);
  assert.deepEqual(await bundlerAdapter.bump(lifecycle(same, fakeToolchain(calls))), { bumped: [], lines: [] });
  assert.equal(calls.length, 0);
});
