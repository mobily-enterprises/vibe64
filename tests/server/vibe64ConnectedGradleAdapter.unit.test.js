import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  inspectConnectedAdapters,
  restoreDisconnected,
  runConnectedAdapterStep
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { gradleAdapter } from "../../packages/vibe64-project/src/server/connectedAdapters/gradle.js";
import { resolveCommandEnv } from "../../packages/vibe64-execution/src/server/env/resolveCommandEnv.js";

// Vibe64's gradle adapter against a fake Gradle that answers like the real one where the adapter
// looks: the proof task prints each runtime artifact with the build it comes from, the published
// task resolves a module or reports it missing, and --write-locks rewrites gradle.lockfile from the
// build script; `sh` answers the default Gradle user home. Git is real.
// examples/connected-development/gradle/prove.sh runs it with real Gradle.
const exec = promisify(execFile);
const library = "https://github.com/example/library";
const tools = "https://github.com/example/tools";
const HOME = ".development/gradle-home";
const INIT = `${HOME}/init.d/vibe64-connected.init.gradle.kts`;
const PROOF_INIT = ".development/connected-proof.init.gradle.kts";
const PUBLISHED_INIT = ".development/connected-published.init.gradle.kts";
const APP_BUILD = "plugins { application }\n\nrepositories { mavenLocal() }\n\ndependencies {\n    implementation(\"com.example:library:1.0.0\")\n}\n";

async function exists(file) {
  return Boolean(await stat(file).catch(() => null));
}

async function git(cwd, ...args) {
  return (await exec("git", args, { cwd })).stdout;
}

/**
 * The fake toolchain: `resolve` "connected" (the included build supplies the library), "published"
 * (Gradle resolves the published jar) or "fail"; `published` the modules the repositories hold.
 */
function fakeGradle({ app, copy, calls, envs = [], defaultHome = "", resolve = "connected", published = [], unreachable = false }) {
  return async ({ command, args, cwd, env = {} }) => {
    calls.push([command, ...args]);
    if (command === "gradle") envs.push(env);
    if (command === "sh") return defaultHome ? { ok: true, stdout: defaultHome, stderr: "" } : { ok: false, stdout: "", stderr: "sh: not found" };
    if (command === "git") {
      try {
        const { stdout, stderr } = await exec("git", args, { cwd });
        return { ok: true, stdout, stderr };
      } catch (error) {
        return { ok: false, stdout: String(error.stdout || ""), stderr: String(error.stderr || ""), error: error.message };
      }
    }
    if (command !== "gradle") return { ok: false, stdout: "", stderr: `unexpected ${command}`, error: "unexpected" };
    if (args.at(-1) === "connectedProof") {
      if (resolve === "fail") {
        return {
          ok: false,
          stdout: "",
          stderr: "FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not resolve all files for configuration ':runtimeClasspath'.\n" +
            "> Could not find com.example:library:1.0.0.\n\n* Try:\n> Run with --stacktrace option to get the stack trace.\n"
        };
      }
      const jar = path.join(copy, "build", "libs", "library-1.1.0.jar");
      await mkdir(path.dirname(jar), { recursive: true });
      await writeFile(jar, "built from source");
      const line = resolve === "connected"
        ? `CONNECTED-ARTIFACT\t:\t:library\tproject :library\t${jar}`
        : `CONNECTED-ARTIFACT\t:\t-\tcom.example:library:1.0.0\t${path.join(app, "..", "m2", "library-1.0.0.jar")}`;
      return { ok: true, stdout: `CONNECTED-ARTIFACT\t:\t-\torg.example:other:1.0\t${path.join(app, "build.gradle.kts")}\n${line}\n`, stderr: "" };
    }
    if (args.at(-1) === "connectedPublished") {
      const module = args.find(arg => arg.startsWith("-Pvibe64ConnectedModule=")).split("=")[1];
      if (unreachable) return { ok: false, stdout: "", stderr: `> Could not GET 'https://repo.example/${module}.pom'. Received status code 503\n` };
      if (published.includes(module)) return { ok: true, stdout: `CONNECTED-PUBLISHED\t${module}\n`, stderr: "" };
      return { ok: false, stdout: "", stderr: `* What went wrong:\n> Could not find ${module}.\n` };
    }
    if (args.includes("--write-locks")) {
      const version = /com\.example:library:([^"]+)"/u.exec(await readFile(path.join(cwd, "build.gradle.kts"), "utf8"))[1];
      await writeFile(path.join(cwd, "gradle.lockfile"), `com.example:library:${version}=runtimeClasspath\nempty=\n`);
      return { ok: true, stdout: "", stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected gradle ${args.join(" ")}`, error: "unexpected" };
  };
}

async function gradleBuild(dir, name, script) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "settings.gradle.kts"), `rootProject.name = "${name}"\n`);
  await writeFile(path.join(dir, "build.gradle.kts"), script);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-connected-gradle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // The shared read-only cache's root follows the server login's cache folder.
  const cacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(root, "xdg-cache");
  t.after(() => { if (cacheHome === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = cacheHome; });
  const roRoot = path.join(root, "xdg-cache", "vibe64", "gradle-ro-dep-cache");
  // The person's own Gradle user home: settings, an init script and a dependency cache with its locks.
  const defaultHome = path.join(root, "person-gradle");
  await mkdir(path.join(defaultHome, "init.d"), { recursive: true });
  await writeFile(path.join(defaultHome, "gradle.properties"), "systemProp.http.proxyHost=proxy.example\n");
  await writeFile(path.join(defaultHome, "init.d", "mirror.init.gradle.kts"), "// the person's mirror\n");
  const modules = path.join(defaultHome, "caches", "modules-2");
  await mkdir(path.join(modules, "files-2.1", "org.example", "other"), { recursive: true });
  await writeFile(path.join(modules, "files-2.1", "org.example", "other", "other-1.0.jar"), "jar");
  await writeFile(path.join(modules, "modules-2.lock"), "");
  await writeFile(path.join(modules, "gc.properties"), "");
  const app = path.join(root, "session", "source");
  await gradleBuild(app, "app", APP_BUILD);
  await writeFile(path.join(app, ".gitignore"), "/build/\n");
  await git(app, "init", "-q", "--initial-branch=main");
  await git(app, "add", "--all");
  await git(app, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "app");
  // A `$` and a quote in a path must stay literal in the Kotlin script.
  const copy = path.join(root, "session", "connected", "lib$rary\"s");
  await gradleBuild(copy, "library", "plugins { `java-library` }\n\ngroup = \"com.example\"\nversion = \"1.1.0\"\n");
  const other = path.join(root, "session", "connected", "tools");
  await gradleBuild(other, "tools", "group = \"com.example\"\nversion = \"2.0.0\"\n");
  const repositories = [
    { name: "Library", repository: library, relationship: "dependency", type: "gradle", sourceRoot: copy },
    { name: "Tools", repository: tools, relationship: "dependency", type: "gradle", sourceRoot: other }
  ];
  const calls = [];
  const envs = [];
  const runCommand = fakeGradle({ app, copy, calls, envs, defaultHome });
  const step = (action, runner = runCommand, connected = repositories) =>
    runConnectedAdapterStep({ action, repository: library, repositories: connected, sessionSourceRoot: app, runCommand: runner });
  const status = async (connected = repositories) => (await inspectConnectedAdapters({ repositories: connected, sessionSourceRoot: app }))[0];
  const context = runner => ({
    connection: repositories[0],
    connections: repositories,
    sessionSourceRoot: app,
    runCommand: runner,
    writeGitExcludes: async () => {}
  });
  return { app, copy, other, repositories, calls, envs, defaultHome, roRoot, step, status, context };
}

const gradleRuns = calls => calls.filter(call => call[0] === "gradle");

test("gradle: apply writes the init script into the session's Gradle home, keeps the home out of Git, and the proof sees the included build with no flag", async t => {
  const { app, copy, other, calls, envs, defaultHome, roRoot, step, status } = await fixture(t);
  // An earlier Vibe64 wrote the script beside the proof's, for commands that passed it with -I.
  await mkdir(path.join(app, ".development"), { recursive: true });
  await writeFile(path.join(app, ".development", "connected.init.gradle.kts"), "// Generated by Vibe64 for connected development. Do not commit.\n");
  const applied = await step("apply");
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.output, [
    `[Connected] Library: Gradle builds it from ${copy} in place of the published module with its group:name, ` +
      `in every Gradle command of the session (its Gradle user home is ${HOME}).`,
    `[Connected] Gradle: the shared read-only dependency cache now holds what ${defaultHome} had.`
  ].join("\n"));
  assert.equal(await readFile(path.join(app, INIT), "utf8"), [
    "// Generated by Vibe64 for connected development. Do not commit.",
    "// Gradle reads it from the session's own Gradle user home, which Vibe64 gives every command of the session.",
    "settingsEvaluated {",
    "    // Library",
    `    includeBuild("${copy.replaceAll("$", "\\$").replaceAll("\"", "\\\"")}")`,
    "    // Tools",
    `    includeBuild("${other}")`,
    "}",
    ""
  ].join("\n"));
  assert.equal(await exists(path.join(app, ".development", "connected.init.gradle.kts")), false, "the earlier script goes");
  assert.match(await readFile(path.join(app, PROOF_INIT), "utf8"), /tasks\.register\("connectedProof"\)/u);
  assert.match(await readFile(path.join(app, PUBLISHED_INIT), "utf8"), /tasks\.register\("connectedPublished"\)/u);
  assert.equal(gradleRuns(calls).length, 0, "writing the composite runs no Gradle");
  const exclude = await readFile(path.join(app, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^# BEGIN Vibe64 managed connected gradle packages files$/mu);
  for (const generated of [HOME, PROOF_INIT, PUBLISHED_INIT]) assert.match(exclude, new RegExp(`^/${generated.replaceAll(".", "\\.")}$`, "mu"));
  // What the session's Gradle writes in its home stays out of Git too.
  await mkdir(path.join(app, HOME, "caches", "transforms-4"), { recursive: true });
  await writeFile(path.join(app, HOME, "caches", "transforms-4", "entry"), "cached");
  assert.equal(await git(app, "status", "--porcelain", "--untracked-files=all"), "", "nothing Vibe64 or Gradle made can reach a commit");
  // The person's own settings and init scripts still apply in the session's home.
  assert.equal(await readlink(path.join(app, HOME, "gradle.properties")), path.join(defaultHome, "gradle.properties"));
  assert.equal(await readlink(path.join(app, HOME, "init.d", "mirror.init.gradle.kts")), path.join(defaultHome, "init.d", "mirror.init.gradle.kts"));
  // The shared read-only cache is a copy of the default home's, without its locks and cleanup state.
  const generation = await readlink(path.join(roRoot, "current"));
  assert.match(generation, /^generation-\d+$/u);
  assert.equal(await readFile(path.join(roRoot, "current", "modules-2", "files-2.1", "org.example", "other", "other-1.0.jar"), "utf8"), "jar");
  assert.deepEqual((await readdir(path.join(roRoot, "current", "modules-2"))).sort(), ["files-2.1"]);

  const proved = await step("proof");
  assert.equal(proved.ok, true, proved.error);
  assert.match(proved.output, /^\[Connected\] Library is in effect\.(?:\n|$)/u);
  assert.deepEqual(gradleRuns(calls).at(-1), [
    "gradle", "-q", "--console=plain", "--no-daemon", "--no-configuration-cache",
    "-I", path.join(app, PROOF_INIT), "connectedProof"
  ], "the proof runs Gradle as the session's commands do, with no connection flag");
  assert.deepEqual(envs.at(-1), { GRADLE_USER_HOME: path.join(app, HOME), GRADLE_RO_DEP_CACHE: path.join(roRoot, generation) },
    "a command reads the generation published when it starts, for its whole run");
  assert.equal((await status()).inEffect, true);
  assert.deepEqual((await status()).published, [{ package: "com.example:library", connected: "1.1.0", locked: "1.0.0" }]);
  const text = await readFile(path.join(app, INIT), "utf8");
  const again = await step("apply");
  assert.equal(again.ok, true, again.error);
  assert.equal(await readFile(path.join(app, INIT), "utf8"), text, "applying again changes nothing");
  assert.equal(again.output.includes("read-only dependency cache"), false, "a cache published today is not copied again");
  assert.equal(await readlink(path.join(roRoot, "current")), generation);
  assert.equal(await readlink(path.join(app, HOME, "gradle.properties")), path.join(defaultHome, "gradle.properties"));
  // An init script the default home no longer has is no longer linked.
  await rm(path.join(defaultHome, "init.d", "mirror.init.gradle.kts"));
  assert.equal((await step("apply")).ok, true);
  assert.deepEqual(await readdir(path.join(app, HOME, "init.d")), ["vibe64-connected.init.gradle.kts"]);
  // A file the session home has of its own stays, even where the default home has one of that name.
  await writeFile(path.join(defaultHome, "init.d", "mirror.init.gradle.kts"), "// the person's mirror\n");
  await writeFile(path.join(app, HOME, "init.d", "mirror.init.gradle.kts"), "// this session's own\n");
  const own = await step("apply");
  assert.equal(own.ok, true, own.error);
  assert.equal(await readFile(path.join(app, HOME, "init.d", "mirror.init.gradle.kts"), "utf8"), "// this session's own\n");
  // The links follow the default home when it moves.
  const moved = path.join(path.dirname(defaultHome), "moved-gradle");
  await mkdir(moved, { recursive: true });
  await writeFile(path.join(moved, "gradle.properties"), "org.gradle.caching=true\n");
  const followed = await step("apply", fakeGradle({ app, copy, calls, defaultHome: moved }));
  assert.equal(followed.ok, true, followed.error);
  assert.equal(await readlink(path.join(app, HOME, "gradle.properties")), path.join(moved, "gradle.properties"));
});

test("gradle: every command in the session gets its Gradle home and the shared cache, a command elsewhere does not, and a command's own home wins", async t => {
  const { app, roRoot, step } = await fixture(t);
  const resolve = (cwd, env = {}, baseEnv = {}) => resolveCommandEnv({
    baseEnv: { PATH: "/usr/bin", ...baseEnv }, request: { cwd, env }, resolvedGitIdentityEnv: {}
  });
  assert.equal(resolve(app).GRADLE_USER_HOME, undefined, "no gradle connection yet");
  assert.equal((await step("apply")).ok, true);
  await mkdir(path.join(app, "src", "main"), { recursive: true });
  for (const cwd of [app, path.join(app, "src", "main")]) {
    const env = resolve(cwd);
    assert.equal(env.GRADLE_USER_HOME, path.join(app, HOME), cwd);
    assert.equal(env.GRADLE_RO_DEP_CACHE, path.join(roRoot, await readlink(path.join(roRoot, "current"))), cwd);
  }
  assert.equal(resolve(path.dirname(app)).GRADLE_USER_HOME, undefined, "a command outside the session's tree");
  assert.equal(resolve(app, { GRADLE_USER_HOME: "/elsewhere" }).GRADLE_USER_HOME, "/elsewhere", "a command's own home wins");
  // An agent started while the session was connected carries the session's Gradle env in its own.
  const agent = { GRADLE_USER_HOME: resolve(app).GRADLE_USER_HOME, GRADLE_RO_DEP_CACHE: resolve(app).GRADLE_RO_DEP_CACHE };
  assert.equal(resolve(app, {}, agent).GRADLE_USER_HOME, path.join(app, HOME));
  await restoreDisconnected({ repositories: [], sessionSourceRoot: app });
  assert.equal(resolve(app).GRADLE_USER_HOME, undefined, "a removed connection takes the session's Gradle home away");
  const after = resolve(app, {}, agent);
  assert.equal(after.GRADLE_USER_HOME, undefined, "even from the environment of an agent started while it was connected");
  assert.equal(after.GRADLE_RO_DEP_CACHE, undefined);
  assert.equal(resolve(app, {}, { GRADLE_USER_HOME: "/home/person/.gradle" }).GRADLE_USER_HOME, "/home/person/.gradle", "another home stays");
});

test("gradle: the shared read-only cache is published again once a day, and old generations go after a week", async t => {
  const { roRoot, step } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  const first = await readlink(path.join(roRoot, "current"));
  // A published generation a day old is replaced by a new one; one a week old goes.
  const dayOld = `generation-${Date.now() - 25 * 60 * 60_000}`;
  const weekOld = `generation-${Date.now() - 8 * 24 * 60 * 60_000}`;
  await mkdir(path.join(roRoot, dayOld, "modules-2"), { recursive: true });
  await mkdir(path.join(roRoot, weekOld, "modules-2"), { recursive: true });
  await rm(path.join(roRoot, "current"));
  await symlink(dayOld, path.join(roRoot, "current"));
  const refreshed = await step("apply");
  assert.match(refreshed.output, /the shared read-only dependency cache now holds/u);
  const next = await readlink(path.join(roRoot, "current"));
  assert.notEqual(next, dayOld);
  const kept = (await readdir(roRoot)).sort();
  assert.ok(kept.includes(dayOld) && kept.includes(first) && kept.includes(next), "generations a build may still read stay");
  assert.equal(kept.includes(weekOld), false, "a week-old generation goes");
  assert.equal(kept.some(entry => entry.endsWith(".partial")), false);
});

test("gradle: the proof says why the connection is not in effect, and preparing again puts it back", async t => {
  const { app, copy, calls, step, status, repositories } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  assert.deepEqual(await step("proof", fakeGradle({ app, copy, calls, resolve: "published" })), {
    ok: false,
    error: `Connected Library is not in effect: no runtime artifact of the session source comes from the included build at ${copy}; ` +
      "does the checkout's group:name match the dependency?"
  });
  const failed = await step("proof", fakeGradle({ app, copy, calls, resolve: "fail" }));
  assert.equal(failed.error, "Connected Library is not in effect: Gradle could not build the composite: Could not find com.example:library:1.0.0.",
    "the deepest cause Gradle names, not its advice");

  const alone = [repositories[0]];
  assert.equal((await status(alone)).reason, `${INIT} does not include the session's connected checkouts; prepare the workspace again.`);
  await writeFile(path.join(app, INIT), (await readFile(path.join(app, INIT), "utf8")).replace(/ {4}includeBuild\(.*rary.*\n/u, ""));
  assert.equal((await status()).reason, `${INIT} does not include the session's connected checkouts; prepare the workspace again.`);
  await rm(path.join(app, INIT));
  assert.equal((await status()).reason, `${INIT} is missing; prepare the workspace to include the connected checkout.`);
  assert.equal((await step("apply")).ok, true);
  await rm(path.join(app, PROOF_INIT));
  assert.equal((await status()).inEffect, true, "the status reads the init script only");
  assert.deepEqual(await step("proof"), { ok: false, error: `Connected Library is not in effect: ${PROOF_INIT} is missing; prepare the workspace again.` });
  assert.equal((await step("apply")).ok, true);
  assert.equal((await step("proof")).ok, true);
});

test("gradle: apply refuses a tracked or project-owned init script, and goes on for a session that is not a Gradle build", async t => {
  const { app, step, status } = await fixture(t);
  await mkdir(path.dirname(path.join(app, INIT)), { recursive: true });
  await writeFile(path.join(app, INIT), "settingsEvaluated { }\n");
  const foreign = await step("apply");
  assert.equal(foreign.code, "vibe64_connected_gradle_init_foreign", foreign.error);
  assert.equal(await readFile(path.join(app, INIT), "utf8"), "settingsEvaluated { }\n");

  await rm(path.join(app, INIT));
  await writeFile(path.join(app, HOME, "gradle.properties"), "org.gradle.caching=true\n");
  await git(app, "add", "--force", path.join(HOME, "gradle.properties"));
  await git(app, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "a tracked Gradle home");
  const tracked = await step("apply");
  assert.equal(tracked.code, "vibe64_connected_derived_tracked", tracked.error);
  assert.match(tracked.error, /tracks \.development\/gradle-home\/gradle\.properties in Git/u);

  // No Gradle build here uses the checkout: preparation goes on and says so.
  await rm(path.join(app, "settings.gradle.kts"));
  await rm(path.join(app, "build.gradle.kts"));
  const said = "[Connected] Library is connected, but nothing here installs it: remove it or install it. " +
    "The session source is not a Gradle build, so no Gradle build uses it.";
  assert.deepEqual(await step("apply"), { ok: true, output: said });
  assert.deepEqual(await step("proof"), { ok: true, output: said });
  const proof = await status();
  assert.deepEqual([proof.inEffect, proof.unused, proof.reason], [false, true, said.slice("[Connected] ".length)]);
});

test("gradle: restore takes the session's Gradle home and the scripts back once no gradle connection remains", async t => {
  const { app, repositories, step } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  assert.deepEqual(await restoreDisconnected({ repositories, sessionSourceRoot: app }), [], "a remaining connection keeps its scripts");
  // An earlier Vibe64's script, for commands that passed it with -I, goes too.
  await writeFile(path.join(app, ".development", "connected.init.gradle.kts"), "// Generated by Vibe64 for connected development. Do not commit.\n");
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: app }), [
    `[Connected] Gradle: removed ${HOME}, .development/connected.init.gradle.kts, ${PROOF_INIT}, ${PUBLISHED_INIT}; ` +
      "Gradle resolves the published modules again."
  ]);
  for (const generated of [HOME, PROOF_INIT, PUBLISHED_INIT]) assert.equal(await exists(path.join(app, generated)), false, generated);
  assert.doesNotMatch(await readFile(path.join(app, ".git", "info", "exclude"), "utf8"), /gradle-home|connected-proof/u);
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: app }), []);
});

test("gradle: locked reads the version the checkout declares and the one the tracked build names", async t => {
  const { app, context } = await fixture(t);
  assert.deepEqual(await gradleAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: "1.0.0" }]);
  await writeFile(path.join(app, "gradle.lockfile"), "com.example:library:0.9.0=runtimeClasspath\nempty=\n");
  assert.deepEqual(await gradleAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: "0.9.0" }],
    "the lockfile is what resolves");
  await rm(path.join(app, "gradle.lockfile"));
  await writeFile(path.join(app, "build.gradle.kts"), "dependencies {\n    implementation(libs.library)\n}\n");
  await mkdir(path.join(app, "gradle"), { recursive: true });
  await writeFile(path.join(app, "gradle", "libs.versions.toml"), "[libraries]\nlibrary = { module = \"com.example:library\", version.ref = \"lib\" }\n");
  assert.deepEqual(await gradleAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: null }],
    "a version catalog cannot be read here");
  await rm(path.join(app, "gradle"), { recursive: true });
  assert.deepEqual(await gradleAdapter.locked(context(null)), [], "a build that does not depend on the checkout");
});

test("gradle: bump moves the tracked build script (and gradle.lockfile) to a published version only", async t => {
  const { app, copy, calls, envs, defaultHome, context } = await fixture(t);
  const runner = options => fakeGradle({ app, copy, calls, envs, defaultHome, ...options });
  assert.deepEqual(await gradleAdapter.bump(context(runner())), {
    bumped: [],
    lines: ["[Connected] Library: com.example:library 1.1.0 is not published; Staging and Production keep 1.0.0."]
  });
  const check = gradleRuns(calls).at(-1);
  assert.deepEqual(check.slice(0, 7), ["gradle", "-q", "--console=plain", "--no-daemon", "--no-configuration-cache", "-I", path.join(app, PUBLISHED_INIT)]);
  assert.equal(check.includes(path.join(app, INIT)), false, "the published check never includes the connected checkout");
  assert.deepEqual(envs.at(-1), { GRADLE_USER_HOME: defaultHome }, "it runs in the default home, whose init.d has no connection");
  assert.deepEqual((await gradleAdapter.bump(context(fakeGradle({ app, copy, calls })))).lines, [
    "[Connected] Library: could not check whether com.example:library 1.1.0 is published: Vibe64 could not find the default Gradle user home."
  ]);
  assert.deepEqual((await gradleAdapter.bump(context(runner({ unreachable: true })))).lines, [
    "[Connected] Library: could not check whether com.example:library 1.1.0 is published: " +
      "Could not GET 'https://repo.example/com.example:library:1.1.0.pom'. Received status code 503."
  ]);
  await writeFile(path.join(copy, "build.gradle.kts"), "group = \"com.example\"\nversion = \"1.2.0-SNAPSHOT\"\n");
  const before = calls.length;
  assert.deepEqual((await gradleAdapter.bump(context(runner({ published: ["com.example:library:1.2.0-SNAPSHOT"] })))).lines, [
    "[Connected] Library: com.example:library 1.2.0-SNAPSHOT is a snapshot, which is never published; Staging and Production keep 1.0.0."
  ]);
  assert.equal(calls.length, before, "a snapshot is not even looked up");
  assert.equal(await readFile(path.join(app, "build.gradle.kts"), "utf8"), APP_BUILD, "nothing moved");

  await writeFile(path.join(copy, "build.gradle.kts"), "group = \"com.example\"\nversion = \"1.1.0\"\n");
  await writeFile(path.join(app, "gradle.lockfile"), "com.example:library:1.0.0=runtimeClasspath\nempty=\n");
  assert.deepEqual(await gradleAdapter.bump(context(runner({ published: ["com.example:library:1.1.0"] }))), {
    bumped: [{ package: "com.example:library", from: "1.0.0", to: "1.1.0" }],
    lines: ["[Connected] Library: Staging and Production now use the published com.example:library 1.1.0."]
  });
  assert.equal(await readFile(path.join(app, "build.gradle.kts"), "utf8"), APP_BUILD.replace("library:1.0.0", "library:1.1.0"));
  assert.equal(await readFile(path.join(app, "gradle.lockfile"), "utf8"), "com.example:library:1.1.0=runtimeClasspath\nempty=\n");
  assert.equal(gradleRuns(calls).at(-1).includes(path.join(app, INIT)), false, "the lockfile is written without the composite");
  assert.deepEqual(envs.at(-1), { GRADLE_USER_HOME: defaultHome }, "in the default home");
  assert.deepEqual(await gradleAdapter.bump(context(runner({ published: ["com.example:library:1.1.0"] }))), { bumped: [], lines: [] },
    "the same version needs nothing");
});
