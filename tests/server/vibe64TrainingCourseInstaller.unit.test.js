import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { createCourseLock, readPinnedTopic } from "../../packages/vibe64-training/src/server/catalogue.js";
import { createTrainingActions } from "../../packages/vibe64-training/src/server/actions.js";
import { createTrainingCourseInstaller } from "../../packages/vibe64-training/src/server/courseInstaller.js";
import { createInstalledTrainingCatalogue } from "../../packages/vibe64-training/src/server/installedCatalogue.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";

// Real local Git repositories stand in for GitHub: the installer's remote
// resolver maps each canonical owner/name slug to a file:// URL.
function git(cwd, ...args) {
  return execFileSync("/usr/bin/git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
    "-c", "user.name=Catalogue fixture", "-c", "user.email=catalogue@example.invalid", ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function write(base, filename, value) {
  const destination = path.join(base, filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t, { status = "released" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-course-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const topicRoot = path.join(root, "remotes", "learn-install-fixture");
  const catalogueRoot = path.join(root, "remotes", "catalogue");
  const executed = path.join(root, "authored-code-executed");
  await mkdir(systemRoot);
  await write(topicRoot, "package.json", { name: "learn-install-fixture", version: "0.1.0",
    repository: { type: "git", url: "https://github.com/examples/learn-install-fixture.git" },
    vibe64Training: { schemaVersion: 1, topicId: "install-fixture", domainId: "vibe64", title: "Install fixture", status,
      outline: "training/outline.md", prerequisites: [],
      lessons: [{ code: "USE-ONE", descriptor: "training/lessons/USE-ONE/lesson.json", status: "published", required: true }] } });
  await write(topicRoot, "training/outline.md", "# One lesson\nTry the application.\n");
  await write(topicRoot, "training/lessons/USE-ONE/lesson.json", { schemaVersion: 1, code: "USE-ONE", title: "Try the application",
    document: "lesson.md", prerequisites: [], estimatedMinutes: 5, visuals: [{ id: "request", descriptor: "../../visuals/request/visual.json" }],
    assessments: [{ id: "explain", kind: "answer", required: true, rubric: "lesson.md#explain" }] });
  await write(topicRoot, "training/lessons/USE-ONE/lesson.md", '# Try the app\n<a id="explain"></a>\nExplain what you tried.\n');
  await write(topicRoot, "training/visuals/request/visual.json", { schemaVersion: 1, id: "request", title: "One request", svg: "diagram.svg",
    controller: "controller.js", initialState: "overview", states: ["overview"], description: "A display-only request.", commands: [] });
  await write(topicRoot, "training/visuals/request/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Request</title></svg>');
  await write(topicRoot, "training/visuals/request/controller.js",
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(executed)}, "Authored code ran.");\n`);
  git(topicRoot, "init", "-q", "-b", "main");
  git(topicRoot, "add", ".");
  git(topicRoot, "commit", "-q", "-m", "Topic release");
  const resolved = await readPinnedTopic(topicRoot);
  const course = { schemaVersion: 1, courseId: "first-course", title: "First course", release: "0.1.0", status,
    topics: [{ topicId: resolved.topicId, release: resolved.release }] };
  const lock = createCourseLock(course, [resolved]);
  const domains = { schemaVersion: 1, domains: [{ domainId: "vibe64", title: "Vibe64" }, { domainId: "web", title: "The web" }] };
  const topics = { schemaVersion: 1, topics: [{ topicId: resolved.topicId, repository: resolved.repository, domainId: "vibe64",
    releases: [{ release: resolved.release, status, commit: resolved.commit, manifestHash: resolved.topicHash }] }] };
  async function publishCatalogue({ courseValue = course, lockValue = lock, domainsValue = domains, topicsValue = topics, courseDir = course.courseId } = {}) {
    await rm(path.join(catalogueRoot, "courses"), { recursive: true, force: true });
    await write(catalogueRoot, "domains.json", domainsValue);
    await write(catalogueRoot, "topics.json", topicsValue);
    await write(catalogueRoot, `courses/${courseDir}/course.json`, courseValue);
    await write(catalogueRoot, `courses/${courseDir}/course.lock.json`, lockValue);
    if (!git(catalogueRoot, "rev-parse", "--is-inside-work-tree").includes("true")) throw new Error("catalogue repository missing");
    git(catalogueRoot, "add", "-A");
    git(catalogueRoot, "commit", "-q", "--allow-empty", "-m", "Catalogue update");
  }
  await mkdir(catalogueRoot, { recursive: true });
  git(catalogueRoot, "init", "-q", "-b", "main");
  await publishCatalogue();
  const remotes = { "examples/vibe64-learning-catalog": catalogueRoot, "examples/learn-install-fixture": topicRoot };
  const commands = [];
  const runCommand = async request => {
    commands.push(request.args);
    return runVibe64Command(request);
  };
  const catalogue = createInstalledTrainingCatalogue({ systemRoot });
  const make = (options = {}) => createTrainingCourseInstaller({ systemRoot, catalogue, repository: "examples/vibe64-learning-catalog",
    runCommand, remoteUrl: slug => {
      if (!remotes[slug]) throw new Error(`No fixture remote for ${slug}`);
      return `file://${remotes[slug]}`;
    }, ...options });
  const scratch = async () => readdir(path.join(systemRoot, "training-sources")).catch(error => error.code === "ENOENT" ? [] : Promise.reject(error));
  return { root, systemRoot, topicRoot, catalogueRoot, executed, resolved, course, lock, domains, topics, publishCatalogue,
    remotes, commands, catalogue, make, scratch };
}

test("the available catalogue lists catalogue domains with each course's install state and installs nothing", async (t) => {
  const f = await fixture(t);
  const installer = f.make();
  const listed = await installer.listAvailable();
  assert.equal(listed.repository, "examples/vibe64-learning-catalog");
  assert.match(listed.commit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(listed.domains, f.domains.domains);
  assert.deepEqual(listed.courses, [{ courseId: "first-course", release: "0.1.0", title: "First course", status: "released",
    domainId: "vibe64", topics: [{ topicId: "install-fixture", release: "0.1.0" }], lessonCount: 1,
    installed: "not-installed", otherReleases: [], updateFrom: null, installing: null }]);
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  assert.deepEqual(await f.scratch(), []);
  // A brief cache serves repeated reads without another fetch.
  const fetches = f.commands.filter(args => args.includes("fetch")).length;
  await installer.listAvailable();
  assert.equal(f.commands.filter(args => args.includes("fetch")).length, fetches);
});

test("a course whose topics declare no domain is listed without one", async (t) => {
  const f = await fixture(t);
  await f.publishCatalogue({ topicsValue: { schemaVersion: 1, topics: f.topics.topics.map(({ domainId: _domain, ...topic }) => topic) } });
  const listed = await f.make().listAvailable();
  assert.equal(listed.courses[0].domainId, null);
});

test("invalid or unreachable catalogues fail closed with actionable errors", async (t) => {
  const f = await fixture(t);
  const cases = [
    { lockValue: { ...f.lock, topics: [{ ...f.lock.topics[0], repository: "examples/not-a-learning-topic" }] } },
    { lockValue: { ...f.lock, topics: [{ ...f.lock.topics[0], commit: "main" }] } },
    { lockValue: { ...f.lock, release: "0.2.0" } },
    { courseDir: "another-course" },
    { courseValue: { ...f.course, extra: true } },
    { topicsValue: { ...f.topics, topics: [{ ...f.topics.topics[0], domainId: "unknown" }] } },
    { domainsValue: { schemaVersion: 2, domains: [] } }
  ];
  for (const change of cases) {
    await f.publishCatalogue(change);
    await assert.rejects(f.make().listAvailable(), { code: "VIBE64_TRAINING_AVAILABLE_INVALID" }, JSON.stringify(change));
    await assert.rejects(f.make().installCourse({ courseId: "first-course", release: "0.1.0" }), { code: "VIBE64_TRAINING_AVAILABLE_INVALID" });
  }
  assert.deepEqual(await f.scratch(), []);
  const unreachable = f.make({ remoteUrl: () => `file://${path.join(f.root, "missing")}` });
  await assert.rejects(unreachable.listAvailable(), error => error.code === "VIBE64_TRAINING_AVAILABLE_UNREACHABLE" &&
    /internet access/u.test(error.message) && error.statusCode === 503);
  assert.deepEqual(await f.scratch(), []);
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  assert.throws(() => f.make({ repository: "https://example.com/other.git" }), /owner\/name/u);
});

test("installing a listed course verifies its exact topic pin, enables it once and is idempotent", async (t) => {
  const f = await fixture(t);
  const installer = f.make();
  const [first, concurrent] = await Promise.all([
    installer.installCourse({ courseId: "first-course", release: "0.1.0" }),
    installer.installCourse({ courseId: "first-course", release: "0.1.0" })
  ]);
  assert.equal(first, concurrent);
  assert.equal(first.changed, true);
  assert.equal(first.course.courseId, "first-course");
  const installed = await f.catalogue.readCatalogue();
  assert.equal(installed.revision, 1);
  assert.deepEqual(installed.courses.map(entry => [entry.course, entry.lock, entry.enabled]), [[f.course, f.lock, true]]);
  assert.deepEqual(await f.scratch(), [], "every scratch source is removed");
  await assert.rejects(readdir(f.executed), { code: "ENOENT" }, "installation runs no authored code");
  assert.equal((await installer.listAvailable()).courses[0].installed, "enabled");
  const fetches = f.commands.filter(args => args.includes("fetch")).length;
  const again = await installer.installCourse({ courseId: "first-course", release: "0.1.0" });
  assert.equal(again.changed, false);
  assert.equal((await f.catalogue.readCatalogue()).revision, 1);
  assert.equal(f.commands.filter(args => args.includes("fetch")).length, fetches + 1, "only the catalogue is reread");
});

test("an installed topic snapshot is reused when its course is enabled", async (t) => {
  const f = await fixture(t);
  await f.make().installCourse({ courseId: "first-course", release: "0.1.0" });
  const current = await f.catalogue.readCatalogue();
  await f.catalogue.disableCourse({ courseId: "first-course", release: "0.1.0", expectedRevision: current.revision });
  await assert.rejects(f.make().installCourse({ courseId: "first-course", release: "0.1.0", actor: { role: "member" } }),
    { code: "VIBE64_TRAINING_COURSE_DISABLED", statusCode: 409 });
  const installer = f.make();
  const before = f.commands.length;
  const result = await installer.installCourse({ courseId: "first-course", release: "0.1.0", actor: { role: "owner" } });
  assert.equal(result.changed, true);
  assert.equal(f.commands.slice(before).filter(args => args.includes("fetch")).length, 1, "the verified snapshot needs no topic download");
  assert.equal((await f.catalogue.readCatalogue()).courses[0].enabled, true);
});

test("lock, commit and manifest mismatches fail closed without enabling anything", async (t) => {
  const f = await fixture(t);
  const cases = [
    [{ ...f.lock.topics[0], manifestHash: "f".repeat(64) }, /conflicts with the approved owner pin/u],
    [{ ...f.lock.topics[0], commit: "e".repeat(40) }, { code: "VIBE64_TRAINING_TOPIC_UNREACHABLE" }]
  ];
  for (const [topic, expected] of cases) {
    await f.publishCatalogue({ lockValue: { ...f.lock, topics: [topic] } });
    await assert.rejects(f.make().installCourse({ courseId: "first-course", release: "0.1.0" }), expected);
    assert.deepEqual(await f.scratch(), []);
    assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  }
  // A later commit with different content cannot satisfy the original hash.
  await write(f.topicRoot, "training/outline.md", "# Changed\n");
  git(f.topicRoot, "commit", "-q", "-am", "Unreviewed change");
  const changed = git(f.topicRoot, "rev-parse", "HEAD");
  await f.publishCatalogue({ lockValue: { ...f.lock, topics: [{ ...f.lock.topics[0], commit: changed }] } });
  await assert.rejects(f.make().installCourse({ courseId: "first-course", release: "0.1.0" }), /conflicts with the approved owner pin/u);
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  assert.deepEqual(await f.scratch(), []);
});

test("a course outside the catalogue or an invalid identity is refused", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.make().installCourse({ courseId: "first-course", release: "9.9.9" }), { code: "VIBE64_TRAINING_COURSE_NOT_AVAILABLE", statusCode: 404 });
  await assert.rejects(f.make().installCourse({ courseId: "../escape", release: "0.1.0" }), { code: "VIBE64_TRAINING_COURSE_INVALID" });
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
});

test("a concurrent catalogue change is retried once against a fresh revision", async (t) => {
  const f = await fixture(t);
  let conflicts = 0;
  const catalogue = { ...f.catalogue, async enableCourse(input) {
    if (conflicts++ === 0) {
      throw Object.assign(new Error("changed"), { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT", statusCode: 409 });
    }
    return f.catalogue.enableCourse(input);
  } };
  const result = await f.make({ catalogue }).installCourse({ courseId: "first-course", release: "0.1.0" });
  assert.equal(result.changed, true);
  assert.equal(conflicts, 2);
  let always = 0;
  const conflicting = { ...f.catalogue, async enableCourse() {
    always += 1;
    throw Object.assign(new Error("changed"), { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT", statusCode: 409 });
  } };
  await f.catalogue.disableCourse({ courseId: "first-course", release: "0.1.0", expectedRevision: 1 });
  await assert.rejects(f.make({ catalogue: conflicting }).installCourse({ courseId: "first-course", release: "0.1.0", actor: { role: "owner" } }),
    { code: "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT" });
  assert.equal(always, 2);
});

test("catalogue actions require a signed-in user and report install results", async (t) => {
  const f = await fixture(t);
  const auth = { user: null };
  const actions = createActionCatalogue();
  const missing = { readCatalogue: f.catalogue.readCatalogue };
  const definitions = createTrainingActions({ catalogue: f.catalogue, learners: { readState() {} },
    courseInstaller: f.make() });
  actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({ ...definition, channels: ["api"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => auth.user, authorizeProject() { throw new Error("No project."); } });
  const execute = (name, input = {}) => actions.execute({ actionId: `vibe64.training.${name}`, input, context: { channel: "api", surface: "app" } });
  await assert.rejects(execute("available.list"), { code: "vibe64_auth_required" });
  await assert.rejects(execute("course.install", { courseId: "first-course", release: "0.1.0" }), { code: "vibe64_auth_required" });
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  auth.user = { uid: 42, username: "member", role: "member" };
  await assert.rejects(execute("course.install", { courseId: "first-course", release: "0.1.0", repository: "evil/learn-x" }), { code: "ACTION_VALIDATION_FAILED" });
  const listed = await execute("available.list");
  assert.equal(listed.ok, true);
  assert.equal(listed.courses[0].installed, "not-installed");
  const installed = await execute("course.install", { courseId: "first-course", release: "0.1.0" });
  assert.deepEqual({ ...installed, catalogueCommit: undefined }, { ok: true, available: true, changed: true, catalogueCommit: undefined, retired: [], revision: 1,
    course: { courseId: "first-course", release: "0.1.0", title: "First course", status: "released", enabled: true } });
  await assert.rejects(execute("course.install", { courseId: "first-course", release: "9.9.9" }), { code: "VIBE64_TRAINING_COURSE_NOT_AVAILABLE" });
  const unavailable = createActionCatalogue();
  unavailable.register({ contributorId: "training", domain: "training", actions: createTrainingActions({ catalogue: missing,
    learners: { readState() {} } }).map(definition => ({ ...definition, channels: ["api"], surfaces: ["app"] })) });
  registerVibe64ActionContext(unavailable, { resolveUser: async () => auth.user, authorizeProject() { throw new Error("No project."); } });
  const result = await unavailable.execute({ actionId: "vibe64.training.course.install", input: { courseId: "first-course", release: "0.1.0" },
    context: { channel: "api", surface: "app" } });
  assert.equal(result.ok, false);
  assert.equal(result.available, false);
});

test("an update installs the newer release and retires older releases for new starts only", async (t) => {
  const f = await fixture(t);
  const installer = f.make();
  await installer.installCourse({ courseId: "first-course", release: "0.1.0" });
  // A learner already started the 0.1.0 lesson.
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const learners = createTrainingLearnerState({ systemRoot: f.systemRoot, content });
  const actor = { uid: 42, username: "member", role: "member" };
  const oldLesson = f.lock.topics[0].lessons[0];
  const oldPin = { course: { courseId: "first-course", release: "0.1.0" },
    topic: { schemaVersion: 1, topicId: f.resolved.topicId, release: "0.1.0", repository: f.resolved.repository, commit: f.resolved.commit, topicHash: f.resolved.topicHash },
    lesson: { code: oldLesson.code, hash: oldLesson.hash } };
  const reserved = await learners.reserveAttempt({ actor, requestId: "start-old", expectedRevision: 0, pin: oldPin });

  // The catalogue publishes 0.2.0 with a changed lesson.
  const metadata = JSON.parse(git(f.topicRoot, "show", "HEAD:package.json"));
  await write(f.topicRoot, "package.json", { ...metadata, version: "0.2.0" });
  await write(f.topicRoot, "training/lessons/USE-ONE/lesson.md", '# Try the app\n<a id="explain"></a>\nExplain what you tried, in one sentence.\n');
  git(f.topicRoot, "commit", "-q", "-am", "Topic 0.2.0");
  const next = await readPinnedTopic(f.topicRoot);
  const course = { ...f.course, release: "0.2.0", topics: [{ topicId: next.topicId, release: "0.2.0" }] };
  const lock = createCourseLock(course, [next]);
  assert.notEqual(lock.topics[0].lessons[0].hash, oldLesson.hash);
  await f.publishCatalogue({ courseValue: course, lockValue: lock });

  const listed = (await f.make().listAvailable()).courses[0];
  assert.deepEqual([listed.release, listed.installed, listed.updateFrom, listed.otherReleases], ["0.2.0", "not-installed", "0.1.0", ["0.1.0"]]);
  const updated = await f.make().installCourse({ courseId: "first-course", release: "0.2.0" });
  assert.deepEqual([updated.changed, updated.retired], [true, ["0.1.0"]]);
  const installed = await f.catalogue.readCatalogue();
  assert.deepEqual(installed.courses.map(entry => [entry.course.release, entry.enabled]), [["0.1.0", false], ["0.2.0", true]]);
  const after = (await f.make().listAvailable()).courses[0];
  assert.deepEqual([after.installed, after.updateFrom], ["enabled", null]);

  // Nothing was deleted: the saved attempt keeps its pin, content and resume.
  const state = await learners.readState({ actor, includeCompletion: true });
  assert.deepEqual(state.active.pin, oldPin);
  await content.readTopic(oldPin.topic);
  const resumed = await learners.resumeAttempt({ actor, attemptId: reserved.attempt.attemptId });
  assert.equal(resumed.attempt.attemptId, reserved.attempt.attemptId);
  // The retired teaching brief read this pinned lesson; the installed-content
  // owner still serves the saved attempt's exact pinned lesson.
  const lesson = await content.readLesson({ ...state.active.pin.topic, lessonCode: state.active.pin.lesson.code,
    lessonHash: state.active.pin.lesson.hash });
  assert.equal(lesson.hash, oldLesson.hash);

  // Repeating the update changes nothing.
  assert.equal((await f.make().installCourse({ courseId: "first-course", release: "0.2.0" })).changed, false);
});

test("an install or update that would exceed the installed release limit fails closed", async (t) => {
  const f = await fixture(t);
  const filler = Array.from({ length: 16 }, (_, index) => ({ course: { courseId: `filler-${index}`, release: "1.0.0" }, enabled: false }));
  const catalogue = { ...f.catalogue, async readCatalogue(options) {
    const current = await f.catalogue.readCatalogue(options);
    return { ...current, courses: [...current.courses, ...filler] };
  } };
  await assert.rejects(f.make({ catalogue }).installCourse({ courseId: "first-course", release: "0.1.0" }),
    error => error.code === "VIBE64_TRAINING_COURSE_LIMIT" && /never deleted/u.test(error.message));
  assert.deepEqual((await f.catalogue.readCatalogue()).courses, []);
  assert.deepEqual(await f.scratch(), []);
});

test("a course release whose topic carries v2 step lessons installs and projects titles without answers", async (t) => {
  const f = await fixture(t);
  const metadata = JSON.parse(git(f.topicRoot, "show", "HEAD:package.json"));
  await write(f.topicRoot, "package.json", { ...metadata, version: "0.2.0" });
  await write(f.topicRoot, "training/lessons/USE-ONE/lesson.json", { schemaVersion: 2, code: "USE-ONE", title: "Try the application",
    prerequisites: [], estimatedMinutes: 5, visuals: [{ id: "request", descriptor: "../../visuals/request/visual.json" }],
    steps: [{ id: "look", title: "Look", body: "steps/look.md", visual: { id: "request" }, check: { kind: "self" }, required: true },
      { id: "which", title: "Which?", body: "steps/which.md", check: { kind: "choice", question: "Which one?", options: ["A", "B"], answer: [0] }, required: true }] });
  await write(f.topicRoot, "training/lessons/USE-ONE/steps/look.md", "Look at the request.\n");
  await write(f.topicRoot, "training/lessons/USE-ONE/steps/which.md", "Pick one.\n");
  git(f.topicRoot, "add", "-A");
  git(f.topicRoot, "commit", "-q", "-m", "Topic 0.2.0 in lesson format v2");
  const next = await readPinnedTopic(f.topicRoot);
  const course = { ...f.course, release: "0.2.0", topics: [{ topicId: next.topicId, release: "0.2.0" }] };
  const lock = createCourseLock(course, [next]);
  const topics = { ...f.topics, topics: [{ ...f.topics.topics[0], releases: [...f.topics.topics[0].releases,
    { release: "0.2.0", status: "released", commit: next.commit, manifestHash: next.topicHash }] }] };
  await f.publishCatalogue({ courseValue: course, lockValue: lock, topicsValue: topics });
  const installed = await f.make().installCourse({ courseId: "first-course", release: "0.2.0" });
  assert.equal(installed.changed, true);
  await assert.rejects(readdir(f.executed), { code: "ENOENT" }, "installation runs no authored code");
  const content = createInstalledTrainingContent({ systemRoot: f.systemRoot });
  const pin = { schemaVersion: 1, topicId: next.topicId, release: "0.2.0", repository: next.repository, commit: next.commit, topicHash: next.topicHash };
  const lesson = await content.readLesson({ ...pin, lessonCode: "USE-ONE", lessonHash: lock.topics[0].lessons[0].hash });
  assert.deepEqual(lesson.steps.map(step => step.id), ["look", "which"]);
  assert.equal(JSON.stringify(lesson).includes('"answer"'), false);
  const listed = (await f.catalogue.readCatalogue()).courses.find(entry => entry.course.release === "0.2.0");
  assert.equal(listed.enabled, true);
});
