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
  createService as createProjectService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  gitSafeDirectoryArgs,
  linkedGitMetadataHostSource,
  linkedGitRepositoryHostSource
} from "@local/studio-terminal-core/server/gitHostCommandPaths";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
} from "@local/vibe64-core/server/projectRepository";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

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
  assert.match(ghRepair.commandPreview, /git_safe rev-parse --verify HEAD/u);
  assert.equal(repoNameFromTargetRoot(targetRoot), "Example-Target-App");
});

test("Adapter Setup host command resolves linked worktree Git metadata", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-adapter-linked-worktree-"));
  const worktreeRoot = path.join(repoRoot, ".vibe64", "sessions", "active", "example", "source");
  const gitDir = path.join(repoRoot, ".git", "worktrees", "example");
  const gitMetadataRoot = path.join(repoRoot, ".git");

  await mkdir(worktreeRoot, { recursive: true });
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(worktreeRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");

  assert.equal(linkedGitMetadataHostSource(worktreeRoot), gitMetadataRoot);
  assert.equal(linkedGitRepositoryHostSource(worktreeRoot), repoRoot);
  assert.deepEqual(gitSafeDirectoryArgs(worktreeRoot), [
    "-c",
    `safe.directory=${worktreeRoot}`
  ]);
  assert.match(gitInitRepair(worktreeRoot).commandPreview, /git .*init/u);
});

test("Adapter Setup GitHub repo repair links existing repos and only pushes when commits exist", () => {
  const script = ghRepoCreateScript("example-target-app");

  assert.match(script, /owner=\$\(gh api user --jq \.login\)/u);
  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.doesNotMatch(script, /git config --global --add safe\.directory/u);
  assert.match(script, /git_safe\(\) \{ git -c safe\.directory="\$PWD" "\$@"; \}/u);
  assert.match(script, /git_safe remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
  assert.match(script, /if git_safe rev-parse --verify HEAD/u);
  assert.match(script, /git_safe push -u origin HEAD/u);
  assert.match(script, /linked origin without pushing/u);
  assert.match(script, /gh repo create "\$repo_name" --private/u);
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
  const targetRoot = path.join(os.tmpdir(), `vibe64-missing-${Date.now()}`);
  const status = await inspectAdapterSetup({
    studioRoot: process.cwd(),
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.checks.find((check) => check.id === "target-directory")?.status, "fail");
  assert.equal(status.checks.find((check) => check.id === "git-repository")?.observed, "Target directory is not ready.");
  assert.equal(status.checks.find((check) => check.id === "github-issues-prs"), undefined);

  const githubStatus = await inspectAdapterSetup({
    studioRoot: process.cwd(),
    targetRoot,
    workflowRepositoryProfile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
  });
  assert.equal(githubStatus.checks.find((check) => check.id === "github-issues-prs")?.observed, "Target directory is not ready.");
});

test("Adapter Setup local profile does not require a GitHub remote", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    runGit(targetRoot, ["init", "-b", "main"]);
    runGit(targetRoot, ["config", "user.name", "Studio Test"]);
    runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
    await writeFile(path.join(targetRoot, "README.md"), "# Local adapter setup\n", "utf8");
    runGit(targetRoot, ["add", "README.md"]);
    runGit(targetRoot, ["commit", "-m", "Initial commit"]);

    const status = await inspectAdapterSetup({
      studioRoot: process.cwd(),
      targetRoot
    });

    assert.equal(status.checks.find((check) => check.id === "git-remote"), undefined);
    assert.equal(status.checks.find((check) => check.id === "github-repository"), undefined);
    assert.equal(status.checks.find((check) => check.id === "github-issues-prs"), undefined);
  });
});

test("Adapter Setup allows JSKIT self-targeting when the target package is Vibe64", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeFile(path.join(targetRoot, "package.json"), JSON.stringify({
      name: "vibe64"
    }), "utf8");

    const projectService = createProjectService({
      targetRoot
    });
    await projectService.saveProjectType({
      projectType: "jskit"
    });
    const config = await projectService.saveProjectConfig({
      values: {
        github_pr_merge_method: "merge",
        jskit_database_runtime: "none"
      }
    });
    assert.equal(config.ok, true);

    const allowed = await inspectAdapterSetup({
      projectService,
      studioRoot: targetRoot,
      targetRoot
    });
    const identity = allowed.checks.find((check) => check.id === "target-identity");
    assert.equal(identity?.status, "pass");
    assert.match(identity?.explanation || "", /self-development mode/u);
  });
});
