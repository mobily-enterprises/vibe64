import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  planCompositionPins,
  readConnectionsLock,
  recordCompositionPins,
  writeConnectionsLock
} from "../../packages/vibe64-project/src/server/connectionsLock.js";

import {
  commandRunner,
  copyPath,
  fixture,
  git,
  githubRepository,
  prepare,
  pushPeer,
  remoteMain,
  SESSION_ID,
  sessionService
} from "./connectedCopiesTestHelpers.js";

// Save's part of the connected lifecycle: a composition's saved commit is pinned in the project's own
// source, in the same commit as its work; a dependency gets no pin (its published versions move the
// project's manifest and lock); the Stack's Save entries run before that commit.
const LOCK = "vibe64.connections.lock.json";
const CONNECTIONS = `${JSON.stringify({
  repositories: [
    { name: "Library", repository: "https://github.com/example/library", relationship: "composition" },
    { name: "Tool", repository: "https://github.com/example/tool", relationship: "dependency" }
  ]
}, null, 2)}\n`;

function lockText(pins) {
  return `${JSON.stringify({ schema: "vibe64.connections-lock.v1", repositories: pins }, null, 2)}\n`;
}

async function pin(repository, commit) {
  return {
    name: "Library",
    repository: "https://github.com/example/library",
    commit,
    tree: await git(repository.bare, ["rev-parse", `${commit}^{tree}`])
  };
}

async function setup(t, { ownFiles = async () => ({}), ...options } = {}) {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  const tool = await githubRepository(f, "tool");
  await prepare(f, ["library", "tool"]);
  const service = await sessionService(f, { ownFiles: { "vibe64.connections.json": CONNECTIONS, ...await ownFiles(library) }, ...options });
  const save = () => service.work.saveSessionWork(SESSION_ID, { destinationReview: service.destinationReview, operationId: `save-${Date.now()}` });
  return { f, library, save, service, tool };
}

test("Save pins the composition copy it saved in the project's own commit; a dependency gets no pin; an unchanged Save has no work", async (t) => {
  let source = "";
  // A Save entry whose output differs on every run: only a Save that saves something runs it.
  const { f, library, save, service } = await setup(t, {
    connectedSaveRunner: async () => ({
      dependencies: false,
      saveSteps: [{ label: "Stamp", argv: ["sh", "-c", "date +%s%N > stamp.txt"], cwd: source, runtimeRequirements: ["shell"] }],
      runCommand: commandRunner
    })
  });
  source = f.session.sourcePath;
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await writeFile(path.join(copyPath(f, "tool"), "work.txt"), "tool work\n");

  const saved = await save();

  assert.deepEqual(saved.connected.map(copy => copy.name), ["library", "tool"]);
  const pushed = await remoteMain(library);
  assert.equal(saved.connected[0].saveCommit, pushed);
  assert.ok(saved.saveCommit, "the project's own source is saved with the pin");
  assert.equal(await remoteMain(service.own), saved.saveCommit);
  assert.equal(`${await git(service.own.bare, ["show", `${saved.saveCommit}:${LOCK}`])}\n`, lockText([await pin(library, pushed)]));
  assert.ok(await git(service.own.bare, ["show", `${saved.saveCommit}:stamp.txt`]));
  assert.deepEqual(saved.connectedLines, [`[Connected] ${LOCK} pins example/library at ${pushed.slice(0, 12)}.`]);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), "");

  await assert.rejects(save(), { code: "vibe64_session_save_no_changes" });
});

test("a Save stopped after a composition copy pushed says what it saved, stays retryable, and the next Save records the pin", async (t) => {
  let stop = true;
  const { f, library, save, service } = await setup(t, {
    connectedSaveRunner: async () => {
      if (stop) throw new Error("simulated failure while recording the release");
      return null;
    }
  });
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");

  await assert.rejects(save(), (error) => {
    assert.match(error.message, /^Saved library at [0-9a-f]{12} to its main, but this project's own source is not saved, so its main still pins the earlier commit of library\. simulated failure while recording the release Save again to finish\.$/u);
    assert.equal(error.retryable, true);
    assert.deepEqual(error.connected.map(copy => copy.name), ["library"]);
    return true;
  });
  const pushed = await remoteMain(library);
  assert.notEqual(pushed, library.base);
  assert.equal(await remoteMain(service.own), service.own.base);
  stop = false;
  // As if it had stopped before writing the lock: the retry finds the pin from the copy's record.
  await rm(path.join(f.session.sourcePath, LOCK));

  const retried = await save();

  assert.deepEqual(retried.connected || [], []);
  assert.equal(`${await git(service.own.bare, ["show", `${retried.saveCommit}:${LOCK}`])}\n`, lockText([await pin(library, pushed)]));
});

test("the project's own Save failing after a copy pushed keeps its refusal and says the copy is saved", async (t) => {
  const { f, save, service } = await setup(t, {
    // Another session saves the project between this Save's copy push and its own commit.
    connectedSaveRunner: async () => {
      await pushPeer(service.own, "peer.txt", "peer\n");
      return null;
    }
  });
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");

  await assert.rejects(save(), (error) => {
    assert.equal(error.code, "vibe64_session_save_update_required");
    assert.match(error.message, /^Saved library at [0-9a-f]{12} to its main, but this project's own source is not saved, so its main still pins the earlier commit of library\. /u);
    assert.equal(error.retryable, true);
    return true;
  });
});

test("a Save that would pin a composition refuses before pushing it while the project's own main moved", async (t) => {
  // The project's main already pins the copy's commit: only the composition's push needs the own Save.
  const { f, library, save, service } = await setup(t, { ownFiles: async (repository) => ({ [LOCK]: lockText([await pin(repository, repository.base)]) }) });
  await writeFile(path.join(copyPath(f, "library"), "work.txt"), "library work\n");
  await pushPeer(service.own, "peer.txt", "peer\n");

  await assert.rejects(save(), { code: "vibe64_session_save_update_required" });
  assert.equal(await remoteMain(library), library.base);
});

test("Update takes the newer pin another session saved, with the copy on the composition's main", async (t) => {
  const { f, library, service } = await setup(t);
  // Another session saved Library and pinned it on the project's main.
  const newer = await pushPeer(library, "other.txt", "other session\n");
  await pushPeer(service.own, LOCK, lockText([await pin(library, newer)]));

  await service.work.updateSessionWork(SESSION_ID, { operationId: "update-1" });

  assert.equal(await readFile(path.join(f.session.sourcePath, LOCK), "utf8"), lockText([await pin(library, newer)]));
  assert.equal(await git(copyPath(f, "library"), ["rev-parse", "HEAD"]), newer);
  assert.equal(f.copies().find(copy => copy.name === "library").canonicalCommit, newer);
});

test("after Update moves a composition copy, a session with no other work has the pin to save, and Save records it", async (t) => {
  // The project's main pins Library's first commit; Library's main then moves without this project pinning it.
  const { f, library, save, service } = await setup(t, { ownFiles: async (repository) => ({ [LOCK]: lockText([await pin(repository, repository.base)]) }) });
  const newer = await pushPeer(library, "other.txt", "saved by another project\n");
  await service.work.updateSessionWork(SESSION_ID, { operationId: "update-1" });
  // Update moved the copy and its record; the session's own source is clean and still pins the first commit.
  assert.equal(f.copies().find(copy => copy.name === "library").canonicalCommit, newer);
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), "");
  assert.equal(await readFile(path.join(f.session.sourcePath, LOCK), "utf8"), lockText([await pin(library, library.base)]));

  const work = await service.inspection.inspectSessionWork(SESSION_ID);

  assert.equal(work.unsaved, true, "the lock behind the copy is work to save, so Save is available");
  assert.deepEqual(work.pinsToRecord, [{ fullName: "example/library", commit: newer }]);

  const saved = await save();

  assert.deepEqual(saved.connected || [], [], "the copy has nothing of its own to push");
  assert.equal(await remoteMain(service.own), saved.saveCommit);
  assert.equal(`${await git(service.own.bare, ["show", `${saved.saveCommit}:${LOCK}`])}\n`, lockText([await pin(library, newer)]));
  assert.deepEqual(saved.connectedLines, [`[Connected] ${LOCK} pins example/library at ${newer.slice(0, 12)}.`]);
  const after = await service.inspection.inspectSessionWork(SESSION_ID);
  assert.deepEqual([after.unsaved, after.pinsToRecord], [false, []]);
  await assert.rejects(save(), { code: "vibe64_session_save_no_changes" });
});

test("a lock an unfinished Save left changed never conflicts with Update: the session takes its main's pins", async (t) => {
  const { f, library, service } = await setup(t);
  const newer = await pushPeer(library, "other.txt", "other session\n");
  await pushPeer(service.own, LOCK, lockText([await pin(library, newer)]));
  // This session's earlier Save wrote its own pin and stopped before its commit.
  await writeFile(path.join(f.session.sourcePath, LOCK), lockText([await pin(library, library.base)]));

  const updated = await service.work.updateSessionWork(SESSION_ID, { operationId: "update-1" });

  assert.equal(updated.status, "updated");
  assert.equal(await readFile(path.join(f.session.sourcePath, LOCK), "utf8"), lockText([await pin(library, newer)]));
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), "");
});

test("a tracked lock an unfinished Save changed is put back before Update, so the session takes its main's newer pin", async (t) => {
  const { f, library, service } = await setup(t, { ownFiles: async (repository) => ({ [LOCK]: lockText([await pin(repository, repository.base)]) }) });
  const unsaved = await pushPeer(library, "unsaved.txt", "unsaved\n");
  const newer = await pushPeer(library, "other.txt", "other session\n");
  await pushPeer(service.own, LOCK, lockText([await pin(library, newer)]));
  await writeFile(path.join(f.session.sourcePath, LOCK), lockText([await pin(library, unsaved)]));

  const updated = await service.work.updateSessionWork(SESSION_ID, { operationId: "update-1" });

  assert.equal(updated.status, "updated");
  assert.equal(await readFile(path.join(f.session.sourcePath, LOCK), "utf8"), lockText([await pin(library, newer)]));
  assert.equal(await git(f.session.sourcePath, ["status", "--porcelain"]), "");
});

test("Save commits what a published version's move changed, and a bump that fails never stops it", async (t) => {
  let fail = false;
  const { f, save, service } = await setup(t, {
    bumpConnectedDependencies: async ({ session }) => {
      if (fail) throw new Error("registry unreachable");
      await writeFile(path.join(session.sourcePath, "deps.lock"), "tool 1.1.0\n");
      return { lines: ["[Connected] Tool: Staging and Production now use the published tool 1.1.0."], bumped: [{ package: "tool", from: "1.0.0", to: "1.1.0" }] };
    },
    connectedSaveRunner: async () => ({ dependencies: true, saveSteps: [], runCommand: commandRunner })
  });
  await writeFile(path.join(copyPath(f, "tool"), "work.txt"), "tool work\n");

  const saved = await save();

  assert.equal(await git(service.own.bare, ["show", `${saved.saveCommit}:deps.lock`]), "tool 1.1.0");
  assert.ok(saved.connectedLines.includes("[Connected] Tool: Staging and Production now use the published tool 1.1.0."), saved.connectedLines.join("\n"));

  fail = true;
  await writeFile(path.join(copyPath(f, "tool"), "more.txt"), "more tool work\n");
  const unbumped = await save();
  assert.deepEqual(unbumped.connectedLines, ["[Connected] Vibe64 could not check the connected dependencies for published versions: registry unreachable."]);
  assert.deepEqual(unbumped.connected.map(copy => copy.name), ["tool"]);
});

test("the Stack's Save entries run before the project's own commit, which takes what they change; one that fails stops it", async (t) => {
  let step = { label: "Record release", argv: ["sh", "-c", "echo recorded > release.txt"] };
  const { f, save, service } = await setup(t, {
    connectedSaveRunner: async () => ({
      dependencies: false,
      saveSteps: [{ ...step, cwd: f.session.sourcePath, runtimeRequirements: ["shell"] }],
      runCommand: commandRunner
    })
  });
  await writeFile(path.join(copyPath(f, "tool"), "work.txt"), "tool work\n");

  const saved = await save();
  assert.equal(await git(service.own.bare, ["show", `${saved.saveCommit}:release.txt`]), "recorded");

  step = { label: "Record release", argv: ["sh", "-c", "echo not released >&2; exit 3"] };
  await writeFile(path.join(f.session.sourcePath, "own.txt"), "own work\n");
  await assert.rejects(save(), (error) => {
    assert.equal(error.code, "vibe64_connected_save_step_failed");
    assert.match(error.message, /^The connected Save step Record release failed: not released\.$/u);
    return true;
  });
  assert.equal(await remoteMain(service.own), saved.saveCommit);
});

test("the connections lock keeps a composition this session has no copy of, goes when none is left, and refuses a link", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connections-lock-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const [commit, tree] = ["a".repeat(40), "b".repeat(40)];
  const library = { name: "Library", repository: "https://github.com/example/library", relationship: "composition", fullName: "example/library" };
  const other = { name: "Other", repository: "https://github.com/example/other", relationship: "composition", fullName: "example/other" };
  const otherPin = { name: "Other", repository: other.repository, commit: "c".repeat(40), tree };
  const connections = [library, other];
  await writeConnectionsLock(root, [otherPin]);

  // Library's copy pins its commit; Other, which this session has no copy of, keeps its pin.
  assert.deepEqual(await recordCompositionPins({ sourceRoot: root, connections, pins: [{ fullName: "example/library", commit, tree }] }), { changed: true });
  assert.deepEqual(await readConnectionsLock(root), [{ name: "Library", repository: library.repository, commit, tree }, otherPin]);
  assert.deepEqual(await planCompositionPins({ sourceRoot: root, connections, commits: { "example/library": commit } }), {
    compositions: ["example/library", "example/other"],
    changed: false,
    pinsToRecord: []
  });
  // A copy at a commit its pin does not name is a pin to record.
  const moved = "d".repeat(40);
  assert.deepEqual(await planCompositionPins({ sourceRoot: root, connections, commits: { "example/library": moved, "example/other": otherPin.commit } }), {
    compositions: ["example/library", "example/other"],
    changed: true,
    pinsToRecord: [{ fullName: "example/library", commit: moved }]
  });

  // No composition left: the lock goes.
  assert.deepEqual(await recordCompositionPins({ sourceRoot: root, connections: [{ ...library, relationship: "dependency" }], pins: [] }), { changed: true });
  await assert.rejects(lstat(path.join(root, LOCK)), { code: "ENOENT" });

  // A link in its place is refused, never followed.
  await writeFile(path.join(root, "elsewhere.json"), lockText([otherPin]));
  await symlink("elsewhere.json", path.join(root, LOCK));
  await assert.rejects(readConnectionsLock(root), { code: "vibe64_connections_lock_invalid" });
  await assert.rejects(recordCompositionPins({ sourceRoot: root, connections, pins: [] }), { code: "vibe64_connections_lock_invalid" });
});
