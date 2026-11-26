// Core's state upgrade publisher: an apply's backups, its manifest and each file it publishes reach the disk before it
// goes on, so a power cut after any step leaves what the step wrote, whole.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { assertDurablyReplaced, traceDurableWrites } from "./durableWriteTrace.js";

test("an apply syncs each backup, its manifest and each published file before its rename, and their folders after", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const record = path.join(systemRoot, "projects/demo/records/one.txt");
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, "old\n");
  const backupRoot = path.join(systemRoot, "upgrades/backups/example");
  const relative = path.relative(systemRoot, record);
  const events = await traceDurableWrites(t);
  await publishStateUpgradeFiles({ systemRoot, apply: true, backupRoot, report() {},
    async prepareUpdates() { return [{ filePath: record, original: "old\n", contents: "new\n" }]; } });
  assert.equal(await readFile(record, "utf8"), "new\n");
  const copies = [path.join(backupRoot, "before", relative), path.join(backupRoot, "after", relative)];
  for (const file of [...copies, path.join(backupRoot, "manifest.json"), record]) assertDurablyReplaced(events, file);
  // Each folder made for a backup is an entry of its parent, synced too.
  const synced = new Set(events.filter((event) => event.op === "fsync").map((event) => event.path));
  for (const copy of copies) {
    for (let folder = path.dirname(copy); folder !== systemRoot; folder = path.dirname(folder)) {
      assert.ok(synced.has(path.dirname(folder)), `${folder}'s entry in its parent was not synced`);
    }
  }
});
