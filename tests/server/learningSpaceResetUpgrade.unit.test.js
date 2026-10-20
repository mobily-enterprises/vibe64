import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resetLearningForLearningSpace } from "../../packages/vibe64-training/src/server/learningSpaceResetUpgrade.js";

const UPGRADE_ID = "20261022-learning-space-reset";
const learnerKey = Buffer.from("1001").toString("base64url");
const ids = {
  hosted: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unmarked: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  mismatched: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  github: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  local: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  space: "ffffffff-ffff-4fff-8fff-ffffffffffff"
};
const slug = id => `training-${id.replaceAll("-", "")}`;
const marker = attemptId => ({ schemaVersion: 1, learnerKey, attemptId,
  pin: { course: { courseId: "first-course", release: "0.1.0" }, topic: { schemaVersion: 1, topicId: "start", release: "0.1.0",
    repository: "vibe64/learn-start", commit: "a".repeat(40), topicHash: "b".repeat(64) }, lesson: { code: "V64-START-01", hash: "c".repeat(64) } },
  exercise: { kind: "bundled", sourcePath: "." } });
const spaceMarker = practiceId => {
  const { attemptId: _attemptId, ...rest } = marker(practiceId);
  return { ...rest, schemaVersion: 2, practiceId };
};

async function put(file, contents = "") {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

// Every path, type, mode, byte and link target below root.
async function treeHash(root) {
  const hash = createHash("sha256");
  async function walk(target, relative) {
    let info;
    try { info = await lstat(target); } catch (error) { if (error.code === "ENOENT") { hash.update(`${relative}:missing\n`); return; } throw error; }
    hash.update(`${relative}:${info.mode}:`);
    if (info.isSymbolicLink()) hash.update(`link:${await readlink(target)}\n`);
    else if (info.isFile()) hash.update(await readFile(target)).update("\n");
    else for (const name of (await readdir(target)).sort()) await walk(path.join(target, name), `${relative}/${name}`);
  }
  await walk(root, ".");
  return hash.digest("hex");
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-reset-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const projectsRoot = path.join(root, "projects");
  const managedSourceRoot = path.join(root, "managed");
  const backupRoot = path.join(systemRoot, "upgrades/backups", UPGRADE_ID, "training");
  const reports = [];
  const runtime = name => path.join(systemRoot, "projects", name);
  const retired = target => path.join(systemRoot, "training/retired", UPGRADE_ID, path.relative(systemRoot, target));
  async function project(name, record, namespace = path.join(projectsRoot, name)) {
    await put(path.join(runtime(name), "project.json"), JSON.stringify(record));
    await put(path.join(runtime(name), "sessions/active/working/conversation-log/transcript.json"), `{"messages":["${name} chat"]}`);
    await put(path.join(namespace, "sessions/working/source/index.js"), `// ${name} code\n`);
    return namespace;
  }
  // Normal projects are real data: none of these may change (G6).
  const normal = [];
  for (const [name, record, namespacePath] of [
    ["app", { repository: { mode: "managed_git", defaultBranch: "main" } }],
    [slug(ids.unmarked), { repository: { mode: "managed_git", defaultBranch: "main" } }],
    [slug(ids.mismatched), { repository: { mode: "managed_git" }, training: marker(ids.hosted) }],
    [slug(ids.github), { repository: { mode: "github" }, training: marker(ids.github) }],
    // A Learning v2 practice project keeps its runtime root in this inventory.
    [slug(ids.space), { repository: { mode: "managed_git" }, training: spaceMarker(ids.space) },
      path.join(projectsRoot, ".learning", learnerKey, ids.space, slug(ids.space))]
  ]) {
    const namespace = await project(name, record, namespacePath);
    await mkdir(path.join(namespace, "node_modules/.bin"), { recursive: true });
    await symlink("../pkg/cli.js", path.join(namespace, "node_modules/.bin/cli"));
    normal.push(namespace, runtime(name));
  }
  const userRoot = path.join(systemRoot, "training/users", learnerKey);
  for (const name of ["progress.json", "step-progress.json", "learning-mode.json", "teacher-notes.json", "state.lock",
    "teacher-notes.lock"]) {
    await put(path.join(userRoot, name), `{"file":"${name}"}`);
  }
  await put(path.join(userRoot, "learning-sessions", ids.local, "sessions/active/teacher/history.json"), "{}");
  await put(path.join(systemRoot, "author-preview/training/users", learnerKey, "progress.json"), "{}");
  // A v1 practice project archived as an ordinary project stays archived.
  const archived = path.join(systemRoot, "project-archives", slug(ids.unmarked), `20261001T000000Z-${slug(ids.unmarked)}`);
  await put(path.join(archived, "manifest.json"), "{}");
  normal.push(archived);
  const run = (options = {}) => resetLearningForLearningSpace({ systemRoot, managedSourceRoot, backupRoot, apply: false,
    report: (level, message) => reports.push({ level, message }), ...options });
  return { root, systemRoot, projectsRoot, managedSourceRoot, backupRoot, reports, runtime, retired, project, normal, userRoot, run };
}

async function hashes(paths) {
  return Promise.all(paths.map(treeHash));
}

test("check lists the exact practice projects and learner files and changes nothing; apply moves only them and keeps teacher notes", async t => {
  const f = await fixture(t);
  const practice = await f.project(slug(ids.hosted), { repository: { mode: "managed_git" }, training: marker(ids.hosted) });
  const normalBefore = await hashes(f.normal);
  const before = await treeHash(f.root);
  await f.run({ projectsRoot: f.projectsRoot });
  assert.equal(await treeHash(f.root), before, "check is read-only");
  const messages = f.reports.map(({ level, message }) => `${level}: ${message}`);
  assert.ok(messages.includes(`info: Practice project ${slug(ids.hosted)} (learner ${learnerKey}, lesson V64-START-01) will be retired.`));
  for (const lookAlike of [ids.unmarked, ids.mismatched, ids.github]) {
    assert.ok(messages.some(line => line.startsWith(`warning: ${slug(lookAlike)} looks like a practice project`)), lookAlike);
  }
  assert.ok(!messages.some(line => line.includes(slug(ids.space))), "a learning-space practice project is skipped silently");
  assert.ok(messages.some(line => /^warning: 1 hosted practice project\(s\) may have managed databases/u.test(line)));
  assert.ok(messages.includes(`info: Learner state training/users/${learnerKey}/state.lock will be retired.`));
  assert.ok(!messages.some(line => line.includes("teacher-notes")), "the learner's notes and their lock stay");
  assert.ok(messages.includes(`info: 1 archived project bundle(s) named like v1 practice projects stay in project-archives and are not part of Learning: ${slug(ids.unmarked)}.`));
  assert.ok(messages.includes("info: 8 Learning item(s) to retire; 0 already retired."));

  await f.run({ projectsRoot: f.projectsRoot, apply: true });
  assert.deepEqual(await hashes(f.normal), normalBefore, "normal projects, sessions, chats and code are byte-identical");
  await assert.rejects(lstat(practice), { code: "ENOENT" });
  await assert.rejects(lstat(f.runtime(slug(ids.hosted))), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.projectsRoot, ".learning-reset-20261022", slug(ids.hosted), "sessions/working/source/index.js"), "utf8"),
    `// ${slug(ids.hosted)} code\n`);
  assert.ok((await lstat(path.join(f.retired(f.runtime(slug(ids.hosted))), "project.json"))).isFile());
  for (const name of ["progress.json", "step-progress.json", "learning-mode.json", "state.lock", "learning-sessions"]) {
    await assert.rejects(lstat(path.join(f.userRoot, name)), { code: "ENOENT" }, name);
    assert.ok(await lstat(f.retired(path.join(f.userRoot, name))), name);
  }
  assert.equal(await readFile(path.join(f.userRoot, "teacher-notes.json"), "utf8"), '{"file":"teacher-notes.json"}');
  assert.equal(await readFile(path.join(f.userRoot, "teacher-notes.lock"), "utf8"), '{"file":"teacher-notes.lock"}');
  await assert.rejects(lstat(path.join(f.systemRoot, "author-preview/training/users", learnerKey, "progress.json")), { code: "ENOENT" });
  const manifest = JSON.parse(await readFile(path.join(f.backupRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.moves.length, 8);
  assert.equal(manifest.moves[0].source, practice);

  const after = await treeHash(f.root);
  f.reports.length = 0;
  await f.run({ projectsRoot: f.projectsRoot, apply: true });
  assert.equal(await treeHash(f.root), after, "a completed reset is a no-op");
  assert.ok(f.reports.some(({ message }) => message === "0 Learning item(s) to retire; 8 already retired."));
});

test("an interrupted local apply resumes the same manifest and a cross-filesystem move copies, verifies, then removes", async t => {
  const f = await fixture(t);
  const name = slug(ids.local);
  const namespace = await f.project(name, { repository: { mode: "managed_git" }, training: marker(ids.local) },
    path.join(f.systemRoot, "training/practice", learnerKey, ids.local, name));
  const sessionSource = path.join(f.managedSourceRoot, name);
  await put(path.join(sessionSource, "sessions/one/source/app.js"), "learner edit\n");
  await mkdir(path.join(sessionSource, "sessions/one/source/node_modules/.bin"), { recursive: true });
  await symlink("../tool/run.js", path.join(sessionSource, "sessions/one/source/node_modules/.bin/run"));
  const sourceHash = await treeHash(sessionSource);
  const normalBefore = await hashes(f.normal);

  let moves = 0;
  await assert.rejects(f.run({ apply: true, renamePath: async (source, destination) => {
    if (++moves === 2) throw new Error("interrupted");
    return rename(source, destination);
  } }), /interrupted/u);
  await assert.rejects(lstat(namespace), { code: "ENOENT" }, "the first move completed");
  assert.ok(await lstat(f.runtime(name)), "the marker-bearing runtime root moves last");

  const exdev = [];
  await f.run({ apply: true, renamePath: async (source, destination) => {
    if (source === sessionSource) { exdev.push(source); throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); }
    return rename(source, destination);
  } });
  assert.deepEqual(exdev, [sessionSource]);
  const copied = path.join(f.managedSourceRoot, ".learning-reset-20261022", name);
  assert.equal(await treeHash(copied), sourceHash, "file list, sizes, bytes and links are verified");
  await assert.rejects(lstat(`${copied}.partial`), { code: "ENOENT" });
  for (const moved of [namespace, sessionSource, f.runtime(name)]) await assert.rejects(lstat(moved), { code: "ENOENT" });
  assert.ok(await lstat(path.join(f.retired(namespace), "sessions/working/source/index.js")));
  assert.ok(await lstat(path.join(f.retired(f.runtime(name)), "project.json")));
  assert.deepEqual(await hashes(f.normal), normalBefore);
});

test("a cross-filesystem move whose source removal was interrupted finishes on retry; an unverified differing copy is refused", async t => {
  const f = await fixture(t);
  const name = slug(ids.local);
  await f.project(name, { repository: { mode: "managed_git" }, training: marker(ids.local) },
    path.join(f.systemRoot, "training/practice", learnerKey, ids.local, name));
  const sessionSource = path.join(f.managedSourceRoot, name);
  for (const file of ["a.txt", "b.txt"]) await put(path.join(sessionSource, file), `${file}\n`);
  const copied = path.join(f.managedSourceRoot, ".learning-reset-20261022", name);
  const crossDevice = async (source, destination) => {
    if (source === sessionSource) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    return rename(source, destination);
  };
  // The copy is verified, then removal stops after one file: a partial source.
  await assert.rejects(f.run({ apply: true, renamePath: crossDevice, removeTree: async (target, options) => {
    if (target !== sessionSource) return rm(target, options);
    await rm(path.join(target, "a.txt"));
    throw new Error("interrupted");
  } }), /interrupted/u);
  assert.deepEqual(await readdir(sessionSource), ["b.txt"]);
  await f.run({ apply: true });
  await assert.rejects(lstat(sessionSource), { code: "ENOENT" }, "a verified copy finishes removing its partial source");
  assert.deepEqual((await readdir(copied)).sort(), ["a.txt", "b.txt"]);
  await assert.rejects(lstat(f.runtime(name)), { code: "ENOENT" });

  // A copy published without its verification proof is verified on retry and
  // never removes a differing source.
  const g = await fixture(t);
  await g.project(name, { repository: { mode: "managed_git" }, training: marker(ids.local) },
    path.join(g.systemRoot, "training/practice", learnerKey, ids.local, name));
  const source = path.join(g.managedSourceRoot, name);
  await put(path.join(source, "kept.txt"), "original\n");
  await assert.rejects(g.run({ apply: true, renamePath: async (from, to) => {
    if (from === source) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    return rename(from, to);
  }, removeTree: async (target, options) => {
    if (target === source) throw new Error("interrupted");
    return rm(target, options);
  } }), /interrupted/u);
  await rm(path.join(g.backupRoot, "verified"), { recursive: true });
  await put(path.join(source, "kept.txt"), "changed\n");
  const before = await treeHash(g.root);
  await assert.rejects(g.run({ apply: true }), /copy differs from its source/u);
  assert.equal(await treeHash(g.root), before, "a differing copy never removes the source");
});

test("refuses symlinks, non-directories and an unexpected destination", async t => {
  const cases = {
    "symlinked runtime root": async f => symlink(path.join(f.root, "elsewhere"), f.runtime(slug(ids.hosted))),
    "file runtime root": async f => put(f.runtime(slug(ids.hosted)), "not a directory"),
    "symlinked learner file": async f => {
      await rm(path.join(f.userRoot, "progress.json"));
      await symlink(path.join(f.root, "elsewhere"), path.join(f.userRoot, "progress.json"));
    },
    "unexpected destination": async f => {
      await f.project(slug(ids.hosted), { repository: { mode: "managed_git" }, training: marker(ids.hosted) });
      await mkdir(path.join(f.projectsRoot, ".learning-reset-20261022", slug(ids.hosted)), { recursive: true });
    }
  };
  for (const [label, arrange] of Object.entries(cases)) {
    const f = await fixture(t);
    await arrange(f);
    const before = await treeHash(f.root);
    for (const apply of [false, true]) {
      await assert.rejects(f.run({ projectsRoot: f.projectsRoot, apply }), /Inspect before upgrading/u, label);
      assert.equal(await treeHash(f.root), before, label);
    }
  }
});

test("a v1 practice project whose deletion removed its namespace retires its runtime root with a warning on either host", async t => {
  for (const hosted of [true, false]) {
    const f = await fixture(t);
    const name = slug(ids.hosted);
    const namespace = await f.project(name, { repository: { mode: "managed_git" }, training: marker(ids.hosted),
      deletion: { startedAt: "2026-10-01T00:00:00.000Z" } });
    await rm(namespace, { recursive: true });
    const options = hosted ? { projectsRoot: f.projectsRoot } : {};
    await f.run({ ...options, apply: true });
    assert.ok(f.reports.some(({ level, message }) => level === "warning" &&
      message === `Practice project ${name} has no namespace (an interrupted deletion); only its runtime state will be retired.`), String(hosted));
    assert.ok(!f.reports.some(({ level }) => level === "error"));
    await assert.rejects(lstat(f.runtime(name)), { code: "ENOENT" });
    assert.ok((await lstat(path.join(f.retired(f.runtime(name)), "project.json"))).isFile());
  }
});

test("a fresh install is a no-op", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learning-reset-fresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const reports = [];
  await resetLearningForLearningSpace({ systemRoot, projectsRoot: path.join(root, "projects"), apply: true,
    backupRoot: path.join(systemRoot, "upgrades/backups", UPGRADE_ID, "training"), report: (_level, message) => reports.push(message) });
  assert.deepEqual(await readdir(root), []);
  assert.deepEqual(reports, ["0 Learning item(s) to retire; 0 already retired."]);
});
