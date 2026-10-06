import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingContentInstaller } from "../../packages/vibe64-training/src/server/contentInstaller.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "source");
  const systemRoot = path.join(root, "system");
  const executed = path.join(root, "authored-code-executed");
  await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(systemRoot, { mode: 0o700 });
  async function write(filename, value, base = sourceRoot) {
    const destination = path.join(base, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const metadata = { name: "learn-install-fixture", version: "0.1.0", type: "module", repository: { type: "git", url: "https://github.com/examples/learn-install-fixture.git" },
    vibe64Training: { schemaVersion: 1, topicId: "install-fixture", domainId: "vibe64", title: "One introduction", status: "preview", outline: "training/outline.md", prerequisites: [],
      lessons: [{ code: "INTRO-01", descriptor: "training/lessons/INTRO-01/lesson.json", status: "published", required: true }] } };
  const document = '# Try an application\n<a id="explain"></a>\nExplain what happened.\n<a id="try-app"></a>\nPress the real button.\n';
  await write("package.json", metadata);
  await write("training/outline.md", "# One introduction\nTry a real application.\n");
  await write("training/lessons/INTRO-01/lesson.json", { schemaVersion: 1, code: "INTRO-01", title: "Try an application", document: "lesson.md", prerequisites: [], estimatedMinutes: 10,
    visuals: [{ id: "flow", descriptor: "../../visuals/flow/visual.json" }], exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" },
    checks: [{ id: "response", file: "../../checks/response.mjs" }], assessments: [
      { id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" },
      { id: "try-app", kind: "practical", required: true, rubric: "lesson.md#try-app", evidence: { producer: "exercise", operation: "try-app", check: "response" } }] });
  await write("training/lessons/INTRO-01/lesson.md", document);
  await write("training/visuals/flow/visual.json", { schemaVersion: 1, id: "flow", title: "Flow", svg: "diagram.svg", controller: "controller.js", initialState: "overview", states: ["overview", "arrived"],
    description: "A labelled flow.", commands: [{ name: "send", parameters: [], completionState: "arrived", description: "Move the packet." }] });
  await write("training/visuals/flow/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title><circle id="packet" cx="10" cy="10" r="5"/></svg>');
  await write("training/visuals/flow/controller.js", 'globalThis.trainingInstallFixtureControllerExecuted = true;\nexport function send(svg) { return svg.querySelector("#packet").animate([{ transform: "translateX(0px)" }, { transform: "translateX(40px)" }], { duration: 300 }).finished; }\n');
  await write("training/exercises/app/package.json", { name: "install-app", private: true, type: "module" });
  const executionMarker = `import { writeFile } from "node:fs/promises";\nawait writeFile(${JSON.stringify(executed)}, "Authored code ran.");\n`;
  await write("training/exercises/app/server.mjs", `${executionMarker}import { createServer } from "node:http";\nconst args = process.argv.slice(2);\nconst host = args[args.indexOf("--host") + 1] || "127.0.0.1";\nconst port = Number(args[args.indexOf("--port") + 1] || 8080);\ncreateServer((request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<button>Try me</button>"); }).listen(port, host);\n`);
  await write("training/exercises/app/genesis/version", "3\n");
  await write("training/exercises/app/genesis/stack.md", '# Stack\n\n## Workspace setup\n\n- Prepare `Check syntax` with `nodejs`: `node` `--check` `server.mjs`\n\n## Outputs\n\n### Target `app`: Practice app\n\n- Default.\n- Mode: `interactive`\n- Workdir: `.`\n- Runtimes: `nodejs`\n- Run `Start`: `node` `server.mjs` `--host` `{host}` `--port` `{port}`\n\n#### Presentation\n\n- Kind: `web`\n- Preferred port: `8080`\n- URL path: `/`\n- Ready when: `GET` `/` returns `200`\n');
  await write("training/checks/response.mjs", `${executionMarker}console.log(JSON.stringify({ outcome: "verified" }));\n`);
  function git(...args) {
    return execFileSync("/usr/bin/git", ["-C", sourceRoot, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  git("init", "-b", "main");
  async function commit() {
    git("add", ".");
    git("commit", "-m", "Pinned installation fixture");
    const { topicId, release, repository, commit: revision, topicHash } = await readPinnedTopic(sourceRoot);
    return { schemaVersion: 1, topicId, release, repository, commit: revision, topicHash };
  }
  const pin = await commit();
  const installer = createTrainingContentInstaller({ systemRoot });
  const reader = createInstalledTrainingContent({ systemRoot });
  const snapshot = value => path.join(systemRoot, "training", "content", value.topicId, value.commit);
  const lockPath = path.join(systemRoot, "training", ".install-locks", `${pin.topicId}-${pin.commit}.lock`);
  return { root, sourceRoot, systemRoot, executed, metadata, document, write, git, commit, pin, installer, reader, snapshot, lockPath };
}

async function treeState(directory) {
  const result = [];
  async function visit(filename) {
    const stat = await lstat(filename);
    const relative = path.relative(directory, filename);
    if (stat.isSymbolicLink()) result.push({ path: relative, link: await readlink(filename) });
    else if (stat.isDirectory()) {
      result.push({ path: relative, directory: true, mode: stat.mode, mtime: stat.mtimeMs });
      for (const entry of (await readdir(filename)).sort()) await visit(path.join(filename, entry));
    } else result.push({ path: relative, mode: stat.mode, mtime: stat.mtimeMs, hash: createHash("sha256").update(await readFile(filename)).digest("hex") });
  }
  await visit(directory);
  return result;
}

test("installs exact Git-pinned CLI bytes and remains readable without executing authored code", async t => {
  const f = await fixture(t);
  // Git may refresh its own index during pin proof; authored source is unchanged.
  const sourceBefore = (await treeState(f.sourceRoot)).filter(entry => entry.path !== ".git" && !entry.path.startsWith(`.git${path.sep}`));
  const result = await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  assert.equal(result.installed, true);
  assert.deepEqual(result.pin, f.pin);
  assert.deepEqual((await treeState(f.sourceRoot)).filter(entry => entry.path !== ".git" && !entry.path.startsWith(`.git${path.sep}`)), sourceBefore);
  const topic = await f.reader.readTopic(f.pin);
  assert.deepEqual(result.topicManifest, topic.topicManifest);
  const lesson = await f.reader.readLesson({ ...f.pin, lessonCode: "INTRO-01", lessonHash: topic.bundles[0].hash });
  assert.equal(lesson.document.text, f.document);
  const snapshot = f.snapshot(f.pin);
  assert.deepEqual((await readdir(snapshot)).sort(), ["bundle.json", "files", "pin.json"]);
  assert.equal((await lstat(path.join(f.systemRoot, "training"))).mode & 0o777, 0o700);
  assert.equal((await lstat(path.join(snapshot, "pin.json"))).mode & 0o777, 0o600);
  assert.equal((await readdir(path.join(f.systemRoot, "training"))).some(name => /^\.install-[a-f0-9-]{36}$/u.test(name)), false);
  await assert.rejects(() => lstat(f.executed), { code: "ENOENT" });
  assert.equal(globalThis.trainingInstallFixtureControllerExecuted, undefined);
});

test("two immutable revisions coexist and matching retries need no live source repository", async t => {
  const f = await fixture(t);
  await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  const oldSnapshot = await treeState(f.snapshot(f.pin));
  await f.write("package.json", { ...f.metadata, version: "0.1.1" });
  await f.write("training/lessons/INTRO-01/lesson.md", f.document.replace("Explain what happened", "Explain the new result"));
  const secondPin = await f.commit();
  const second = await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: secondPin });
  assert.equal(second.installed, true);
  assert.notEqual(secondPin.commit, f.pin.commit);
  assert.deepEqual(await treeState(f.snapshot(f.pin)), oldSnapshot);
  await rename(f.sourceRoot, `${f.sourceRoot}.unavailable`);
  const beforeRetry = await treeState(f.systemRoot);
  const retry = await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  assert.equal(retry.installed, false);
  assert.deepEqual(retry.pin, f.pin);
  assert.deepEqual(await treeState(f.systemRoot), beforeRetry);
  assert.equal((await f.reader.readTopic(secondPin)).release, "0.1.1");
});

test("unsupported pins, dirty sources and every wrong trusted source field fail before installation writes", async t => {
  const f = await fixture(t);
  const before = await treeState(f.systemRoot);
  for (const change of [{ schemaVersion: 2 }, { topicId: "../elsewhere" }, { release: "latest" }, { repository: "unapproved/repository" }, { commit: "A".repeat(40) }, { topicHash: "invalid" }, { enabled: true },
    { topicId: "other-topic" }, { release: "0.2.0" }, { repository: "examples/learn-other" }, { commit: "f".repeat(40) }, { topicHash: "f".repeat(64) }]) {
    await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: { ...f.pin, ...change } }));
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.write("training/lessons/INTRO-01/lesson.md", `${f.document}\nUncommitted edit.\n`);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), /Commit the topic content/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("conflicting, corrupt and empty existing destinations remain unchanged", async t => {
  const f = await fixture(t);
  await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  let before = await treeState(f.systemRoot);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: { ...f.pin, repository: "examples/learn-other" } }), /conflicts with the approved owner pin/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  const pinPath = path.join(f.snapshot(f.pin), "pin.json");
  await writeFile(pinPath, "{corrupt");
  before = await treeState(f.systemRoot);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), error => error.code === "VIBE64_TRAINING_CONTENT_INVALID");
  assert.deepEqual(await treeState(f.systemRoot), before);
  await rm(f.snapshot(f.pin), { recursive: true });
  await mkdir(f.snapshot(f.pin));
  before = await treeState(f.systemRoot);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("unsafe paths, containment and aliases are rejected before mutation", async t => {
  const f = await fixture(t);
  for (const systemRoot of ["", ".", "/", `${f.systemRoot}/`, `${f.systemRoot}/../system`]) {
    assert.throws(() => createTrainingContentInstaller({ systemRoot }), /normalized absolute, non-root/u);
  }
  const before = await treeState(f.systemRoot);
  const missingRoot = path.join(f.root, "missing-system");
  await assert.rejects(() => createTrainingContentInstaller({ systemRoot: missingRoot }).installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), { code: "ENOENT" });
  await assert.rejects(() => lstat(missingRoot), { code: "ENOENT" });
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: path.join(f.root, "missing-source"), pin: f.pin }), /Trusted topic source is missing/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
  for (const sourceRoot of [".", "/", f.systemRoot, path.join(f.systemRoot, "training"), path.join(f.systemRoot, "training/content/source"), `${f.sourceRoot}/../source`]) {
    await assert.rejects(() => f.installer.installTopic({ sourceRoot, pin: f.pin }));
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
  await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  const targets = [f.root, f.systemRoot, f.sourceRoot, path.join(f.systemRoot, "training"), path.join(f.systemRoot, "training/content"), path.dirname(f.snapshot(f.pin)), f.snapshot(f.pin), path.dirname(f.lockPath), f.lockPath];
  for (const target of targets) {
    const actual = `${target}.actual`;
    const directory = (await lstat(target)).isDirectory();
    await rename(target, actual);
    try {
      await symlink(path.basename(actual), target, directory ? "dir" : "file");
      const aliasedBefore = await treeState(f.systemRoot);
      await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), /symlink or directory aliases/u);
      assert.deepEqual(await treeState(f.systemRoot), aliasedBefore);
    } finally {
      await rm(target);
      await rename(actual, target);
    }
  }
});

test("the real OS lock reports contention, releases and retains its persistent inode", async t => {
  const f = await fixture(t);
  await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin });
  const inode = (await lstat(f.lockPath)).ino;
  const release = await tryAcquireExclusiveFileLock(f.lockPath);
  assert.equal(typeof release, "function");
  t.after(() => release());
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), error => error.code === "VIBE64_TRAINING_INSTALL_BUSY" && error.statusCode === 409);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await release();
  assert.equal((await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin })).installed, false);
  assert.equal((await lstat(f.lockPath)).ino, inode);
  await writeFile(f.lockPath, "Unexplained state; preserve it.");
  const unexplained = await treeState(f.systemRoot);
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), /unaliased empty regular file/u);
  assert.deepEqual(await treeState(f.systemRoot), unexplained);
});

test("crash-left staging is preserved while a fresh owner operation retries safely", async t => {
  const f = await fixture(t);
  const orphan = path.join(f.systemRoot, "training", ".install-00000000-0000-0000-0000-000000000000");
  await mkdir(orphan, { recursive: true, mode: 0o700 });
  await writeFile(path.join(orphan, "incomplete-snapshot"), "Owner must inspect this interrupted operation.\n");
  const before = await treeState(orphan);
  assert.equal((await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin })).installed, true);
  assert.deepEqual(await treeState(orphan), before);
  assert.deepEqual(await f.reader.readTopic(f.pin).then(topic => topic.pin), f.pin);
});

test("a commit changed after bundling cannot publish, owned staging is cleaned and the lock is reusable", async t => {
  const f = await fixture(t);
  const toolsRoot = path.join(f.root, "tools");
  await mkdir(toolsRoot);
  const shim = path.join(toolsRoot, "git");
  // A controlled Git process changes only this disposable fixture when a full
  // staged bundle exists. No installer callbacks or production failure hooks.
  await writeFile(shim, `#!${process.execPath}\nimport { existsSync, readdirSync, writeFileSync } from "node:fs";\nimport { execFileSync } from "node:child_process";\nimport path from "node:path";\nconst trainingRoot = ${JSON.stringify(path.join(f.systemRoot, "training"))};\nconst marker = ${JSON.stringify(path.join(toolsRoot, "source-changed"))};\nif (!existsSync(marker) && existsSync(trainingRoot) && readdirSync(trainingRoot).some(name => existsSync(path.join(trainingRoot, name, "training/content", ${JSON.stringify(f.pin.topicId)}, ${JSON.stringify(f.pin.commit)}, "bundle.json")))) {\n  execFileSync("/usr/bin/git", ["-C", ${JSON.stringify(f.sourceRoot)}, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "--allow-empty", "-m", "Concurrent source revision"], { stdio: "ignore" });\n  writeFileSync(marker, "changed");\n}\ntry { execFileSync("/usr/bin/git", process.argv.slice(2), { stdio: "inherit" }); } catch (error) { process.exit(error.status || 1); }\n`, { mode: 0o700 });
  // The tools directory is outside the source. Make the shim an ESM program.
  await writeFile(path.join(toolsRoot, "package.json"), '{"type":"module"}\n');
  const originalPath = process.env.PATH;
  t.after(() => { process.env.PATH = originalPath; });
  process.env.PATH = `${toolsRoot}${path.delimiter}${originalPath}`;
  await assert.rejects(() => f.installer.installTopic({ sourceRoot: f.sourceRoot, pin: f.pin }), /conflicts with the approved owner pin/u);
  process.env.PATH = originalPath;
  await assert.rejects(() => lstat(f.snapshot(f.pin)), { code: "ENOENT" });
  assert.deepEqual((await readdir(path.join(f.systemRoot, "training"))).sort(), [".install-locks", "content"]);
  const current = await readPinnedTopic(f.sourceRoot);
  assert.notEqual(current.commit, f.pin.commit);
  assert.equal(current.topicHash, f.pin.topicHash);
  const pin = { ...f.pin, commit: current.commit };
  assert.equal((await f.installer.installTopic({ sourceRoot: f.sourceRoot, pin })).installed, true);
  const release = await tryAcquireExclusiveFileLock(f.lockPath);
  assert.equal(typeof release, "function");
  await release();
  await assert.rejects(() => lstat(f.executed), { code: "ENOENT" });
});
