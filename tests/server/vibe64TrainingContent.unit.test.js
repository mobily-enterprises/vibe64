import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { bundleFiles, canonicalJson, validateTopic } from "../../packages/vibe64-training/src/server/content.js";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { installVibe64ManagedExecutionProvider, runCaptureCommand } from "../../packages/vibe64-execution/src/server/index.js";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { splitStepBeats } from "../../packages/vibe64-training/src/shared/beats.js";

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

test("an exercise lesson may declare a small list of in-app request routes for Learning watches", async t => {
  const f = await fixture(t);
  const appRoutes = [{ method: "POST", path: "/api/notes" }, { method: "DELETE", path: "/api/notes/:id" }];
  await f.write("training/lessons/LESSON-01/lesson.json", { ...f.lesson, appRoutes });
  const bundle = (await validateTopic(f.root)).bundles[0];
  assert.deepEqual(bundle.lesson.appRoutes, appRoutes);
  const cases = [
    [lesson => { delete lesson.exercise; delete lesson.checks; lesson.assessments = [lesson.assessments[0]]; },
      /declare app routes only with its exercise/u],
    [lesson => lesson.appRoutes = [{ method: "GET", path: "/api/notes" }], /validation/iu],
    [lesson => lesson.appRoutes = [{ method: "POST", path: "/api/notes?draft=1" }], /validation/iu],
    [lesson => lesson.appRoutes = [{ method: "POST", path: "/api/notes/" }], /app route path/u],
    [lesson => lesson.appRoutes = [{ method: "POST", path: "/api/:noteId" }], /app route path/u],
    [lesson => lesson.appRoutes = [appRoutes[0], { ...appRoutes[0] }], /duplicate app route/u]
  ];
  for (const [change, expected] of cases) {
    const lesson = structuredClone({ ...f.lesson, appRoutes });
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

test("authoring CLI refuses retired v1 lessons; bundling (the installer's path) keeps exact files and existing output", async t => {
  const f = await fixture(t);
  const output = `${f.root}-bundle`;
  t.after(() => rm(output, { recursive: true, force: true }));
  await assert.rejects(() => runTrainingCli(["validate", f.root], { write() {} }), /Lesson LESSON-01 uses retired lesson format 1/u);
  const { hash } = (await validateTopic(f.root)).bundles[0];
  await assert.rejects(() => runTrainingCli(["publish", f.root]), /Usage/u);
  await assert.rejects(() => runTrainingCli(["bundle", f.root, path.join(f.root, "output")]), /outside/u);
  await runTrainingCli(["bundle", f.root, output], { write() {} });
  const bundled = JSON.parse(await readFile(path.join(output, "bundle.json"), "utf8"));
  assert.equal(bundled.lessons[0].hash, hash);
  assert.equal(await readFile(path.join(output, "files/training/exercises/app/server.mjs"), "utf8"), "// Exercise server\n");
  await assert.rejects(() => runTrainingCli(["bundle", f.root, output]), { code: "EEXIST" });
  assert.equal(JSON.parse(await readFile(path.join(output, "bundle.json"), "utf8")).lessons[0].hash, hash);
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

test("pinned blob batches retain binary/newline identity, bounded execution and every corruption refusal", async t => {
  const f = await fixture(t);
  await f.write("package.json", { name: "learn-test-topic", version: "0.1.0",
    repository: { url: "https://github.com/example/learn-test-topic.git" }, vibe64Training: f.topic });
  await writeFile(path.join(f.root, "training/exercises/app/binary\nasset.bin"), Buffer.from([0, 255, 10, 13, 128]));
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8" }).trim();
  git("init", "--initial-branch=main"); git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Pinned binary inputs");
  const requests = [];
  let corrupt = null;
  const release = installVibe64ManagedExecutionProvider({
    async runCommand(request, context) {
      requests.push(request);
      const result = await runCaptureCommand(context.localPath || request.command, request.args,
        { ...request, cwd: context.cwd, env: context.env });
      if (corrupt && request.args.includes("--batch")) {
        result.stdout = corrupt(Buffer.from(result.stdout, "base64")).toString("base64");
      }
      return result;
    }, async stopExecution() { return { ok: true }; }
  });
  t.after(release);
  const pinned = await readPinnedTopic(f.root);
  assert.equal(pinned.topicHash, (await validateTopic(f.root)).topicHash);
  assert.equal(requests.length, 7, "one original proof uses one blob batch and retains all six surrounding Git reads");
  const batch = requests.find(request => request.args.includes("--batch"));
  assert.ok(batch.input.includes("binary\nasset.bin\0"));
  assert.equal(batch.outputEncoding, "base64");
  assert.equal(batch.maxBuffer, 2 * 1024 * 1024);
  assert.deepEqual(batch.allowedRoots, [f.root]);
  for (const change of [
    () => Buffer.from("missing\0"),
    bytes => bytes.subarray(0, bytes.length - 1),
    bytes => Buffer.concat([bytes, Buffer.from("trailing")]),
    bytes => { bytes[bytes.indexOf(0) + 1] ^= 1; return bytes; },
    bytes => Buffer.from(bytes.toString("latin1").replace(" blob ", " tree "), "latin1")
  ]) {
    corrupt = change;
    await assert.rejects(() => readPinnedTopic(f.root), /pinned commit|trailing data/u);
  }
  corrupt = null;
  git("update-index", "--assume-unchanged", "training/checks/response.mjs");
  await f.write("training/checks/response.mjs", "// A transient edit hidden from status\n");
  assert.equal(git("status", "--porcelain"), "");
  await assert.rejects(() => readPinnedTopic(f.root), /differs from its pinned commit/u);
  git("update-index", "--no-assume-unchanged", "training/checks/response.mjs");
  git("restore", "training/checks/response.mjs");
  await writeFile(path.join(f.root, "training/exercises/app/large.bin"), Buffer.alloc(1024 * 1024, 255));
  git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "Maximum valid input");
  requests.length = 0;
  await readPinnedTopic(f.root);
  assert.ok(requests.filter(request => request.args.includes("--batch")).length > 1);
  assert.ok(requests.every(request => request.maxBuffer <= 2 * 1024 * 1024));
});

test("publish-manifest writes a pinned whole-topic lock without changing source or publishing remotely", async t => {
  const f = await stepsTopic(t);
  const course = { schemaVersion: 1, courseId: "first-course", title: "First", release: "0.1.0", status: "preview", topics: [{ topicId: "steps", release: "0.1.0" }] };
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
  const v1 = await fixture(t);
  await assert.rejects(() => runTrainingCli(["publish-manifest", filename, v1.root]), /retired lesson format 1/u,
    "a course release never publishes a v1 lesson");
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
  // An already-published lock of v1 content: operators still install existing releases.
  await writeFile(lockPath, `${canonicalJson(createCourseLock(course, [await readPinnedTopic(f.root)]))}\n`);
  const outputs = [];
  const run = (...args) => runTrainingCli(args, { write: text => outputs.push(JSON.parse(text)) });
  return { ...f, git, owner, course, coursePath, lockPath, systemRoot: path.join(owner, "system"), outputs, run };
}

test("operator CLI separately installs exact committed content and enables, disables or removes with fresh catalogue CAS", async t => {
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
  await assert.rejects(f.run("remove-course", f.course.courseId, f.course.release, f.systemRoot, "1"),
    { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT" });
  await f.run("remove-course", f.course.courseId, f.course.release, f.systemRoot, "2");
  assert.deepEqual([f.outputs.at(-1).revision, f.outputs.at(-1).changed], [3, true]);
  await f.run("installed-courses", f.systemRoot);
  assert.deepEqual(f.outputs.at(-1), { ok: true, schemaVersion: 1, revision: 3, courses: [] },
    "removing the last release leaves an empty catalogue at a later revision");
  await assert.rejects(f.run("remove-course", f.course.courseId, f.course.release, f.systemRoot, "3"),
    { code: "VIBE64_TRAINING_COURSE_MISSING" });
  assert.deepEqual(JSON.parse(await readFile(path.join(snapshot, "pin.json"), "utf8")), first.pin,
    "removing a release keeps the installed topic content for saved attempts");
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
    await assert.rejects(f.run("remove-course", f.course.courseId, f.course.release, f.systemRoot, revision), /Usage/u);
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

// Lesson format v3 (steps and a stage). The fixture is a complete topic with every check kind.
const stepsFixture = path.resolve(import.meta.dirname, "../fixtures/training/steps-v3");

async function stepsTopic(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-steps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(stepsFixture, root, { recursive: true });
  const lesson = JSON.parse(await readFile(path.join(root, "lesson.json"), "utf8"));
  async function write(filename, value) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  }
  return { root, lesson, write };
}

test("a v3 lesson bundles its steps, notes and step bodies into lesson identity", async t => {
  const f = await stepsTopic(t);
  const first = (await validateTopic(f.root)).bundles[0];
  assert.equal(first.lesson.schemaVersion, 3);
  assert.equal(first.lesson.stage, "project");
  assert.deepEqual(first.lesson.steps.map(step => [step.id, step.check.kind, step.required]),
    [["open-preview", "auto", true], ["which-side", "choice", true], ["require-title", "auto", true],
      ["reflect", "self", false], ["read-more", "none", false]]);
  assert.deepEqual(first.lesson.steps[1].check.answer, [1], "the authoring bundle keeps the answer for the server");
  const paths = first.manifest.files.map(file => file.path);
  for (const expected of ["lesson.json", "notes.md", "steps/open-preview.md", "steps/read-more.md", "app/notes.mjs",
    "checks/notes/title.mjs", "visuals/flow/diagram.svg"]) assert.ok(paths.includes(expected), expected);
  assert.ok(!paths.some(file => file.endsWith("lesson.md")), "v2 has no teaching document");
  await f.write("unrelated.md", "Not declared\n");
  assert.equal((await validateTopic(f.root)).bundles[0].hash, first.hash);
  for (const filename of ["steps/which-side.md", "notes.md"]) {
    const previous = await readFile(path.join(f.root, filename), "utf8");
    await f.write(filename, `${previous}More.\n`);
    assert.notEqual((await validateTopic(f.root)).bundles[0].hash, first.hash, filename);
    await f.write(filename, previous);
  }
  // Two steps may share one body file; it is recorded once.
  const shared = structuredClone(f.lesson);
  shared.steps[4].body = shared.steps[3].body;
  await f.write("lesson.json", shared);
  const sharedBundle = (await validateTopic(f.root)).bundles[0];
  assert.equal(sharedBundle.manifest.files.filter(file => file.path === "steps/reflect.md").length, 1);
});

test("v3 step rules reject invalid references, kinds, choices, guides and visual commands", async t => {
  const f = await stepsTopic(t);
  const step = index => lesson => lesson.steps[index];
  const cases = [
    [lesson => lesson.steps.push(structuredClone(lesson.steps[0])), /duplicate ID/u],
    [lesson => { lesson.steps[0].id = "1-bad"; }, /invalid or duplicate ID/u],
    [lesson => { lesson.steps = []; }, /at least one step/u],
    [lesson => { lesson.steps = Array.from({ length: 33 }, (_, index) => ({ ...lesson.steps[3], id: `s${index}` })); }, /validation/iu],
    [lesson => lesson.steps.forEach(value => { value.required = false; }), /needs a required step/u],
    [lesson => { step(4)(lesson).required = true; }, /no check and cannot be required/u],
    [lesson => { step(0)(lesson).visual.id = "missing"; }, /undeclared visual/u],
    [lesson => { step(0)(lesson).visual.play[0].name = "jump"; }, /undeclared command/u],
    [lesson => { step(0)(lesson).visual.play[0].parameters = {}; }, /needs parameter label/u],
    [lesson => { step(0)(lesson).visual.play[0].parameters.label = "x".repeat(33); }, /at most 32 characters/u],
    [lesson => { step(0)(lesson).visual.play[0].parameters.colour = "red"; }, /undeclared parameter/u],
    [lesson => { step(0)(lesson).visual.play[0].parameters.label = 1; }, /noncanonical|validation|string/iu],
    [lesson => { step(0)(lesson).visual.play = Array.from({ length: 17 }, () => step(0)(lesson).visual.play[0]); }, /validation/iu],
    [lesson => { step(0)(lesson).guide.target = "nowhere"; }, /guide: Use one of this installation's guide places/u],
    [lesson => { step(0)(lesson).guide.filePath = "notes.mjs"; }, /filePath is only for the files place/u],
    [lesson => { step(2)(lesson).guide.filePath = "../escape.mjs"; }, /guide: Use a relative/u],
    [lesson => { step(0)(lesson).guide.caption = "x".repeat(257); }, /validation/iu],
    [lesson => { step(0)(lesson).guide.highlight = false; }, /validation/iu],
    [lesson => { step(0)(lesson).check.kind = "rubric"; }, /validation/iu],
    [lesson => { step(0)(lesson).check.check = "missing"; }, /unknown check/u],
    [lesson => { delete step(0)(lesson).check.check; }, /unknown check/u],
    [lesson => { step(0)(lesson).check.files = ["notes.mjs"]; }, /only a code check edits files/u],
    [lesson => { step(2)(lesson).check.files = []; }, /code check needs 1-8 exercise files/u],
    [lesson => { step(2)(lesson).check.files = ["missing.mjs"]; }, /outside its bundled exercise/u],
    [lesson => { step(2)(lesson).check.files = ["../lesson.json"]; }, /outside its bundled exercise/u],
    [lesson => { step(2)(lesson).check.files = ["notes.mjs", "notes.mjs"]; }, /repeats a declared file/u],
    [lesson => { delete lesson.exercise; lesson.stage = "studio"; }, /needs the lesson's exercise/u],
    [lesson => { step(1)(lesson).check.options = ["Only one"]; }, /2-8 options/u],
    [lesson => { step(1)(lesson).check.answer = [3]; }, /option indexes within its options/u],
    [lesson => { step(1)(lesson).check.answer = [1, 1]; }, /unique option indexes/u],
    [lesson => { step(1)(lesson).check.answer = []; }, /option indexes/u],
    [lesson => { step(1)(lesson).check.answer = [-1]; }, /validation/iu],
    [lesson => { delete step(1)(lesson).check.question; }, /needs question, options and answer/u],
    [lesson => { step(3)(lesson).check.question = "Why?"; }, /self check cannot declare question/u],
    [lesson => { step(4)(lesson).check.check = "app-response"; }, /none check cannot declare check/u],
    [lesson => { step(1)(lesson).check.check = "app-response"; }, /choice check cannot declare check/u],
    [lesson => { lesson.document = "notes.md"; }, /validation/iu],
    [lesson => { lesson.assessments = []; }, /validation/iu],
    [lesson => { step(0)(lesson).rubric = "steps/open-preview.md"; }, /validation/iu],
    [lesson => { lesson.schemaVersion = 4; }, /validation/iu],
    [lesson => { delete lesson.stage; }, /validation/iu],
    [lesson => { lesson.stage = "garden"; }, /validation/iu],
    [lesson => { delete lesson.exercise; lesson.steps = lesson.steps.filter(value => value.id === "which-side"); delete lesson.checks; },
      /a project lesson needs its exercise/u],
    [lesson => { step(3)(lesson).check = { kind: "fact", fact: "deployment-live" }; }, /checks an unknown fact/u],
    [lesson => { step(3)(lesson).check = { kind: "fact" }; }, /checks an unknown fact/u],
    [lesson => { step(3)(lesson).check = { kind: "fact", fact: "ai-ready", rubric: "x" }; }, /fact check cannot declare rubric/u],
    [lesson => { step(0)(lesson).body = "steps/missing.md"; }, /ENOENT/u],
    [lesson => { lesson.notes = "../../outside.md"; }, /escapes topic/u]
  ];
  for (const [change, expected] of cases) {
    const lesson = structuredClone(f.lesson);
    change(lesson);
    await f.write("lesson.json", lesson);
    await assert.rejects(() => validateTopic(f.root), expected, String(change));
  }
});

test("v3 step beats end the step body and validate their grammar, places and the step's own check", async t => {
  const f = await stepsTopic(t);
  const reflect = "# Say it in your words\n\nTick Done when you can.\n";
  const beats = lines => `${reflect}\n\`\`\`beats\n${lines.join("\n")}\n\`\`\`\n`;
  await f.write("steps/reflect.md", beats(["show preview: This is your app, running.", "show chat: You ask for changes here.",
    "do send-message: Ask it: \"Make the heading green\"", "do file-opened public/index.html: Open the page file.",
    "check done: Press Done when the heading is green."]));
  assert.equal((await validateTopic(f.root)).bundles[0].lesson.steps[3].id, "reflect", "a valid beats block bundles");
  const tooMany = Array.from({ length: 9 }, () => "show preview: Look.");
  const cases = [
    [["point preview: Look."], /beats: beat 1 must read/u],
    [["show nowhere: Look."], /names an unknown place/u],
    [["show preview:"], /needs its text/u],
    [[`show preview: ${"x".repeat(161)}`], /longer than 160/u],
    [["show preview extra: Look."], /takes no argument/u],
    [["do file-opened ../escape.mjs: Open it."], /relative practice project file path/u],
    [["do dashboard: Go there."], /nothing the learner can do or be at/u],
    [["do send-message: Ask it to make the heading green."], /exactly one quoted prompt/u],
    [["do send-message: \"One\" and \"two\""], /exactly one quoted prompt/u],
    [["check grade: Done."], /check auto, review, done or fact/u],
    [["check done: Done.", "show preview: Look."], /at most one check beat, and it is the last/u],
    [["check done: Done.", "check done: Again."], /at most one check beat/u],
    [["check auto: Checked."], /does not match its self check/u],
    [tooMany, /1 to 8 beats/u]
  ];
  for (const [lines, expected] of cases) {
    await f.write("steps/reflect.md", beats(lines));
    await assert.rejects(() => validateTopic(f.root), expected, lines.join(" | "));
  }
  await f.write("steps/reflect.md", `${reflect}\n\`\`\`beats\nshow preview: Look.\n`);
  await assert.rejects(() => validateTopic(f.root), /not closed/u);
  await f.write("steps/reflect.md", `\`\`\`beats\nshow preview: Look.\n\`\`\`\n\nMore text.\n`);
  await assert.rejects(() => validateTopic(f.root), /must end the step text/u);
  // Beats replace a guide; practice project places need the exercise.
  await f.write("steps/reflect.md", reflect);
  await f.write("steps/open-preview.md", beats(["show preview: Look."]));
  await assert.rejects(() => validateTopic(f.root), /both beats and a guide/u);
  const lesson = structuredClone(f.lesson);
  delete lesson.steps[0].guide;
  await f.write("lesson.json", lesson);
  assert.equal((await validateTopic(f.root)).bundles[0].lesson.steps[0].id, "open-preview");
  const noProject = structuredClone(f.lesson);
  noProject.stage = "studio";
  delete noProject.exercise;
  noProject.steps = noProject.steps.filter(step => ["which-side", "reflect", "read-more"].includes(step.id));
  delete noProject.checks;
  await f.write("lesson.json", noProject);
  await f.write("steps/reflect.md", beats(["show lesson-bar: This bar walks you through each step.", "do courses: Open Courses.",
    "do colleague: Open Colleague.", "do colleague-minimised: Minimise it.", "do learning: Press L twice.", "check done: Press Done."]));
  assert.equal((await validateTopic(f.root)).bundles[0].lesson.steps.length, 3, "lesson places need no practice project");
  await f.write("steps/reflect.md", beats(["show preview: Look."]));
  await assert.rejects(() => validateTopic(f.root), /beat show preview needs the lesson's exercise/u);
});

test("a step lesson descriptor holding answers cannot be served as a body, notes, visual or exercise file", async t => {
  const f = await stepsTopic(t);
  const cases = [
    lesson => { lesson.steps[3].body = "lesson.json"; },
    lesson => { lesson.notes = "lesson.json"; },
    lesson => { lesson.exercise.source = "."; lesson.steps[2].check.files = ["app/notes.mjs"]; }
  ];
  for (const change of cases) {
    const lesson = structuredClone(f.lesson);
    change(lesson);
    await f.write("lesson.json", lesson);
    await assert.rejects(() => validateTopic(f.root), /descriptor cannot also be/u, String(change));
  }
  await f.write("lesson.json", f.lesson);
  const visual = JSON.parse(await readFile(path.join(f.root, "visuals/flow/visual.json"), "utf8"));
  await f.write("visuals/flow/visual.json", { ...visual, assets: ["../../lesson.json"] });
  await assert.rejects(() => validateTopic(f.root), /descriptor cannot also be/u);
});

test("one topic may mix v1 history lessons with v3 step lessons", async t => {
  const f = await stepsTopic(t);
  const metadata = JSON.parse(await readFile(path.join(f.root, "package.json"), "utf8"));
  await cp(path.resolve(import.meta.dirname, "../fixtures/training/code-practical"), path.join(f.root, "v1"), { recursive: true });
  metadata.vibe64Training.lessons.unshift({ code: "CODE-ONE", descriptor: "v1/lesson.json", status: "published", required: false });
  await f.write("package.json", metadata);
  const result = await validateTopic(f.root);
  assert.deepEqual(result.bundles.map(bundle => [bundle.lesson.code, bundle.lesson.schemaVersion]), [["CODE-ONE", 1], ["STEPS-ONE", 3]]);
  assert.ok(result.bundles[0].lesson.assessments);
  assert.equal(result.bundles[1].lesson.assessments, undefined);
});

test("authoring CLI validates, bundles and publishes a course lock for a v3 topic", async t => {
  const f = await stepsTopic(t);
  const messages = [];
  await runTrainingCli(["validate", f.root], { write: text => messages.push(JSON.parse(text)) });
  assert.deepEqual(messages[0].lessons.map(lesson => [lesson.code, lesson.schemaVersion, lesson.stage, lesson.steps]), [["STEPS-ONE", 3, "project", 5]]);
  const output = `${f.root}-bundle`;
  t.after(() => rm(output, { recursive: true, force: true }));
  await runTrainingCli(["bundle", f.root, output], { write() {} });
  const bundled = JSON.parse(await readFile(path.join(output, "bundle.json"), "utf8"));
  assert.equal(bundled.lessons[0].hash, messages[0].lessons[0].hash);
  assert.equal(await readFile(path.join(output, "files/steps/which-side.md"), "utf8"),
    await readFile(path.join(f.root, "steps/which-side.md"), "utf8"));
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main"); git("add", ".");
  git("-c", "user.name=Training fixture", "-c", "user.email=training@example.invalid", "commit", "-m", "v3 topic");
  const catalogue = await mkdtemp(path.join(os.tmpdir(), "vibe64-training-catalogue-"));
  t.after(() => rm(catalogue, { recursive: true, force: true }));
  const course = { schemaVersion: 1, courseId: "steps-course", title: "Steps", release: "0.1.0", status: "preview", topics: [{ topicId: "steps", release: "0.1.0" }] };
  await writeFile(path.join(catalogue, "course.json"), JSON.stringify(course));
  await runTrainingCli(["publish-manifest", path.join(catalogue, "course.json"), f.root], { write() {} });
  const lock = JSON.parse(await readFile(path.join(catalogue, "course.lock.json"), "utf8"));
  assert.deepEqual(lock.topics[0].lessons.map(lesson => [lesson.code, lesson.hash]), [["STEPS-ONE", messages[0].lessons[0].hash]]);
});

test("authoring refuses retired lesson formats; installed v2 snapshots still validate", async t => {
  const f = await stepsTopic(t);
  const retired = structuredClone(f.lesson);
  retired.schemaVersion = 2;
  delete retired.stage;
  await f.write("lesson.json", retired);
  assert.equal((await validateTopic(f.root)).bundles[0].lesson.schemaVersion, 2, "an installed v2 snapshot still verifies");
  await assert.rejects(() => validateTopic(f.root, { authoring: true }), /retired lesson format 2\. Author it in format 3/u);
  retired.steps[3].check = { kind: "fact", fact: "ai-ready" };
  await f.write("lesson.json", retired);
  await assert.rejects(() => validateTopic(f.root), /fact check needs lesson format 3/u);
});

test("an installed snapshot keeps a lesson this Vibe64 cannot teach, with its problem; authoring and installing refuse it", async t => {
  const f = await stepsTopic(t);
  await f.write("steps/read-more.md", "# Read more\n\n```beats\ndo app-deployed: Deploy it.\n```\n");
  for (const options of [{}, { authoring: true }]) {
    await assert.rejects(() => validateTopic(f.root, options), /do app-deployed\) names nothing the learner can do/u);
  }
  const [bundle] = (await validateTopic(f.root, { installed: true })).bundles;
  assert.match(bundle.problem, /Lesson STEPS-ONE: step read-more beats: .*names nothing the learner can do/u);
  assert.equal(bundle.lesson.title, f.lesson.title, "the lesson keeps its identity and title");
  await f.write("steps/read-more.md", "# Read more\n");
  assert.equal(Object.hasOwn((await validateTopic(f.root, { installed: true })).bundles[0], "problem"), false);
});

test("a studio lesson checks facts and names host places its topic declares", async t => {
  const f = await stepsTopic(t);
  const studio = { schemaVersion: 3, code: "STEPS-ONE", title: "Your workspace", stage: "studio", prerequisites: [],
    estimatedMinutes: 5, visuals: [], steps: [
      { id: "ai", title: "Your AI", body: "steps/reflect.md", check: { kind: "fact", fact: "ai-ready" }, required: true },
      { id: "users", title: "People", body: "steps/read-more.md", check: { kind: "self" }, required: false }] };
  await f.write("lesson.json", studio);
  const beats = (body, lines) => `${body}\n\n\`\`\`beats\n${lines.join("\n")}\n\`\`\`\n`;
  await f.write("steps/reflect.md", beats("# Your AI", ["show account-menu: Your AI lives here.", "check fact: Press Check when your AI is set up."]));
  await f.write("steps/read-more.md", beats("# People", ["show manage-users: Add the people you work with.", "do app-deployed: Deploy it.", "check done: Done."]));
  await assert.rejects(() => validateTopic(f.root), /show manage-users\) names an unknown place/u);
  const metadata = JSON.parse(await readFile(path.join(f.root, "package.json"), "utf8"));
  await f.write("package.json", { ...metadata, vibe64Training: { ...metadata.vibe64Training, places: ["manage-users"] } });
  await assert.rejects(() => validateTopic(f.root), /do app-deployed\) names nothing the learner can do/u);
  await f.write("package.json", { ...metadata, vibe64Training: { ...metadata.vibe64Training, places: ["manage-users"],
    activities: ["app-deployed"], facts: ["deployment-live"] } });
  const lesson = (await validateTopic(f.root)).bundles[0].lesson;
  assert.deepEqual(lesson.steps.map(step => step.check.kind), ["fact", "self"]);
  studio.steps[1].check = { kind: "fact", fact: "deployment-live" };
  await f.write("lesson.json", studio);
  await f.write("steps/read-more.md", "# People\n");
  assert.equal((await validateTopic(f.root)).bundles[0].lesson.steps[1].check.fact, "deployment-live", "a declared host fact");
  // A studio lesson without a practice project cannot use project places or project checks.
  await f.write("steps/read-more.md", beats("# People", ["show preview: Your app.", "check fact: Check."]));
  await assert.rejects(() => validateTopic(f.root), /beat show preview needs the lesson's exercise/u);
  studio.steps[1].check = { kind: "review", rubric: "It works." };
  await f.write("lesson.json", studio);
  await f.write("steps/read-more.md", "# People\n");
  await assert.rejects(() => validateTopic(f.root), /reviews practice work and needs the lesson's exercise/u);
});

test("a course orientation names one of its published lessons", async t => {
  const f = await stepsTopic(t);
  const result = await validateTopic(f.root);
  const resolved = { topicId: "steps", release: "0.1.0", repository: "examples/learn-steps-fixture", commit: "a".repeat(40),
    topicManifest: result.topicManifest, topicHash: result.topicHash };
  const course = { schemaVersion: 1, courseId: "steps-course", title: "Steps", release: "0.1.0", status: "preview",
    topics: [{ topicId: "steps", release: "0.1.0" }] };
  assert.equal(createCourseLock({ ...course, orientation: "STEPS-ONE" }, [resolved]).courseId, "steps-course");
  assert.throws(() => createCourseLock({ ...course, orientation: "MISSING" }, [resolved]), /orientation MISSING must be a published lesson/u);
});

test("a check review beat takes no text: the bar shows the step's rubric", () => {
  const block = lines => `Do it.\n\n\`\`\`beats\n${lines.join("\n")}\n\`\`\`\n`;
  assert.deepEqual(splitStepBeats(block(["do chat: Ask for it.", "check review"])).beats.at(-1), { kind: "check", target: "review", text: "" });
  assert.equal(splitStepBeats(block(["check review:"])).beats[0].text, "");
  assert.throws(() => splitStepBeats(block(["check review: The heading is green."])), /takes no text/u);
  assert.throws(() => splitStepBeats(block(["check done"])), /needs its text/u);
});
