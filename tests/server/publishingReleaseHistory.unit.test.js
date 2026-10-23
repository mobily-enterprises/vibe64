// History lists the newest activity first. A failed release that a new
// confirmation resumes is the latest thing that happened, so it moves above
// dry runs made in between instead of staying where it first started.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
