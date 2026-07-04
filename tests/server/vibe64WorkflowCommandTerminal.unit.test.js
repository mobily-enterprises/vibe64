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
  createIssueOnGhTerminalSpec,
  createPrOnGhTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/issuePr";
import {
  mergePrTerminalSpec,
  projectSyncMainCheckoutTerminalSpec,
  syncMainCheckoutTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/mergeSync";
import {
  createWorktreeTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/worktreeDependencies";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  workflowRepositoryProfileForCommandSession
} from "@local/vibe64-adapters/server/workflowCommandTerminal/repositoryCommandProfile";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath as testManagedSourcePath,
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

function githubCommandMetadata(values = {}) {
  return {
    workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
    ...values
  };
}

test("create PR command treats an existing branch pull request as success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await createPrOnGhTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: githubCommandMetadata({
          base_branch: "main",
          branch: "vibe64/test-session",
          source_path: targetRoot
        }),
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
        metadata: githubCommandMetadata({
          base_branch: "feature-base",
          branch: "vibe64/test-session",
          source_pr_head_ref: "feature-base",
          source_pr_head_sha: "abc123",
          source_pr_number: "77",
          source_pr_url: "https://github.com/example/project/pull/77",
          source_path: targetRoot
        }),
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

test("command repository profile derives from durable repository metadata", () => {
  assert.equal(workflowRepositoryProfileForCommandSession({
    metadata: {
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
    }
  }), WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);

  assert.equal(workflowRepositoryProfileForCommandSession({
    metadata: {
      repository_mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  }), WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR);

  assert.equal(workflowRepositoryProfileForCommandSession({
    metadata: {
      repository_mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
    }
  }), WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT);

  assert.equal(workflowRepositoryProfileForCommandSession({
    metadata: {
      github_repository: "example/legacy-github"
    }
  }), "");

  assert.equal(workflowRepositoryProfileForCommandSession({
    metadata: {}
  }), "");
});

test("create source command selects non-GitHub clone paths from the repository profile", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const localSessionRoot = path.join(runtimeRoot, "sessions", "active", "local-source-session");
    const canonicalSessionRoot = path.join(runtimeRoot, "sessions", "active", "canonical-session");
    const managedSourceRoot = path.join(path.dirname(targetRoot), "managed-source");
    const localSessionSourceRoot = path.join(managedSourceRoot, "local-source-project");
    const canonicalSessionSourceRoot = path.join(managedSourceRoot, "canonical-project");
    const localSourcePath = path.join(localSessionSourceRoot, "sessions", "active", "local-source-session", "source");
    const canonicalSourcePath = path.join(canonicalSessionSourceRoot, "sessions", "active", "canonical-session", "source");
    const canonicalRepositoryPath = path.join(runtimeRoot, "git-cache", "repository.git");

    const localSpec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot,
        projectSessionSourceRoot: localSessionSourceRoot
      },
      session: {
        metadata: {
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
        },
        sessionId: "local-source-session",
        sessionRoot: localSessionRoot,
        targetRoot
      },
      targetRoot
    });
    assert.equal(localSpec.ok, true);
    assert.equal(localSpec.commandPreview, `git clone ${targetRoot} ${localSourcePath}`);
    assert.equal(localSpec.successMetadata.source_path, localSourcePath);
    assert.equal(localSpec.successMetadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
    assert.doesNotMatch(localSpec.args.at(-1), /gh auth token/u);
    assert.match(localSpec.args.at(-1), /clone_from_local_target\nprepare_vibe64_worktree/u);

    const canonicalSpec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot,
        projectSessionSourceRoot: canonicalSessionSourceRoot
      },
      session: {
        metadata: {
          source_cache_path: canonicalRepositoryPath,
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
        },
        sessionId: "canonical-session",
        sessionRoot: canonicalSessionRoot,
        targetRoot
      },
      targetRoot
    });
    assert.equal(canonicalSpec.ok, true);
    assert.equal(canonicalSpec.commandPreview, `git clone ${canonicalRepositoryPath} ${canonicalSourcePath}`);
    assert.equal(canonicalSpec.successMetadata.source_path, canonicalSourcePath);
    assert.equal(canonicalSpec.successMetadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
    assert.doesNotMatch(canonicalSpec.args.at(-1), /gh auth token/u);
    assert.match(canonicalSpec.args.at(-1), /clone_from_canonical_git\nprepare_vibe64_worktree/u);
  });
});

test("create source command requires explicit repository profile metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const sessionRoot = path.join(runtimeRoot, "sessions", "active", "missing-profile-session");
    const projectSessionSourceRoot = path.join(path.dirname(targetRoot), "managed-source", "missing-profile-project");
    const spec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot,
        projectSessionSourceRoot
      },
      session: {
        metadata: {},
        sessionId: "missing-profile-session",
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, false);
    assert.equal(spec.message, "Cannot create a session clone before the session has repository profile metadata.");
  });
});

test("create source command refuses to place new copies under private session state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const sessionRoot = path.join(runtimeRoot, "sessions", "active", "missing-source-root");
    const spec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot
      },
      session: {
        metadata: {
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
        },
        sessionId: "missing-source-root",
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, false);
    assert.equal(spec.message, "Cannot create a session clone before the project has a managed session source root.");
    assert.notEqual(spec.commandPreview, `git clone ${targetRoot} ${path.join(sessionRoot, "source")}`);
  });
});

test("create source command initializes an empty local-source target before cloning", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const sessionRoot = path.join(runtimeRoot, "sessions", "active", "local-empty-seed");
    const projectSessionSourceRoot = path.join(path.dirname(targetRoot), "managed-source", "local-empty-project");
    const sourcePath = path.join(projectSessionSourceRoot, "sessions", "active", "local-empty-seed", "source");
    const spec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot,
        projectSessionSourceRoot
      },
      session: {
        metadata: {
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
        },
        sessionId: "local-empty-seed",
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.commandPreview, `git clone ${targetRoot} ${sourcePath}`);
    assert.doesNotMatch(spec.args.at(-1), /gh auth token/u);
    assert.doesNotMatch(spec.args.at(-1), /gh repo fork/u);

    const resultFile = path.join(targetRoot, "facts.txt");
    await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const targetHead = await gitOutput(targetRoot, ["rev-parse", "HEAD"]);
    const sourceHead = await gitOutput(sourcePath, ["rev-parse", "HEAD"]);
    assert.equal(await gitOutput(targetRoot, ["branch", "--show-current"]), "main");
    assert.equal(await gitOutput(sourcePath, ["branch", "--show-current"]), "vibe64/local-empty-seed");
    assert.equal(sourceHead, targetHead);

    const facts = Object.fromEntries(decodedFactLines(await readFile(resultFile, "utf8")));
    assert.equal(facts.source_kind, "session_clone");
    assert.equal(facts.source_path, sourcePath);
    assert.equal(facts.source_cache_path, path.join(runtimeRoot, "git-cache", "repository.git"));
    assert.equal(facts.source_remote_url, "");
    assert.equal(facts.source_default_branch, "main");
    assert.equal(facts.base_branch, "main");
    assert.equal(facts.base_commit, targetHead);

    const successMetadata = await spec.applySuccessFacts({
      facts
    });
    assert.equal(successMetadata.metadata.source_path, sourcePath);
    assert.equal(successMetadata.metadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
    assert.equal(successMetadata.metadata.base_branch, "main");
    assert.equal(successMetadata.metadata.base_commit, targetHead);
  });
});

test("canonical Git commands bootstrap an empty repository and save accepted work", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const sessionRoot = path.join(runtimeRoot, "sessions", "active", "canonical-empty-seed");
    const projectSessionSourceRoot = path.join(path.dirname(targetRoot), "managed-source", "canonical-empty-project");
    const sourcePath = path.join(projectSessionSourceRoot, "sessions", "active", "canonical-empty-seed", "source");
    const canonicalRepositoryPath = path.join(targetRoot, "git-cache", "repository.git");
    const sourceSpec = await createWorktreeTerminalSpec({
      context: {
        projectLocalRoot: runtimeRoot,
        projectSessionSourceRoot
      },
      session: {
        metadata: {
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
        },
        sessionId: "canonical-empty-seed",
        sessionRoot,
        targetRoot
      },
      targetRoot
    });

    assert.equal(sourceSpec.ok, true);
    assert.equal(sourceSpec.commandPreview, `git clone ${canonicalRepositoryPath} ${sourcePath}`);
    assert.equal(sourceSpec.successMetadata.source_path, sourcePath);
    assert.equal(sourceSpec.successMetadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
    assert.doesNotMatch(sourceSpec.args.at(-1), /gh auth token/u);
    assert.doesNotMatch(sourceSpec.args.at(-1), /gh repo fork/u);

    const sourceResultFile = path.join(targetRoot, "source-facts.txt");
    await execFileAsync(sourceSpec.command, sourceSpec.args, {
      cwd: sourceSpec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: sourceResultFile
      }
    });

    const sourceFacts = Object.fromEntries(decodedFactLines(await readFile(sourceResultFile, "utf8")));
    const baseCommit = await gitOutput(sourcePath, ["rev-parse", "HEAD"]);
    assert.equal(sourceFacts.source_kind, "session_clone");
    assert.equal(sourceFacts.source_path, sourcePath);
    assert.equal(sourceFacts.source_cache_path, canonicalRepositoryPath);
    assert.equal(sourceFacts.source_remote_url, "");
    assert.equal(sourceFacts.source_default_branch, "main");
    assert.equal(sourceFacts.base_branch, "main");
    assert.equal(sourceFacts.base_commit, baseCommit);
    assert.equal(await gitOutput(targetRoot, ["--git-dir", canonicalRepositoryPath, "symbolic-ref", "HEAD"]), "refs/heads/main");
    await assert.rejects(
      () => gitOutput(targetRoot, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]),
      /fatal/u
    );

    await writeFile(path.join(sourcePath, "README.md"), "Seeded through Vibe64 Git\n");
    const artifactsRoot = path.join(sessionRoot, "artifacts");
    const metadataRoot = path.join(sessionRoot, "metadata");
    await writeSessionMetadata(metadataRoot, {
      work_title: "Seed canonical Git project"
    });
    const commitSpec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot,
        metadata: {
          base_branch: sourceFacts.base_branch,
          base_commit: sourceFacts.base_commit,
          branch: "vibe64/canonical-empty-seed",
          source_kind: sourceFacts.source_kind,
          source_cache_path: sourceFacts.source_cache_path,
          source_path: sourceFacts.source_path,
          source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
          work_source: "seed",
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
        },
        metadataRoot,
        sessionId: "canonical-empty-seed",
        targetRoot
      }
    });
    assert.equal(commitSpec.ok, true);
    assert.doesNotMatch(commitSpec.args.at(-1), /gh auth token/u);
    assert.doesNotMatch(commitSpec.args.at(-1), /gh repo fork/u);

    const commitResultFile = path.join(targetRoot, "commit-facts.txt");
    await execFileAsync(commitSpec.command, commitSpec.args, {
      cwd: commitSpec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: commitResultFile
      }
    });

    const acceptedCommit = await gitOutput(sourcePath, ["rev-parse", "HEAD"]);
    assert.notEqual(acceptedCommit, baseCommit);
    assert.equal(await gitOutput(targetRoot, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]), acceptedCommit);

    const commitFacts = Object.fromEntries(decodedFactLines(await readFile(commitResultFile, "utf8")));
    assert.equal(commitFacts.accepted_commit, acceptedCommit);
    assert.equal(commitFacts.canonical_git_saved, "yes");
    assert.equal(commitFacts.main_checkout_synced, "yes");
    assert.equal(commitFacts.branch_pushed, undefined);
  });
});

test("commit command always pushes the session branch for existing PR sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: githubCommandMetadata({
          base_branch: "feature-base",
          branch: "vibe64/test-session",
          source_pr_head_ref: "feature-base",
          source_pr_head_repo: "example/project",
          pr_source: "existing",
          source_pr_update_mode: "direct",
          source_path: targetRoot
        }),
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);

    const script = spec.args.at(-1);
    assert.match(script, /BASE_BRANCH=feature-base/u);
    assert.match(script, /gh auth token/u);
    assert.match(script, /vibe64_enable_github_git_auth_for_remote origin/u);
    assert.match(script, /git push -u origin "\$CURRENT_BRANCH"/u);
    assert.match(script, /if ! git remote get-url origin/u);
    assert.match(script, /gh repo fork "\$UPSTREAM_REPOSITORY" --clone=false --remote=false/u);
    assert.match(script, /vibe64_enable_github_git_auth_for_remote vibe64-fork/u);
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
    const worktreePath = testManagedSourcePath(targetRoot, "test-session");
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
        metadata: githubCommandMetadata({
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/test-session",
          ...sourceMetadata(targetRoot, "test-session"),
          work_source: "seed",
        }),
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

test("commit command applies local-source commits to the opened repository even when the clone has origin", async () => {
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
    const sessionRoot = path.join(projectRuntimeRoot(targetRoot), "sessions", "active", "local-source-session");
    const sourcePath = testManagedSourcePath(targetRoot, "local-source-session");
    await mkdir(path.dirname(sourcePath), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--single-branch", "--branch", "main", targetRoot, sourcePath]);
    await execFileAsync("git", ["checkout", "-B", "vibe64/local-source-session", baseCommit], {
      cwd: sourcePath
    });
    await writeFile(path.join(sourcePath, "README.md"), "Changed through local source\n");

    const artifactsRoot = path.join(sessionRoot, "artifacts");
    const metadataRoot = path.join(sessionRoot, "metadata");
    await writeSessionMetadata(metadataRoot, {
      work_title: "Local source change"
    });
    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot,
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/local-source-session",
          ...sourceMetadata(targetRoot, "local-source-session"),
          work_source: "description",
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
        },
        metadataRoot,
        sessionId: "local-source-session",
        targetRoot
      }
    });
    const script = spec.args.at(-1);
    assert.doesNotMatch(script, /gh auth token/u);
    assert.doesNotMatch(script, /gh repo fork/u);

    const resultFile = path.join(targetRoot, "facts.txt");
    await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const targetHead = await gitOutput(targetRoot, ["rev-parse", "HEAD"]);
    const sourceHead = await gitOutput(sourcePath, ["rev-parse", "HEAD"]);
    assert.equal(targetHead, sourceHead);
    assert.equal(await readFile(path.join(targetRoot, "README.md"), "utf8"), "Changed through local source\n");

    const facts = Object.fromEntries(decodedFactLines(await readFile(resultFile, "utf8")));
    assert.equal(facts.accepted_commit, sourceHead);
    assert.equal(facts.local_commit_only, "yes");
    assert.equal(facts.main_checkout_synced, "yes");
    assert.equal(facts.branch_pushed, undefined);
  });
});

test("commit command saves canonical Git sessions to the managed repository without GitHub", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const seedRoot = path.join(targetRoot, "seed");
    await mkdir(seedRoot, {
      recursive: true
    });
    await createGitRepository(seedRoot);
    await writeFile(path.join(seedRoot, "README.md"), "Initial\n");
    await execFileAsync("git", ["add", "README.md"], {
      cwd: seedRoot
    });
    await execFileAsync("git", ["commit", "-m", "Initial commit"], {
      cwd: seedRoot
    });
    const baseCommit = await gitOutput(seedRoot, ["rev-parse", "HEAD"]);
    const canonicalRepositoryPath = path.join(targetRoot, "runtime", "git-cache", "repository.git");
    await mkdir(path.dirname(canonicalRepositoryPath), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--bare", seedRoot, canonicalRepositoryPath]);

    const sessionRoot = path.join(targetRoot, "runtime", "sessions", "active", "canonical-session");
    const sourcePath = testManagedSourcePath(targetRoot, "canonical-session");
    await mkdir(path.dirname(sourcePath), {
      recursive: true
    });
    await execFileAsync("git", ["clone", "--single-branch", "--branch", "main", canonicalRepositoryPath, sourcePath]);
    await execFileAsync("git", ["checkout", "-B", "vibe64/canonical-session", baseCommit], {
      cwd: sourcePath
    });
    await writeFile(path.join(sourcePath, "README.md"), "Changed through Vibe64 Git\n");

    const artifactsRoot = path.join(sessionRoot, "artifacts");
    const metadataRoot = path.join(sessionRoot, "metadata");
    await writeSessionMetadata(metadataRoot, {
      work_title: "Canonical Git change"
    });
    const spec = await commitChangesTerminalSpec({
      session: {
        artifactsRoot,
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/canonical-session",
          source_cache_path: canonicalRepositoryPath,
          ...sourceMetadata(targetRoot, "canonical-session"),
          work_source: "description",
          workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
        },
        metadataRoot,
        sessionId: "canonical-session",
        targetRoot
      }
    });
    const script = spec.args.at(-1);
    assert.doesNotMatch(script, /gh auth token/u);
    assert.doesNotMatch(script, /gh repo fork/u);
    assert.match(script, /Saving accepted commit/u);

    const resultFile = path.join(targetRoot, "facts.txt");
    await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const sourceHead = await gitOutput(sourcePath, ["rev-parse", "HEAD"]);
    assert.equal(await gitOutput(targetRoot, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]), sourceHead);

    const facts = Object.fromEntries(decodedFactLines(await readFile(resultFile, "utf8")));
    assert.equal(facts.accepted_commit, sourceHead);
    assert.equal(facts.canonical_git_saved, "yes");
    assert.equal(facts.main_checkout_synced, "yes");
    assert.equal(facts.branch_pushed, undefined);

    const successMetadata = spec.applySuccessFacts({
      facts
    });
    assert.equal(successMetadata.metadata.accepted_commit, sourceHead);
    assert.equal(successMetadata.metadata.canonical_git_saved, "yes");
    assert.equal(successMetadata.metadata.main_checkout_synced, "yes");
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
    const worktreePath = testManagedSourcePath(targetRoot, "test-session");
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
        metadata: githubCommandMetadata({
          base_branch: "main",
          base_commit: baseCommit,
          branch: "vibe64/test-session",
          ...sourceMetadata(targetRoot, "test-session"),
          work_source: "seed",
        }),
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
        metadata: githubCommandMetadata({
          base_branch: "main",
          branch: "vibe64/test-session",
          branch_push_remote: "vibe64-fork",
          pr_head_owner: "octocat",
          source_path: targetRoot
        }),
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
    assert.match(script, /gh auth token/u);
    assert.match(script, /vibe64_enable_github_git_auth_for_remote origin/u);
    assert.match(script, /vibe64_enable_github_git_auth_for_remote "\$BRANCH_PUSH_REMOTE"/u);
    assert.match(script, /git ls-remote --exit-code --heads "\$BRANCH_PUSH_REMOTE" "\$EXPECTED_BRANCH"/u);
    assert.match(script, /gh pr create --base "\$BASE_BRANCH" --head "\$PR_HEAD"/u);
  });
});

test("GitHub-only command specs reject non-GitHub repository profiles", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);
    const session = {
      artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
      metadata: {
        branch: "vibe64/test-session",
        pr_merged: "yes",
        pr_url: "https://github.com/example/project/pull/12",
        source_path: targetRoot,
        workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT
      },
      metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
      sessionId: "test-session",
      targetRoot
    };

    assert.deepEqual(await createIssueOnGhTerminalSpec({
      session
    }), {
      ok: false,
      message: "GitHub issue creation is only available for GitHub projects."
    });
    assert.deepEqual(await createPrOnGhTerminalSpec({
      session
    }), {
      ok: false,
      message: "GitHub pull requests are only available for GitHub projects."
    });
    assert.deepEqual(await mergePrTerminalSpec({
      session,
      targetRoot
    }), {
      ok: false,
      message: "GitHub pull request merge is only available for GitHub projects."
    });
    assert.deepEqual(await syncMainCheckoutTerminalSpec({
      session,
      targetRoot
    }), {
      ok: false,
      message: "GitHub cache refresh is only available for GitHub projects."
    });
  });
});

test("merge PR command does not write missing hook objects into the shell script", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: githubCommandMetadata({
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        }),
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

test("refresh Git cache command mounts the Vibe64 runtime bucket", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const cachePath = path.join(runtimeRoot, "git-cache", "repository.git");
    const spec = await syncMainCheckoutTerminalSpec({
      context: {
        projectRuntimeRoot: runtimeRoot
      },
      session: {
        metadata: githubCommandMetadata({
          base_branch: "main",
          pr_merged: "yes",
          source_cache_path: cachePath,
          source_remote_url: "https://github.com/example/project.git"
        }),
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.deepEqual(spec.mounts, [
      {
        source: runtimeRoot,
        target: runtimeRoot
      }
    ]);
    const script = spec.args.at(-1);
    assert.match(script, /gh auth token/u);
    assert.match(script, /vibe64_enable_github_git_auth_for_url "\$VIBE64_GIT_REMOTE_URL"/u);
    assert.match(script, new RegExp(`VIBE64_GIT_CACHE_PATH=${cachePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
    assert.equal(spec.cwd, targetRoot);
  });
});

test("project refresh Git cache command uses projectRuntimeRoot instead of source root", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const spec = await projectSyncMainCheckoutTerminalSpec({
      context: {
        projectRuntimeRoot: runtimeRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.deepEqual(spec.mounts, [
      {
        source: runtimeRoot,
        target: runtimeRoot
      }
    ]);
    assert.match(spec.args.at(-1), /VIBE64_GIT_CACHE_PATH=.*\/git-cache\/repository\.git/u);
    assert.doesNotMatch(spec.args.at(-1), new RegExp(`${targetRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\/git-cache`, "u"));
  });
});

test("merge PR command comments with merge preparation work after a successful merge", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: githubCommandMetadata({
          merge_preparation_summary: "- Resolved a merge conflict before merging.",
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        }),
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
        metadata: githubCommandMetadata({
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        }),
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
        metadata: githubCommandMetadata({
          pr_url: "https://github.com/example/project/pull/12",
          source_path: targetRoot
        }),
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
