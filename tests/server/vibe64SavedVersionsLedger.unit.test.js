import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readSavedVersions,
  recordSavedVersions,
  savedVersionsPath
} from "../../packages/vibe64-core/src/server/savedVersions.js";
import { runProjectSourceExclusive } from "../../packages/vibe64-project/src/server/projectSourceMutationLock.js";
import { configureVibe64Host } from "../../packages/vibe64-execution/src/server/hostProfile.js";

// Save's record of which session saved each version, kept in the project's runtime state root so the message for a
// session behind main can name the session without guessing from the commits.

async function projectRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-saved-versions-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

const commit = (letter) => letter.repeat(40);
const save = (letter, sessionId, sessionName) => ({
  commit: commit(letter),
  repository: "",
  savedAt: "2026-11-25T00:11:00.000Z",
  sessionId,
  sessionName
});

test("two Saves recorded at once under the project lock both keep their version, and a reader gets only the commits it asks for", async (t) => {
  const root = await projectRoot(t);
  const runExclusive = (operation) => runProjectSourceExclusive(root, operation);
  const passes = save("a", "2026-1125-0811-passes", "Passes");
  const inbox = save("b", "2026-1125-0812-inbox", "Inbox");

  const recorded = await Promise.all([
    recordSavedVersions({ projectRuntimeRoot: root, runExclusive, saves: [passes] }),
    recordSavedVersions({ projectRuntimeRoot: root, runExclusive, saves: [inbox] })
  ]);

  assert.deepEqual(recorded, [true, true]);
  const read = await readSavedVersions({ projectRuntimeRoot: root, commits: [passes.commit, inbox.commit, commit("c")] });
  assert.deepEqual(Object.fromEntries(read), {
    [passes.commit]: { savedAt: passes.savedAt, sessionId: passes.sessionId, sessionName: "Passes" },
    [inbox.commit]: { savedAt: inbox.savedAt, sessionId: inbox.sessionId, sessionName: "Inbox" }
  });
  // Ten more at once: none lost either.
  const many = "0123456789".split("").map((digit) => ({ ...save("e", `2026-1125-090${digit}-s`, `S${digit}`), commit: digit.repeat(40) }));
  await Promise.all(many.map((entry) => recordSavedVersions({ projectRuntimeRoot: root, runExclusive, saves: [entry] })));
  assert.equal((await readSavedVersions({ projectRuntimeRoot: root, commits: many.map((entry) => entry.commit) })).size, 10);
});

test("the record keeps the newest two hundred Saves, so reading it costs the same however long the history", async (t) => {
  const root = await projectRoot(t);
  const commits = Array.from({ length: 205 }, (_, index) => index.toString(16).padStart(40, "0"));
  for (const [index, entry] of commits.entries()) {
    await recordSavedVersions({ projectRuntimeRoot: root, saves: [{ ...save("a", `s-${index}`, ""), commit: entry }] });
  }
  const stored = JSON.parse(await readFile(savedVersionsPath(root), "utf8"));
  assert.equal(stored.saves.length, 200);
  assert.equal(stored.saves[0].commit, commits.at(-1));
  assert.equal((await readSavedVersions({ projectRuntimeRoot: root, commits: commits.slice(0, 5) })).size, 0);
});

test("on a host that shares project files through a group, the record is the group's and no one else's", async (t) => {
  const root = await projectRoot(t);
  // The project's runtime state root, as the managed workspace makes it: setgid, group-shared, closed to others.
  await chmod(root, 0o2770);
  configureVibe64Host({ sharedGroupAccess: true });
  t.after(() => configureVibe64Host(null));

  assert.equal(await recordSavedVersions({ projectRuntimeRoot: root, saves: [save("a", "s-1", "Passes")] }), true);

  const [file, folder] = await Promise.all([stat(savedVersionsPath(root)), stat(root)]);
  assert.equal(file.mode & 0o777, 0o660);
  assert.equal(file.gid, folder.gid);
  assert.equal(path.dirname(savedVersionsPath(root)), root);
});

test("a corrupt or unreadable record only loses the session names: reading never fails, nor does recording, and the next Save rewrites it", async (t) => {
  const root = await projectRoot(t);
  const file = savedVersionsPath(root);
  for (const corrupt of ["{not json", JSON.stringify({ saves: "nothing" }), JSON.stringify([{ commit: 7 }])]) {
    await writeFile(file, corrupt);
    assert.equal((await readSavedVersions({ projectRuntimeRoot: root, commits: [commit("a")] })).size, 0);
    assert.equal(await recordSavedVersions({ projectRuntimeRoot: root, saves: [save("a", "s-1", "Passes")] }), true);
    const rewritten = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(rewritten.saves.map((entry) => entry.commit), [commit("a")]);
    assert.equal((await readSavedVersions({ projectRuntimeRoot: root, commits: [commit("a")] })).size, 1);
  }
  // Something that is not a file where the record belongs: Save and its readers go on without names.
  await rm(file);
  await mkdir(file);
  assert.equal((await readSavedVersions({ projectRuntimeRoot: root, commits: [commit("a")] })).size, 0);
  assert.equal(await recordSavedVersions({ projectRuntimeRoot: root, saves: [save("b", "s-2", "Inbox")] }), false);
  // A lock that fails is the same: the Save it follows is not failed by it.
  const failingLock = async () => { throw new Error("Another project source operation is still running."); };
  assert.equal(await recordSavedVersions({ projectRuntimeRoot: "", runExclusive: failingLock, saves: [save("c", "s-3", "")] }), false);
  assert.equal((await readSavedVersions({ projectRuntimeRoot: "", commits: [commit("c")] })).size, 0);
});
