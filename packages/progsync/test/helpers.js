import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runProgSyncCommand } from "../src/command.js";

async function writeFiles(root, files) {
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, source, "utf8");
  }
}

async function createGitProject(t, files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "package.json": "{\n  \"name\": \"fixture\",\n  \"private\": true,\n  \"type\": \"module\"\n}\n",
    ...files
  });
  await runProgSyncCommand("git", ["init", "--quiet"], { cwd: root });
  await runProgSyncCommand("git", ["add", "--all"], { cwd: root });
  await runProgSyncCommand("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

function synchronizationReport(mode, status = "updated", summary = "Fixture synchronization") {
  return {
    status,
    mode,
    summary,
    programChanges: [],
    implementationChanges: [],
    preservedImplementationDetails: [],
    sharedDefinitionProposals: [],
    diagnostics: [],
    verificationPerformed: status === "unchanged"
      ? ["Compared the complete Program and implementation surfaces."]
      : [],
    verificationStillRequired: []
  };
}

async function readContext(workspaceRoot) {
  return JSON.parse(
    await fs.readFile(path.join(workspaceRoot, ".progsync", "context.json"), "utf8")
  );
}

async function writeWorkspace(workspaceRoot, relativePath, source) {
  const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, source, "utf8");
}

export {
  createGitProject,
  readContext,
  synchronizationReport,
  writeFiles,
  writeWorkspace
};
