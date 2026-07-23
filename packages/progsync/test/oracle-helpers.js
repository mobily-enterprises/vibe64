import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

const GREETING_PROGRAM = `# Greeting

Produces a personalized greeting.

## Uses

- Nothing outside this file.

## Provides

### \`greet()\`

#### Parameters

* \`name\`: the recipient name as text

#### What it does

It places \`Hello, \` before \`name\` and \`!\` after it.

#### Returns

The resulting greeting as text.
`;

const COMMAND_PROGRAM = `# Example command

## Uses

- Nothing outside this file.

## Provides

### \`example\`

#### Parameters

No parameters.

#### What it does

It completes successfully without producing output.

#### Returns

No direct value; the process status is zero.
`;

async function writeFiles(root, files) {
  for (const [relativePath, source] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, source, "utf8");
  }
}

async function git(root, args) {
  const result = await executeFile("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return result.stdout;
}

async function createGitProject(t, files = {}, packageManifest = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-v2-oracle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeFiles(root, {
    "package.json": `${JSON.stringify({
      name: "progsync-oracle-fixture",
      private: true,
      type: "module",
      ...packageManifest
    }, null, 2)}\n`,
    ...files
  });
  await git(root, ["init", "--quiet"]);
  await git(root, ["add", "--all"]);
  await git(root, [
    "-c", "user.name=ProgSync Oracle",
    "-c", "user.email=oracle@local",
    "commit", "--quiet", "-m", "fixture"
  ]);
  return root;
}

function report(
  mode,
  status = "updated",
  summary = "Oracle candidate",
  changes = {}
) {
  return {
    status,
    mode,
    summary,
    programChanges: changes.programChanges ?? [],
    implementationChanges: changes.implementationChanges ?? (
      status === "updated"
        ? ["Applied the requested managed implementation change."]
        : []
    ),
    preservedImplementationDetails: [],
    sharedDefinitionProposals: [],
    diagnostics: [],
    verificationPerformed: status === "unchanged"
      ? ["Compared the complete public Program surface and managed implementation."]
      : [],
    verificationStillRequired: []
  };
}

async function readContext(workspaceRoot) {
  return JSON.parse(await fs.readFile(
    path.join(workspaceRoot, ".progsync/context.json"),
    "utf8"
  ));
}

async function writeWorkspace(workspaceRoot, relativePath, source, mode = null) {
  const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, source, "utf8");
  if (mode !== null) {
    await fs.chmod(absolutePath, mode);
  }
}

export {
  COMMAND_PROGRAM,
  GREETING_PROGRAM,
  createGitProject,
  git,
  readContext,
  report,
  writeFiles,
  writeWorkspace
};
