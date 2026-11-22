import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

// Vibe64's gradle adapter against a fake Gradle that answers like the real one where the adapter
// looks: the proof task prints each runtime artifact with the build it comes from, the published
// task resolves a module or reports it missing, and --write-locks rewrites gradle.lockfile from the
// build script. Git is real. examples/connected-development/gradle/prove.sh runs it with real Gradle.
const exec = promisify(execFile);
const library = "https://github.com/example/library";
const tools = "https://github.com/example/tools";
const INIT = ".development/connected.init.gradle.kts";
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
function fakeGradle({ app, copy, calls, resolve = "connected", published = [], unreachable = false }) {
  return async ({ command, args, cwd }) => {
    calls.push([command, ...args]);
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
  const runCommand = fakeGradle({ app, copy, calls });
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
  return { app, copy, other, repositories, calls, step, status, context };
}

const gradleRuns = calls => calls.filter(call => call[0] === "gradle");

test("gradle: apply writes the init script including every connected checkout, keeps it out of Git, and the proof sees the included build", async t => {
  const { app, copy, other, calls, step, status } = await fixture(t);
  const applied = await step("apply");
  assert.equal(applied.ok, true, applied.error);
  assert.equal(applied.output, `[Connected] Library: Gradle builds it from ${copy} in place of the published module with its group:name, ` +
    `in every Gradle command that passes -I ${INIT}.`);
  assert.equal(await readFile(path.join(app, INIT), "utf8"), [
    "// Generated by Vibe64 for connected development. Do not commit.",
    `// Use: gradle -I ${INIT} <tasks>`,
    "settingsEvaluated {",
    "    // Library",
    `    includeBuild("${copy.replaceAll("$", "\\$").replaceAll("\"", "\\\"")}")`,
    "    // Tools",
    `    includeBuild("${other}")`,
    "}",
    ""
  ].join("\n"));
  assert.match(await readFile(path.join(app, PROOF_INIT), "utf8"), /tasks\.register\("connectedProof"\)/u);
  assert.match(await readFile(path.join(app, PUBLISHED_INIT), "utf8"), /tasks\.register\("connectedPublished"\)/u);
  assert.equal(gradleRuns(calls).length, 0, "writing the composite runs no Gradle");
  const exclude = await readFile(path.join(app, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^# BEGIN Vibe64 managed connected gradle packages files$/mu);
  for (const generated of [INIT, PROOF_INIT, PUBLISHED_INIT]) assert.match(exclude, new RegExp(`^/${generated.replaceAll(".", "\\.")}$`, "mu"));
  assert.equal(await git(app, "status", "--porcelain", "--untracked-files=all"), "", "nothing Vibe64 made can reach a commit");

  const proved = await step("proof");
  assert.equal(proved.ok, true, proved.error);
  assert.match(proved.output, /^\[Connected\] Library is in effect\.(?:\n|$)/u);
  assert.deepEqual(gradleRuns(calls).at(-1), [
    "gradle", "-q", "--console=plain", "--no-daemon", "--no-configuration-cache",
    "-I", path.join(app, INIT), "-I", path.join(app, PROOF_INIT), "connectedProof"
  ]);
  assert.equal((await status()).inEffect, true);
  assert.deepEqual((await status()).published, [{ package: "com.example:library", connected: "1.1.0", locked: "1.0.0" }]);
  const text = await readFile(path.join(app, INIT), "utf8");
  assert.equal((await step("apply")).ok, true);
  assert.equal(await readFile(path.join(app, INIT), "utf8"), text, "applying again changes nothing");
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

test("gradle: apply refuses a tracked or project-owned init script and a session that is not a Gradle build", async t => {
  const { app, step } = await fixture(t);
  await mkdir(path.join(app, ".development"), { recursive: true });
  await writeFile(path.join(app, INIT), "settingsEvaluated { }\n");
  const foreign = await step("apply");
  assert.equal(foreign.code, "vibe64_connected_gradle_init_foreign", foreign.error);
  assert.equal(await readFile(path.join(app, INIT), "utf8"), "settingsEvaluated { }\n");

  await writeFile(path.join(app, INIT), "// Generated by Vibe64 for connected development. Do not commit.\n");
  await git(app, "add", "--force", INIT);
  await git(app, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "init script");
  const tracked = await step("apply");
  assert.equal(tracked.code, "vibe64_connected_derived_tracked", tracked.error);

  await rm(path.join(app, "settings.gradle.kts"));
  await rm(path.join(app, "build.gradle.kts"));
  assert.equal((await step("apply")).code, "vibe64_connected_gradle_consumer");
});

test("gradle: restore takes the init scripts back once no gradle connection remains", async t => {
  const { app, repositories, step } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  assert.deepEqual(await restoreDisconnected({ repositories, sessionSourceRoot: app }), [], "a remaining connection keeps its scripts");
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: app }), [
    `[Connected] Gradle: removed ${INIT}, ${PROOF_INIT}, ${PUBLISHED_INIT}; Gradle resolves the published modules again.`
  ]);
  for (const generated of [INIT, PROOF_INIT, PUBLISHED_INIT]) assert.equal(await exists(path.join(app, generated)), false, generated);
  assert.doesNotMatch(await readFile(path.join(app, ".git", "info", "exclude"), "utf8"), /connected\.init/u);
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
  const { app, copy, calls, context } = await fixture(t);
  const runner = options => fakeGradle({ app, copy, calls, ...options });
  assert.deepEqual(await gradleAdapter.bump(context(runner())), {
    bumped: [],
    lines: ["[Connected] Library: com.example:library 1.1.0 is not published; Staging and Production keep 1.0.0."]
  });
  const check = gradleRuns(calls).at(-1);
  assert.deepEqual(check.slice(0, 7), ["gradle", "-q", "--console=plain", "--no-daemon", "--no-configuration-cache", "-I", path.join(app, PUBLISHED_INIT)]);
  assert.equal(check.includes(path.join(app, INIT)), false, "the published check never includes the connected checkout");
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
  assert.deepEqual(await gradleAdapter.bump(context(runner({ published: ["com.example:library:1.1.0"] }))), { bumped: [], lines: [] },
    "the same version needs nothing");
});
