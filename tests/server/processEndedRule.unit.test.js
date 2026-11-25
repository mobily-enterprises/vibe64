import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Whether a process has ended is decided in one place, processEnded (packages/vibe64-execution/src/host/processEnded.js):
// a zombie (Z) whose process still has other threads has not ended. Every check of a process or a group once compared
// the state letter with Z on its own, and each read a main thread's pthread_exit as the end of a process still running.
// This reads every source and test file and refuses a state compared with Z anywhere else, so a new check fails here.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_FOLDERS = Object.freeze(["bin", "packages", "server", "src", "tests", "tooling"]);
const SKIPPED_FOLDERS = new Set([".git", "dist", "node_modules"]);
const SOURCE_FILE = /\.(?:c?js|mjs|ts|vue)$/u;
const Q = "[\"'`]";
const Z_STATE_CHECK = new RegExp([
  `[!=]==?\\s*${Q}Z${Q}`,
  `${Q}Z${Q}\\s*[!=]==?`,
  `startsWith\\(\\s*${Q}Z`,
  `\\[\\s*${Q}Z${Q}\\s*,`,
  `,\\s*${Q}Z${Q}\\s*\\]`
].join("|"), "gu");
const RULE = "packages/vibe64-execution/src/host/processEnded.js";
const ALLOWED = Object.freeze({
  [RULE]: "the rule itself",
  // Waits for the kernel to show the zombie leader it proves every check against, and for a plain zombie.
  "tests/server/zombieLeaderProcess.unit.test.js": "builds its scenario from the kernel's own state"
});

async function sourceFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name)) files.push(...await sourceFiles(entryPath));
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(entryPath);
  }
  return files;
}

test("only processEnded compares a process's state with Z", async () => {
  const self = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/");
  const checks = [];
  for (const folder of SOURCE_FOLDERS) {
    for (const file of await sourceFiles(path.join(REPO_ROOT, folder))) {
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      if (relative === self) continue;
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(Z_STATE_CHECK)) checks.push({ file: relative, line: index + 1, text: match[0] });
      });
    }
  }
  assert.deepEqual(checks.filter(({ file }) => !ALLOWED[file]), [], "every other check asks processEnded");
  assert.ok(checks.some(({ file }) => file === RULE), "the scan finds the rule's own comparison");
});
