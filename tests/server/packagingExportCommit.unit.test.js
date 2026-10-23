// A saved commit exports into a clean folder from an ordinary checkout and from
// a bare canonical repository alike, with file times set to the commit time.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { exportSavedCommit } from "../../packages/vibe64-packaging/src/server/release/exportCommit.js";
import { gitProject } from "./packagingRegistryTestTools.js";

const run = promisify(execFile);

test("a saved commit exports from a working checkout and from a bare repository", async (t) => {
  const { root, commit } = await gitProject(t, { "package.json": "{\"name\":\"notes\"}\n", "src/index.js": "export {};\n" });
  const scratch = await mkdtemp(path.join(os.tmpdir(), "vibe64-export-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const bare = path.join(scratch, "canonical.git");
  await run("git", ["clone", "-q", "--bare", root, bare]);

  for (const [label, projectRoot] of [["checkout", root], ["bare", bare]]) {
    const directory = path.join(scratch, label);
    const exported = await exportSavedCommit({ projectRoot, commit, directory });
    assert.equal(await readFile(path.join(directory, "src", "index.js"), "utf8"), "export {};\n", label);
    assert.equal(Math.round((await stat(path.join(directory, "package.json"))).mtimeMs / 1000), exported.commitTime, `${label} file times are the commit time`);
    await assert.rejects(stat(path.join(directory, ".git")), `${label} export has no Git metadata`);
  }
});

test("a package build leaves out the project's Genesis and agent files, from checkouts and bare repositories", async (t) => {
  const { VIBE64_PACKAGING_SOURCE_EXCLUSIONS } = await import("../../packages/vibe64-genesis/src/server/packaging.js");
  const { root, commit } = await gitProject(t, {
    "pyproject.toml": "[project]\nname = \"weather-kit\"\n",
    "weather_kit/__init__.py": "",
    "genesis/stack.md": "# Stack\n",
    ".genesis/machine-city.json": "{}\n",
    ".agents/skills/genesis-project/SKILL.md": "skill\n",
    ".claude/settings.json": "{}\n",
    ".codex/hooks.json": "{}\n",
    ".opencode/plugins/genesis-project-guidance.js": "export {};\n",
    "docs/genesis.md": "kept: only the top-level folders are left out\n"
  });
  const scratch = await mkdtemp(path.join(os.tmpdir(), "vibe64-export-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const bare = path.join(scratch, "canonical.git");
  await run("git", ["clone", "-q", "--bare", root, bare]);
  for (const [label, projectRoot] of [["checkout", root], ["bare", bare]]) {
    const directory = path.join(scratch, label);
    await exportSavedCommit({ projectRoot, commit, directory, exclude: VIBE64_PACKAGING_SOURCE_EXCLUSIONS });
    for (const left of ["genesis", ".genesis", ".agents", ".claude", ".codex", ".opencode"]) {
      await assert.rejects(stat(path.join(directory, left)), `${label} export leaves out ${left}`);
    }
    assert.ok(await stat(path.join(directory, "weather_kit", "__init__.py")), `${label} keeps the package`);
    assert.ok(await stat(path.join(directory, "docs", "genesis.md")), `${label} keeps nested files that only share the name`);
  }
  const { stdout } = await run("git", ["-C", root, "status", "--porcelain"]);
  assert.equal(stdout, "", "the project's own index and worktree are untouched");
});
