// History lists the newest activity first. A failed release that a new
// confirmation resumes is the latest thing that happened, so it moves above
// dry runs made in between instead of staying where it first started.
import assert from "node:assert/strict";
import fs, { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createReleaseHistoryStore } from "../../packages/vibe64-publishing/src/server/state/releaseHistoryStore.js";

test("a resumed release lists above the dry runs made since it first started", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let clock = Date.parse("2026-10-23T10:00:00.000Z");
  const history = createReleaseHistoryStore({ runtimeRoot: root, now: () => new Date(clock += 60_000).toISOString() });
  const release = await history.create({ kind: "release" });
  await history.update(release.id, (record) => ({ ...record, status: "failed" }));
  const dryRun = await history.create({ kind: "dry-run" });
  assert.deepEqual((await history.list()).map(({ id }) => id), [dryRun.id, release.id]);
  await history.update(release.id, (record) => ({ ...record, status: "running", resumedAt: new Date(clock += 60_000).toISOString() }));
  assert.deepEqual((await history.list()).map(({ id }) => id), [release.id, dryRun.id]);
});

// Release history is never pruned, so a list that read every record would cost
// more with every dry run. It reads each record file once, then only new ones.
async function recordReads(t, recordCount) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-publishing-history-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let clock = Date.parse("2026-10-23T10:00:00.000Z");
  const now = () => new Date(clock += 60_000).toISOString();
  const writer = createReleaseHistoryStore({ runtimeRoot: root, now });
  for (let index = 0; index < recordCount; index += 1) {
    await writer.create({ kind: "dry-run", status: "succeeded" });
  }
  const history = createReleaseHistoryStore({ runtimeRoot: root, now });
  const releases = path.join(root, "releases");
  const originalReadFile = fs.readFile;
  let reads = 0;
  t.mock.method(fs, "readFile", async (...args) => {
    if (String(args[0]).startsWith(releases)) reads += 1;
    return originalReadFile(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  assert.equal((await history.list({ limit: Infinity })).length, recordCount);
  const first = reads;
  await history.list({ limit: 30 });
  await history.list({ limit: Infinity });
  const repeated = reads - first;
  const created = await history.create({ kind: "dry-run" });
  await history.update(created.id, (record) => ({ ...record, status: "failed" }));
  const afterWrites = reads;
  const [newest] = await history.list({ limit: 1 });
  const listAfterWrites = reads - afterWrites;
  assert.equal(newest.id, created.id);
  assert.equal(newest.status, "failed", "a list shows the store's own update");
  assert.equal(newest.log, undefined, "a listed record leaves its log to read(id)");
  assert.deepEqual((await history.read(created.id)).log, []);
  t.mock.restoreAll();
  syncBuiltinESMExports();
  return { first, repeated, listAfterWrites };
}

test("release history reads each record file once, so later lists cost the same at 10 and 200 records", async (t) => {
  const small = await recordReads(t, 10);
  const large = await recordReads(t, 200);
  assert.equal(small.first, 10);
  assert.equal(large.first, 200);
  assert.deepEqual(
    [small.repeated, small.listAfterWrites],
    [large.repeated, large.listAfterWrites],
    "a list after the first must not read more files as history grows"
  );
  assert.deepEqual([large.repeated, large.listAfterWrites], [0, 0]);
});
