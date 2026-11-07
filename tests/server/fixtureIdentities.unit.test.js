import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The public source: code, tests, fixtures, guides and examples.
const SOURCE_ROOTS = ["bin", "docs", "examples", "genesis", "packages", "server", "src", "tests", "tooling"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "test-results", "playwright-report"]);
const TEXT_FILE = /\.(?:[cm]?js|ts|json|md|txt|vue|html|ya?ml)$/u;

// Real people's logins, email names and account ids once used as fixtures and
// examples, kept as SHA-256 hashes so this public test names no one. Use
// made-up ones instead: octocat, owner@example.test, id 1.
const RETIRED_IDENTITY_HASHES = new Set([
  "3f0ef904187d2da4f0c84fb42b2b25434e9743b2cbbcff2f1af8290032c08c83",
  "84b7c809b708f048eb040f11244951f0cd09fe9f46a76321a622134f37293b1e",
  "84402ca37ad36d20fe45e5bd3e576e39ca914f1067158e2767c72976e92c567a",
  "d0fccb74f0058c1d988f9056b44a5b6254155b94d55993d67dcb3e10420eba47"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) files.push(...await textFiles(entryPath));
    else if (entry.isFile() && TEXT_FILE.test(entry.name)) files.push(entryPath);
  }
  return files;
}

test("the public source uses made-up identities, never real people's", async () => {
  const rootEntries = await readdir(REPOSITORY_ROOT, { withFileTypes: true });
  const files = [
    ...rootEntries.filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
      .map((entry) => path.join(REPOSITORY_ROOT, entry.name)),
    ...(await Promise.all(SOURCE_ROOTS.map((root) => textFiles(path.join(REPOSITORY_ROOT, root))))).flat()
  ];
  const retired = new Map();
  const found = [];
  for (const file of files) {
    for (const word of new Set((await readFile(file, "utf8")).toLowerCase().split(/[^a-z0-9]+/u))) {
      if (!retired.has(word)) retired.set(word, RETIRED_IDENTITY_HASHES.has(sha256(word)));
      if (retired.get(word)) found.push(`${path.relative(REPOSITORY_ROOT, file)} (${sha256(word).slice(0, 12)})`);
    }
  }
  assert.ok(files.length > 100, "the scan reads the source tree");
  assert.deepEqual(found, []);
});
