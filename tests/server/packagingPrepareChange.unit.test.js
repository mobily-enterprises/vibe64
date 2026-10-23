import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyReleaseChange,
  nextChangelog,
  prepareReleaseChange,
  readSourceVersion
} from "../../packages/vibe64-packaging/src/server/release/prepareChange.js";
import { compareSemver, pep440FromSemver } from "../../packages/vibe64-packaging/src/server/release/version.js";

const npmEntry = { id: "sdk", packer: "npm", workdir: "packages/sdk", versionFrom: "package.json" };
const pythonEntry = { id: "client", packer: "python-dist", workdir: "python", versionFrom: "pyproject.toml" };

async function project(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-prepare-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

const PACKAGE_JSON = "{\n  \"name\": \"@notes/sdk\",\n  \"version\": \"1.4.2\",\n  \"dependencies\": {\n    \"left-pad\": \"1.4.2\"\n  }\n}\n";
const LOCK = `${JSON.stringify({ name: "@notes/sdk", version: "1.4.2", lockfileVersion: 3, packages: { "": { name: "@notes/sdk", version: "1.4.2" } } }, null, 2)}\n`;

test("an npm release is a version bump, lockfile and changelog change computed without writing", async (t) => {
  const root = await project(t, { "packages/sdk/package.json": PACKAGE_JSON, "packages/sdk/package-lock.json": LOCK });
  const change = await prepareReleaseChange({ projectRoot: root, entry: npmEntry, version: "1.5.0", notes: "- Faster sync.\n- Fixed offline edits.", date: "2026-10-23" });
  assert.equal(change.previousVersion, "1.4.2");
  assert.deepEqual(change.files.map(({ path: file }) => file), ["packages/sdk/package.json", "packages/sdk/package-lock.json", "packages/sdk/CHANGELOG.md"]);
  // Only the version line changes; a dependency with the same text is untouched.
  assert.equal(change.files[0].after, PACKAGE_JSON.replace("\"version\": \"1.4.2\"", "\"version\": \"1.5.0\""));
  const lock = JSON.parse(change.files[1].after);
  assert.deepEqual([lock.version, lock.packages[""].version], ["1.5.0", "1.5.0"]);
  assert.equal(change.files[2].before, null);
  assert.equal(change.files[2].after, "# Changelog\n\n## 1.5.0 - 2026-10-23\n\n- Faster sync.\n- Fixed offline edits.\n");
  // Nothing was written yet.
  assert.equal(await readFile(path.join(root, "packages/sdk/package.json"), "utf8"), PACKAGE_JSON);

  await applyReleaseChange({ projectRoot: root, change });
  assert.match(await readFile(path.join(root, "packages/sdk/package.json"), "utf8"), /"version": "1\.5\.0"/u);
  assert.match(await readFile(path.join(root, "packages/sdk/CHANGELOG.md"), "utf8"), /## 1\.5\.0 - 2026-10-23/u);
  assert.equal(await readSourceVersion({ projectRoot: root, entry: npmEntry }), "1.5.0");
});

test("a prepared change is refused once any file moved on", async (t) => {
  const root = await project(t, { "packages/sdk/package.json": PACKAGE_JSON });
  const change = await prepareReleaseChange({ projectRoot: root, entry: npmEntry, version: "1.5.0", notes: "- Faster.", date: "2026-10-23" });
  await writeFile(path.join(root, "packages/sdk/CHANGELOG.md"), "# Changelog\n");
  await assert.rejects(applyReleaseChange({ projectRoot: root, change }), { code: "VIBE64_PUBLISH_PREPARE_STALE" });
  assert.equal(await readFile(path.join(root, "packages/sdk/package.json"), "utf8"), PACKAGE_JSON);
  await assert.rejects(
    applyReleaseChange({ projectRoot: root, change: { files: [{ path: "../outside.txt", before: null, after: "x" }] } }),
    /outside the project/u
  );
});

test("versions must move forward and notes stay below the changelog's entry headings", async (t) => {
  const root = await project(t, { "packages/sdk/package.json": PACKAGE_JSON });
  const prepare = (version, notes = "- Change.") => prepareReleaseChange({ projectRoot: root, entry: npmEntry, version, notes, date: "2026-10-23" });
  await assert.rejects(prepare("1.4.2"), /newer than the current 1\.4\.2/u);
  await assert.rejects(prepare("1.4.1"), /newer than/u);
  await assert.rejects(prepare("1.5"), /not a semantic version/u);
  await assert.rejects(prepare("1.5.0", "## Big"), /### headings/u);
  await assert.rejects(prepare("1.5.0", "  "), /notes are needed/u);
  assert.equal((await prepare("1.5.0-rc.1")).version, "1.5.0-rc.1");
  await assert.rejects(
    prepareReleaseChange({ projectRoot: root, entry: npmEntry, version: "1.5.0", notes: "- x", date: "23/10/2026" }),
    /YYYY-MM-DD/u
  );
});

test("the changelog entry goes above the newest release, below the title and Unreleased", () => {
  const existing = "# Changelog\n\n## Unreleased\n\n- Pending.\n\n## 1.4.2 - 2026-09-01\n\n- Old.\n";
  assert.equal(
    nextChangelog(existing, { version: "1.5.0", date: "2026-10-23", notes: "- New." }),
    "# Changelog\n\n## Unreleased\n\n- Pending.\n\n## 1.5.0 - 2026-10-23\n\n- New.\n\n## 1.4.2 - 2026-09-01\n\n- Old.\n"
  );
  assert.equal(
    nextChangelog("# Changelog\n\nNotes about this file.\n", { version: "1.0.0", date: "2026-10-23", notes: "- First." }),
    "# Changelog\n\nNotes about this file.\n\n## 1.0.0 - 2026-10-23\n\n- First.\n"
  );
  assert.throws(() => nextChangelog(existing, { version: "1.4.2", date: "2026-10-23", notes: "- Again." }), /already has an entry for 1\.4\.2/u);
  assert.throws(() => nextChangelog("## [1.4.2] - 2026-09-01\n", { version: "1.4.2", date: "2026-10-23", notes: "- Again." }), /already has an entry/u);
});

test("a Python release writes the PEP 440 spelling into pyproject.toml's static version", async (t) => {
  const pyproject = "[build-system]\nrequires = [\"setuptools\"]\n\n[project]\nname = \"notes-client\"\nversion = \"1.4.2\"  # released\n\n[tool.other]\nversion = \"9.9.9\"\n";
  const root = await project(t, { "python/pyproject.toml": pyproject });
  const change = await prepareReleaseChange({ projectRoot: root, entry: pythonEntry, version: "1.5.0-rc.2", notes: "- Async client.", date: "2026-10-23" });
  assert.equal(change.sourceVersion, "1.5.0rc2");
  assert.equal(change.files[0].after, pyproject.replace("version = \"1.4.2\"  # released", "version = \"1.5.0rc2\"  # released"));
  assert.deepEqual(change.files.map(({ path: file }) => file), ["python/pyproject.toml", "python/CHANGELOG.md"]);

  const dynamicRoot = await project(t, { "python/pyproject.toml": "[project]\nname = \"x\"\ndynamic = [\"version\"]\n" });
  await assert.rejects(
    prepareReleaseChange({ projectRoot: dynamicRoot, entry: pythonEntry, version: "1.5.0", notes: "- x" }),
    /Version from: external/u
  );
});

test("external versions are read, never written", async (t) => {
  const root = await project(t, { "packages/sdk/package.json": PACKAGE_JSON });
  const entry = { ...npmEntry, versionFrom: "external" };
  await assert.rejects(
    prepareReleaseChange({ projectRoot: root, entry, version: "1.5.0", notes: "- x" }),
    { code: "VIBE64_PUBLISH_VERSION_EXTERNAL" }
  );
  assert.equal(await readSourceVersion({ projectRoot: root, entry }), "1.4.2");
});

test("semantic versions order by precedence and map to PEP 440 only where PyPI can express them", () => {
  const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.10.0"];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemver(ordered[index - 1], ordered[index]), -1, `${ordered[index - 1]} < ${ordered[index]}`);
  }
  assert.equal(compareSemver("1.0.0+build.1", "1.0.0"), 0);
  assert.deepEqual(
    ["1.5.0", "1.5.0-alpha.1", "1.5.0-beta.2", "1.5.0-rc.1", "1.5.0-dev.3", "1.5.0-post.1"].map(pep440FromSemver),
    ["1.5.0", "1.5.0a1", "1.5.0b2", "1.5.0rc1", "1.5.0.dev3", "1.5.0.post1"]
  );
  assert.throws(() => pep440FromSemver("1.5.0+build.1"), /build metadata/u);
  assert.throws(() => pep440FromSemver("1.5.0-preview.1"), /no PyPI spelling/u);
});
