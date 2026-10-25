import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261025-retired-project-bootstrap.js";

async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-retired-bootstrap-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const record = (slug) => path.join(systemRoot, "projects", slug, "project.json");
  async function save(slug, value) {
    await mkdir(path.dirname(record(slug)), { recursive: true, mode: 0o700 });
    await writeFile(record(slug), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  const read = async (slug) => readFile(record(slug), "utf8");
  const run = apply => upgrade.run({ systemRoot, apply, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id), report: () => {} });
  return { systemRoot, record, save, read, run };
}

test("the retired bootstrap field leaves project records, which keep everything else, after check and on a retry", async t => {
  const f = await fixture(t);
  await f.save("old-app", { bootstrap: { mode: "new", status: "pending" }, developmentDatabaseScope: "project", repository: { mode: "local" } });
  await f.save("current-app", { developmentDatabaseScope: "session" });
  const untouched = await f.read("current-app");
  const before = await f.read("old-app");
  await f.run(false);
  assert.equal(await f.read("old-app"), before, "check changes nothing");
  await f.run(true);
  assert.deepEqual(JSON.parse(await f.read("old-app")), { developmentDatabaseScope: "project", repository: { mode: "local" } });
  assert.equal(await f.read("current-app"), untouched);
  assert.equal(await readFile(path.join(f.systemRoot, "upgrades/backups", upgrade.id, "before/projects/old-app/project.json"), "utf8"), before);
  const after = await f.read("old-app");
  await f.run(true);
  assert.equal(await f.read("old-app"), after, "a retry changes nothing more");
});

test("an installation without projects has nothing to change, and a damaged project record stops the upgrade", async t => {
  const f = await fixture(t);
  await f.run(true);
  await f.save("broken", "not json");
  await assert.rejects(f.run(false), /Project record is invalid: projects\/broken\/project\.json/u);
});
