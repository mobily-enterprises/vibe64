import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A MariaDB GRANT or REVOKE on `<database>.*` reads each _ and % in the name as a wildcard, so a grant naming shop_dev
// as it is also reaches shopxdev. Every one public writes names its database through the local database server
// guide's grantName (serverGuide.js), which escapes each \, _ and %. This reads every source file public ships and
// refuses any other form, so a new grant naming a database as it is fails here.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_FOLDERS = Object.freeze(["bin", "config", "examples", "packages", "server", "src", "tooling"]);
const SKIPPED_FOLDERS = new Set([".git", "node_modules", "test", "tests", "__tests__"]);
const SOURCE_FILE = /\.(?:c?js|mjs|py|sh|sql|ts|vue)$/u;
const DATABASE_GRANT = /\b(?:GRANT|REVOKE)\b[^\n]*?\bON\s+(.+?)\.\*/giu;
const RULE_FORM = /^\$\{mysqlName\(grantName\([A-Za-z.]+\)\)\}$/u;
const SERVER_GUIDE = "packages/vibe64-database-tools/src/shared/serverGuide.js";
// A test database's numbered copies are granted as patterns on purpose: copyGrantNames escapes the name through
// grantName, then adds a literal _ and one or two characters.
const COPY_PATTERNS = Object.freeze({ [SERVER_GUIDE]: /^\$\{mysqlName\(copies\)\}$/u });

async function sourceFiles(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) files.push(...await sourceFiles(entryPath));
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(entryPath);
  }
  return files;
}

test("every MariaDB grant public writes names its database with each \\, _ and % escaped", async () => {
  const rootFiles = (await readdir(REPO_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) => path.join(REPO_ROOT, entry.name));
  const folders = await Promise.all(SOURCE_FOLDERS.map((folder) => sourceFiles(path.join(REPO_ROOT, folder))));
  const grants = [];
  for (const file of [...rootFiles, ...folders.flat()]) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    for (const match of (await readFile(file, "utf8")).matchAll(DATABASE_GRANT)) {
      if (match[1] !== "*") grants.push({ file: relative, database: match[1] });
    }
  }
  const unescaped = grants.filter(({ file, database }) => !RULE_FORM.test(database)
    && !COPY_PATTERNS[file]?.test(database));
  assert.deepEqual(unescaped, [], "each grant names its database through grantName");
  const guide = grants.filter(({ file }) => file === SERVER_GUIDE);
  assert.ok(guide.length >= 2, `the scan finds the local database server guide's grants (found ${guide.length})`);
  const source = await readFile(path.join(REPO_ROOT, SERVER_GUIDE), "utf8");
  assert.match(source, /testDatabases\.flatMap\(copyGrantNames\)\.map\(\(copies\) =>/u,
    "the patterns granted are the ones copyGrantNames makes");
  assert.match(source, /function copyGrantNames\(name\) \{\n {2}const escaped = grantName\(name\);/u,
    "copyGrantNames escapes the name through grantName");
});
