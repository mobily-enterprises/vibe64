import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  commitChangesTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/commitPush";
import {
  createPrOnGhTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/issuePr";
import {
  mergePrTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/mergeSync";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function createGitRepository(root) {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.email", "vibe64@example.test"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Vibe64 Test"], {
    cwd: root
  });
}

async function gitOutput(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd
  });
  return String(result.stdout || "").trim();
}

async function writeSessionMetadata(root, values = {}) {
  await mkdir(root, {
    recursive: true
  });
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(path.join(root, name), `${value}\n`)));
}

function decodedFactLines(text = "") {
  return String(text || "").trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [, name, encodedValue] = line.split("\t");
    return [name, Buffer.from(encodedValue || "", "base64").toString("utf8")];
  });
}

test("create PR command treats an existing branch pull request as success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await createPrOnGhTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: {
          base_branch: "main",
          branch: "vibe64/test-session",
          source_path: targetRoot
        },
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.commandPreview, "gh pr create");

    const script = spec.args.at(-1);
    const lookupIndex = script.indexOf("find_existing_pull_request_url()");
    const createIndex = script.indexOf("gh pr create");
    assert.ok(lookupIndex > -1);
    assert.ok(createIndex > -1);
    assert.ok(lookupIndex < createIndex);
    assert.match(script, /gh pr list --head "\$PR_HEAD" --base "\$BASE_BRANCH" --state open/u);
    assert.match(script, /GitHub pull request already exists/u);
    assert.match(script, /\.vibe64\/artifacts\/tmp\/create_and_merge_pull_request\.title\.txt/u);
    assert.match(script, /\.vibe64\/artifacts\/tmp\/create_and_merge_pull_request\.body\.md/u);
    assert.match(script, /vibe64_require_tmp_artifact title\.txt 'pull request title artifact'/u);
    assert.match(script, /vibe64_require_tmp_artifact body\.md 'pull request body artifact'/u);
    assert.match(script, /rm -f "\$\(vibe64_tmp_artifact_path title\.txt\)"/u);
    assert.match(script, /rm -f "\$\(vibe64_tmp_artifact_path body\.md\)"/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' pr_url/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' pr_title/u);
    assert.match(script, /if ! PR_URL="\$\(gh pr create/u);
  });
});

test("create PR command stacks new pull requests on selected existing PRs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await createPrOnGhTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: {
          base_branch: "feature-base",
          branch: "vibe64/test-session",
          source_pr_head_ref: "feature-base",
          source_pr_head_sha: "abc123",
          source_pr_number: "77",
          source_pr_url: "https://github.com/example/project/pull/77",
          source_path: targetRoot
        },
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);

    const script = spec.args.at(-1);
    assert.match(script, /BASE_BRANCH=feature-base/u);
    assert.match(script, /SOURCE_PR_NUMBER=77/u);
    assert.match(script, /SOURCE_PR_HEAD_SHA=abc123/u);
    assert.match(script, /Validating stacked PR base/u);
    assert.match(script, /gh pr view "\$SOURCE_PR_NUMBER" --json state/u);
    assert.match(script, /gh pr view "\$SOURCE_PR_NUMBER" --json headRefOid/u);
    assert.match(script, /PR_SOURCE=stacked/u);
    assert.match(script, /Stacks on existing pull request: %s/u);
    assert.match(script, /gh pr create --base "\$BASE_BRANCH" --head "\$PR_HEAD"/u);
    assert.doesNotMatch(script, /PR_SOURCE=replacement/u);
    assert.doesNotMatch(script, /Continues existing pull request/u);
  });
});

test("commit command always pushes the session branch for existing PR sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: {
          base_branch: "feature-base",
          branch: "vibe64/test-session",
          source_pr_head_ref: "feature-base",
          source_pr_head_repo: "example/project",
          pr_source: "existing",
          source_pr_update_mode: "direct",
          source_path: targetRoot
        },
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);

    const script = spec.args.at(-1);
    assert.match(script, /BASE_BRANCH=feature-base/u);
    assert.match(script, /git push -u origin "\$CURRENT_BRANCH"/u);
    assert.match(script, /if ! git remote get-url origin/u);
    assert.match(script, /gh repo fork "\$UPSTREAM_REPOSITORY" --clone=false --remote=false/u);
    assert.match(script, /git push -u vibe64-fork "\$CURRENT_BRANCH"/u);
    assert.match(script, /VIBE64_COMMAND_FACT_VALUE="\$CURRENT_BRANCH"/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' branch_pushed/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' branch_push_remote/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' pr_head_owner/u);
    assert.doesNotMatch(script, /HEAD:refs\/heads\/\$SOURCE_PR_HEAD_REF/u);
  });
});

test("commit command applies seed commits locally when no origin remote exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, "README.md"), "Initial\n");
    await execFileAsync("git", ["add", "README.md"], {
      cwd: targetRoot
    });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], {
      cwd: targetRoot
    });
    const baseCommit = await gitOutput(targetRoot, ["rev-parse", "HEAD"]);
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", "test-session");
    const worktreePath = path.join(sessionRoot, "source");
    await mkdir(path.dirname(worktreePath), {
      recursive: true
    });
    await execFileAsync("git", ["worktree", "add", "-b", "vibe64/test-session", worktreePath, "HEAD"], {
      cwd: targetRoot
    });
    await writeFile(path.join(worktreePath, "README.md"), "Changed locally\n");

    const artifactsRoot = path.join(sessionRoot, "artifacts");
    const metadataRoot = path.join(sessionRoot, "metadata");
    await writeSessionMetadata(metadataRoot, {
      work_title: "Local seed"
    });
    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot,
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/test-session",
          work_source: "seed",
          source_path: worktreePath
        },
        metadataRoot,
        sessionId: "test-session",
        targetRoot
      }
    });
    assert.equal(spec.ok, true);

    const resultFile = path.join(targetRoot, "facts.txt");
    await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const targetHead = await gitOutput(targetRoot, ["rev-parse", "HEAD"]);
    const worktreeHead = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
    assert.equal(targetHead, worktreeHead);
    assert.equal(await readFile(path.join(targetRoot, "README.md"), "utf8"), "Changed locally\n");
    assert.equal(await gitOutput(targetRoot, ["branch", "--show-current"]), "main");

    const facts = Object.fromEntries(decodedFactLines(await readFile(resultFile, "utf8")));
    assert.equal(facts.accepted_commit, worktreeHead);
    assert.equal(facts.local_commit_only, "yes");
    assert.equal(facts.main_checkout_synced, "yes");
    assert.equal(facts.branch_pushed, undefined);
  });
});

test("commit command publishes the local base branch before pushing seed work to an empty remote", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    await writeFile(path.join(targetRoot, "README.md"), "Initial\n");
    await execFileAsync("git", ["add", "README.md"], {
      cwd: targetRoot
    });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], {
      cwd: targetRoot
    });
    const baseCommit = await gitOutput(targetRoot, ["rev-parse", "HEAD"]);
    const remotePath = path.join(path.dirname(targetRoot), "origin.git");
    await execFileAsync("git", ["init", "--bare", remotePath]);
    await execFileAsync("git", ["remote", "add", "origin", remotePath], {
      cwd: targetRoot
    });
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", "test-session");
    const worktreePath = path.join(sessionRoot, "source");
    await mkdir(path.dirname(worktreePath), {
      recursive: true
    });
    await execFileAsync("git", ["worktree", "add", "-b", "vibe64/test-session", worktreePath, "HEAD"], {
      cwd: targetRoot
    });
    await writeFile(path.join(worktreePath, "README.md"), "Changed for remote\n");

    const artifactsRoot = path.join(sessionRoot, "artifacts");
    const metadataRoot = path.join(sessionRoot, "metadata");
    await writeSessionMetadata(metadataRoot, {
      work_title: "Remote seed"
    });
    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot,
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/test-session",
          work_source: "seed",
          source_path: worktreePath
        },
        metadataRoot,
        sessionId: "test-session",
        targetRoot
      }
    });

    const resultFile = path.join(targetRoot, "facts.txt");
    await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const worktreeHead = await gitOutput(worktreePath, ["rev-parse", "HEAD"]);
    assert.equal(await gitOutput(targetRoot, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]), baseCommit);
    assert.equal(await gitOutput(targetRoot, ["--git-dir", remotePath, "rev-parse", "refs/heads/vibe64/test-session"]), worktreeHead);

    const facts = Object.fromEntries(decodedFactLines(await readFile(resultFile, "utf8")));
    assert.equal(facts.accepted_commit, worktreeHead);
    assert.equal(facts.branch_pushed, "vibe64/test-session");
    assert.equal(facts.branch_push_remote, "origin");
    assert.equal(facts.local_commit_only, undefined);
  });
});

test("create PR command uses fork head metadata when the branch was pushed to a fork", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await createPrOnGhTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: {
          base_branch: "main",
          branch: "vibe64/test-session",
          branch_push_remote: "vibe64-fork",
          pr_head_owner: "octocat",
          source_path: targetRoot
        },
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);

    const script = spec.args.at(-1);
    assert.match(script, /BRANCH_PUSH_REMOTE=vibe64-fork/u);
    assert.match(script, /PR_HEAD_OWNER=octocat/u);
    assert.match(script, /PR_HEAD="\$PR_HEAD_OWNER:\$EXPECTED_BRANCH"/u);
    assert.match(script, /git ls-remote --exit-code --heads "\$BRANCH_PUSH_REMOTE" "\$EXPECTED_BRANCH"/u);
    assert.match(script, /gh pr create --base "\$BASE_BRANCH" --head "\$PR_HEAD"/u);
  });
});

test("merge PR command does not write missing hook objects into the shell script", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: {
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    assert.doesNotMatch(script, /\[object Object\]/u);
    assert.match(script, /gh pr merge https:\/\/github\.com\/example\/project\/pull\/12 --merge/u);
  });
});

test("merge PR command comments with merge preparation work after a successful merge", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: {
          merge_preparation_summary: "- Resolved a merge conflict before merging.",
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    const mergeIndex = script.indexOf("gh pr merge https://github.com/example/project/pull/12 --merge");
    const commentIndex = script.indexOf("gh pr comment https://github.com/example/project/pull/12 --body-file");
    assert.ok(mergeIndex > -1);
    assert.ok(commentIndex > -1);
    assert.ok(commentIndex > mergeIndex);
    assert.match(script, /## Vibe64 merge preparation/u);
    assert.match(script, /Resolved a merge conflict before merging\./u);
    assert.match(script, /if ! gh pr comment/u);
  });
});

test("merge PR command does not comment when no merge preparation work was recorded", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: {
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    assert.match(script, /gh pr merge https:\/\/github\.com\/example\/project\/pull\/12 --merge/u);
    assert.doesNotMatch(script, /gh pr comment/u);
  });
});

test("merge PR command accepts structured before-merge hook scripts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      hooks: {
        beforeMerge: async () => ({
          command: "npm run verify",
          intro: "Checking before merge."
        })
      },
      session: {
        metadata: {
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    assert.match(script, /printf '\[studio\] Checking before merge\.\\n'/u);
    assert.match(script, /npm run verify/u);
    assert.match(script, /gh pr merge https:\/\/github\.com\/example\/project\/pull\/12 --merge/u);
  });
});
