import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectProjectSetup
} from "../../packages/project-setup-doctor/src/server/service.js";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function createLinkedWorktree() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-project-linked-repo-"));
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-project-linked-worktree-"));

  runGit(repoRoot, ["init", "-b", "main"]);
  runGit(repoRoot, ["config", "user.name", "Studio Test"]);
  runGit(repoRoot, ["config", "user.email", "studio-test@example.com"]);
  await writeFile(path.join(repoRoot, "README.md"), "# Test\n", "utf8");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "Initial commit"]);
  runGit(repoRoot, ["worktree", "add", "-b", "studio-test", worktreeRoot]);
  return worktreeRoot;
}

test("Project Setup hard-stops when a non-git directory already has files", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-project-files-"));
  await writeFile(path.join(targetRoot, "notes.txt"), "existing work\n", "utf8");

  const status = await inspectProjectSetup({
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.currentStageId, "directory");
  assert.equal(status.hardStop, true);
  assert.equal(status.stages[0].status, "hard-stop");
  assert.match(status.stages[0].observed, /notes\.txt/u);
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "pending");
});

test("Project Setup blocks an empty directory at Git initialization", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-project-empty-"));

  const status = await inspectProjectSetup({
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.hardStop, false);
  assert.equal(status.stages[0].status, "pass");
  assert.equal(status.currentStageId, "git-ready");
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "blocked");
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.repair?.actionId, "terminal-git-init");
});

test("Project Setup admits linked Git worktrees before Git safety checks", async () => {
  const worktreeRoot = await createLinkedWorktree();

  const status = await inspectProjectSetup({
    targetRoot: worktreeRoot
  });

  assert.equal(status.stages.find((stage) => stage.id === "directory")?.status, "pass");
  assert.match(status.stages.find((stage) => stage.id === "directory")?.observed || "", /linked Git metadata/u);
  assert.notEqual(status.currentStageId, "directory");
});

test("Project Setup GitHub repo repair links existing repos and only pushes when commits exist", () => {
  const script = ghRepoCreateScript("exampleapp");

  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.match(script, /git remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
  assert.match(script, /if git rev-parse --verify HEAD/u);
  assert.match(script, /--push/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Project Setup checkpoint repair commits and pushes the baseline", () => {
  const script = gitCheckpointScript();

  assert.match(script, /gh auth token/u);
  assert.match(script, /GIT_ASKPASS=\/tmp\/ai-studio-git-askpass/u);
  assert.match(script, /setpriv --reuid "\$AI_STUDIO_HOST_UID" --regid "\$AI_STUDIO_HOST_GID"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace commit -m "\$AI_STUDIO_COMMIT_MESSAGE"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace -c credential\.helper= push -u origin HEAD/u);
  assert.match(script, /GIT_TERMINAL_PROMPT=0/u);
  assert.doesNotMatch(script, /Working tree is already clean/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Project Setup builds GitHub branch ref API paths", () => {
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "main"),
    "repos/mercmobily/exampleapp/git/ref/heads/main"
  );
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "feature/setup baseline"),
    "repos/mercmobily/exampleapp/git/ref/heads/feature/setup%20baseline"
  );
});
