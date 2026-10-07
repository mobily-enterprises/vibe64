import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { bundleFiles, validateTopic } from "../../packages/vibe64-training/src/server/content.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-content-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function write(filename, value) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  const lesson = { schemaVersion: 1, code: "LESSON-01", title: "First", document: "lesson.md", prerequisites: [],
    estimatedMinutes: 10, visuals: [{ id: "flow", descriptor: "../../visuals/flow/visual.json" }],
    exercise: { kind: "bundled", source: "../../exercises/app", reuse: "attempt" },
    checks: [{ id: "response", file: "../../checks/response.mjs" }],
    assessments: [{ id: "answer", kind: "answer", required: true, rubric: "lesson.md#answer" },
      { id: "request", kind: "practical", required: true, rubric: "lesson.md#request",
        evidence: { producer: "exercise", operation: "request-response", check: "response", explanationRequired: true } }] };
  const topic = { schemaVersion: 1, topicId: "test-topic", domainId: "vibe64", title: "Test", status: "preview", outline: "training/outline.md", prerequisites: [],
    lessons: [{ code: "LESSON-01", descriptor: "training/lessons/LESSON-01/lesson.json", status: "published", required: true }] };
  const visual = { schemaVersion: 1, id: "flow", title: "Flow", svg: "diagram.svg", controller: "controller.js", initialState: "overview",
    states: ["overview", "arrived"], description: "An accessible flow.", commands: [{ name: "send", parameters: [], completionState: "arrived", description: "Request arrives." }] };
  await write("package.json", { name: "learn-test-topic", version: "0.1.0", vibe64Training: topic });
  await write("training/outline.md", "# Outline\n");
  await write("training/lessons/LESSON-01/lesson.json", lesson);
  await write("training/lessons/LESSON-01/lesson.md", '# First\n<a id="answer"></a>\nExplain it.\n<a id="request"></a>\nTry it.\n');
  await write("training/visuals/flow/visual.json", visual);
  await write("training/visuals/flow/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Flow</title></svg>');
  await write("training/visuals/flow/controller.js", "export const commands = ['send'];\n");
  await write("training/exercises/app/package.json", { name: "orientation", type: "module" });
  await write("training/exercises/app/server.mjs", "// Exercise server\n");
  await write("training/checks/response.mjs", "// Pinned response check\n");
  return { root, lesson, topic, visual, write };
}

test("lesson identity covers declared assets/checks/exercise but not dependencies or unrelated documents", async t => {
  const f = await fixture(t);
  const first = (await validateTopic(f.root)).bundles[0];
  assert.match(first.hash, /^[a-f0-9]{64}$/u);
  assert.equal(first.manifest.files.length, 8);
  await f.write("notes.md", "Unrelated edits\n");
  await f.write("training/exercises/app/node_modules/ignored.txt", "Installed dependency\n");
  await f.write("training/exercises/app/.git/config", "Local Git state\n");
  assert.equal((await validateTopic(f.root)).bundles[0].hash, first.hash);
  for (const filename of ["training/visuals/flow/diagram.svg", "training/checks/response.mjs", "training/exercises/app/server.mjs"]) {
    const previous = await readFile(path.join(f.root, filename), "utf8");
    await f.write(filename, `${previous}\n`);
    assert.notEqual((await validateTopic(f.root)).bundles[0].hash, first.hash, filename);
    await f.write(filename, previous);
  }
  assert.deepEqual((await validateTopic(f.root)).bundles[0].manifest, first.manifest);
});

test("content rejects missing rubrics, invalid producer/check references and unsupported fields instead of silently stripping", async t => {
  const f = await fixture(t);
  const cases = [
    [lesson => lesson.assessments[0].rubric = "lesson.md#missing", /rubric anchor/u],
    [lesson => delete lesson.assessments[1].evidence, /evidence producer/u],
    [lesson => lesson.assessments[1].evidence.check = "missing", /Unknown check/u],
    [lesson => lesson.assessments.push(lesson.assessments[0]), /duplicate ID/u],
    [lesson => lesson.shellCommand = "arbitrary", /validation/iu],
    [lesson => lesson.estimatedMinutes = "10", /noncanonical/u],
    [lesson => lesson.schemaVersion = 2, /validation/iu]
  ];
  for (const [change, expected] of cases) {
    const lesson = structuredClone(f.lesson);
    change(lesson);
    await f.write("training/lessons/LESSON-01/lesson.json", lesson);
    await assert.rejects(() => validateTopic(f.root), expected);
  }
});

test("topic files cannot escape the root through relative paths, absolute paths or symlinks", async t => {
  const f = await fixture(t);
  for (const document of ["../../../../outside.md", "/etc/passwd", "https://example.com/lesson.md"]) {
    await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, document });
    await assert.rejects(() => validateTopic(f.root));
  }
  await f.write("training/lessons/LESSON-01/lesson.json", f.lesson);
  await rm(path.join(f.root, "training/visuals/flow/controller.js"));
  await symlink("/etc/passwd", path.join(f.root, "training/visuals/flow/controller.js"));
  await assert.rejects(() => validateTopic(f.root), /Symlink/u);
});

test("visual contracts validate declared states and command identity", async t => {
  const f = await fixture(t);
  for (const visual of [{ ...f.visual, initialState: "missing" },
    { ...f.visual, commands: [{ ...f.visual.commands[0], completionState: "missing" }] },
    { ...f.visual, commands: [...f.visual.commands, f.visual.commands[0]] }]) {
    await f.write("training/visuals/flow/visual.json", visual);
    await assert.rejects(() => validateTopic(f.root), /state|duplicate/u);
  }
});

test("declared auxiliary visual and check inputs participate in lesson identity", async t => {
  const f = await fixture(t);
  const lesson = { ...f.lesson, checks: [{ ...f.lesson.checks[0], assets: ["../../checks/helper.mjs"] }] };
  await f.write("training/lessons/LESSON-01/lesson.json", lesson);
  await f.write("training/checks/helper.mjs", "export const answer = 1;\n");
  await f.write("training/visuals/flow/visual.json", { ...f.visual, assets: ["style.css"] });
  await f.write("training/visuals/flow/style.css", "svg { color: blue; }\n");
  const before = (await validateTopic(f.root)).bundles[0];
  assert.ok(before.manifest.files.some(file => file.path === "training/checks/helper.mjs"));
  assert.ok(before.manifest.files.some(file => file.path === "training/visuals/flow/style.css"));
  await f.write("training/checks/helper.mjs", "export const answer = 2;\n");
  const changedCheck = (await validateTopic(f.root)).bundles[0].hash;
  assert.notEqual(changedCheck, before.hash);
  await f.write("training/visuals/flow/style.css", "svg { color: red; }\n");
  assert.notEqual((await validateTopic(f.root)).bundles[0].hash, changedCheck);
});

test("conflicting shared-file snapshots cannot be collapsed into a successful bundle", () => {
  const file = { path: "visual/controller.js", sha256: "a".repeat(64), bytes: 20 };
  assert.deepEqual(bundleFiles([{ files: [file] }, { files: [{ ...file }] }]), [file]);
  for (const changed of [{ ...file, sha256: "b".repeat(64) }, { ...file, bytes: 21 }]) {
    assert.throws(() => bundleFiles([{ files: [file] }, { files: [changed] }]), /Source changed between lesson snapshots/u);
  }
});

test("published topic cannot claim required drafts, and prerequisite cycles or unknown lessons fail", async t => {
  const f = await fixture(t);
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", vibe64Training: { ...f.topic, status: "released", lessons: [{ ...f.topic.lessons[0], status: "draft" }] } });
  await assert.rejects(() => validateTopic(f.root), /required draft/u);
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", vibe64Training: f.topic });
  for (const code of ["LESSON-01", "MISSING"]) {
    await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, prerequisites: [{ code }] });
    await assert.rejects(() => validateTopic(f.root), /cycle|Unknown prerequisite/u);
  }
});

test("continuation must follow one sequence creation and use the same exercise source", async t => {
  const f = await fixture(t);
  const exercise = { ...f.lesson.exercise, reuse: "sequence", sequenceId: "checklist", sequenceMode: "create" };
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, exercise });
  assert.equal((await validateTopic(f.root)).bundles.length, 1);
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, exercise: { ...exercise, sequenceMode: "continue" } });
  await assert.rejects(() => validateTopic(f.root), /create\/continue/u);
});

test("topic metadata and ordering change topic identity without changing unchanged lesson identity", async t => {
  const f = await fixture(t);
  const first = await validateTopic(f.root);
  await f.write("training/outline.md", "# Revised outline\n");
  const revised = await validateTopic(f.root);
  assert.notEqual(revised.topicHash, first.topicHash);
  assert.equal(revised.bundles[0].hash, first.bundles[0].hash);
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02" });
  await f.write("training/lessons/LESSON-02/lesson.md", '# Second\n<a id="answer"></a>\nExplain.\n<a id="request"></a>\nTry.\n');
  const entries = [...f.topic.lessons, { ...f.topic.lessons[0], code: "LESSON-02", descriptor: "training/lessons/LESSON-02/lesson.json", status: "draft" }];
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", vibe64Training: { ...f.topic, lessons: entries } });
  const ordered = await validateTopic(f.root);
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", vibe64Training: { ...f.topic, lessons: entries.toReversed() } });
  const reordered = await validateTopic(f.root);
  assert.notEqual(reordered.topicHash, ordered.topicHash);
  assert.equal(reordered.bundles[1].hash, ordered.bundles[0].hash);
  assert.equal(reordered.bundles[0].status, "draft");
});

test("released learning paths reject a draft prerequisite or sequence creator and inconsistent continued sources", async t => {
  const f = await fixture(t);
  const entries = [{ ...f.topic.lessons[0], status: "draft", required: false },
    { ...f.topic.lessons[0], code: "LESSON-02", descriptor: "training/lessons/LESSON-02/lesson.json" }];
  await f.write("training/lessons/LESSON-02/lesson.md", '<a id="answer"></a>\n<a id="request"></a>\n');
  await f.write("package.json", { name: "learn-test-topic", version: "1.0.0", vibe64Training: { ...f.topic, status: "released", lessons: entries } });
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02", prerequisites: [{ code: "LESSON-01" }] });
  await assert.rejects(() => validateTopic(f.root), /requires draft/u);
  const create = { ...f.lesson.exercise, reuse: "sequence", sequenceId: "checklist", sequenceMode: "create" };
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, exercise: create });
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02", exercise: { ...create, sequenceMode: "continue" } });
  await assert.rejects(() => validateTopic(f.root), /create\/continue/u);
  entries[0].status = "published";
  await f.write("package.json", { name: "learn-test-topic", version: "1.0.0", vibe64Training: { ...f.topic, status: "released", lessons: entries } });
  assert.equal((await validateTopic(f.root)).bundles.length, 2);
  await f.write("training/exercises/other/server.mjs", "// Different source\n");
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02", exercise: { ...create, source: "../../exercises/other", sequenceMode: "continue" } });
  await assert.rejects(() => validateTopic(f.root), /create\/continue/u);
  await f.write("training/lessons/LESSON-02/lesson.json", { ...f.lesson, code: "LESSON-02", prerequisites: [{ code: "LESSON-01" }], exercise: { ...create, sequenceMode: "continue" } });
  await f.write("package.json", { name: "learn-test-topic", version: "1.0.0", vibe64Training: { ...f.topic, status: "released", lessons: entries.toReversed() } });
  await assert.rejects(() => validateTopic(f.root), /must precede/u);
});

test("authoring CLI validates without launching, bundles exact files and preserves existing output", async t => {
  const f = await fixture(t);
  const output = `${f.root}-bundle`;
  t.after(() => rm(output, { recursive: true, force: true }));
  const messages = [];
  assert.equal(await runTrainingCli(["validate", f.root], { write: text => messages.push(JSON.parse(text)) }), 0);
  assert.equal(messages[0].topicId, "test-topic");
  await assert.rejects(() => runTrainingCli(["publish", f.root]), /Usage/u);
  await assert.rejects(() => runTrainingCli(["bundle", f.root, path.join(f.root, "output")]), /outside/u);
  await runTrainingCli(["bundle", f.root, output], { write() {} });
  const bundled = JSON.parse(await readFile(path.join(output, "bundle.json"), "utf8"));
  assert.equal(bundled.lessons[0].hash, messages[0].lessons[0].hash);
  assert.equal(await readFile(path.join(output, "files/training/exercises/app/server.mjs"), "utf8"), "// Exercise server\n");
  await assert.rejects(() => runTrainingCli(["bundle", f.root, output]), { code: "EEXIST" });
  assert.equal(JSON.parse(await readFile(path.join(output, "bundle.json"), "utf8")).lessons[0].hash, messages[0].lessons[0].hash);
});

test("source and output-parent symlink aliases cannot put generated output inside topic source", async t => {
  const f = await fixture(t);
  const alias = `${f.root}-alias`;
  await symlink(f.root, alias);
  t.after(() => rm(alias));
  await assert.rejects(() => runTrainingCli(["bundle", alias, path.join(f.root, "output")]), /outside/u);
  await assert.rejects(() => runTrainingCli(["bundle", f.root, path.join(alias, "output")]), /outside/u);
  await assert.rejects(() => readFile(path.join(f.root, "output/bundle.json")), { code: "ENOENT" });
});

test("courses select complete ordered topics and cannot claim a preview is released", async t => {
  const f = await fixture(t);
  const result = await validateTopic(f.root);
  const resolved = { topicId: result.topic.topicId, release: result.release, topicManifest: result.topicManifest,
    topicHash: result.topicHash, repository: "example/learn-test-topic", commit: "a".repeat(40) };
  const course = { schemaVersion: 1, courseId: "first-course", title: "First course", release: "0.1.0", status: "preview", topics: [{ topicId: "test-topic", release: "0.1.0" }] };
  const lock = createCourseLock(course, [resolved]);
  assert.equal(lock.topics[0].commit, resolved.commit);
  assert.deepEqual(lock.topics[0].lessons, result.topicManifest.lessons);
  assert.throws(() => createCourseLock({ ...course, lessons: ["LESSON-01"] }, [resolved]), /validation/iu);
  assert.throws(() => createCourseLock({ ...course, status: "released" }, [resolved]), /released topic/u);
  assert.throws(() => createCourseLock(course, []), /exactly one/u);
  assert.throws(() => createCourseLock(course, [resolved, resolved]), /exactly one/u);
  assert.throws(() => createCourseLock(course, [{ ...resolved, commit: "main" }]), /immutable commit/u);
  assert.throws(() => createCourseLock(course, [{ ...resolved, topicHash: "b".repeat(64) }]), /identity mismatch/u);
});

test("pinned topic reads require the repository root and committed exact inputs", async t => {
  const f = await fixture(t);
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", repository: { type: "git", url: "https://github.com/example/learn-test-topic.git" }, vibe64Training: f.topic });
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  await assert.rejects(() => readPinnedTopic(f.root));
  git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Fixture topic");
  const commit = git("rev-parse", "HEAD");
  const pinned = await readPinnedTopic(f.root);
  assert.equal(pinned.commit, commit);
  assert.equal(pinned.repository, "example/learn-test-topic");
  assert.equal(pinned.topicHash, (await validateTopic(f.root)).topicHash);
  await assert.rejects(() => readPinnedTopic(path.join(f.root, "training")), /repository root/u);
  await f.write("training/checks/response.mjs", "// Changed check\n");
  await assert.rejects(() => readPinnedTopic(f.root), /Commit the topic/u);
  assert.equal(git("rev-parse", "HEAD"), commit);
});

test("publish-manifest writes a pinned whole-topic lock without changing source or publishing remotely", async t => {
  const f = await fixture(t);
  const course = { schemaVersion: 1, courseId: "first-course", title: "First", release: "0.1.0", status: "preview", topics: [{ topicId: "test-topic", release: "0.1.0" }] };
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", repository: { type: "git", url: "https://github.com/example/learn-test-topic.git" }, vibe64Training: f.topic });
  await f.write("course.json", course);
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main"); git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Fixture topic");
  const catalogue = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-catalogue-"));
  t.after(() => rm(catalogue, { recursive: true, force: true }));
  const filename = path.join(catalogue, "course.json");
  await writeFile(filename, JSON.stringify(course));
  const messages = [];
  await runTrainingCli(["publish-manifest", filename, f.root], { write: text => messages.push(JSON.parse(text)) });
  const lock = JSON.parse(await readFile(path.join(catalogue, "course.lock.json"), "utf8"));
  assert.equal(lock.topics[0].commit, git("rev-parse", "HEAD"));
  assert.equal(lock.topics[0].lessons.length, 1);
  assert.equal(messages[0].status, "preview");
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(git("remote"), "");
  await assert.rejects(() => runTrainingCli(["publish-manifest", path.join(f.root, "course.json"), f.root]), /outside every pinned source/u);
  const alias = path.join(catalogue, "topic-alias");
  await symlink(f.root, alias, "dir");
  await assert.rejects(() => runTrainingCli(["publish-manifest", path.join(alias, "course.json"), f.root]), /outside every pinned source/u);
  const lockPath = path.join(catalogue, "course.lock.json");
  await writeFile(lockPath, JSON.stringify(course));
  await assert.rejects(() => runTrainingCli(["publish-manifest", lockPath, f.root]), /must not replace its input/u);
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), course);
  assert.equal(git("status", "--porcelain"), "", "Rejected output paths leave the source clean");
});


test("visual descriptor lists accept their exact bounds and reject valid excess items", async t => {
  const f = await fixture(t);
  // Optional assets and checks' optional assets are absent in the original fixture.
  assert.equal((await validateTopic(f.root)).bundles[0].manifest.files.length, 8);
  const states = ["overview", "arrived", ...Array.from({ length: 30 }, (_, index) => `state-${index}`)];
  const parameters = Array.from({ length: 8 }, (_, index) => ({ name: `label-${index}`, required: true, maxLength: 256 }));
  const commands = Array.from({ length: 32 }, (_, index) => ({ ...f.visual.commands[0], name: `command-${index}`, parameters }));
  const assets = Array.from({ length: 32 }, (_, index) => `asset-${index}.txt`);
  for (const name of [...assets, "asset-extra.txt"]) {
    await f.write(`training/visuals/flow/${name}`, "Declared visual asset.\n");
  }
  const visual = { ...f.visual, states, commands, assets };
  await f.write("training/visuals/flow/visual.json", visual);
  assert.equal((await validateTopic(f.root)).bundles[0].manifest.files.length, 40);

  const changes = [
    { states: [...states, "extra-state"] },
    { commands: [...commands, { ...commands[0], name: "extra-command" }] },
    { commands: [{ ...commands[0], parameters: [...parameters, { name: "extra-label", required: true, maxLength: 256 }] }] },
    { assets: [...assets, "asset-extra.txt"] }
  ];
  for (const change of changes) {
    await f.write("training/visuals/flow/visual.json", { ...visual, ...change });
    await assert.rejects(() => validateTopic(f.root), error => {
      assert.match(error.message, /Schema validation failed/u);
      assert.match(JSON.stringify(error.fieldErrors), /Expected at most (8|32) items/u);
      return true;
    });
  }
});

async function operatorFixture(t) {
  const f = await fixture(t);
  await f.write("training/exercises/app/server.mjs", "throw new Error('Installation must not launch the exercise');\n");
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0", repository: {
    type: "git", url: "https://github.com/example/learn-test-topic.git" }, vibe64Training: f.topic });
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Fixture topic");
  const owner = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-operator-"));
  t.after(() => rm(owner, { recursive: true, force: true }));
  const course = { schemaVersion: 1, courseId: "first-course", title: "First", release: "0.1.0", status: "preview",
    topics: [{ topicId: "test-topic", release: "0.1.0" }] };
  const coursePath = path.join(owner, "course.json"), lockPath = path.join(owner, "course.lock.json");
  await writeFile(coursePath, JSON.stringify(course));
  await runTrainingCli(["publish-manifest", coursePath, f.root], { write() {} });
  const outputs = [];
  const run = (...args) => runTrainingCli(args, { write: text => outputs.push(JSON.parse(text)) });
  return { ...f, git, owner, course, coursePath, lockPath, systemRoot: path.join(owner, "system"), outputs, run };
}

test("operator CLI separately installs exact committed content and enables or disables with fresh catalogue CAS", async t => {
  const f = await operatorFixture(t);
  const courseBefore = await readFile(f.coursePath), lockBefore = await readFile(f.lockPath);
  await f.run("installed-courses", f.systemRoot);
  assert.deepEqual(f.outputs.at(-1), { ok: true, schemaVersion: 1, revision: 0, courses: [] });
  await assert.rejects(readFile(path.join(f.systemRoot, "training/catalogue.json")), { code: "ENOENT" });
  await assert.rejects(f.run("install-topic", f.root, f.systemRoot), { code: "ENOENT" });
  await mkdir(f.systemRoot);
  await assert.rejects(f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, "0"));
  await f.run("install-topic", f.root, f.systemRoot);
  const first = f.outputs.at(-1);
  assert.equal(first.installed, true);
  assert.equal(first.pin.commit, f.git("rev-parse", "HEAD"));
  assert.equal(first.pin.repository, "example/learn-test-topic");
  const snapshot = path.join(f.systemRoot, "training/content/test-topic", first.pin.commit);
  assert.deepEqual(JSON.parse(await readFile(path.join(snapshot, "pin.json"), "utf8")), first.pin);
  await f.run("installed-courses", f.systemRoot);
  assert.equal(f.outputs.at(-1).courses.length, 0, "installing never enables a course");
  await f.run("install-topic", f.root, f.systemRoot);
  assert.equal(f.outputs.at(-1).installed, false);
  assert.deepEqual(f.outputs.at(-1).pin, first.pin);
  await f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, "0");
  assert.equal(f.outputs.at(-1).revision, 1);
  assert.equal(f.outputs.at(-1).entry.enabled, true);
  await assert.rejects(f.run("disable-course", f.course.courseId, f.course.release, f.systemRoot, "0"),
    { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT" });
  await f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, "1");
  assert.equal(f.outputs.at(-1).changed, false);
  await f.run("disable-course", f.course.courseId, f.course.release, f.systemRoot, "1");
  assert.equal(f.outputs.at(-1).revision, 2);
  assert.equal(f.outputs.at(-1).entry.enabled, false);
  await f.run("installed-courses", f.systemRoot);
  assert.equal(f.outputs.at(-1).revision, 2);
  assert.equal(f.outputs.at(-1).courses[0].enabled, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(snapshot, "pin.json"), "utf8")), first.pin,
    "disabling retains the exact installed pin for existing attempts");
  assert.deepEqual(await readFile(f.coursePath), courseBefore);
  assert.deepEqual(await readFile(f.lockPath), lockBefore);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(f.git("remote"), "", "local provisioning never publishes a remote source");
});

test("operator CLI refuses malformed revisions aliases dirty sources and changed releases without repair", async t => {
  const f = await operatorFixture(t);
  await mkdir(f.systemRoot);
  for (const revision of ["", "-1", "1.5", "+1", "01", "9007199254740992"]) {
    await assert.rejects(f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, revision), /Usage/u);
    await assert.rejects(f.run("disable-course", f.course.courseId, f.course.release, f.systemRoot, revision), /Usage/u);
  }
  for (const args of [["install-topic", f.root], ["installed-courses", f.systemRoot, "extra"],
    ["enable-course", f.coursePath, f.lockPath, f.systemRoot, "0", "extra"],
    ["disable-course", f.course.courseId, f.course.release, f.systemRoot]]) await assert.rejects(f.run(...args), /Usage/u);
  await assert.rejects(readFile(path.join(f.systemRoot, "training/catalogue.json")), { code: "ENOENT" });
  const alias = path.join(f.owner, "system-alias");
  await symlink(f.systemRoot, alias, "dir");
  await assert.rejects(f.run("installed-courses", alias), { code: "VIBE64_TRAINING_CATALOGUE_INVALID" });
  await assert.rejects(f.run("install-topic", f.root, alias), /alias/u);
  await f.write("training/checks/response.mjs", "// Changed after the pin\n");
  await assert.rejects(f.run("install-topic", f.root, f.systemRoot), /Commit the topic/u);
  await assert.rejects(readFile(path.join(f.systemRoot, "training/catalogue.json")), { code: "ENOENT" });
  await f.write("training/checks/response.mjs", "// Pinned response check\n");
  await f.run("install-topic", f.root, f.systemRoot);
  await f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, "0");
  await writeFile(f.coursePath, JSON.stringify({ ...f.course, title: "Different approved definition" }));
  await assert.rejects(f.run("enable-course", f.coursePath, f.lockPath, f.systemRoot, "1"),
    { code: "VIBE64_TRAINING_COURSE_RELEASE_CONFLICT" });
  const cataloguePath = path.join(f.systemRoot, "training/catalogue.json");
  await writeFile(cataloguePath, "{broken");
  await assert.rejects(f.run("installed-courses", f.systemRoot), { code: "VIBE64_TRAINING_CATALOGUE_INVALID" });
  assert.equal(await readFile(cataloguePath, "utf8"), "{broken", "a read never repairs invalid operator state");
});
