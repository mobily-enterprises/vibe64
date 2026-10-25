// The Release dialog's version change is written into the session only over
// the text it was prepared from: an edit made in between is never overwritten.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSessionReleaseWriter } from "../../packages/vibe64-publishing/src/server/sessionReleaseWriter.js";

const ENTRY = { id: "sdk", packer: "npm", workdir: ".", versionFrom: "package.json" };

async function fixture(t, { editBeforeSave = null } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "vibe64-release-writer-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "sessions", "active", "s1", "source");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "sdk", version: "1.0.0" }, null, 2)}\n`);
  await writeFile(path.join(root, "CHANGELOG.md"), "# Changelog\n");
  const saves = [];
  const sourceEditor = {
    async readFile({ path: file }) {
      if (editBeforeSave?.path === file) await writeFile(path.join(root, file), editBeforeSave.text);
      let text;
      try {
        text = await readFile(path.join(root, file), "utf8");
      } catch {
        return { ok: false, error: `${file} is not there.` };
      }
      return { ok: true, file: { path: file, text, hash: `hash-of-${text.length}` } };
    },
    async saveFile({ path: file, text, baseHash }) {
      saves.push({ file, baseHash });
      await writeFile(path.join(root, file), text);
      return { ok: true };
    },
    async createFile({ path: file, text }) {
      await writeFile(path.join(root, file), text);
      return { ok: true };
    }
  };
  const project = { createSessionStore: async () => ({ readSession: async () => ({ sessionId: "s1", metadata: { source_path: root, source_path_authority: "managed_session_source", source_kind: "session_clone" } }) }) };
  const writer = createSessionReleaseWriter({ project, sourceEditor, today: () => "2026-10-25" });
  return { root, saves, writer };
}

test("the prepared version change is written over the text it was made from", async (t) => {
  const { root, saves, writer } = await fixture(t);
  await writer.prepareAndWrite({ sessionId: "s1", entry: ENTRY, version: "1.1.0", notes: "- Faster." });
  assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "1.1.0");
  assert.match(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), /1\.1\.0/u);
  assert.ok(saves.length >= 1);
});

test("an edit made after the change was prepared is never overwritten", async (t) => {
  const edited = `${JSON.stringify({ name: "sdk", version: "1.0.0", description: "Edited meanwhile" }, null, 2)}\n`;
  const { root, saves, writer } = await fixture(t, { editBeforeSave: { path: "package.json", text: edited } });
  await assert.rejects(writer.prepareAndWrite({ sessionId: "s1", entry: ENTRY, version: "1.1.0", notes: "- Faster." }), { code: "VIBE64_PUBLISH_PREPARE_STALE" });
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), edited, "the person's edit stays");
  assert.equal(saves.some(({ file }) => file === "package.json"), false);
});

test("an edit to a later file leaves every file as it was", async (t) => {
  const edited = "# Changelog\n\nWritten meanwhile.\n";
  const { root, saves, writer } = await fixture(t, { editBeforeSave: { path: "CHANGELOG.md", text: edited } });
  await assert.rejects(writer.prepareAndWrite({ sessionId: "s1", entry: ENTRY, version: "1.1.0", notes: "- Faster." }), { code: "VIBE64_PUBLISH_PREPARE_STALE" });
  assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "1.0.0");
  assert.equal(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), edited);
  assert.deepEqual(saves, []);
});
