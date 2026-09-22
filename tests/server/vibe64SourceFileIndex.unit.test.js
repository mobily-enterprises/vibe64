import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSourceEditorFileIndex } from "../../packages/vibe64-source-editor/src/server/fileIndex.js";

test("filename queries share discovery, expire external changes, and isolate source roots", async () => {
  let time = 0;
  const calls = [];
  let finish;
  const index = createSourceEditorFileIndex({
    now: () => time,
    load: ({ sourceRoot }) => {
      calls.push(sourceRoot);
      return new Promise((resolve) => { finish = resolve; });
    }
  });
  const first = index.read({ sourceRoot: "/one" });
  const second = index.read({ sourceRoot: "/one" });
  await Promise.resolve();
  assert.deepEqual(calls, ["/one"]);
  finish({ paths: ["dist/ignored.txt"], truncated: false });
  assert.deepEqual(await second, await first);
  assert.deepEqual(await index.read({ sourceRoot: "/one" }), await first);

  time = 30_000;
  const expired = index.read({ sourceRoot: "/one" });
  await Promise.resolve();
  finish({ paths: ["renamed.txt"], truncated: false });
  assert.deepEqual((await expired).paths, ["renamed.txt"]);
  const other = index.read({ sourceRoot: "/two" });
  await Promise.resolve();
  finish({ paths: ["private.txt"], truncated: false });
  assert.deepEqual((await other).paths, ["private.txt"]);
  assert.deepEqual((await index.read({ sourceRoot: "/one" })).paths, ["renamed.txt"]);
  assert.deepEqual(calls, ["/one", "/one", "/two"]);
});

test("creation or refresh invalidation cannot be undone by an older in-flight scan", async () => {
  const pending = [];
  const index = createSourceEditorFileIndex({
    load: () => new Promise((resolve) => pending.push(resolve))
  });
  const old = index.read({ sourceRoot: "/source" });
  await Promise.resolve();
  index.invalidate("/source");
  const fresh = index.read({ sourceRoot: "/source" });
  await Promise.resolve();
  pending[1]({ paths: ["new.txt"], truncated: false });
  await fresh;
  pending[0]({ paths: [], truncated: false });
  await old;
  assert.deepEqual((await index.read({ sourceRoot: "/source" })).paths, ["new.txt"]);
});

test("incomplete and failed discovery remain retryable", async () => {
  let calls = 0;
  const index = createSourceEditorFileIndex({
    load: async () => {
      calls += 1;
      if (calls === 1) throw new Error("scan failed");
      return { paths: ["found.txt"], truncated: calls === 2 };
    }
  });
  await assert.rejects(index.read({ sourceRoot: "/source" }), /scan failed/);
  assert.equal((await index.read({ sourceRoot: "/source" })).truncated, true);
  assert.equal((await index.read({ sourceRoot: "/source" })).truncated, false);
  await index.read({ sourceRoot: "/source" });
  assert.equal(calls, 3);
});

test("idle source indexes are evicted and service shutdown clears discovery", async () => {
  let calls = 0;
  const index = createSourceEditorFileIndex({
    load: async () => ({ paths: [String(++calls)], truncated: false })
  });
  for (let i = 0; i < 9; i += 1) await index.read({ sourceRoot: `/source-${i}` });
  await index.read({ sourceRoot: "/source-0" });
  assert.equal(calls, 10);
  index.clear();
  await index.read({ sourceRoot: "/source-0" });
  assert.equal(calls, 11);
});

test("a recent filename snapshot survives restart but explicit invalidation bypasses it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-filenames-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const options = {
    snapshotPath: () => path.join(root, "filenames.json"),
    load: async () => ({ paths: [String(++calls)], truncated: false })
  };
  const context = { sourceRoot: "/session" };
  await createSourceEditorFileIndex(options).read(context);
  const restarted = createSourceEditorFileIndex(options);
  assert.deepEqual((await restarted.read(context)).paths, ["1"]);
  assert.equal(calls, 1);
  restarted.invalidate(context.sourceRoot);
  assert.deepEqual((await restarted.read(context)).paths, ["2"]);
});
