import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  ADD_AI_STUDIO_GITIGNORE_RULES_ACTION_ID,
  AI_STUDIO_LOCAL_STATE_GITIGNORE_PATTERNS
} from "../../server/lib/setupDoctorGit.js";
import {
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectProjectSetup
} from "../../packages/project-setup-doctor/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

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

async function withLinkedWorktree(callback) {
  return withTemporaryRoot(async (repoRoot) => {
    return withTemporaryRoot(async (worktreeRoot) => {
      runGit(repoRoot, ["init", "-b", "main"]);
      runGit(repoRoot, ["config", "user.name", "Studio Test"]);
      runGit(repoRoot, ["config", "user.email", "studio-test@example.com"]);
      await writeFile(path.join(repoRoot, "README.md"), "# Test\n", "utf8");
      runGit(repoRoot, ["add", "README.md"]);
      runGit(repoRoot, ["commit", "-m", "Initial commit"]);
      runGit(repoRoot, ["worktree", "add", "-b", "studio-test", worktreeRoot]);
      return callback(worktreeRoot);
    });
  });
}

async function createGitRepository(root) {
  runGit(root, ["init", "-b", "main"]);
}

test("Project Setup hard-stops when a non-git directory already has files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
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
});

test("Project Setup blocks an empty directory at Git initialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
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
});

test("Project Setup treats .ai-studio as bootstrap state in an otherwise empty directory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".ai-studio", "config"), {
      recursive: true
    });
    await writeFile(path.join(targetRoot, ".ai-studio", "project_type"), "jskit\n", "utf8");

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.ready, false);
    assert.equal(status.hardStop, false);
    assert.equal(status.stages[0].status, "pass");
    assert.match(status.stages[0].observed, /\.ai-studio/u);
    assert.equal(status.currentStageId, "git-ready");
    assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.repair?.actionId, "terminal-git-init");
  });
});

test("Project Setup admits linked Git worktrees before Git safety checks", async () => {
  await withLinkedWorktree(async (worktreeRoot) => {
    const status = await inspectProjectSetup({
      targetRoot: worktreeRoot
    });

    assert.equal(status.stages.find((stage) => stage.id === "directory")?.status, "pass");
    assert.match(status.stages.find((stage) => stage.id === "directory")?.observed || "", /linked Git metadata/u);
    assert.notEqual(status.currentStageId, "directory");
  });
});

test("Project Setup blocks before remote setup when AI Studio ignore rules are missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const status = await inspectProjectSetup({
      targetRoot
    });

    const ignoreStage = status.stages.find((stage) => stage.id === "ai-studio-gitignore");
    assert.equal(status.currentStageId, "ai-studio-gitignore");
    assert.equal(ignoreStage?.status, "blocked");
    assert.equal(ignoreStage?.repair?.actionId, ADD_AI_STUDIO_GITIGNORE_RULES_ACTION_ID);
    for (const pattern of AI_STUDIO_LOCAL_STATE_GITIGNORE_PATTERNS) {
      assert.match(ignoreStage?.observed || "", new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.match(ignoreStage?.repair?.commandPreview || "", new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "pending");
  });
});

test("Project Setup retries automatic repairs when the same check reports a new blocker", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const attempts = [];
    let ignoreRuleRepairAttempts = 0;

    const status = await inspectProjectSetup({
      autoRepair: true,
      startAutomaticRepair: async ({
        repair
      }) => {
        attempts.push(repair.actionId);
        if (repair.actionId === ADD_AI_STUDIO_GITIGNORE_RULES_ACTION_ID) {
          ignoreRuleRepairAttempts += 1;
          await writeFile(
            path.join(targetRoot, ".gitignore"),
            `${AI_STUDIO_LOCAL_STATE_GITIGNORE_PATTERNS.slice(0, ignoreRuleRepairAttempts).join("\n")}\n`,
            "utf8"
          );
          return {
            exitCode: 0,
            ok: true,
            output: "updated .gitignore",
            status: "exited"
          };
        }
        return {
          error: "gh unavailable",
          exitCode: 1,
          ok: false,
          output: "gh unavailable",
          status: "exited"
        };
      },
      targetRoot
    });

    assert.deepEqual(attempts, [
      ADD_AI_STUDIO_GITIGNORE_RULES_ACTION_ID,
      ADD_AI_STUDIO_GITIGNORE_RULES_ACTION_ID,
      "terminal-gh-create-repo"
    ]);
    assert.equal(status.stages.find((stage) => stage.id === "ai-studio-gitignore")?.status, "pass");
    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "blocked");
    assert.match(status.stages.find((stage) => stage.id === "remote-ready")?.observed || "", /Automatic repair failed/u);
    assert.match(status.stages.find((stage) => stage.id === "remote-ready")?.observed || "", /gh unavailable/u);
  });
});

test("Project Setup continues to remote setup when AI Studio ignore rules are present", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    await writeFile(
      path.join(targetRoot, ".gitignore"),
      `${AI_STUDIO_LOCAL_STATE_GITIGNORE_PATTERNS.join("\n")}\n`,
      "utf8"
    );

    const status = await inspectProjectSetup({
      targetRoot
    });

    assert.equal(status.stages.find((stage) => stage.id === "ai-studio-gitignore")?.status, "pass");
    assert.equal(status.currentStageId, "remote-ready");
    assert.equal(status.stages.find((stage) => stage.id === "remote-ready")?.status, "blocked");
  });
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
  assert.match(script, /if \[ "\$\(id -u\)" = "0" \] && command -v setpriv/u);
  assert.match(script, /setpriv --reuid "\$AI_STUDIO_HOST_UID" --regid "\$AI_STUDIO_HOST_GID"/u);
  assert.match(script, /if \[ "\$\(id -u\)" = "0" \]; then chown "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace commit -m "\$AI_STUDIO_COMMIT_MESSAGE"/u);
  assert.match(script, /remote_ref="refs\/heads\/\$branch"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace -c credential\.helper= push -u origin "HEAD:\$remote_ref"/u);
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
