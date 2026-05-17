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
  createService,
  ghRepoCreateRepair,
  ghRepoCreateScript,
  gitIdentityRepair,
  gitInitRepair,
  inspectAdapterSetup,
  isAdapterSetupReady,
  repoNameFromTargetRoot,
  validateGitIdentityInputs
} from "../../packages/adapter-setup-doctor/src/server/service.js";
import {
  terminalInputValidator
} from "../../packages/adapter-setup-doctor/src/server/inputSchemas.js";
import {
  gitSafeDirectoryArgs,
  gitToolchainMountArgs,
  linkedGitMetadataMountSource,
  linkedGitRepositoryMountSource
} from "../../server/lib/gitToolchainMounts.js";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

test("Adapter Setup readiness requires every required check to pass", () => {
  assert.equal(isAdapterSetupReady([
    { required: true, status: "pass" },
    { required: true, status: "pass" }
  ]), true);
  assert.equal(isAdapterSetupReady([
    { required: true, status: "pass" },
    { required: true, status: "fail" }
  ]), false);
});

test("Adapter Setup repair commands stay explicit", () => {
  const targetRoot = path.join("/", "tmp", "Example Target App");
  const gitRepair = gitInitRepair(targetRoot);
  const identityRepair = gitIdentityRepair();
  const ghRepair = ghRepoCreateRepair(targetRoot);

  assert.equal(gitRepair.kind, "terminal");
  assert.equal(gitRepair.label, "Initialize Git");
  assert.match(gitRepair.commandPreview, /git .*init/u);
  assert.equal(identityRepair.kind, "terminal");
  assert.equal(identityRepair.label, "Set Git identity");
  assert.deepEqual(identityRepair.fields.map((field) => field.id), ["name", "email"]);
  assert.match(identityRepair.commandPreview, /git config --global user\.name/u);
  assert.equal(ghRepair.kind, "terminal");
  assert.equal(ghRepair.label, "Create/link GitHub repo");
  assert.match(ghRepair.commandPreview, /gh repo create/u);
  assert.match(ghRepair.commandPreview, /git rev-parse --verify HEAD/u);
  assert.equal(repoNameFromTargetRoot(targetRoot), "Example-Target-App");
});

test("Adapter Setup toolchain mounts linked worktree Git metadata", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "ai-studio-adapter-linked-worktree-"));
  const worktreeRoot = path.join(repoRoot, ".ai-studio", "sessions", "active", "example", "worktree");
  const gitDir = path.join(repoRoot, ".git", "worktrees", "example");
  const gitMetadataRoot = path.join(repoRoot, ".git");

  await mkdir(worktreeRoot, { recursive: true });
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");

  assert.equal(linkedGitMetadataMountSource(worktreeRoot), gitMetadataRoot);
  assert.equal(linkedGitRepositoryMountSource(worktreeRoot), repoRoot);
  assert.deepEqual(gitToolchainMountArgs(worktreeRoot), [
    "-v",
    `${repoRoot}:${repoRoot}`
  ]);
  assert.deepEqual(gitSafeDirectoryArgs(worktreeRoot), [
    "-c",
    "safe.directory=/workspace",
    "-c",
    `safe.directory=${worktreeRoot}`
  ]);
  assert.match(gitInitRepair(worktreeRoot).commandPreview, new RegExp(`${repoRoot}:${repoRoot}`));
});

test("Adapter Setup GitHub repo repair links existing repos and only pushes when commits exist", () => {
  const script = ghRepoCreateScript("example-target-app");

  assert.match(script, /owner=\$\(gh api user --jq \.login\)/u);
  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.match(script, /git remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
  assert.match(script, /if git rev-parse --verify HEAD/u);
  assert.match(script, /--push/u);
  assert.match(script, /linked origin without pushing/u);
  assert.match(script, /gh repo create "\$repo_name" --source=\. --remote=origin --private/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("Adapter Setup terminal input preserves enter/control characters", () => {
  const result = terminalInputValidator.schema.create({
    data: "\r"
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.validatedObject.data, "\r");
});

test("Adapter Setup validates parameterized Git identity repair inputs", () => {
  assert.deepEqual(validateGitIdentityInputs({
    email: "dev@example.com",
    name: "Dev User"
  }), {
    email: "dev@example.com",
    name: "Dev User",
    ok: true
  });
  assert.equal(validateGitIdentityInputs({
    email: "dev@example.com",
    name: ""
  }).ok, false);
  assert.equal(validateGitIdentityInputs({
    email: "not-an-email",
    name: "Dev User"
  }).ok, false);
});

test("Adapter Setup rejects Git identity terminal repair without valid inputs", () => {
  const service = createService({
    studioRoot: process.cwd(),
    targetRoot: os.tmpdir()
  });
  const response = service.startTerminal({
    actionId: "terminal-git-identity",
    inputs: {
      email: "not-an-email",
      name: ""
    }
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /user\.name/u);
});

test("Adapter Setup blocks dependent checks when target directory is unavailable", async () => {
  const targetRoot = path.join(os.tmpdir(), `ai-studio-missing-${Date.now()}`);
  const status = await inspectAdapterSetup({
    studioRoot: process.cwd(),
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.checks.find((check) => check.id === "target-directory")?.status, "fail");
  assert.equal(status.checks.find((check) => check.id === "git-repository")?.observed, "Target directory is not ready.");
  assert.equal(status.checks.find((check) => check.id === "github-auth")?.observed, "Target directory is not ready.");
});
