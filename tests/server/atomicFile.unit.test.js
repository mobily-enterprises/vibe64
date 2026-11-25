import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { serializeByKey, writeFileAtomic, writeJsonFileAtomic } from "../../packages/vibe64-core/src/server/atomicFile.js";
import { readEnvUserValues, saveEnvUserValues } from "../../packages/vibe64-core/src/server/envUserValues.js";
import { assertDurablyReplaced, traceDurableWrites } from "./durableWriteTrace.js";

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-atomic-file-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test("atomic writes publish the exact mode and never leave a temporary file", async (t) => {
  const root = await temporaryRoot(t);
  const filePath = path.join(root, "nested", "value.json");
  const previous = process.umask(0o077);
  try {
    await writeJsonFileAtomic(filePath, { ok: true }, { directoryMode: 0o700, fileMode: 0o640 });
  } finally {
    process.umask(previous);
  }
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { ok: true });
  assert.equal((await stat(filePath)).mode & 0o777, 0o640);
  assert.deepEqual(await readdir(path.dirname(filePath)), ["value.json"]);

  const blocked = path.join(root, "blocked");
  await mkdir(path.join(blocked, "occupied"), { recursive: true });
  await writeFile(path.join(blocked, "occupied", "keep"), "");
  await assert.rejects(writeFileAtomic(path.join(blocked, "occupied"), "text"));
  assert.deepEqual(await readdir(blocked), ["occupied"], "a failed rename removes its temporary file");
});

test("an atomic write is durable: its data reaches the disk before the rename, and its folder after", async (t) => {
  const root = await temporaryRoot(t);
  const filePath = path.join(root, "upgrades", "applied.json");
  const events = await traceDurableWrites(t);
  await writeJsonFileAtomic(filePath, { applied: [] });
  assertDurablyReplaced(events, filePath);
  await writeFileAtomic(filePath, "replaced\n", { fileMode: 0o600 });
  assertDurablyReplaced(events, filePath);
  assert.equal(await readFile(filePath, "utf8"), "replaced\n");
});

test("a write with durable: false is published whole by rename, with neither it nor its folder synced", async (t) => {
  const root = await temporaryRoot(t);
  const filePath = path.join(root, "locks", "owner.json");
  const events = await traceDurableWrites(t);
  await writeJsonFileAtomic(filePath, { pid: 1 }, { durable: false });
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { pid: 1 });
  assert.equal(events.filter((event) => event.op === "rename" && event.to === filePath).length, 1);
  assert.deepEqual(events.filter((event) => event.op === "fsync"), []);
  assert.deepEqual(await readdir(path.dirname(filePath)), ["owner.json"]);
});

test("every atomic write's temporary file has the one fixed name, beside the file", async (t) => {
  const root = await temporaryRoot(t);
  const names = [];
  let sentinelSeen;
  const sentinel = new Promise((resolve) => { sentinelSeen = resolve; });
  const watcher = watch(root, (type, name) => {
    names.push(name);
    if (name === "sentinel") sentinelSeen();
  });
  try {
    await writeFileAtomic(path.join(root, "value.txt"), "one\n");
    await writeFileAtomic(path.join(root, "created.txt"), "new\n", { exclusive: true });
    await writeFile(path.join(root, "sentinel"), "");
    await sentinel;
  } finally {
    watcher.close();
  }
  const temporary = [...new Set(names.filter((name) => !["value.txt", "created.txt", "sentinel"].includes(name)))];
  assert.equal(temporary.length, 2, names.join(" "));
  for (const name of temporary) assert.match(name, /^\.vibe64-write-[0-9a-f-]{36}\.tmp$/u);
  assert.deepEqual((await readdir(root)).sort(), ["created.txt", "sentinel", "value.txt"]);
});

test("an exclusive atomic write creates a missing file whole and refuses an existing one, unchanged", async (t) => {
  const root = await temporaryRoot(t);
  const filePath = path.join(root, "notes", "new.md");
  await writeFileAtomic(filePath, "first\n", { exclusive: true, fileMode: 0o640 });
  assert.equal(await readFile(filePath, "utf8"), "first\n");
  assert.equal((await stat(filePath)).mode & 0o777, 0o640);
  await assert.rejects(writeFileAtomic(filePath, "second\n", { exclusive: true }), { code: "EEXIST" });
  assert.equal(await readFile(filePath, "utf8"), "first\n");
  assert.deepEqual(await readdir(path.dirname(filePath)), ["new.md"]);
});

test("removeStale clears the folder's temporary files a killed write left over a minute ago, and only when asked", async (t) => {
  const root = await temporaryRoot(t);
  const folder = (...names) => path.join(root, ...names);
  await mkdir(folder("other"));
  await mkdir(folder(".vibe64-write-folder.tmp"));
  const stale = folder(".vibe64-write-11111111-1111-4111-8111-111111111111.tmp");
  const live = folder(".vibe64-write-22222222-2222-4222-8222-222222222222.tmp");
  const elsewhere = folder("other", ".vibe64-write-33333333-3333-4333-8333-333333333333.tmp");
  const unrelated = folder(".vibe64-write-notes.txt");
  const minutesAgo = new Date(Date.now() - 2 * 60_000);
  for (const file of [stale, live, elsewhere, unrelated]) await writeFile(file, "partial");
  for (const entry of [stale, elsewhere, unrelated, folder(".vibe64-write-folder.tmp")]) await utimes(entry, minutesAgo, minutesAgo);

  // A records folder never pays for a listing: without removeStale nothing else in it is touched.
  await writeFileAtomic(folder("record.json"), "{}\n");
  assert.ok(await stat(stale));

  await writeFileAtomic(folder("record.json"), "{}\n", { removeStale: true });
  await assert.rejects(stat(stale), { code: "ENOENT" });
  for (const entry of [live, elsewhere, unrelated, folder(".vibe64-write-folder.tmp")]) assert.ok(await stat(entry));
});

test("serializeByKey runs one key's operations in order, past failures, and other keys independently", async () => {
  const pending = new Map();
  const order = [];
  const gate = Promise.withResolvers();
  const first = serializeByKey(pending, "a", async () => { await gate.promise; order.push("a1"); throw new Error("first failed"); });
  const second = serializeByKey(pending, "a", async () => { order.push("a2"); return 2; });
  const other = serializeByKey(pending, "b", async () => { order.push("b1"); return "b"; });
  assert.equal(await other, "b");
  gate.resolve();
  await assert.rejects(first, /first failed/u);
  assert.equal(await second, 2);
  assert.deepEqual(order, ["b1", "a1", "a2"]);
  assert.equal(pending.size, 0);
});

test("concurrent Env value saves for one project keep every update in a private file", async (t) => {
  const projectRuntimeRoot = await temporaryRoot(t);
  await Promise.all(["FIRST_VALUE", "SECOND_VALUE", "THIRD_VALUE"].map((key) => saveEnvUserValues({
    projectRuntimeRoot,
    values: { [key]: `${key.toLowerCase()}-secret` }
  })));
  const saved = await readEnvUserValues({ projectRuntimeRoot });
  assert.deepEqual(Object.keys(saved.state.environments.dev), ["FIRST_VALUE", "SECOND_VALUE", "THIRD_VALUE"]);
  assert.equal((await stat(saved.filePath)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(path.dirname(saved.filePath)), ["user-values.json"]);
});
