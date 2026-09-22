import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSourceEditorSearchIndex, sourceEditorIndexDirectory } from "../../packages/vibe64-source-editor/src/server/searchIndex.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-search-index-"));
  const context = { sourceRoot: path.join(root, "source"), sessionId: "session-1", runtime: { stateRoot: path.join(root, "state") } };
  await mkdir(context.sourceRoot);
  const indexes = [];
  t.after(async () => {
    await Promise.all(indexes.map((index) => index.close()));
    await rm(root, { recursive: true, force: true });
  });
  return {
    context,
    async put(name, text) {
      const target = path.join(context.sourceRoot, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    },
    index() { const index = createSourceEditorSearchIndex(); indexes.push(index); return index; }
  };
}

async function ready(index, context, query, limit = 120) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await index.search(context, { query, limit });
    assert.notEqual(result.index.state, "error", result.index.error);
    if (result.index.state === "ready") return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The content index did not finish.");
}

test("content index persists across services and incrementally refreshes ignored creates, edits and deletes", async (t) => {
  const f = await fixture(t);
  await f.put(".gitignore", "dist/\n");
  await f.put("dist/a.txt", "a needle in text\n");
  await f.put("removed.txt", "old needle\n");
  const first = f.index();
  assert.equal((await first.search(f.context, { query: "needle", limit: 120 })).index.state, "building");
  assert.deepEqual((await ready(first, f.context, "needle")).results.map((r) => r.path), ["dist/a.txt", "removed.txt"]);
  await first.close();
  const statusPath = path.join(sourceEditorIndexDirectory(f.context), "status.json");
  const before = await readFile(statusPath, "utf8");
  const second = f.index();
  assert.equal((await second.search(f.context, { query: "needle", limit: 120 })).index.state, "ready");
  assert.equal(await readFile(statusPath, "utf8"), before, "reopening reuses the persistent index without rebuilding");

  await f.put("dist/a.txt", "a replacement phrase\n");
  await f.put("node_modules/new.txt", "new needle\n");
  await rm(path.join(f.context.sourceRoot, "removed.txt"));
  second.invalidate(f.context.sourceRoot);
  assert.deepEqual((await ready(second, f.context, "needle")).results.map((r) => r.path), ["node_modules/new.txt"]);
  assert.equal((await ready(second, f.context, "replacement")).results[0].path, "dist/a.txt");
  second.invalidate(f.context.sourceRoot);
  await ready(second, f.context, "needle");
  assert.equal(JSON.parse(await readFile(statusPath, "utf8")).changed, 0, "unchanged files are not reindexed");
});

test("content matching preserves literals, smart case, short queries, Unicode positions, long lines and limits", async (t) => {
  const f = await fixture(t);
  const index = f.index();
  await f.put("cases.txt", 'é foo.bar HELLO\nfooXbar hello\nquote " AND %_[]\\\n');
  await f.put("long.txt", `${"x".repeat(65534)}boundary-needle${"x".repeat(1100000)}\nlast needle\n`);
  let result = await ready(index, f.context, "foo.bar");
  assert.deepEqual(result.results, [{ path: "cases.txt", line: 1, column: 4, preview: "é foo.bar HELLO" }]);
  assert.equal((await ready(index, f.context, "hello")).results.length, 2);
  assert.equal((await ready(index, f.context, "HELLO")).results.length, 1);
  assert.equal((await ready(index, f.context, "é")).results[0].column, 1);
  assert.equal((await ready(index, f.context, '" AND %_[]\\')).results[0].line, 3);
  result = await ready(index, f.context, "boundary-needle");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].column, 65535);
  assert.equal((await ready(index, f.context, "last needle")).results[0].line, 2);
  assert.equal((await ready(index, f.context, "hello", 1)).truncated, true);
});

test("content index excludes VCS internals, binaries and symlinks and isolates source roots", async (t) => {
  const f = await fixture(t);
  await f.put(".git/private.txt", "needle");
  await f.put("nested/.git/private.txt", "needle");
  await f.put("binary.bin", "needle\0hidden");
  await f.put("visible.txt", "needle");
  await symlink(path.join(f.context.sourceRoot, ".git"), path.join(f.context.sourceRoot, "linked"));
  await symlink(path.join(f.context.sourceRoot, ".git/private.txt"), path.join(f.context.sourceRoot, "linked.txt"));
  const index = f.index();
  assert.deepEqual((await ready(index, f.context, "needle")).results.map((r) => r.path), ["visible.txt"]);
  const other = { ...f.context, sourceRoot: path.join(f.context.sourceRoot, "other") };
  await mkdir(other.sourceRoot);
  assert.deepEqual((await ready(index, other, "needle")).results, []);
  assert.notEqual(sourceEditorIndexDirectory(other), sourceEditorIndexDirectory(f.context));
});

test("failed refreshes stop reporting progress and explicit refresh retries them", async (t) => {
  const f = await fixture(t);
  const index = f.index();
  await f.put("visible.txt", "needle");
  await ready(index, f.context, "needle");
  await rename(f.context.sourceRoot, `${f.context.sourceRoot}.away`);
  index.invalidate(f.context.sourceRoot);
  // The gateway refuses the missing working directory; background failures are
  // retained even when an accompanying query also cannot start.
  await index.search(f.context, { query: "needle", limit: 120 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rename(`${f.context.sourceRoot}.away`, f.context.sourceRoot);
  const failed = await index.search(f.context, { query: "needle", limit: 120 });
  assert.equal(failed.index.state, "error");
  assert.ok(failed.index.error);
  index.invalidate(f.context.sourceRoot);
  assert.equal((await ready(index, f.context, "needle")).results.length, 1);
});
