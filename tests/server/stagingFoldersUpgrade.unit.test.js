import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261119-staging-folders.js";

async function fixture(t) {
  const systemRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-staging-folders-"));
  t.after(() => rm(systemRoot, { recursive: true, force: true }));
  const at = (...parts) => path.join(systemRoot, "projects", ...parts);
  async function put(relative, text = "kept") {
    await mkdir(path.dirname(at(relative)), { recursive: true });
    await writeFile(at(relative), text);
  }
  const messages = [];
  const run = (apply) => upgrade.run({ systemRoot, apply, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id),
    report: (level, message) => messages.push(message) });
  // Every file under projects/, relative, with its content.
  async function tree() {
    const files = {};
    async function walk(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(full);
        else files[path.relative(at(), full)] = await readFile(full, "utf8");
      }
    }
    await walk(at());
    return files;
  }
  return { at, messages, put, run, systemRoot, tree };
}

test("every old folder moves whole after a check that changes nothing, and a second apply changes nothing more", async t => {
  const f = await fixture(t);
  await f.put("app/deployments/releases/r1/release.json", "{}");
  await f.put("app/drop-zone/.vibe64-staging/3f1c", "half an upload");
  await f.put("app/drop-zone/notes.txt");
  await f.put("app/backups/.vibe64-staging/kept-item", "set aside");
  await f.put("app/sessions/active/s-one/drop-zone/.vibe64-staging/9a2b", "partial");
  await f.put("app/sessions/closing/s-two/drop-zone/.vibe64-staging/77", "partial");
  await f.put("app/sessions/active/.creating/s-three.x/drop-zone/.vibe64-staging/1", "not a session");
  await f.put("app/sessions/archived/.staging/s-old-crash/session.json", "{}");
  await f.put("current/staging/current.json", "{}");
  await f.put("current/drop-zone/.vibe64-incoming/5", "already new");
  const before = await f.tree();

  await f.run(false);
  assert.deepEqual(await f.tree(), before, "check moves nothing");
  assert.equal(f.messages.length, 6);

  await f.run(true);
  const renamed = (name) => name
    .replace("app/deployments/", "app/staging/")
    .replace(/(?<!creating\/s-three\.x\/drop-zone\/)\.vibe64-staging\//u, ".vibe64-incoming/")
    .replace("archived/.staging/", "archived/.packing/");
  assert.deepEqual(await f.tree(), Object.fromEntries(Object.entries(before).map(([name, text]) => [renamed(name), text])));
  assert.ok((await lstat(f.at("app/sessions/active/.creating/s-three.x/drop-zone/.vibe64-staging"))).isDirectory(),
    "the store's own dot folders are not sessions");

  const after = await f.tree();
  f.messages.length = 0;
  await f.run(true);
  assert.deepEqual(await f.tree(), after, "a retry changes nothing more");
  assert.deepEqual(f.messages, ["No folder has an old name."]);
});

test("both names, a file or a link in an old name's place stop the upgrade before any move", async t => {
  const f = await fixture(t);
  await f.put("first/deployments/current.json", "{}");
  await f.put("second/deployments/current.json", "{}");
  await f.put("second/staging/current.json", "{}");
  const before = await f.tree();
  for (const apply of [false, true]) {
    await assert.rejects(f.run(apply), /projects\/second\/deployments and projects\/second\/staging both exist\. Inspect them/u);
  }
  assert.deepEqual(await f.tree(), before, "first/deployments did not move either");

  await rm(f.at("second"), { recursive: true });
  await f.put("second/backups/.vibe64-staging", "a file");
  await assert.rejects(f.run(true), /projects\/second\/backups\/\.vibe64-staging is not a folder/u);
  await rm(f.at("second"), { recursive: true });
  await mkdir(f.at("second/sessions/active/s-one"), { recursive: true });
  await symlink(f.at("first"), f.at("second/sessions/active/s-one/drop-zone"));
  await f.put("first/.vibe64-staging/x");
  await assert.rejects(f.run(true), /requires a regular directory: .*s-one\/drop-zone/u);
  assert.ok((await lstat(f.at("first/deployments"))).isDirectory());
});

test("an empty or missing system state has nothing to move", async t => {
  const f = await fixture(t);
  await f.run(true);
  await mkdir(f.at(), { recursive: true });
  await f.run(true);
  assert.deepEqual(f.messages, ["No folder has an old name.", "No folder has an old name."]);
});
