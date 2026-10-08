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


test("declared visual reads return exact pinned SVG, controller and binary asset bytes without writes", async t => {
  const f = await fixture(t);
  const request = {
    ...f.installed.pin,
    lessonCode: "LESSON-01",
    lessonHash: f.installed.bundle.lessons[0].hash,
    visualId: "flow"
  };
  const original = await f.reader.readVisual(request);
  assert.deepEqual(original.assets, []);
  assert.deepEqual(original.visual, f.visual);

  const visual = { ...f.visual, assets: ["labels.txt", "image.bin"] };
  await f.write("training/visuals/flow/visual.json", visual);
  await f.write("training/visuals/flow/labels.txt", "Client and server labels.\n");
  await writeFile(path.join(f.source, "training/visuals/flow/image.bin"), Buffer.from([0, 255, 128, 10]));
  const installed = await f.install();
  const before = await treeState(f.systemRoot);
  const result = await f.reader.readVisual({
    ...installed.pin,
    lessonCode: "LESSON-01",
    lessonHash: installed.bundle.lessons[0].hash,
    visualId: "flow"
  });
  assert.deepEqual(result.pin, installed.pin);
  assert.equal(result.lessonCode, "LESSON-01");
  assert.equal(result.lessonHash, installed.bundle.lessons[0].hash);
  assert.equal(result.id, "flow");
  assert.equal(result.descriptorPath, "training/visuals/flow/visual.json");
  assert.deepEqual(result.visual, visual);
  assert.deepEqual(Object.keys(result).sort(), [
    "assets", "controller", "descriptorPath", "id", "lessonCode", "lessonHash", "pin", "svg", "visual"
  ]);
  assert.deepEqual([result.svg.path, result.controller.path, ...result.assets.map(file => file.path)],
    ["diagram.svg", "controller.js", "labels.txt", "image.bin"].map(name => `training/visuals/flow/${name}`));
  for (const file of [result.svg, result.controller, ...result.assets]) {
    assert.equal(Buffer.isBuffer(file.bytes), true);
    assert.deepEqual(Object.keys(file).sort(), ["bytes", "path"]);
    assert.deepEqual(file.bytes, await readFile(path.join(installed.snapshotRoot, "files", file.path)));
  }
  assert.deepEqual(result.assets[1].bytes, Buffer.from([0, 255, 128, 10]));
  assert.deepEqual(await f.reader.readVisual(request), original);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("visual reads require a declared ID and exact trusted published lesson pin", async t => {
  const f = await fixture(t);
  const { pin, bundle } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash, visualId: "flow" };
  const before = await treeState(f.systemRoot);
  for (const visualId of [undefined, "../diagram.svg", "/absolute", "flow/controller.js", 1]) {
    await assert.rejects(() => f.reader.readVisual({ ...request, visualId }), /declared visual ID/u);
  }
  await assert.rejects(() => f.reader.readVisual({ ...request, visualId: "unknown" }), /not declared in this pinned lesson/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, topicHash: undefined }), /trusted 64-character topic hash/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, topicHash: "f".repeat(64) }), /trusted course or attempt pin/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, topicId: "../elsewhere" }), /valid topic ID/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, lessonCode: "LESSON-02", lessonHash: bundle.lessons[1].hash }), /draft and cannot be taught/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, lessonCode: "UNKNOWN" }), /not declared/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, lessonHash: "f".repeat(64) }), /content hash changed/u);
  await assert.rejects(() => f.reader.readVisual({ ...request, commit: "f".repeat(40) }), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("visual reads reject changed, missing and aliased resources without repairing them", async t => {
  const f = await fixture(t);
  const { pin, bundle, snapshotRoot } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash, visualId: "flow" };
  for (const name of ["diagram.svg", "controller.js"]) {
    const filename = path.join(snapshotRoot, "files/training/visuals/flow", name);
    const bytes = await readFile(filename);
    await writeFile(filename, Buffer.concat([bytes, Buffer.from("\nChanged after installation.\n")]));
    let before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readVisual(request), error =>
      error.code === "VIBE64_TRAINING_CONTENT_INVALID" && /changed from its source files/u.test(error.message));
    assert.deepEqual(await treeState(f.systemRoot), before);
    await rm(filename);
    before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readVisual(request), error => error.code === "VIBE64_TRAINING_CONTENT_MISSING");
    assert.deepEqual(await treeState(f.systemRoot), before);
    await writeFile(`${filename}.actual`, bytes);
    await symlink(`${name}.actual`, filename);
    try {
      before = await treeState(f.systemRoot);
      await assert.rejects(() => f.reader.readVisual(request), /symlink or directory aliases/u);
      assert.deepEqual(await treeState(f.systemRoot), before);
    } finally {
      await rm(filename);
      await rename(`${filename}.actual`, filename);
    }
  }
});

test("visual reads preserve original descriptor bounds and topic-relative path rejection", async t => {
  const f = await fixture(t);
  const { pin, bundle, snapshotRoot } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash, visualId: "flow" };
  const changes = [
    { svg: "/absolute.svg" }, { controller: "../../../../outside.js" },
    { description: "x".repeat(2001) },
    { states: Array.from({ length: 33 }, (_, index) => `state-${index}`) },
    { commands: Array.from({ length: 33 }, (_, index) => ({ ...f.visual.commands[0], name: `command-${index}` })) },
    { commands: [{
      ...f.visual.commands[0],
      parameters: Array.from({ length: 9 }, (_, index) => ({ name: `parameter-${index}`, required: true, maxLength: 28 }))
    }] },
    { commands: [{ ...f.visual.commands[0], parameters: [{ name: "label", required: true, maxLength: 257 }] }] },
    { assets: Array.from({ length: 33 }, (_, index) => `asset-${index}.txt`) }
  ];
  for (const change of changes) {
    await f.write("files/training/visuals/flow/visual.json", { ...f.visual, ...change }, snapshotRoot);
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readVisual(request), error => {
      assert.equal(error.code, "VIBE64_TRAINING_CONTENT_INVALID");
      assert.match(error.cause.message, change.svg || change.controller
        ? /Invalid topic-relative path|Path escapes topic/u
        : /Schema validation failed/u);
      return true;
    });
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
});


test("exercise reads return only exact declared exercise-relative bytes without writes or modes", async t => {
  const f = await fixture(t);
  const { pin, bundle, snapshotRoot } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash };
  const before = await treeState(f.systemRoot);
  const result = await f.reader.readExercise(request);
  assert.deepEqual(Object.keys(result).sort(), ["exercise", "files", "lessonCode", "lessonHash", "pin", "sourcePath"]);
  assert.deepEqual(result.pin, pin);
  assert.equal(result.lessonCode, "LESSON-01");
  assert.equal(result.lessonHash, bundle.lessons[0].hash);
  assert.deepEqual(result.exercise, f.lesson.exercise);
  assert.equal(result.sourcePath, "training/exercises/app");
  assert.deepEqual(result.files.map(file => file.path), ["genesis/stack.md", "genesis/version", "package.json", "server.mjs"]);
  for (const file of result.files) {
    assert.deepEqual(Object.keys(file).sort(), ["bytes", "path"]);
    assert.equal(Buffer.isBuffer(file.bytes), true);
    assert.deepEqual(file.bytes, await readFile(path.join(snapshotRoot, "files", result.sourcePath, file.path)));
  }
  // Caller paths cannot replace the descriptor's source selection.
  assert.deepEqual(await f.reader.readExercise({ ...request, source: "../../visuals/flow", path: "/etc/passwd" }), result);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("exercise reads retain old pins, nested binary bytes and declared sequence metadata", async t => {
  const f = await fixture(t);
  const first = f.installed;
  const originalRequest = { ...first.pin, lessonCode: "LESSON-01", lessonHash: first.bundle.lessons[0].hash };
  const original = await f.reader.readExercise(originalRequest);
  const exercise = { ...f.lesson.exercise, reuse: "sequence", sequenceId: "intro", sequenceMode: "create" };
  await f.write("training/lessons/LESSON-01/lesson.json", {
    ...f.lesson,
    exercise,
    checks: [{ ...f.lesson.checks[0], file: "../../exercises/app-other/health.mjs" }]
  });
  await f.write("training/exercises/app-other/health.mjs", "// A declared check outside this exercise directory.\n");
  await f.write("training/exercises/app/src/message.bin", "");
  const binary = Buffer.from([0, 255, 128, 10]);
  await writeFile(path.join(f.source, "training/exercises/app/src/message.bin"), binary);
  await f.write("training/exercises/app/node_modules/ignored.txt", "Installed dependency.\n");
  await f.write("training/exercises/app/.genesis/derived.json", "Derived index.\n");
  const second = await f.install();
  const before = await treeState(f.systemRoot);
  const result = await f.reader.readExercise({ ...second.pin, lessonCode: "LESSON-01", lessonHash: second.bundle.lessons[0].hash });
  assert.notEqual(result.pin.commit, original.pin.commit);
  assert.notEqual(result.lessonHash, original.lessonHash);
  assert.deepEqual(result.exercise, exercise);
  assert.deepEqual(result.files.map(file => file.path), [
    "genesis/stack.md", "genesis/version", "package.json", "server.mjs", "src/message.bin"
  ]);
  assert.deepEqual(result.files.at(-1).bytes, binary);
  assert.ok(second.bundle.lessons[0].manifest.files.some(file => file.path === "training/exercises/app-other/health.mjs"));
  assert.deepEqual(await f.reader.readExercise(originalRequest), original);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("exercise reads reject absent exercises, drafts and mismatched trusted pins", async t => {
  const f = await fixture(t);
  const { pin, bundle } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash };
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readExercise({ ...request, topicHash: undefined }), /trusted 64-character topic hash/u);
  await assert.rejects(() => f.reader.readExercise({ ...request, topicHash: "f".repeat(64) }), /trusted course or attempt pin/u);
  await assert.rejects(() => f.reader.readExercise({ ...request, lessonHash: "f".repeat(64) }), /content hash changed/u);
  await assert.rejects(() => f.reader.readExercise({ ...request, lessonCode: "LESSON-02", lessonHash: bundle.lessons[1].hash }), /draft and cannot be taught/u);
  await assert.rejects(() => f.reader.readExercise({ ...request, lessonCode: "UNKNOWN" }), /not declared/u);
  await assert.rejects(() => f.reader.readExercise({ ...request, lessonCode: "../elsewhere" }), /declared lesson code/u);
  assert.deepEqual(await treeState(f.systemRoot), before);

  await f.write("training/lessons/LESSON-01/lesson.json", {
    ...f.lesson, exercise: undefined, checks: undefined, assessments: [f.lesson.assessments[0]]
  });
  const withoutExercise = await f.install();
  const beforeAbsentRead = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readExercise({
    ...withoutExercise.pin, lessonCode: "LESSON-01", lessonHash: withoutExercise.bundle.lessons[0].hash
  }), /no declared bundled exercise/u);
  assert.deepEqual(await treeState(f.systemRoot), beforeAbsentRead);
});

test("exercise reads reject changed, missing, aliased and escaping source content without repair", async t => {
  const f = await fixture(t);
  const { pin, bundle, snapshotRoot } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash };
  const filename = path.join(snapshotRoot, "files/training/exercises/app/server.mjs");
  const bytes = await readFile(filename);
  await writeFile(filename, Buffer.concat([bytes, Buffer.from("\nChanged after installation.\n")]));
  let before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readExercise(request), error =>
    error.code === "VIBE64_TRAINING_CONTENT_INVALID" && /changed from its source files/u.test(error.message));
  assert.deepEqual(await treeState(f.systemRoot), before);
  await rm(filename);
  before = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readExercise(request), error =>
    error.code === "VIBE64_TRAINING_CONTENT_INVALID" && /changed from its source files/u.test(error.message));
  assert.deepEqual(await treeState(f.systemRoot), before);
  await assert.rejects(() => lstat(filename), { code: "ENOENT" });
  await writeFile(`${filename}.actual`, bytes);
  await symlink("server.mjs.actual", filename);
  try {
    before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readExercise(request), /symlink or directory aliases/u);
    assert.deepEqual(await treeState(f.systemRoot), before);
  } finally {
    await rm(filename);
    await rename(`${filename}.actual`, filename);
  }
  for (const source of ["/absolute", "../../../../outside"]) {
    await f.write("files/training/lessons/LESSON-01/lesson.json", {
      ...f.lesson, exercise: { ...f.lesson.exercise, source }
    }, snapshotRoot);
    before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readExercise(request), error => {
      assert.equal(error.code, "VIBE64_TRAINING_CONTENT_INVALID");
      assert.match(error.cause.message, /Invalid topic-relative path|Path escapes topic/u);
      return true;
    });
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
});


test("declared check reads preserve exact executable and ordered asset bytes at each pin without writes", async t => {
  const f = await fixture(t);
  const first = f.installed;
  const originalRequest = { ...first.pin, lessonCode: "LESSON-01", lessonHash: first.bundle.lessons[0].hash, checkId: "health" };
  const original = await f.reader.readCheck(originalRequest);
  assert.deepEqual(original.check, f.lesson.checks[0]);
  assert.deepEqual(original.assets, []);
  assert.equal(original.file.path, "training/checks/health.mjs");
  assert.deepEqual(original.file.bytes, await readFile(path.join(first.snapshotRoot, "files/training/checks/health.mjs")));

  const check = { ...f.lesson.checks[0], assets: ["../../checks/labels.txt", "../../checks/config.bin"] };
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, checks: [check] });
  await f.write("training/checks/health.mjs", '// A changed, pinned check is returned without executing it.\n');
  await f.write("training/checks/labels.txt", "The actual response identity.\n");
  const binary = Buffer.from([0, 255, 128, 10]);
  await writeFile(path.join(f.source, "training/checks/config.bin"), binary);
  const installed = await f.install();
  const request = { ...installed.pin, lessonCode: "LESSON-01", lessonHash: installed.bundle.lessons[0].hash, checkId: "health" };
  const before = await treeState(f.systemRoot);
  const result = await f.reader.readCheck(request);
  assert.deepEqual(Object.keys(result).sort(), ["assets", "check", "file", "lessonCode", "lessonHash", "pin"]);
  assert.deepEqual(result.pin, installed.pin);
  assert.equal(result.lessonCode, "LESSON-01");
  assert.equal(result.lessonHash, installed.bundle.lessons[0].hash);
  assert.deepEqual(result.check, check);
  assert.deepEqual([result.file.path, ...result.assets.map(value => value.path)],
    ["training/checks/health.mjs", "training/checks/labels.txt", "training/checks/config.bin"]);
  for (const file of [result.file, ...result.assets]) {
    assert.deepEqual(Object.keys(file).sort(), ["bytes", "path"]);
    assert.equal(Buffer.isBuffer(file.bytes), true);
    assert.deepEqual(file.bytes, await readFile(path.join(installed.snapshotRoot, "files", file.path)));
  }
  assert.deepEqual(result.assets[1].bytes, binary);
  assert.notDeepEqual(result.file.bytes, original.file.bytes);
  assert.deepEqual(await f.reader.readCheck(originalRequest), original);
  assert.deepEqual(await f.reader.readCheck({ ...request, file: "/etc/passwd", path: "../../exercises/app/server.mjs" }), result);
  result.check.id = "caller-change";
  result.file.bytes.fill(0);
  result.assets[1].bytes.fill(0);
  const reread = await f.reader.readCheck(request);
  assert.deepEqual(reread.check, check);
  assert.deepEqual(reread.file.bytes, await readFile(path.join(installed.snapshotRoot, "files/training/checks/health.mjs")));
  assert.deepEqual(reread.assets[1].bytes, binary);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("check reads require a declared ID and exact trusted published lesson pin", async t => {
  const f = await fixture(t);
  const { pin, bundle } = f.installed;
  const request = { ...pin, lessonCode: "LESSON-01", lessonHash: bundle.lessons[0].hash, checkId: "health" };
  const before = await treeState(f.systemRoot);
  for (const checkId of [undefined, "../health.mjs", "/absolute", "health/extra", "x".repeat(65), 1]) {
    await assert.rejects(() => f.reader.readCheck({ ...request, checkId }), /declared check ID/u);
  }
  await assert.rejects(() => f.reader.readCheck({ ...request, checkId: "unknown" }), /not declared in this pinned lesson/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, topicHash: undefined }), /trusted 64-character topic hash/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, topicHash: "f".repeat(64) }), /trusted course or attempt pin/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, topicId: "../elsewhere" }), /valid topic ID/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, lessonHash: "f".repeat(64) }), /content hash changed/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, lessonCode: "UNKNOWN" }), /not declared/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, lessonCode: "LESSON-02", lessonHash: bundle.lessons[1].hash }), /draft and cannot be taught/u);
  await assert.rejects(() => f.reader.readCheck({ ...request, commit: "f".repeat(40) }), { code: "VIBE64_TRAINING_CONTENT_MISSING" });
  assert.deepEqual(await treeState(f.systemRoot), before);

  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, checks: undefined, assessments: [f.lesson.assessments[0]] });
  const withoutCheck = await f.install();
  const beforeAbsentRead = await treeState(f.systemRoot);
  await assert.rejects(() => f.reader.readCheck({ ...withoutCheck.pin, lessonCode: "LESSON-01",
    lessonHash: withoutCheck.bundle.lessons[0].hash, checkId: "health" }), /not declared in this pinned lesson/u);
  assert.deepEqual(await treeState(f.systemRoot), beforeAbsentRead);
});

test("check reads reject changed executable or changed missing and aliased assets without repair", async t => {
  for (const damage of ["executable", "asset", "missing", "alias"]) {
    const f = await fixture(t);
    await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson,
      checks: [{ ...f.lesson.checks[0], assets: ["../../checks/labels.txt"] }] });
    await f.write("training/checks/labels.txt", "Pinned label.\n");
    const installed = await f.install();
    const filename = path.join(installed.snapshotRoot, "files/training/checks", damage === "executable" ? "health.mjs" : "labels.txt");
    if (damage === "executable" || damage === "asset") await writeFile(filename, "Changed bytes.\n");
    else {
      await rm(filename);
      if (damage === "alias") await symlink(path.join(f.source, "training/checks/labels.txt"), filename);
    }
    const before = await treeState(f.systemRoot);
    await assert.rejects(() => f.reader.readCheck({ ...installed.pin, lessonCode: "LESSON-01",
      lessonHash: installed.bundle.lessons[0].hash, checkId: "health" }), error =>
      damage === "missing"
        ? error.code === "VIBE64_TRAINING_CONTENT_MISSING" && /install that exact revision/u.test(error.message)
        : error.code === "VIBE64_TRAINING_CONTENT_INVALID" && /reinstall/u.test(error.message) &&
          (damage !== "alias" || /symlink or directory aliases/u.test(error.message)));
    assert.deepEqual(await treeState(f.systemRoot), before);
  }
});


test("trusted author-preview construction reads a pinned draft through the original lesson and resource owners", async t => {
  const f = await fixture(t);
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02", title: "Draft with original resources" });
  await f.write("training/lessons/LESSON-02/lesson.md", f.teachingText);
  const { pin, bundle } = await f.install();
  const input = { ...pin, lessonCode: "LESSON-02", lessonHash: bundle.lessons[1].hash };
  const author = createInstalledTrainingContent({ systemRoot: f.systemRoot, allowDraftLessons: true });
  const before = await treeState(f.systemRoot);
  const lesson = await author.readLesson(input);
  assert.equal(lesson.lesson.code, "LESSON-02");
  assert.equal(lesson.document.text, f.teachingText);
  assert.equal(lesson.hash, input.lessonHash);
  assert.deepEqual(lesson.pin, pin);
  const visual = await author.readVisual({ ...input, visualId: "flow" });
  assert.deepEqual(visual.visual, f.visual);
  assert.match(visual.controller.bytes.toString(), /export function send/u);
  const exercise = await author.readExercise(input);
  assert.deepEqual(exercise.exercise, f.lesson.exercise);
  assert.ok(exercise.files.some(file => file.path === "server.mjs"));
  const check = await author.readCheck({ ...input, checkId: "health" });
  assert.match(check.file.bytes.toString(), /outcome/u);
  for (const operation of [
    () => f.reader.readLesson({ ...input, allowDraftLessons: true }),
    () => f.reader.readVisual({ ...input, visualId: "flow", allowDraftLessons: true }),
    () => f.reader.readExercise({ ...input, allowDraftLessons: true }),
    () => f.reader.readCheck({ ...input, checkId: "health", allowDraftLessons: true })
  ]) await assert.rejects(operation, /draft and cannot be taught/u);
  await assert.rejects(() => author.readLesson({ ...input, lessonHash: "f".repeat(64) }), /content hash changed/u);
  await assert.rejects(() => author.readLesson({ ...input, topicHash: "f".repeat(64) }), /differs from the trusted course or attempt pin/u);
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("author-preview readers retain original snapshot corruption refusal and require an explicit boolean construction", async t => {
  const f = await fixture(t);
  for (const allowDraftLessons of ["true", 1, null]) {
    assert.throws(() => createInstalledTrainingContent({ systemRoot: f.systemRoot, allowDraftLessons }), /trusted server construction/u);
  }
  const input = { ...f.installed.pin, lessonCode: "LESSON-02", lessonHash: f.installed.bundle.lessons[1].hash };
  const author = createInstalledTrainingContent({ systemRoot: f.systemRoot, allowDraftLessons: true });
  await f.write("files/training/lessons/LESSON-02/lesson.md", "Changed draft bytes.\n", f.installed.snapshotRoot);
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => author.readLesson(input), { code: "VIBE64_TRAINING_CONTENT_INVALID" });
  assert.deepEqual(await treeState(f.systemRoot), before);
});


// Readable catalogue titles reuse these same installed snapshot fixtures and
// the original verified catalogue/action owners. Original reader tests above
// remain unchanged.
import { createCourseLock } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createInstalledTrainingCatalogue } from "../../packages/vibe64-training/src/server/installedCatalogue.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingTeachingBrief } from "../../packages/vibe64-training/src/server/teachingBrief.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

async function titleCatalogue(f) {
  const course = { schemaVersion: 1, courseId: "readable-course", release: "0.1.0", title: "Readable lessons", status: "preview",
    topics: [{ topicId: f.installed.pin.topicId, release: f.installed.pin.release }] };
  const lock = createCourseLock(course, [{ ...f.installed.pin, topicManifest: f.installed.bundle.topicManifest }]);
  const catalogue = createInstalledTrainingCatalogue({ systemRoot: f.systemRoot });
  await catalogue.enableCourse({ course, lock, expectedRevision: 0 });
  return { catalogue, course, lock };
}
function titleActions(f, catalogue) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "title-fixture", domain: "training", actions: createTrainingActions({ catalogue,
    learners: createTrainingLearnerState({ systemRoot: f.systemRoot }), teachingBrief: createTrainingTeachingBrief({ systemRoot: f.systemRoot })
  }).map(definition => ({ ...definition, channels: ["api", "automation"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => ({ uid: 42, username: "reader", role: "member" }),
    authorizeProject() { assert.fail("Course title reads must not require a project."); } });
  const execute = (input = {}) => actions.execute({ actionId: "vibe64.training.courses.list", input, context: { channel: "api", surface: "app" } });
  return { actions, execute };
}

test("opt-in lesson titles use exact verified snapshots without changing default catalogue or persisted locks", async t => {
  const f = await fixture(t);
  const { catalogue, course, lock } = await titleCatalogue(f);
  const savedPath = path.join(f.systemRoot, "training/catalogue.json");
  const saved = JSON.parse(await readFile(savedPath, "utf8"));
  const before = await treeState(f.systemRoot);
  const display = await catalogue.readCatalogue({ includeLessonTitles: true });
  assert.deepEqual(display.courses[0].lessonTitles, [
    { topicId: "installed-topic", topicRelease: "0.1.0", code: "LESSON-01", hash: f.installed.bundle.lessons[0].hash, title: "Use an application" },
    { topicId: "installed-topic", topicRelease: "0.1.0", code: "LESSON-02", hash: f.installed.bundle.lessons[1].hash, title: "Draft" }
  ]);
  assert.deepEqual(await catalogue.readCatalogue(), saved);
  assert.deepEqual(await treeState(f.systemRoot), before);
  await catalogue.disableCourse({ courseId: course.courseId, release: course.release, expectedRevision: 1 });
  assert.equal((await catalogue.readCatalogue({ includeLessonTitles: true })).courses[0].enabled, false);
  await catalogue.enableCourse({ course, lock, expectedRevision: 2 });
  const persisted = JSON.parse(await readFile(savedPath, "utf8"));
  assert.equal(persisted.revision, 3);
  assert.equal(Object.hasOwn(persisted.courses[0], "lessonTitles"), false);
  assert.deepEqual(persisted.courses[0].lock, lock);
  assert.deepEqual(await catalogue.readCatalogue(), persisted);
  await assert.rejects(() => catalogue.readCatalogue({ includeLessonTitles: "true" }), /explicit Boolean/u);
});

test("canonical course API and native tool project bounded installed lesson titles with all original identities and no writes", async t => {
  const f = await fixture(t);
  const { catalogue } = await titleCatalogue(f);
  const { actions, execute } = titleActions(f, catalogue);
  const before = await treeState(f.systemRoot);
  const result = await execute();
  assert.deepEqual(result.courses[0].lessons, [
    { code: "LESSON-01", hash: f.installed.bundle.lessons[0].hash, status: "published", required: true,
      title: "Use an application", topicId: "installed-topic", topicRelease: "0.1.0" },
    { code: "LESSON-02", hash: f.installed.bundle.lessons[1].hash, status: "draft", required: true,
      title: "Draft", topicId: "installed-topic", topicRelease: "0.1.0" }
  ]);
  const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const context = { channel: "automation", surface: "app" };
  const toolSet = tools.resolveToolSet(context);
  const definition = toolSet.tools.find(value => value.actionId === "vibe64.training.courses.list");
  const tool = await tools.executeToolCall({ toolName: definition.name, toolSet, context, argumentsText: "{}" });
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.deepEqual(tool.result, result);
  assert.doesNotMatch(JSON.stringify(result), /sourceRoot|repository|descriptor|snapshotRoot|lessonTitles|lesson\.json|controller/u);
  await assert.rejects(() => execute({ includeLessonTitles: true }), { code: "ACTION_VALIDATION_FAILED" });
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("title projection ignores edited live source and refuses a tampered exact installed descriptor without repair", async t => {
  const f = await fixture(t);
  const { catalogue } = await titleCatalogue(f);
  const { execute } = titleActions(f, catalogue);
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, title: "Edited live source" });
  assert.equal((await execute()).courses[0].lessons[0].title, "Use an application");
  await f.write("files/training/lessons/LESSON-01/lesson.json", { ...f.lesson, title: "Tampered installed title" }, f.installed.snapshotRoot);
  const before = await treeState(f.systemRoot);
  await assert.rejects(() => catalogue.readCatalogue({ includeLessonTitles: true }), { code: "VIBE64_TRAINING_CATALOGUE_INVALID" });
  await assert.rejects(() => execute(), { code: "VIBE64_TRAINING_CATALOGUE_INVALID" });
  assert.deepEqual(await treeState(f.systemRoot), before);
});

test("canonical title projection refuses missing, ambiguous, oversized or wrong-pin display metadata", async t => {
  const f = await fixture(t);
  const { catalogue } = await titleCatalogue(f);
  const original = await catalogue.readCatalogue({ includeLessonTitles: true });
  for (const change of [
    entry => { entry.lessonTitles = []; },
    entry => { entry.lessonTitles.push({ ...entry.lessonTitles[0] }); },
    entry => { entry.lessonTitles[0].title = "x".repeat(257); },
    entry => { entry.lessonTitles[0].hash = "0".repeat(64); }
  ]) {
    const result = structuredClone(original);
    change(result.courses[0]);
    const { execute } = titleActions(f, { readCatalogue: async options => {
      assert.deepEqual(options, { includeLessonTitles: true });
      return result;
    } });
    await assert.rejects(() => execute(), /training operation could not complete/u);
  }
});
