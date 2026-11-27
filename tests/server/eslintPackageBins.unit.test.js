import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

// A package's extensionless programs (bin/genesis, bin/vibe64-connected and the like) ship in the release runtime as
// its .js files do. ESLint lints a file without an extension only when a config names it, so `npm run lint` checked
// none of them until eslint.config.mjs named them.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function extensionlessPrograms() {
  const programs = [];
  for (const entry of await readdir(path.join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const bin = path.join(REPO_ROOT, "packages", entry.name, "bin");
    const files = await readdir(bin, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const file of files) if (file.isFile() && !file.name.includes(".")) programs.push(path.join(bin, file.name));
  }
  return programs;
}

test("npm run lint covers every extensionless package program as the JavaScript it is", async () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const programs = await extensionlessPrograms();
  assert.ok(programs.length >= 4, `found only ${programs.join(", ")}`);
  for (const program of programs) {
    assert.ok(await eslint.calculateConfigForFile(program), `${path.relative(REPO_ROOT, program)} has no lint configuration`);
  }
  // A program's mistake is reported, not skipped as a file no configuration names.
  const [result] = await eslint.lintText("#!/usr/bin/env node\nconst unused = 1;\n", {
    filePath: path.join(REPO_ROOT, "packages", "vibe64-genesis", "bin", "lint-probe")
  });
  assert.deepEqual(result.messages.map(({ ruleId }) => ruleId), ["no-unused-vars"], JSON.stringify(result.messages));
});
