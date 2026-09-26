import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { addGenesisStack, initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { inspectCanonicalProjectStack } from "../../packages/vibe64-terminals/src/server/projectStackInspection.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
async function git(cwd, args) {
  return (await exec("git", args, { cwd, maxBuffer: 2 * 1024 ** 2 })).stdout.trim();
}
async function runCommand(request) {
  try {
    const result = await exec(request.command, request.args, { cwd: request.cwd, maxBuffer: request.maxBuffer || 2 * 1024 ** 2, signal: request.signal });
    return { ok: true, ...result };
  } catch (error) { return { ok: false, stderr: error.stderr, stdout: error.stdout }; }
}
async function fixture(root, mode = "managed_git") {
  const source = path.join(root, "publisher");
  const repository = path.join(root, "repository.git");
  const temporaryRoot = path.join(root, "tmp");
  await mkdir(source);
  await git(source, ["init", "--initial-branch=stable"]);
  await git(source, ["config", "user.name", "Test"]);
  await git(source, ["config", "user.email", "test@example.test"]);
  await initializeGenesisProject({ projectRoot: source });
  await addGenesisStack({ projectRoot: source, pieces: ["nodejs"] });
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "Initial"]);
  await git(root, ["clone", "--bare", source, repository]);
  const project = { repositoryMode: mode, repository: { mode, defaultBranch: "stable" },
    canonicalRepositoryPath: repository, githubRepository: { cloneUrl: repository },
    githubMirrorPath: path.join(root, "runtime/github-mirror/repository.git") };
  return { source, repository, project, temporaryRoot, runCommand };
}

test("saved Stack uses the configured canonical branch with no session and removes inspection files", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root);
    await writeFile(path.join(context.source, "genesis/stack.md"), "uncommitted and invalid");
    const result = await inspectCanonicalProjectStack(context);
    assert.deepEqual(result.components, ["nodejs"]);
    assert.equal(result.branch, "stable");
    assert.equal(result.commit, await git(root, ["--git-dir", context.repository, "rev-parse", "stable"]));
    assert.deepEqual(await readdir(context.temporaryRoot), []);
  });
});

test("GitHub inspection verifies the remote even with a warm mirror and picks up a changed branch", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root, "github");
    const first = await inspectCanonicalProjectStack(context);
    await addGenesisStack({ projectRoot: context.source, pieces: ["python"] });
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Python"]);
    await git(context.source, ["push", context.repository, "stable"]);
    const second = await inspectCanonicalProjectStack(context);
    assert.notEqual(second.commit, first.commit);
    assert.ok(second.components.includes("python"));
    await git(root, ["--git-dir", context.repository, "update-ref", "refs/heads/stable", first.commit]);
    const rewound = await inspectCanonicalProjectStack(context);
    assert.equal(rewound.commit, first.commit);
    assert.deepEqual(rewound.components, ["nodejs"]);
    await assert.rejects(inspectCanonicalProjectStack({ ...context, runCommand: (request) =>
      request.args.includes("ls-remote") ? { ok: false } : runCommand(request)
    }), { code: "vibe64_stack_repository_read_failed" });
    assert.deepEqual(await readdir(context.temporaryRoot), []);
  });
});

test("a missing mirror can read verified GitHub objects without making a session checkout", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root, "github");
    context.project.githubMirrorPath = "";
    assert.deepEqual((await inspectCanonicalProjectStack(context)).components, ["nodejs"]);
    assert.deepEqual(await readdir(context.temporaryRoot), []);
  });
});

test("unsupported formats and linked Stack inputs fail without touching the source", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root);
    const stack = await readFile(path.join(context.source, "genesis/stack.md"), "utf8");
    await rm(path.join(context.source, "genesis/version"));
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Unversioned"]);
    await git(context.source, ["push", context.repository, "stable"]);
    await assert.rejects(inspectCanonicalProjectStack(context), { code: "vibe64_stack_format_required" });
    await rm(path.join(context.source, "genesis/stack.md"));
    await symlink("/etc/passwd", path.join(context.source, "genesis/stack.md"));
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Linked"]);
    await git(context.source, ["push", context.repository, "stable"]);
    await assert.rejects(inspectCanonicalProjectStack(context), { code: "vibe64_stack_input_unsafe" });
    assert.ok(stack.includes("nodejs"));
    assert.deepEqual(await readdir(context.temporaryRoot), []);
  });
});


test("changing the saved branch takes effect, while a session branch never chooses workspace technologies", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root);
    await git(context.source, ["checkout", "-b", "feature"]);
    await addGenesisStack({ projectRoot: context.source, pieces: ["python"] });
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Feature technology"]);
    await git(context.source, ["push", context.repository, "feature"]);
    context.project.sessionSource = { branch: "feature", pullRequestNumber: 42 };
    assert.deepEqual((await inspectCanonicalProjectStack(context)).components, ["nodejs"]);
    context.project.repository.defaultBranch = "feature";
    assert.ok((await inspectCanonicalProjectStack(context)).components.includes("python"));
  });
});

test("missing or oversized saved Stack fails instead of becoming an empty selection", async () => {
  await withTemporaryRoot(async (root) => {
    const context = await fixture(root);
    await rm(path.join(context.source, "genesis/stack.md"));
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Missing Stack"]);
    await git(context.source, ["push", context.repository, "stable"]);
    await assert.rejects(inspectCanonicalProjectStack(context));
    await writeFile(path.join(context.source, "genesis/stack.md"), "# Stack\n\n## Components\n- `unsupported-component`\n");
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Invalid component"]);
    await git(context.source, ["push", context.repository, "stable"]);
    await assert.rejects(inspectCanonicalProjectStack(context));
    await writeFile(path.join(context.source, "genesis/stack.md"), "x".repeat(1024 * 1024 + 1));
    await git(context.source, ["add", "."]);
    await git(context.source, ["commit", "-m", "Oversized Stack"]);
    await git(context.source, ["push", context.repository, "stable"]);
    await assert.rejects(inspectCanonicalProjectStack(context), /too large/u);
    assert.deepEqual(await readdir(context.temporaryRoot), []);
  });
});
