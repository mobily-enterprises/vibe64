import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "@local/vibe64-training/server/installed-content";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-installed-training-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const systemRoot = path.join(root, "system");
  await mkdir(source);
  await mkdir(systemRoot);
  async function write(filename, value, base = source) {
    const destination = path.join(base, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const topic = { schemaVersion: 1, topicId: "installed-topic", domainId: "vibe64", title: "Installed topic", status: "preview", outline: "training/outline.md", prerequisites: [],
    lessons: [{ code: "LESSON-01", descriptor: "training/lessons/LESSON-01/lesson.json", status: "published", required: true },
      { code: "LESSON-02", descriptor: "training/lessons/LESSON-02/lesson.json", status: "draft", required: true }] };
  const metadata = { name: "learn-installed-topic", version: "0.1.0", repository: { type: "git", url: "https://github.com/examples/learn-installed-topic.git" }, vibe64Training: topic };
  const lesson = { schemaVersion: 1, code: "LESSON-01", title: "Use an application", document: "lesson.md", prerequisites: [], estimatedMinutes: 10,
    visuals: [{ id: "flow", descriptor: "../../visuals/flow/visual.json" }],
    exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" },
    checks: [{ id: "health", file: "../../checks/health.mjs" }],
    assessments: [{ id: "answer", kind: "answer", required: true, rubric: "lesson.md#answer" },
      { id: "use-app", kind: "practical", required: true, rubric: "lesson.md#use-app", evidence: { producer: "exercise", operation: "try-app", check: "health" } }] };
  const visual = { schemaVersion: 1, id: "flow", title: "Flow", svg: "diagram.svg", controller: "controller.js", initialState: "overview", states: ["overview", "arrived"],
    description: "A labelled flow.", commands: [{ name: "send", parameters: [], completionState: "arrived", description: "The request arrives." }] };
  const teachingText = '# Use an application\n<a id="answer"></a>\nExplain your first observation.\n<a id="use-app"></a>\nTry the real application.\n';
  await write("package.json", metadata);
  await write("training/outline.md", "# Installed topic\nA published introduction and one draft fixture.\n");
  await write("training/lessons/LESSON-01/lesson.json", lesson);
  await write("training/lessons/LESSON-01/lesson.md", teachingText);
  await write("training/lessons/LESSON-02/lesson.json", { ...lesson, code: "LESSON-02", title: "Draft", visuals: [], exercise: undefined, checks: undefined, assessments: [lesson.assessments[0]] });
  await write("training/lessons/LESSON-02/lesson.md", '# Draft\n<a id="answer"></a>\nIncomplete author work.\n');
  await write("training/visuals/flow/visual.json", visual);
  await write("training/visuals/flow/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title><circle id="packet" cx="10" cy="10" r="5"/></svg>');
  await write("training/visuals/flow/controller.js", 'export function send(svg) { return svg.querySelector("#packet").animate([{ transform: "translateX(0px)" }, { transform: "translateX(40px)" }], { duration: 300 }).finished; }\n');
  await write("training/exercises/app/package.json", { name: "installed-app", private: true, type: "module", scripts: { start: "node server.mjs" } });
  await write("training/exercises/app/server.mjs", 'import { createServer } from "node:http";\nconst args = process.argv.slice(2);\nconst host = args[args.indexOf("--host") + 1] || "127.0.0.1";\nconst port = Number(args[args.indexOf("--port") + 1] || 8080);\ncreateServer((request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end("<h1>Real training application</h1>"); }).listen(port, host);\n');
  await write("training/exercises/app/genesis/version", "3\n");
  await write("training/exercises/app/genesis/stack.md", '# Stack\n\n## Workspace setup\n\n- Prepare `Check syntax` with `nodejs`: `node` `--check` `server.mjs`\n\n## Outputs\n\n### Target `app`: Test application\n\n- Default.\n- Mode: `interactive`\n- Workdir: `.`\n- Runtimes: `nodejs`\n- Run `Start`: `node` `server.mjs` `--host` `{host}` `--port` `{port}`\n\n#### Presentation\n\n- Kind: `web`\n- Preferred port: `8080`\n- URL path: `/`\n- Ready when: `GET` `/` returns `200`\n');
  await write("training/checks/health.mjs", 'console.log(JSON.stringify({ outcome: "verified" }));\n');
  function git(...args) {
    return execFileSync("git", ["-C", source, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  git("init", "-b", "main");
  async function install() {
    git("add", ".");
    git("commit", "-m", "Pinned fixture content");
    const sourcePin = await readPinnedTopic(source);
    const parent = path.join(systemRoot, "training", "content", sourcePin.topicId);
    await mkdir(parent, { recursive: true });
    const snapshotRoot = path.join(parent, sourcePin.commit);
    await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
    const pin = { schemaVersion: 1, topicId: sourcePin.topicId, release: sourcePin.release, repository: sourcePin.repository, commit: sourcePin.commit, topicHash: sourcePin.topicHash };
    await write("pin.json", pin, snapshotRoot);
    const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
    return { pin, bundle, snapshotRoot };
  }
  const installed = await install();
  const reader = createInstalledTrainingContent({ systemRoot });
  return { root, source, systemRoot, metadata, lesson, visual, teachingText, installed, install, write, reader };
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
    } else result.push({ path: relative, bytes: stat.size, mode: stat.mode, mtime: stat.mtimeMs, hash: createHash("sha256").update(await readFile(filename)).digest("hex") });
  }
  await visit(directory);
  return result;
}

test("two cached commits retain exact published lesson material without catalogue enablement or writes", async t => {
  const f = await fixture(t);
  const first = f.installed;
  await f.write("package.json", { ...f.metadata, version: "0.2.0" });
  await f.write("training/lessons/LESSON-01/lesson.md", f.teachingText.replace("first observation", "revised observation"));
  const second = await f.install();
  assert.notEqual(first.pin.commit, second.pin.commit);
  await f.write("training/catalogue.json", "Disabled or unavailable catalogue is not a pinned-read dependency.\n", f.systemRoot);
  const before = await treeState(f.systemRoot);
  const original = await f.reader.readTopic(first.pin);
  const revised = await f.reader.readTopic(second.pin);
  assert.deepEqual(original.pin, first.pin);
  assert.deepEqual(original.topicManifest, first.bundle.topicManifest);
  assert.equal(revised.release, "0.2.0");
  assert.notEqual(original.bundles[0].hash, revised.bundles[0].hash);
  const lesson = await f.reader.readLesson({ ...first.pin, lessonCode: "LESSON-01", lessonHash: first.bundle.lessons[0].hash });
  assert.equal(lesson.document.text, f.teachingText);
  assert.equal(lesson.descriptorPath, "training/lessons/LESSON-01/lesson.json");
  assert.equal(lesson.hash, first.bundle.lessons[0].hash);
  assert.match(lesson.rubrics[0].text, /Explain your first observation/u);
  assert.doesNotMatch(lesson.rubrics[0].text, /Try the real application/u);
  assert.deepEqual(lesson.visuals[0].visual, f.visual);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("the trusted topic hash fences a self-consistent replacement under an old commit", async t => {
  const f = await fixture(t);
  const first = f.installed;
  await assert.rejects(() => f.reader.readTopic({ topicId: first.pin.topicId, commit: first.pin.commit }), /trusted 64-character topic hash/u);
  // The lesson is unchanged; a lesson hash alone cannot pin the topic's metadata.
  await f.write("package.json", { ...f.metadata, version: "0.2.0" });
  const second = await f.install();
  assert.equal(second.bundle.lessons[0].hash, first.bundle.lessons[0].hash);
  assert.notEqual(second.pin.topicHash, first.pin.topicHash);
  await rm(first.snapshotRoot, { recursive: true });
  await cp(second.snapshotRoot, first.snapshotRoot, { recursive: true });
  await f.write("pin.json", { ...second.pin, commit: first.pin.commit }, first.snapshotRoot);
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readTopic(first.pin), /trusted course or attempt pin/u);
  await assert.rejects(() => f.reader.readLesson({ ...first.pin, lessonCode: "LESSON-01", lessonHash: first.bundle.lessons[0].hash }), /trusted course or attempt pin/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("pin schema, exact source identity and requested path identity must agree", async t => {
  const f = await fixture(t);
  const { pin, snapshotRoot } = f.installed;
  const changes = [
    { schemaVersion: 2 }, { topicId: "other-topic" }, { release: "0.2.0" }, { repository: "examples/learn-other" },
    { commit: "f".repeat(40) }, { topicHash: "f".repeat(64) }, { enabled: true }
  ];
  for (const change of changes) {
    await f.write("pin.json", { ...pin, ...change }, snapshotRoot);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readTopic(pin), error => error.code === "VIBE64_TRAINING_CONTENT_INVALID");
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
});

test("bundle metadata must preserve full ordered inventories and exact manifests", async t => {
  const f = await fixture(t);
  const { pin, bundle, snapshotRoot } = f.installed;
  const changes = [
    value => value.schemaVersion = 2,
    value => value.lessons.pop(),
    value => value.lessons.reverse(),
    value => value.topicManifest.lessons.reverse(),
    value => value.lessons[0].hash = "f".repeat(64),
    value => value.lessons[0].manifest.files.pop(),
    value => value.topic.title = "Unapproved title",
    value => value.extra = true
  ];
  for (const change of changes) {
    const altered = structuredClone(bundle);
    change(altered);
    await f.write("bundle.json", altered, snapshotRoot);
    await assert.rejects(() => f.reader.readTopic(pin), /incomplete, reordered, unsupported or changed/u);
  }
});

test("changed declared bytes and unrecorded snapshot files cannot be accepted", async t => {
  const f = await fixture(t);
  const { pin, snapshotRoot } = f.installed;
  await f.write("files/training/lessons/LESSON-01/lesson.md", `${f.teachingText}\nChanged after installation.\n`, snapshotRoot);
  await assert.rejects(() => f.reader.readTopic(pin), /changed from its source files/u);
  await f.write("files/training/lessons/LESSON-01/lesson.md", f.teachingText, snapshotRoot);
  await f.write("files/unrecorded.txt", "Not part of the approved CLI snapshot.\n", snapshotRoot);
  await assert.rejects(() => f.reader.readTopic(pin), /unrecorded files/u);
});

test("draft lessons, unknown lessons and another content hash are not teachable", async t => {
  const f = await fixture(t);
  const { pin, bundle } = f.installed;
  await assert.rejects(() => f.reader.readLesson({ ...pin, lessonCode: "LESSON-02", lessonHash: bundle.lessons[1].hash }), /draft and cannot be taught/u);
  await assert.rejects(() => f.reader.readLesson({ ...pin, lessonCode: "UNKNOWN", lessonHash: bundle.lessons[0].hash }), /not declared/u);
  await assert.rejects(() => f.reader.readLesson({ ...pin, lessonCode: "LESSON-01", lessonHash: "f".repeat(64) }), /content hash changed/u);
});

test("missing and corrupt snapshots fail actionably without creation or repair", async t => {
  const f = await fixture(t);
  const { pin, snapshotRoot } = f.installed;
  const absentRoot = path.join(f.root, "not-created");
  await assert.rejects(() => createInstalledTrainingContent({ systemRoot: absentRoot }).readTopic(pin), /install that exact revision/u);
  await assert.rejects(() => lstat(absentRoot), { code: "ENOENT" });
  await f.write("bundle.json", "{corrupt", snapshotRoot);
  await assert.rejects(() => f.reader.readTopic(pin), error => error.code === "VIBE64_TRAINING_CONTENT_INVALID" && /reinstall/u.test(error.message));
  await rm(path.join(snapshotRoot, "bundle.json"));
  await assert.rejects(() => f.reader.readTopic(pin), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  await assert.rejects(() => lstat(path.join(snapshotRoot, "bundle.json")), { code: "ENOENT" });
  await f.write("bundle.json", f.installed.bundle, snapshotRoot);
  const missingDocument = path.join(snapshotRoot, "files/training/lessons/LESSON-01/lesson.md");
  await rm(missingDocument);
  const beforeMissingRead = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readTopic(pin), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), beforeMissingRead);
  await assert.rejects(() => lstat(missingDocument), { code: "ENOENT" });
  await f.write("files/training/lessons/LESSON-01/lesson.md", f.teachingText, snapshotRoot);
  await rm(path.join(snapshotRoot, "pin.json"));
  await assert.rejects(() => f.reader.readTopic(pin), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  await assert.rejects(() => lstat(path.join(snapshotRoot, "pin.json")), { code: "ENOENT" });
});

test("server-derived paths reject traversal and symlink aliases throughout the installed hierarchy", async t => {
  const f = await fixture(t);
  const { pin, snapshotRoot } = f.installed;
  for (const request of [{ ...pin, topicId: "../elsewhere" }, { ...pin, topicId: "/absolute" }, { ...pin, commit: "../elsewhere" }, { ...pin, commit: "A".repeat(40) }]) {
    await assert.rejects(() => f.reader.readTopic(request), /valid topic ID/u);
  }
  const aliases = [f.systemRoot, path.join(f.systemRoot, "training"), path.join(f.systemRoot, "training/content"), path.dirname(snapshotRoot), snapshotRoot,
    path.join(snapshotRoot, "files"), path.join(snapshotRoot, "files/training"), path.join(snapshotRoot, "pin.json"), path.join(snapshotRoot, "bundle.json"),
    path.join(snapshotRoot, "files/training/lessons/LESSON-01/lesson.md")];
  for (const target of aliases) {
    const actual = `${target}.actual`;
    const directory = (await lstat(target)).isDirectory();
    await rename(target, actual);
    try {
      await symlink(path.basename(actual), target, directory ? "dir" : "file");
      const before = await treeState(f.systemRoot);
      await assert.rejects(() => f.reader.readTopic(pin), /symlink or directory aliases/u);
      assert.deepEqual(await treeState(f.systemRoot), before);
    } finally {
      await rm(target);
      await rename(actual, target);
    }
  }
});
