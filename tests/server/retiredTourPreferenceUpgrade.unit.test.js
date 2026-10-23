import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261023-retired-tour-preference.js";

async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-retired-tour-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const profile = (person, target) => path.join(systemRoot, "assistant-preferences", person, `${target}.json`);
  async function save(person, target, settings) {
    await mkdir(path.dirname(profile(person, target)), { recursive: true, mode: 0o700 });
    await writeFile(profile(person, target), `${JSON.stringify({ schemaVersion: 1, settings })}\n`, { mode: 0o600 });
  }
  const read = async (person, target) => readFile(profile(person, target), "utf8");
  const run = apply => upgrade.run({ systemRoot, apply, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id), report: () => {} });
  return { systemRoot, save, read, run };
}

test("the retired tour flag leaves personal Colleague preferences, which keep everything else, after check and on a retry", async t => {
  const f = await fixture(t);
  await f.save("MTAwMA", "colleague", { avatar: "merc", voice: "kitten_jasper", readAloud: true, welcomeTourDone: true });
  await f.save("MzAwMzM", "colleague", { avatar: "yu", voice: "kitten_bella" });
  await f.save("MTAwMA", "coding", { avatar: "yu", voice: "kitten_bella", readAloud: true });
  const untouched = [await f.read("MzAwMzM", "colleague"), await f.read("MTAwMA", "coding")];
  const before = await f.read("MTAwMA", "colleague");
  await f.run(false);
  assert.equal(await f.read("MTAwMA", "colleague"), before, "check changes nothing");
  await f.run(true);
  assert.deepEqual(JSON.parse(await f.read("MTAwMA", "colleague")),
    { schemaVersion: 1, settings: { avatar: "merc", voice: "kitten_jasper", readAloud: true } });
  assert.deepEqual([await f.read("MzAwMzM", "colleague"), await f.read("MTAwMA", "coding")], untouched);
  const backup = await readFile(path.join(f.systemRoot, "upgrades/backups", upgrade.id, "before/assistant-preferences/MTAwMA/colleague.json"), "utf8");
  assert.equal(backup, before);
  const after = await f.read("MTAwMA", "colleague");
  await f.run(true);
  assert.equal(await f.read("MTAwMA", "colleague"), after, "a retry changes nothing more");
});

test("an installation with no personal preferences has nothing to change, and a damaged profile stops the upgrade", async t => {
  const f = await fixture(t);
  await f.run(true);
  await mkdir(path.join(f.systemRoot, "assistant-preferences/broken"), { recursive: true });
  await writeFile(path.join(f.systemRoot, "assistant-preferences/broken/colleague.json"), "not json");
  await assert.rejects(f.run(false), /Personal Colleague preferences are invalid: assistant-preferences\/broken\/colleague\.json/u);
});
