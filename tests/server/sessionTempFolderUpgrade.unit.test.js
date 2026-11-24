import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261124-session-temp-folders.js";
import { managedSessionSourcePath, SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";
import { removeOldSessionTempFolders } from "../../packages/vibe64-runtime/src/server/sessionTempFolderUpgrade.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";

const exists = (target) => stat(target).then(() => true, () => false);

// Session checkouts live outside the state directory, where source_path says;
// the old temporary folder was `tmp` beside each.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-session-temp-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "example");
  const sourcesRoot = path.join(root, "sources");
  const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
  async function session(sessionId, metadata = {}) {
    await store.createSession({ runtimeKind: "genesis", sessionId });
    const sourcePath = managedSessionSourcePath(sourcesRoot, sessionId);
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(sourcePath, "work.txt"), "the session's work\n");
    const values = {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      ...metadata
    };
    for (const [name, value] of Object.entries(values)) {
      if (value !== null) await store.writeMetadataValue(sessionId, name, value);
    }
    return { oldTemp: path.join(path.dirname(sourcePath), "tmp"), sourcePath };
  }
  const messages = [];
  const run = (apply) => upgrade.run({
    apply, backupRoot: path.join(systemRoot, "upgrades", "backups", upgrade.id), removeOldSessionTempFolders, systemRoot,
    report: (level, message) => messages.push([level, message])
  });
  return { messages, root, run, session, store };
}

test("the session temp folder upgrade checks, then removes each session's old tmp folder and nothing else", async (t) => {
  const f = await fixture(t);
  const active = await f.session("active");
  await mkdir(path.join(active.oldTemp, "mb-net-abc123", "repo", ".git"), { recursive: true });
  await writeFile(path.join(active.oldTemp, "mb-net-abc123", "throwaway.txt"), "test output\n");
  // An archived checkout's folder can still hold the old temporary folder.
  const archived = await f.session("archived", { source_removed: "yes" });
  await rm(archived.sourcePath, { recursive: true });
  await mkdir(archived.oldTemp);
  const without = await f.session("without");
  // A link or a file named tmp is not what Vibe64 made, and what a link leads to is never touched.
  const linked = await f.session("linked");
  const elsewhere = path.join(f.root, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(path.join(elsewhere, "keep.txt"), "not the session's\n");
  await symlink(elsewhere, linked.oldTemp);
  const file = await f.session("file");
  await writeFile(file.oldTemp, "a file\n");
  // A session with no recorded managed checkout has no folder to look beside.
  const unmanaged = await f.session("unmanaged", { source_path_authority: null });
  await mkdir(unmanaged.oldTemp);
  // Its upgrade needs its owner.
  await assert.rejects(upgrade.run({ apply: false, report() {}, systemRoot: f.root }), /session record owner is required/u);

  await f.run(false);
  for (const kept of [active.oldTemp, archived.oldTemp, linked.oldTemp, file.oldTemp, unmanaged.oldTemp]) {
    assert.equal(await exists(kept), true, `checking removed ${kept}`);
  }
  assert.ok(f.messages.some(([level, message]) => level === "info" && message === `example/active: would remove its old temporary folder ${active.oldTemp}.`));
  assert.ok(f.messages.some(([, message]) => message === "Old session temporary folders: 2 to remove."));
  assert.ok(f.messages.some(([level, message]) => level === "warning" && message.startsWith(`example/linked: ${linked.oldTemp} is not a folder Vibe64 made`)));
  assert.ok(f.messages.some(([level, message]) => level === "warning" && message.startsWith(`example/file: ${file.oldTemp} is not a folder Vibe64 made`)));

  f.messages.length = 0;
  await f.run(true);
  assert.equal(await exists(active.oldTemp), false);
  assert.equal(await exists(archived.oldTemp), false);
  assert.equal(await exists(path.join(active.sourcePath, "work.txt")), true, "the session's source stays");
  assert.equal(await exists(without.sourcePath), true);
  assert.equal(await exists(path.join(elsewhere, "keep.txt")), true);
  assert.equal(await exists(linked.oldTemp), true);
  assert.equal(await exists(file.oldTemp), true);
  assert.equal(await exists(unmanaged.oldTemp), true);
  assert.ok(f.messages.some(([, message]) => message === `example/active: removed its old temporary folder ${active.oldTemp}.`));
  assert.ok(f.messages.some(([, message]) => message === "Old session temporary folders: 2 of 2 removed."));

  // A repeated apply finds nothing left to remove.
  f.messages.length = 0;
  await f.run(true);
  assert.ok(f.messages.some(([, message]) => message === "No old session temporary folders to remove."));
});
