import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261025-workspace-assistant-name-only.js";

async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-assistant-name-only-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const filePath = path.join(systemRoot, "assistant-settings.json");
  const save = value => writeFile(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const read = () => readFile(filePath, "utf8");
  const run = apply => upgrade.run({ systemRoot, apply, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id), report: () => {} });
  return { systemRoot, filePath, save, read, run };
}

test("workspace assistant settings keep only the Colleague name after check and on a retry", async t => {
  const f = await fixture(t);
  await f.save({ colleagueName: "Ada", talkMode: "hold", sendMode: "edit", voice: "current", avatar: "yu", thinkingSounds: true });
  const before = await f.read();
  await f.run(false);
  assert.equal(await f.read(), before, "check changes nothing");
  await f.run(true);
  assert.deepEqual(JSON.parse(await f.read()), { colleagueName: "Ada" });
  assert.equal(await readFile(path.join(f.systemRoot, "upgrades/backups", upgrade.id, "before/assistant-settings.json"), "utf8"), before);
  const after = await f.read();
  await f.run(true);
  assert.equal(await f.read(), after, "a retry changes nothing more");
});

test("settings without a name are removed, a name-only file and a missing file are untouched, and damage stops the upgrade", async t => {
  const missing = await fixture(t);
  await missing.run(true);
  await assert.rejects(stat(missing.filePath), { code: "ENOENT" });

  const nameless = await fixture(t);
  await nameless.save({ avatar: "merc", sendMode: "immediately" });
  await nameless.run(true);
  await assert.rejects(stat(nameless.filePath), { code: "ENOENT" });

  const nameOnly = await fixture(t);
  await nameOnly.save({ colleagueName: "Colleague" });
  const saved = await nameOnly.read();
  await nameOnly.run(true);
  assert.equal(await nameOnly.read(), saved);

  const damaged = await fixture(t);
  await damaged.save("not json");
  await assert.rejects(damaged.run(false), /Workspace assistant settings are invalid: assistant-settings\.json/u);
});
