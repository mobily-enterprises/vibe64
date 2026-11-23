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
import { mavenAdapter } from "../../packages/vibe64-project/src/server/connectedAdapters/maven.js";

// Vibe64's maven adapter against a fake Maven that behaves like the real one where the adapter looks:
// `install` builds target/*.jar from the checkout's source and copies it into -Dmaven.repo.local, and
// the classpath goal resolves the connected repository's jar when it has one, else the developer's.
// Git is real. examples/connected-development/maven/prove.sh runs it with real Maven.
const exec = promisify(execFile);
const repository = "https://github.com/example/library";
const LIBRARY_JAVA = path.join("src", "main", "java", "com", "example", "library", "Library.java");
const CONFIG = ".mvn/maven.config";
const CONNECTED_REPOSITORY = ".development/maven-connected-repository";
const INSTALLED = "com/example/library/1.0.0/library-1.0.0.jar";

async function exists(file) {
  return Boolean(await stat(file).catch(() => null));
}

async function git(cwd, ...args) {
  return (await exec("git", args, { cwd })).stdout;
}

/**
 * The fake toolchain. `resolve: "published"` makes the classpath goal resolve the developer's jar,
 * as Maven does when the connected repository lacks the version pom.xml asks for. `published` lists
 * the artifacts (g:a:v) the remote repositories hold; `unreachable` makes them unreachable.
 */
function fakeMaven({ home, calls, version = "3.9.16", resolve = "connected", published = [], unreachable = false }) {
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
    if (command === "java") return { ok: true, stdout: "", stderr: `Property settings:\n    user.home = ${home}\n    user.name = proof\n` };
    if (command === "mvn" && args[0] === "--version") return { ok: true, stdout: `Apache Maven ${version} (proof)\n`, stderr: "" };
    const option = name => args.find(arg => arg.startsWith(`-D${name}=`)).slice(name.length + 3);
    if (command === "mvn" && args.at(-1) === "install") {
      const source = path.dirname(args[args.indexOf("-f") + 1]);
      const built = /<version>([^<]+)<\/version>/u.exec(await readFile(path.join(source, "pom.xml"), "utf8"))[1];
      const jar = `jar built from ${await readFile(path.join(source, LIBRARY_JAVA), "utf8")}`;
      await mkdir(path.join(source, "target"), { recursive: true });
      await writeFile(path.join(source, "target", `library-${built}.jar`), jar);
      await writeFile(path.join(source, "target", `library-${built}-sources.jar`), `sources ${jar}`);
      const installed = path.join(option("maven.repo.local"), "com", "example", "library", built);
      await mkdir(installed, { recursive: true });
      await writeFile(path.join(installed, `library-${built}.jar`), jar);
      await writeFile(path.join(installed, `library-${built}.pom`), "<project/>");
      return { ok: true, stdout: "", stderr: "" };
    }
    if (command === "mvn" && args.some(arg => arg.endsWith(":get"))) {
      const artifact = option("artifact").replace(/:pom$/u, "");
      if (unreachable) {
        return { ok: false, stdout: `[ERROR] Could not transfer artifact ${artifact} from/to central: Unknown host repo.example\n`, stderr: "" };
      }
      if (published.includes(artifact)) return { ok: true, stdout: "", stderr: "" };
      return { ok: false, stdout: `[ERROR] The following artifacts could not be resolved: ${artifact}: Could not find artifact ${artifact} in central\n`, stderr: "" };
    }
    if (command === "mvn" && args.some(arg => arg.endsWith(":build-classpath"))) {
      const connected = path.join(cwd, CONNECTED_REPOSITORY, INSTALLED);
      const published = path.join(home, ".m2", "repository", INSTALLED);
      const library = resolve === "connected" && await exists(connected) ? connected : published;
      await writeFile(option("mdep.outputFile"), [path.join(home, ".m2", "repository", "other.jar"), library].join(path.delimiter));
      return { ok: true, stdout: "", stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}`, error: "unexpected" };
  };
}

const APP_POM = `<project>
  <groupId>com.example</groupId>
  <artifactId>app</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <!-- <dependency><groupId>com.example</groupId><artifactId>library</artifactId><version>0.1.0</version></dependency> -->
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>library</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>
`;

function libraryPom(version) {
  return `<project>\n  <groupId>com.example</groupId>\n  <artifactId>library</artifactId>\n  <version>${version}</version>\n</project>\n`;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-connected-maven-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const published = path.join(home, ".m2", "repository", INSTALLED);
  await mkdir(path.dirname(published), { recursive: true });
  await writeFile(published, "published library 1.0.0");
  await writeFile(path.join(home, ".m2", "repository", "other.jar"), "other");

  const app = path.join(root, "session", "source");
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, "pom.xml"), APP_POM);
  await writeFile(path.join(app, ".gitignore"), "/target/\n");
  await git(app, "init", "-q", "--initial-branch=main");
  await git(app, "add", "--all");
  await git(app, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "app");

  const copy = path.join(root, "session", "connected", "library");
  await mkdir(path.join(copy, path.dirname(LIBRARY_JAVA)), { recursive: true });
  await writeFile(path.join(copy, "pom.xml"), libraryPom("1.0.0"));
  await writeFile(path.join(copy, LIBRARY_JAVA), "class Library { String marker() { return \"connected\"; } }\n");
  await writeFile(path.join(copy, "README.md"), "Not a build input.\n");
  const repositories = [{ name: "Library", repository, relationship: "dependency", type: "maven", sourceRoot: copy }];
  const calls = [];
  const runCommand = fakeMaven({ home, calls });
  const step = (action, runner = runCommand) =>
    runConnectedAdapterStep({ action, repository, repositories, sessionSourceRoot: app, runCommand: runner });
  const status = async () => (await inspectConnectedAdapters({ repositories, sessionSourceRoot: app }))[0];
  const context = runner => ({
    connection: repositories[0],
    connections: repositories,
    sessionSourceRoot: app,
    runCommand: runner,
    writeGitExcludes: async () => {}
  });
  return { root, home, app, copy, repositories, calls, step, status, context };
}

const installs = calls => calls.filter(call => call[0] === "mvn" && call.at(-1) === "install");

test("maven: apply installs the checkout into the session's chained repository, selects it with an untracked maven.config, and proves it", async t => {
  const { home, app, copy, calls, step, status } = await fixture(t);
  const applied = await step("apply");
  assert.equal(applied.ok, true, applied.error);
  assert.match(applied.output, new RegExp(`installed ${INSTALLED} from ${copy}`, "u"));
  assert.deepEqual(installs(calls), [[
    "mvn", "-B", "-q", "-f", path.join(copy, "pom.xml"),
    `-Dmaven.repo.local=${path.join(app, CONNECTED_REPOSITORY)}`, `-Dmaven.repo.local.tail=${path.join(home, ".m2", "repository")}`,
    "-DskipTests", "install"
  ]]);
  assert.equal(await readFile(path.join(app, CONFIG), "utf8"), [
    "# Generated by Vibe64 for connected development. Do not commit.",
    `-Dmaven.repo.local=${path.join(app, CONNECTED_REPOSITORY)}`,
    `-Dmaven.repo.local.tail=${path.join(home, ".m2", "repository")}`,
    ""
  ].join("\n"));
  const record = JSON.parse(await readFile(path.join(app, ".development", "maven-connected.json"), "utf8"));
  assert.deepEqual(record.connections[0].jars.map(jar => [jar.installed, jar.built]), [[INSTALLED, path.join("target", "library-1.0.0.jar")]],
    "the sources jar is not what Maven resolves");
  assert.deepEqual(Object.keys(record.connections[0].sources), ["pom.xml", LIBRARY_JAVA], "the build inputs, not the README");
  const exclude = await readFile(path.join(app, ".git", "info", "exclude"), "utf8");
  for (const generated of [
    CONFIG, ".development/maven-connected.json", CONNECTED_REPOSITORY, ".development/maven-connected-classpath.txt", ".development/maven-published-repository"
  ]) {
    assert.match(exclude, new RegExp(`^/${generated.replaceAll(".", "\\.")}$`, "mu"));
  }
  assert.match(exclude, /^# BEGIN Vibe64 managed connected maven packages files$/mu);
  assert.equal(await git(app, "status", "--porcelain", "--untracked-files=all"), "", "nothing Vibe64 made can reach a commit");

  const proved = await step("proof");
  assert.equal(proved.ok, true, proved.error);
  assert.match(proved.output, /^\[Connected\] Library is in effect\.(?:\n|$)/u);
  assert.equal(await exists(path.join(app, ".development", "maven-connected-classpath.txt")), false, "the proof leaves no file behind");
  assert.equal((await status()).inEffect, true);
  assert.deepEqual((await status()).published, [{ package: "com.example:library", connected: "1.0.0", locked: "1.0.0" }]);

  const again = await step("apply");
  assert.equal(again.ok, true, again.error);
  assert.match(again.output, /Maven already resolves it/u);
  assert.equal(installs(calls).length, 1, "an unchanged checkout is not installed again");
});

test("maven: the proof says why the connection is not in effect, and preparing again puts it back", async t => {
  const { home, app, copy, calls, step, status } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  const reason = async () => (await status()).reason;

  // Maven resolves another jar (pom.xml asks for a version the checkout does not build): only the toolchain sees it.
  const elsewhere = await step("proof", fakeMaven({ home, calls, resolve: "published" }));
  assert.deepEqual(elsewhere, {
    ok: false,
    error: `Connected Library is not in effect: the session source's runtime classpath has no jar Maven installed from ${copy}; ` +
      "does pom.xml ask for the version the checkout builds?"
  });

  await writeFile(path.join(copy, LIBRARY_JAVA), "class Library { String marker() { return \"edited\"; } }\n");
  const stale = `${LIBRARY_JAVA} changed in the connected copy since Maven installed it; prepare the workspace again to install it.`;
  assert.equal(await reason(), stale);
  assert.deepEqual(await step("proof"), { ok: false, error: `Connected Library is not in effect: ${stale}` });
  assert.equal((await step("apply")).ok, true);
  assert.equal(installs(calls).length, 2, "a changed checkout is installed again");
  assert.match(await readFile(path.join(app, CONNECTED_REPOSITORY, INSTALLED), "utf8"), /edited/u);
  assert.equal((await step("proof")).ok, true);

  const added = path.join("src", "main", "java", "com", "example", "library", "Added.java");
  await writeFile(path.join(copy, added), "class Added {}\n");
  assert.equal(await reason(), `${added} changed in the connected copy since Maven installed it; prepare the workspace again to install it.`);
  assert.equal((await step("apply")).ok, true);

  await writeFile(path.join(app, CONNECTED_REPOSITORY, INSTALLED), "replaced");
  assert.equal(await reason(), `${CONNECTED_REPOSITORY}/${INSTALLED} no longer holds the jar built from the connected copy; prepare again.`);
  assert.equal((await step("apply")).ok, true);

  const config = await readFile(path.join(app, CONFIG), "utf8");
  await writeFile(path.join(app, CONFIG), config.replace(/-Dmaven\.repo\.local=.*\n/u, ""));
  assert.equal(await reason(), `${CONFIG} does not select the connected repository ${CONNECTED_REPOSITORY}; prepare the workspace again.`);
  await rm(path.join(app, CONFIG));
  assert.equal(await reason(), `${CONFIG} is missing; prepare the workspace to install the connected checkout.`);
  assert.equal((await step("apply")).ok, true);
  assert.equal((await step("proof")).ok, true);
  assert.equal((await status()).inEffect, true);
});

test("maven: apply refuses a tracked or project-owned maven.config and a Maven without chained repositories", async t => {
  const { home, app, calls, step } = await fixture(t);
  const old = await step("apply", fakeMaven({ home, calls, version: "3.8.8" }));
  assert.equal(old.code, "vibe64_connected_maven_version");

  await mkdir(path.join(app, ".mvn"), { recursive: true });
  await writeFile(path.join(app, CONFIG), "-T4\n");
  const foreign = await step("apply");
  assert.equal(foreign.code, "vibe64_connected_maven_config_foreign", foreign.error);
  assert.equal(await readFile(path.join(app, CONFIG), "utf8"), "-T4\n");

  await git(app, "add", CONFIG);
  await git(app, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "own maven.config");
  const tracked = await step("apply");
  assert.equal(tracked.code, "vibe64_connected_derived_tracked", tracked.error);
  assert.equal(installs(calls).length, 0, "nothing is installed for a refused connection");
  assert.equal(await git(app, "status", "--porcelain"), "");
});

test("maven: a session source with no pom.xml leaves preparation going and says to remove or install it", async t => {
  const { app, calls, step, status } = await fixture(t);
  await rm(path.join(app, "pom.xml"));
  const said = "[Connected] Library is connected, but nothing here installs it: remove it or install it. " +
    "The session source has no pom.xml, so no Maven build uses it.";
  assert.deepEqual(await step("apply"), { ok: true, output: said });
  assert.deepEqual(await step("proof"), { ok: true, output: said });
  assert.deepEqual(calls, [], "Maven runs for nothing");
  const proof = await status();
  assert.deepEqual([proof.inEffect, proof.unused, proof.reason], [false, true, said.slice("[Connected] ".length)]);
});

test("maven: restore takes the derived files and the connected repository back once no maven connection remains", async t => {
  const { app, repositories, step } = await fixture(t);
  assert.equal((await step("apply")).ok, true);
  assert.deepEqual(await restoreDisconnected({ repositories, sessionSourceRoot: app }), [], "a remaining connection keeps its install");
  assert.equal(await exists(path.join(app, CONFIG)), true);

  const lines = await restoreDisconnected({ repositories: [], sessionSourceRoot: app });
  assert.deepEqual(lines, [
    `[Connected] Maven: removed ${CONFIG}, .development/maven-connected.json, ${CONNECTED_REPOSITORY}; Maven resolves the published artifacts again.`
  ]);
  for (const generated of [CONFIG, ".development/maven-connected.json", CONNECTED_REPOSITORY]) {
    assert.equal(await exists(path.join(app, generated)), false, generated);
  }
  assert.doesNotMatch(await readFile(path.join(app, ".git", "info", "exclude"), "utf8"), /maven-connected/u);
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: app }), [], "nothing left to take back");

  await mkdir(path.join(app, ".mvn"), { recursive: true });
  await writeFile(path.join(app, CONFIG), "-T4\n");
  assert.deepEqual(await restoreDisconnected({ repositories: [], sessionSourceRoot: app }), [], "a project's own maven.config stays");
  assert.equal(await readFile(path.join(app, CONFIG), "utf8"), "-T4\n");
});

test("maven: locked reads the version the checkout declares and the one the tracked pom.xml names", async t => {
  const { app, copy, context } = await fixture(t);
  await writeFile(path.join(copy, "pom.xml"), libraryPom("1.1.0"));
  assert.deepEqual(await mavenAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: "1.0.0" }]);

  await writeFile(path.join(app, "pom.xml"), APP_POM.replace("<version>1.0.0</version>\n    </dependency>", "<version>${library.version}</version>\n    </dependency>")
    .replace("<dependencies>", "<properties><library.version>1.0.0</library.version></properties>\n  <dependencies>"));
  assert.deepEqual(await mavenAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: "1.0.0" }],
    "a property of the same pom");
  await writeFile(path.join(app, "pom.xml"), APP_POM.replace("<version>1.0.0</version>\n    </dependency>", "</dependency>"));
  assert.deepEqual(await mavenAdapter.locked(context(null)), [{ package: "com.example:library", connected: "1.1.0", locked: null }],
    "a version from a parent or a BOM cannot be read here");
  await writeFile(path.join(app, "pom.xml"), "<project><artifactId>app</artifactId></project>\n");
  assert.deepEqual(await mavenAdapter.locked(context(null)), [], "a pom that does not depend on the checkout");
});

test("maven: bump moves the tracked pom.xml to a published version only, by its one exact edit", async t => {
  const { home, app, copy, calls, context } = await fixture(t);
  await writeFile(path.join(copy, "pom.xml"), libraryPom("1.1.0"));
  const before = await readFile(path.join(app, "pom.xml"), "utf8");

  const unpublished = await mavenAdapter.bump(context(fakeMaven({ home, calls })));
  assert.deepEqual(unpublished, {
    bumped: [],
    lines: ["[Connected] Library: com.example:library 1.1.0 is not published; Staging and Production keep 1.0.0."]
  });
  const get = calls.findLast(call => call.some(arg => arg.endsWith(":get")));
  const published = path.join(app, ".development", "maven-published-repository");
  assert.deepEqual(get.slice(1, 6), ["-B", "-q", "-U", `-Dmaven.repo.local=${published}`, `-Dmaven.repo.local.tail=${published}`],
    "neither the connected repository nor the developer's can answer");
  assert.ok(get.includes("-Dartifact=com.example:library:1.1.0:pom"));

  const unreachable = await mavenAdapter.bump(context(fakeMaven({ home, calls, unreachable: true, published: ["com.example:library:1.1.0"] })));
  assert.deepEqual(unreachable.lines, [
    "[Connected] Library: could not check whether com.example:library 1.1.0 is published: " +
      "Could not transfer artifact com.example:library:1.1.0 from/to central: Unknown host repo.example."
  ]);
  await writeFile(path.join(copy, "pom.xml"), libraryPom("1.2.0-SNAPSHOT"));
  const callsBefore = calls.length;
  const snapshot = await mavenAdapter.bump(context(fakeMaven({ home, calls, published: ["com.example:library:1.2.0-SNAPSHOT"] })));
  assert.deepEqual(snapshot.lines, [
    "[Connected] Library: com.example:library 1.2.0-SNAPSHOT is a snapshot, which is never published; Staging and Production keep 1.0.0."
  ]);
  assert.equal(calls.length, callsBefore, "a snapshot is not even looked up");
  assert.equal(await readFile(path.join(app, "pom.xml"), "utf8"), before, "nothing moved");

  await writeFile(path.join(copy, "pom.xml"), libraryPom("1.1.0"));
  const moved = await mavenAdapter.bump(context(fakeMaven({ home, calls, published: ["com.example:library:1.1.0"] })));
  assert.deepEqual(moved, {
    bumped: [{ package: "com.example:library", from: "1.0.0", to: "1.1.0" }],
    lines: ["[Connected] Library: Staging and Production now use the published com.example:library 1.1.0."]
  });
  assert.equal(await readFile(path.join(app, "pom.xml"), "utf8"), before.replace(
    "<artifactId>library</artifactId>\n      <version>1.0.0</version>", "<artifactId>library</artifactId>\n      <version>1.1.0</version>"
  ), "only the dependency's version, not the commented one or the project's own");
  assert.deepEqual(await mavenAdapter.bump(context(fakeMaven({ home, calls, published: ["com.example:library:1.1.0"] }))), { bumped: [], lines: [] },
    "the same version needs nothing");

  await writeFile(path.join(app, "pom.xml"), before.replace("<version>1.0.0</version>\n    </dependency>", "<version>${library.version}</version>\n    </dependency>")
    .replace("<dependencies>", "<properties>\n    <library.version>1.0.0</library.version>\n  </properties>\n  <dependencies>"));
  const property = await mavenAdapter.bump(context(fakeMaven({ home, calls, published: ["com.example:library:1.1.0"] })));
  assert.equal(property.bumped.length, 1);
  assert.match(await readFile(path.join(app, "pom.xml"), "utf8"), /<library\.version>1\.1\.0<\/library\.version>[\s\S]*<version>\$\{library\.version\}<\/version>/u);
});

test("maven: the shared watcher watches each connected checkout and applies it again; gradle needs none", async () => {
  const { gradleAdapter } = await import("../../packages/vibe64-project/src/server/connectedAdapters/gradle.js");
  const connections = [{ name: "Library", repository, sourceRoot: "/session/connected/library" }];
  assert.deepEqual(await mavenAdapter.watch.sources({ connections }), new Map([["/session/connected/library", repository]]));
  assert.equal(await mavenAdapter.watch.sync({ connections }), null, "a null sync puts the connection in effect again");
  assert.equal(gradleAdapter.watch, undefined);
});
