import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  constants as fsConstants
} from "node:fs";
import {
  access,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createCppTargetAdapter
} from "@local/vibe64-adapters/server/adapters/cpp/index";
import {
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  createGenericNodeWebTargetAdapter
} from "@local/vibe64-adapters/server/adapters/node-web/index";
import {
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  createJskitTargetAdapter
} from "@local/vibe64-adapters/server/adapters/jskit/index";
import {
  JSKIT_DATABASE_RUNTIME_CONFIG
} from "@local/vibe64-adapters/server/adapters/jskit/adapter";
import {
  JSKIT_USER_MODE_CONFIG,
  JSKIT_USER_MODE_USERS
} from "@local/vibe64-adapters/server/adapters/jskit/appAuthConfig";
import {
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  createLaravelTargetAdapter
} from "@local/vibe64-adapters/server/adapters/laravel/index";
import {
  NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
  createNextjsTargetAdapter
} from "@local/vibe64-adapters/server/adapters/nextjs/index";
import {
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  createVinextTargetAdapter
} from "@local/vibe64-adapters/server/adapters/vinext/index";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

function runCommand(command, args, {
  cwd,
  env = {}
} = {}) {
  const result = runCommandResult(command, args, {
    cwd,
    env
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function runCommandResult(command, args, {
  cwd,
  env = {}
} = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Vibe64 Test",
      GIT_AUTHOR_EMAIL: "vibe64-test@example.invalid",
      GIT_COMMITTER_NAME: "Vibe64 Test",
      GIT_COMMITTER_EMAIL: "vibe64-test@example.invalid",
      ...env
    }
  });
}

function runGit(cwd, args) {
  return runCommand("git", args, {
    cwd
  });
}

async function assertExecutableScript(scriptPath = "") {
  const script = await readFile(scriptPath, "utf8");
  assert.match(script, /^#!/u);
  await access(scriptPath, fsConstants.X_OK);
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function assertNoGitAlternates(sourcePath) {
  await assert.rejects(
    readFile(path.join(sourcePath, ".git", "objects", "info", "alternates"), "utf8"),
    {
      code: "ENOENT"
    }
  );
}

function decodeCommandFacts(text = "") {
  return Object.fromEntries(text.split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter(([operation, name, value]) => operation === "fact:set" && name && value)
    .map(([, name, value]) => [
      name,
      Buffer.from(value, "base64").toString("utf8")
    ]));
}

function githubSessionMetadata(values = {}) {
  return {
    repository_mode: PROJECT_REPOSITORY_MODE_GITHUB,
    workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
    ...values
  };
}

function localSourceSessionMetadata(values = {}) {
  return {
    repository_mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
    workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
    ...values
  };
}

function githubProjectRecord(github = {}) {
  return {
    repository: {
      github,
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    }
  };
}

function testProjectSessionSourceRoot(targetRoot = "") {
  return path.join(path.dirname(targetRoot), "managed-source", path.basename(targetRoot));
}

function testSessionSourcePath(targetRoot = "", sessionId = "") {
  return path.join(testProjectSessionSourceRoot(targetRoot), "sessions", "active", sessionId, "source");
}

async function createGitTarget(root) {
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "Studio Test"]);
  runGit(root, ["config", "user.email", "studio-test@example.com"]);
  await Promise.all([
    writeProjectFile(root, ".gitignore", [
      ".vibe64/",
      ".env"
    ].join("\n")),
    writeProjectFile(root, "README.md", "# Test target\n"),
    writeProjectFile(root, ".env", "SECRET=from-target\n")
  ]);
  runGit(root, ["add", ".gitignore", "README.md"]);
  runGit(root, ["commit", "-m", "Initial commit"]);
}

async function writeCompleteJskitApplication(root) {
  await Promise.all([
    writeProjectFile(root, "package.json", "{}\n"),
    writeProjectFile(root, "config/public.js", "export default {};\n"),
    writeProjectFile(root, "src/main.js", "export {};\n"),
    writeProjectFile(root, "packages/main/package.descriptor.mjs", "export default {};\n"),
    writeProjectFile(root, ".jskit/lock.json", "{}\n")
  ]);
}

test("adapters own the worktree preparation script", async () => {
  await Promise.all([
    GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
    JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
    LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
    NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
    VINEXT_PREPARE_WORKTREE_SCRIPT_PATH
  ].map(assertExecutableScript));

  assert.equal(await createJskitTargetAdapter().getPrepareWorktreeScriptPath(), JSKIT_PREPARE_WORKTREE_SCRIPT_PATH);
  assert.equal(await createLaravelTargetAdapter().getPrepareWorktreeScriptPath(), LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH);
  assert.equal(await createNextjsTargetAdapter().getPrepareWorktreeScriptPath(), NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH);
  assert.equal(await createGenericNodeWebTargetAdapter().getPrepareWorktreeScriptPath(), GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH);
  assert.equal(await createVinextTargetAdapter().getPrepareWorktreeScriptPath(), VINEXT_PREPARE_WORKTREE_SCRIPT_PATH);
  assert.equal(await createCppTargetAdapter().getPrepareWorktreeScriptPath(), "");
});

test("create worktree terminal specs mount adapter preparation scripts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const adapters = [
      [createGenericNodeWebTargetAdapter(), GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH],
      [createJskitTargetAdapter(), JSKIT_PREPARE_WORKTREE_SCRIPT_PATH],
      [createLaravelTargetAdapter(), LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH],
      [createNextjsTargetAdapter(), NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH],
      [createVinextTargetAdapter(), VINEXT_PREPARE_WORKTREE_SCRIPT_PATH],
      [createCppTargetAdapter(), ""]
    ];

    for (const [adapter, scriptPath] of adapters) {
      const session = {
        metadata: localSourceSessionMetadata(),
        sessionId: `prepare-mount-${adapter.id}`,
        sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", `prepare-mount-${adapter.id}`),
        targetRoot
      };
      const spec = await adapter.createCommandTerminalSpec("create_source", {
        projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
        session,
        targetRoot
      });
      const sourceParentPath = path.dirname(testSessionSourcePath(targetRoot, session.sessionId));
      assert.equal(spec.ok, true);
      assert.deepEqual(spec.mounts || [], [
        ...(scriptPath
          ? [
              {
                readOnly: true,
                source: path.dirname(scriptPath),
                target: path.dirname(scriptPath)
              }
            ]
          : []),
        {
          source: sourceParentPath,
          target: sourceParentPath
        }
      ]);
    }
  });
});

test("create worktree creates an initial commit for unborn seeded repositories", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    runGit(targetRoot, ["init", "-b", "main"]);
    runGit(targetRoot, ["config", "user.name", "Studio Test"]);
    runGit(targetRoot, ["config", "user.email", "studio-test@example.com"]);
	    await Promise.all([
	      writeProjectFile(targetRoot, ".gitignore", [
	        ".vibe64/"
	      ].join("\n")),
	      writeProjectFile(targetRoot, "README.md", "# Seeded target\n")
	    ]);

	    const sessionRoot = path.join(path.dirname(targetRoot), "runtime", "sessions", "active", "unborn-seed");
    const sourcePath = testSessionSourcePath(targetRoot, "unborn-seed");
    const resultFile = path.join(path.dirname(targetRoot), "command-result.tsv");
    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "unborn-seed",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.base_branch, "main");
    assert.equal(spec.successMetadata.base_commit, "");

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const baseCommit = runGit(targetRoot, ["rev-parse", "--verify", "HEAD"]);
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.base_branch, "main");
    assert.equal(facts.base_commit, baseCommit);
    assert.equal(facts.source_kind, "session_clone");
    assert.equal(facts.source_path, sourcePath);
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(sourcePath, ["branch", "--show-current"]), "vibe64/unborn-seed");
    assert.equal(runGit(sourcePath, ["branch", "--list", "main"]), "");
    assert.deepEqual(runGit(targetRoot, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean).sort(), [
      ".gitignore",
      "README.md"
    ]);

    const factMetadata = spec.applySuccessFacts({
      facts,
      session
    });
    assert.equal(factMetadata.metadata.base_branch, "main");
    assert.equal(factMetadata.metadata.base_commit, baseCommit);
  });
});

	test("create worktree rejects ordinary directories nested under the target repository", async () => {
	  await withTemporaryRoot(async (targetRoot) => {
	    await createGitTarget(targetRoot);
	    const sessionRoot = path.join(path.dirname(targetRoot), "runtime", "sessions", "active", "ordinary-directory");
    const sourcePath = testSessionSourcePath(targetRoot, "ordinary-directory");
    await writeProjectFile(sourcePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");

    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "ordinary-directory",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });
    assert.equal(spec.ok, true);

    const result = runCommandResult(spec.command, spec.args, {
      cwd: spec.cwd
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Session clone path exists but is not a Git repository/u);
    assert.doesNotMatch(runGit(targetRoot, ["worktree", "list", "--porcelain"]), new RegExp(sourcePath, "u"));
  });
});

test("create worktree initializes a plain local folder before creating the worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
	    await Promise.all([
	      writeProjectFile(targetRoot, ".gitignore", [
	        ".vibe64/"
	      ].join("\n")),
	      writeProjectFile(targetRoot, "README.md", "# Plain local target\n")
	    ]);

	    const sessionRoot = path.join(path.dirname(targetRoot), "runtime", "sessions", "active", "plain-local");
    const sourcePath = testSessionSourcePath(targetRoot, "plain-local");
    const resultFile = path.join(path.dirname(targetRoot), "command-result.tsv");
    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "plain-local",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.base_branch, "main");
    assert.equal(spec.successMetadata.base_commit, "");

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const baseCommit = runGit(targetRoot, ["rev-parse", "--verify", "HEAD"]);
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.base_branch, "main");
    assert.equal(facts.base_commit, baseCommit);
    assert.equal(facts.source_path, sourcePath);
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(sourcePath, ["branch", "--show-current"]), "vibe64/plain-local");
  });
});

test("create worktree creates an isolated clone from project repository metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const tempRoot = path.dirname(targetRoot);
    const sourceRoot = path.join(tempRoot, "source");
    const remoteRoot = path.join(tempRoot, "remote.git");
    const projectRecordPath = path.join(targetRoot, "project.json");
    await mkdir(sourceRoot, {
      recursive: true
    });
    await createGitTarget(sourceRoot);
    runGit(sourceRoot, ["checkout", "-b", "vibe64/stale-session"]);
    await writeProjectFile(sourceRoot, "stale.txt", "old session branch\n");
    runGit(sourceRoot, ["add", "stale.txt"]);
    runGit(sourceRoot, ["commit", "-m", "stale session branch"]);
    runGit(sourceRoot, ["checkout", "main"]);
    runCommand("git", ["init", "--bare", remoteRoot], {
      cwd: tempRoot
    });
    runGit(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(sourceRoot, ["push", "origin", "main", "vibe64/stale-session"]);
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      ...githubProjectRecord({
        cloneUrl: remoteRoot,
        defaultBranch: "main",
        fullName: "example/project"
      })
    }, null, 2)}\n`);
    const cachePath = path.join(targetRoot, "git-cache", "repository.git");
    await mkdir(path.dirname(cachePath), {
      recursive: true
    });
    runCommand("git", ["init", "--bare", cachePath], {
      cwd: tempRoot
    });
    runGit(cachePath, ["fetch", remoteRoot, "+refs/heads/*:refs/heads/*"]);
    assert.equal(runGit(cachePath, ["remote"]), "");

    const sessionRoot = path.join(targetRoot, "sessions", "active", "metadata-remote");
    const sourcePath = testSessionSourcePath(targetRoot, "metadata-remote");
    const resultFile = path.join(tempRoot, "command-result.tsv");
    const session = {
      metadata: githubSessionMetadata(),
      sessionId: "metadata-remote",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.source_kind, "session_clone");
    assert.equal(spec.successMetadata.source_remote_url, remoteRoot);
    assert.equal(spec.commandPreview, `git clone ${remoteRoot} ${sourcePath}`);

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const baseCommit = runGit(sourceRoot, ["rev-parse", "--verify", "HEAD"]);
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.base_branch, "main");
    assert.equal(facts.base_commit, baseCommit);
    assert.equal(facts.source_kind, "session_clone");
    assert.equal(facts.source_remote_url, remoteRoot);
    assert.equal(facts.source_path, sourcePath);
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(sourcePath, ["branch", "--show-current"]), "vibe64/metadata-remote");
    assert.equal(runGit(sourcePath, ["branch", "--list", "main"]), "");
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "origin/main"]), baseCommit);
    assert.equal(runGit(sourcePath, ["branch", "-r", "--list", "origin/vibe64/stale-session"]), "");
    assert.deepEqual(
      runGit(sourcePath, ["config", "--get-all", "remote.origin.fetch"]).split("\n"),
      [
        "+refs/heads/main:refs/remotes/origin/main",
        "+refs/heads/vibe64/metadata-remote:refs/remotes/origin/vibe64/metadata-remote"
      ]
    );
    assert.equal(runGit(sourcePath, ["remote", "get-url", "origin"]), remoteRoot);
    await assertNoGitAlternates(sourcePath);

    await writeProjectFile(sourcePath, "session.txt", "session work\n");
    runGit(sourcePath, ["add", "session.txt"]);
    runGit(sourcePath, ["commit", "-m", "session work"]);
    runGit(sourcePath, ["push", "-u", "origin", "vibe64/metadata-remote"]);
    assert.equal(
      runGit(sourcePath, ["rev-parse", "--verify", "refs/remotes/origin/vibe64/metadata-remote"]),
      runGit(sourcePath, ["rev-parse", "--verify", "HEAD"])
    );
    assert.equal(runGit(sourcePath, ["rev-list", "--count", "HEAD", "--not", "--remotes"]), "0");
    assert.equal(runGit(cachePath, ["rev-parse", "--is-bare-repository"]), "true");
    assert.equal(runGit(cachePath, ["remote", "get-url", "origin"]), remoteRoot);
    assert.notEqual(runCommandResult("git", ["-C", targetRoot, "worktree", "list", "--porcelain"]).status, 0);
  });
});

test("create worktree materializes selected local source config into the session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    await Promise.all([
      writeProjectFile(targetRoot, "vibe64.project.json", JSON.stringify({
        schema: "vibe64.project",
        schemaVersion: 1,
        projectType: "node-web",
        config: {
          github_pr_merge_method: "merge",
          test_setting: "kept"
        }
      }, null, 2)),
      writeProjectFile(targetRoot, "vibe64.runtime-lock.json", "{\"schema\":\"test-runtime-lock\"}\n")
    ]);

    const sessionRoot = path.join(path.dirname(targetRoot), "runtime", "sessions", "active", "local-config");
    const sourcePath = testSessionSourcePath(targetRoot, "local-config");
    const resultFile = path.join(path.dirname(targetRoot), "command-result.tsv");
    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "local-config",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectLocalRoot: path.dirname(sessionRoot),
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      sourceRoot: targetRoot,
      targetRoot
    });

    assert.equal(spec.ok, true);
    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    await spec.applySuccessFacts({
      facts,
      session
    });

    const manifest = JSON.parse(await readFile(path.join(sourcePath, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.projectType, "node-web");
    assert.equal(manifest.config.github_pr_merge_method, "merge");
    assert.equal(manifest.config.test_setting, "kept");
    const runtimeLock = JSON.parse(await readFile(path.join(sourcePath, "vibe64.runtime-lock.json"), "utf8"));
    assert.deepEqual(runtimeLock, {
      schema: "test-runtime-lock"
    });
  });
});

test("create worktree reads repository metadata from the project record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const tempRoot = path.dirname(targetRoot);
    const sourceRoot = path.join(tempRoot, "shared-source");
    const remoteRoot = path.join(tempRoot, "shared-remote.git");
    const projectRecordPath = path.join(targetRoot, "project.json");
    await mkdir(sourceRoot, {
      recursive: true
    });
    await createGitTarget(sourceRoot);
    runCommand("git", ["init", "--bare", remoteRoot], {
      cwd: tempRoot
    });
    runGit(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(sourceRoot, ["push", "origin", "main"]);
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      ...githubProjectRecord({
        cloneUrl: remoteRoot,
        defaultBranch: "main",
        fullName: "example/shared-project"
      })
    }, null, 2)}\n`);
    await writeProjectFile(targetRoot, "README.md", "# Project home only\n");

    const sessionRoot = path.join(targetRoot, "sessions", "active", "shared-metadata");
    const sourcePath = testSessionSourcePath(targetRoot, "shared-metadata");
    const resultFile = path.join(tempRoot, "shared-command-result.tsv");
    const session = {
      metadata: githubSessionMetadata(),
      sessionId: "shared-metadata",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.source_remote_url, remoteRoot);
    assert.equal(spec.commandPreview, `git clone ${remoteRoot} ${sourcePath}`);

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const baseCommit = runGit(sourceRoot, ["rev-parse", "--verify", "HEAD"]);
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.source_remote_url, remoteRoot);
    assert.equal(facts.source_path, sourcePath);
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(sourcePath, ["branch", "--show-current"]), "vibe64/shared-metadata");
  });
});

test("create worktree materializes pending online bootstrap config into the session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const tempRoot = path.dirname(targetRoot);
    const sourceRoot = path.join(tempRoot, "source");
    const remoteRoot = path.join(tempRoot, "remote.git");
    const projectRecordPath = path.join(targetRoot, "project.json");
    await mkdir(sourceRoot, {
      recursive: true
    });
    await createGitTarget(sourceRoot);
    await writeCompleteJskitApplication(sourceRoot);
    runGit(sourceRoot, ["add", "package.json", "config/public.js", "src/main.js", "packages/main/package.descriptor.mjs", ".jskit/lock.json"]);
    runGit(sourceRoot, ["commit", "-m", "Add existing JSKIT application"]);
    runCommand("git", ["init", "--bare", remoteRoot], {
      cwd: tempRoot
    });
    runGit(sourceRoot, ["remote", "add", "origin", remoteRoot]);
    runGit(sourceRoot, ["push", "origin", "main"]);
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      bootstrapConfig: {
        projectType: "jskit",
        schemaVersion: 1,
        status: "pending",
        values: {
          github_pr_merge_method: "squash",
          [JSKIT_DATABASE_RUNTIME_CONFIG]: "mariadb",
          [JSKIT_USER_MODE_CONFIG]: JSKIT_USER_MODE_USERS
        }
      },
      ...githubProjectRecord({
        cloneUrl: remoteRoot,
        defaultBranch: "main",
        fullName: "example/project"
      })
    }, null, 2)}\n`);

    const sessionRoot = path.join(targetRoot, "sessions", "active", "bootstrap-config");
    const sourcePath = testSessionSourcePath(targetRoot, "bootstrap-config");
    const resultFile = path.join(tempRoot, "command-result.tsv");
    const session = {
      metadata: githubSessionMetadata({
        work_source: "initialization"
      }),
      sessionId: "bootstrap-config",
      sessionRoot,
      targetRoot
    };
    const adapter = createJskitTargetAdapter();
    const spec = await adapter.createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectLocalRoot: targetRoot,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      runtime: {
        adapter
      },
      session,
      targetRoot
    });

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    await spec.applySuccessFacts({
      facts,
      session
    });

    const manifest = JSON.parse(await readFile(path.join(sourcePath, "vibe64.project.json"), "utf8"));
    assert.equal(manifest.projectType, "jskit");
    assert.equal(manifest.config.github_pr_merge_method, "squash");
    assert.equal(manifest.config[JSKIT_DATABASE_RUNTIME_CONFIG], "mariadb");
    assert.equal(manifest.config[JSKIT_USER_MODE_CONFIG], JSKIT_USER_MODE_USERS);
    const runtimeLock = JSON.parse(await readFile(path.join(sourcePath, "vibe64.runtime-lock.json"), "utf8"));
    assert.deepEqual(runtimeLock.selected.services.map((entry) => entry.id), ["mariadb"]);
    await assertNoGitAlternates(sourcePath);
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.applicationMode, undefined);
    assert.equal(projectRecord.bootstrapConfig, undefined);
  });
});

test("create worktree retires stale bootstrap metadata when the session source is authoritative", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectRecordPath = path.join(targetRoot, "project.json");
    const sessionId = "source-authority";
    const sourcePath = testSessionSourcePath(targetRoot, sessionId);
    const manifestText = `${JSON.stringify({
      schema: "vibe64.project",
      schemaVersion: 1,
      projectType: "node-web",
      config: {
        github_pr_merge_method: "squash",
        node_web_client_library: "auto"
      }
    }, null, 2)}\n`;
    await Promise.all([
      writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
        bootstrapConfig: {
          projectType: "jskit",
          schemaVersion: 1,
          status: "pending",
          values: {
            github_pr_merge_method: "merge",
            jskit_database_runtime: "mariadb"
          }
        }
      }, null, 2)}\n`),
      writeProjectFile(sourcePath, "package.json", `${JSON.stringify({
        name: "vibe64-online",
        scripts: {
          dev: "node ./bin/vibe64-online.js dev"
        }
      }, null, 2)}\n`),
      writeProjectFile(sourcePath, "vibe64.project.json", manifestText)
    ]);

    const session = {
      metadata: localSourceSessionMetadata({
        work_source: "initialization"
      }),
      sessionId,
      sessionRoot: path.join(targetRoot, "sessions", "active", sessionId),
      targetRoot
    };
    const adapter = createGenericNodeWebTargetAdapter();
    const spec = await adapter.createCommandTerminalSpec("create_source", {
      projectLocalRoot: targetRoot,
      projectRecordPath,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      runtime: {
        adapter
      },
      session,
      targetRoot
    });

    await spec.applySuccessFacts({
      facts: {
        source_path: sourcePath
      },
      session
    });

    assert.equal(await readFile(path.join(sourcePath, "vibe64.project.json"), "utf8"), manifestText);
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.bootstrapConfig, undefined);
  });
});

test("create worktree rejects a bootstrap adapter mismatch before writing source config", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectRecordPath = path.join(targetRoot, "project.json");
    const sessionId = "bootstrap-adapter-mismatch";
    const sourcePath = testSessionSourcePath(targetRoot, sessionId);
    await Promise.all([
      writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
        bootstrapConfig: {
          projectType: "jskit",
          schemaVersion: 1,
          status: "pending",
          values: {
            github_pr_merge_method: "merge",
            jskit_database_runtime: "mariadb"
          }
        }
      }, null, 2)}\n`),
      writeProjectFile(sourcePath, "package.json", `${JSON.stringify({
        name: "vibe64-online",
        scripts: {
          dev: "node ./bin/vibe64-online.js dev"
        }
      }, null, 2)}\n`)
    ]);

    const session = {
      metadata: localSourceSessionMetadata({
        work_source: "initialization"
      }),
      sessionId,
      sessionRoot: path.join(targetRoot, "sessions", "active", sessionId),
      targetRoot
    };
    const adapter = createGenericNodeWebTargetAdapter();
    const spec = await adapter.createCommandTerminalSpec("create_source", {
      projectLocalRoot: targetRoot,
      projectRecordPath,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      runtime: {
        adapter
      },
      session,
      targetRoot
    });

    await assert.rejects(
      spec.applySuccessFacts({
        facts: {
          source_path: sourcePath
        },
        session
      }),
      {
        code: "vibe64_project_bootstrap_adapter_mismatch"
      }
    );
    await assert.rejects(
      readFile(path.join(sourcePath, "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    await assert.rejects(
      readFile(path.join(sourcePath, "vibe64.runtime-lock.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.bootstrapConfig.projectType, "jskit");
  });
});

test("create worktree refuses to seed over a complete existing application", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const projectRecordPath = path.join(targetRoot, "project.json");
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      bootstrapConfig: {
        projectType: "jskit",
        schemaVersion: 1,
        status: "pending",
        values: {}
      }
    }, null, 2)}\n`);
    const sessionId = "seed-source-conflict";
    const sessionRoot = path.join(targetRoot, "sessions", "active", sessionId);
    const sourcePath = testSessionSourcePath(targetRoot, sessionId);
    await writeCompleteJskitApplication(sourcePath);
    const session = {
      metadata: localSourceSessionMetadata({
        work_source: "seed"
      }),
      sessionId,
      sessionRoot,
      targetRoot
    };
    const adapter = createJskitTargetAdapter();
    const spec = await adapter.createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectLocalRoot: targetRoot,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      runtime: {
        adapter
      },
      session,
      targetRoot
    });

    await assert.rejects(
      spec.applySuccessFacts({
        facts: {
          source_path: sourcePath
        },
        session
      }),
      {
        code: "vibe64_new_application_source_conflict"
      }
    );
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.bootstrapConfig.status, "pending");
    await assert.rejects(
      readFile(path.join(sourcePath, "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
  });
});

test("create worktree rejects pending online bootstrap config outside the session source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectRecordPath = path.join(targetRoot, "project.json");
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      bootstrapConfig: {
        projectType: "jskit",
        schemaVersion: 1,
        status: "pending",
        values: {
          jskit_database_runtime: "postgres"
        }
      }
    }, null, 2)}\n`);

    const sessionRoot = path.join(targetRoot, "sessions", "active", "bootstrap-contained");
    const sourcePath = testSessionSourcePath(targetRoot, "bootstrap-contained");
    const outsideSourcePath = testSessionSourcePath(targetRoot, "other-session");
    await mkdir(sourcePath, {
      recursive: true
    });
    await mkdir(outsideSourcePath, {
      recursive: true
    });

    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "bootstrap-contained",
      sessionRoot,
      targetRoot
    };
    const adapter = createJskitTargetAdapter();
    const spec = await adapter.createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectLocalRoot: targetRoot,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      runtime: {
        adapter
      },
      session,
      targetRoot
    });

    await assert.rejects(
      spec.applySuccessFacts({
        facts: {
          source_path: outsideSourcePath
        },
        session
      }),
      {
        code: "vibe64_project_bootstrap_source_outside_session"
      }
    );
    const projectRecord = JSON.parse(await readFile(projectRecordPath, "utf8"));
    assert.equal(projectRecord.bootstrapConfig.status, "pending");
    await assert.rejects(
      readFile(path.join(outsideSourcePath, "vibe64.project.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );
  });
});

test("create worktree bootstraps an isolated clone from empty project repository metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const tempRoot = path.dirname(targetRoot);
    const remoteRoot = path.join(tempRoot, "empty-remote.git");
    const projectRecordPath = path.join(targetRoot, "project.json");
    runCommand("git", ["init", "--bare", remoteRoot], {
      cwd: tempRoot
    });
    await writeProjectFile(targetRoot, ".env", "SECRET=from-target\n");
    await writeProjectFile(targetRoot, "project.json", `${JSON.stringify({
      ...githubProjectRecord({
        cloneUrl: remoteRoot,
        defaultBranch: "",
        fullName: "example/empty"
      })
    }, null, 2)}\n`);

    const sessionRoot = path.join(targetRoot, "sessions", "active", "empty-remote");
    const sourcePath = testSessionSourcePath(targetRoot, "empty-remote");
    const resultFile = path.join(tempRoot, "empty-command-result.tsv");
    const session = {
      metadata: githubSessionMetadata(),
      sessionId: "empty-remote",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_source", {
      projectRecordPath,
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.source_remote_url, remoteRoot);
    assert.equal(spec.successMetadata.base_branch, "");
    assert.equal(spec.successMetadata.base_commit, "");

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.base_branch, "main");
    assert.match(facts.base_commit, /^[a-f0-9]{40}$/u);
    assert.equal(facts.source_kind, "session_clone");
    assert.equal(facts.source_remote_url, remoteRoot);
    assert.equal(facts.source_path, sourcePath);
    assert.equal(runGit(sourcePath, ["rev-parse", "--verify", "HEAD"]), facts.base_commit);
    assert.equal(runGit(sourcePath, ["branch", "--show-current"]), "vibe64/empty-remote");
    assert.equal(runGit(sourcePath, ["branch", "--list", "main"]), "");
    assert.equal(runGit(sourcePath, ["remote", "get-url", "origin"]), remoteRoot);
    assert.deepEqual(runGit(sourcePath, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean), []);
    await assertNoGitAlternates(sourcePath);
    assert.notEqual(runCommandResult("git", ["-C", remoteRoot, "show-ref", "--heads"]).status, 0);
  });
});

test("create worktree terminal specs branch existing PR sessions from the source PR head", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "stacked-pr");
    const session = {
      metadata: githubSessionMetadata({
        source_pr_head_ref: "feature-base",
        source_pr_head_repo: "example/project",
        source_pr_head_sha: "abc123",
        source_pr_number: "77",
        pr_source: "existing",
        source_pr_update_mode: "stacked",
        source_pr_url: "https://github.com/example/project/pull/77"
      }),
      sessionId: "stacked-pr",
      sessionRoot,
      targetRoot
    };
    const spec = await createGenericNodeWebTargetAdapter().createCommandTerminalSpec("create_source", {
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.base_branch, "feature-base");
    assert.equal(spec.successMetadata.base_commit, "abc123");

    const script = spec.args.at(-1);
    assert.match(script, /--reference-if-able "\$VIBE64_GIT_CACHE_PATH" --dissociate/u);
    assert.match(script, /git clone .*--single-branch --branch "\$CLONE_BASE_BRANCH" .*"\$VIBE64_GIT_REMOTE_URL"/u);
    assert.match(script, /git -C .* fetch origin "pull\/\$SOURCE_PR_NUMBER\/head:\$PR_FETCH_REF"/u);
    assert.match(script, /FETCHED_PR_SHA=/u);
    assert.match(script, /Existing PR #%s moved from %s to %s/u);
    assert.match(script, /checkout -B .* "\$PR_FETCH_REF"/u);
    assert.doesNotMatch(script, /worktree add/u);
    assert.match(script, /source_pr_update_mode/u);
    assert.doesNotMatch(script, /git push --dry-run/u);
    assert.doesNotMatch(script, /source_pr_update_mode.*direct/u);

    const factMetadata = spec.applySuccessFacts({
      facts: {
        source_pr_update_mode: "stacked"
      },
      session
    });
    assert.deepEqual(factMetadata.metadata, {
      source_pr_update_mode: "stacked"
    });
  });
});

test("JSKIT worktree preparation script does not copy .env as runtime truth", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "prepare-env");
    const worktreePath = testSessionSourcePath(targetRoot, "prepare-env");
    const adapter = createJskitTargetAdapter();
    const session = {
      metadata: localSourceSessionMetadata(),
      sessionId: "prepare-env",
      sessionRoot,
      targetRoot
    };

    const firstSpec = await adapter.createCommandTerminalSpec("create_source", {
      projectSessionSourceRoot: testProjectSessionSourceRoot(targetRoot),
      session,
      targetRoot
    });
    assert.equal(firstSpec.ok, true);
    assert.deepEqual(firstSpec.mounts, [
      {
        readOnly: true,
        source: path.dirname(JSKIT_PREPARE_WORKTREE_SCRIPT_PATH),
        target: path.dirname(JSKIT_PREPARE_WORKTREE_SCRIPT_PATH)
      },
      {
        source: path.dirname(worktreePath),
        target: path.dirname(worktreePath)
      }
    ]);
    runCommand(firstSpec.command, firstSpec.args, {
      cwd: firstSpec.cwd
    });

    await assert.rejects(readFile(path.join(worktreePath, ".env"), "utf8"), {
      code: "ENOENT"
    });
  });
});
