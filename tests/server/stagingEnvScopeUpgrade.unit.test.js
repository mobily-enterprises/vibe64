import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEnvUserValues } from "../../packages/vibe64-core/src/server/envUserValues.js";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261114-staging-env-scope.js";

async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-staging-env-scope-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const projectRoot = (slug) => path.join(systemRoot, "projects", slug);
  const values = (slug) => path.join(projectRoot(slug), "env", "user-values.json");
  async function save(slug, value) {
    await mkdir(path.dirname(values(slug)), { recursive: true, mode: 0o700 });
    await writeFile(values(slug), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }
  const read = async (slug) => readFile(values(slug), "utf8");
  const run = apply => upgrade.run({ systemRoot, apply, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id), report: () => {} });
  return { projectRoot, read, run, save, systemRoot };
}

test("a project's prod Env values move to staging as saved, after check, with a backup and on a retry", async t => {
  const f = await fixture(t);
  const dev = { DEBUG: { secret: false, value: "1" } };
  const prod = { API_KEY: { secret: true, value: "k" }, MAIL_FROM: { secret: false, value: "a@example.test" } };
  await f.save("old-app", { environments: { dev, prod }, version: 1 });
  await f.save("current-app", { environments: { dev, staging: prod }, version: 1 });
  await mkdir(f.projectRoot("no-env"), { recursive: true });
  const before = await f.read("old-app");
  const untouched = await f.read("current-app");
  await assert.rejects(readEnvUserValues({ projectRuntimeRoot: f.projectRoot("old-app") }), /Invalid runtime config scope: prod/u);

  await f.run(false);
  assert.equal(await f.read("old-app"), before, "check changes nothing");
  await f.run(true);
  assert.deepEqual(JSON.parse(await f.read("old-app")), { environments: { dev, staging: prod }, version: 1 });
  assert.equal(await f.read("current-app"), untouched);
  assert.equal(await readFile(path.join(f.systemRoot, "upgrades/backups", upgrade.id, "before/projects/old-app/env/user-values.json"), "utf8"), before);
  const records = (await readEnvUserValues({ projectRuntimeRoot: f.projectRoot("old-app") })).records;
  assert.deepEqual(records.map(({ key, scope, value }) => [scope, key, value]),
    [["dev", "DEBUG", "1"], ["staging", "API_KEY", "k"], ["staging", "MAIL_FROM", "a@example.test"]]);

  const after = await f.read("old-app");
  await f.run(true);
  assert.equal(await f.read("old-app"), after, "a retry changes nothing more");
});

test("Env values holding both prod and staging, or damaged ones, stop the upgrade without a change", async t => {
  const f = await fixture(t);
  await f.run(true);
  await f.save("both", { environments: { prod: {}, staging: {} }, version: 1 });
  const both = await f.read("both");
  await assert.rejects(f.run(true), /both the prod and the staging scope: projects\/both\/env\/user-values\.json/u);
  assert.equal(await f.read("both"), both);
  await rm(path.join(f.projectRoot("both")), { recursive: true });
  await f.save("broken", "not json");
  await assert.rejects(f.run(false), /Project Env values are invalid: projects\/broken\/env\/user-values\.json/u);
  await f.save("broken", { environments: [] });
  await assert.rejects(f.run(false), /Project Env values are invalid/u);
});
