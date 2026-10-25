import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { serializeByKey, writeFileAtomic, writeJsonFileAtomic } from "../../packages/vibe64-core/src/server/atomicFile.js";
import { readEnvUserValues, saveEnvUserValues } from "../../packages/vibe64-core/src/server/envUserValues.js";

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
