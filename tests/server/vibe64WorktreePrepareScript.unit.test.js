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

function decodeCommandFacts(text = "") {
  return Object.fromEntries(text.split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter(([operation, name, value]) => operation === "fact:set" && name && value)
    .map(([, name, value]) => [
      name,
      Buffer.from(value, "base64").toString("utf8")
    ]));
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
        metadata: {},
        sessionId: `prepare-mount-${adapter.id}`,
        sessionRoot: path.join(targetRoot, ".vibe64", "sessions", "active", `prepare-mount-${adapter.id}`),
        targetRoot
      };
      const spec = await adapter.createCommandTerminalSpec("create_worktree", {
        session,
        targetRoot
      });
      assert.equal(spec.ok, true);
      assert.deepEqual(spec.mounts || [], scriptPath
        ? [
            {
              readOnly: true,
              source: path.dirname(scriptPath),
              target: path.dirname(scriptPath)
            }
          ]
        : []);
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
        ".vibe64/",
        ".vibe64-local/"
      ].join("\n")),
      writeProjectFile(targetRoot, "README.md", "# Seeded target\n")
    ]);

    const sessionRoot = path.join(targetRoot, ".vibe64-local", "sessions", "active", "unborn-seed");
    const worktreePath = path.join(sessionRoot, "worktree");
    const resultFile = path.join(path.dirname(targetRoot), "command-result.tsv");
    const session = {
      metadata: {},
      sessionId: "unborn-seed",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_worktree", {
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
    assert.equal(runGit(worktreePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(worktreePath, ["branch", "--show-current"]), "vibe64/unborn-seed");
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
    const sessionRoot = path.join(targetRoot, ".vibe64-local", "sessions", "active", "ordinary-directory");
    const worktreePath = path.join(sessionRoot, "worktree");
    await writeProjectFile(worktreePath, "src/typed-router.d.ts", "declare module 'typed-router';\n");

    const session = {
      metadata: {},
      sessionId: "ordinary-directory",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_worktree", {
      session,
      targetRoot
    });
    assert.equal(spec.ok, true);

    const result = runCommandResult(spec.command, spec.args, {
      cwd: spec.cwd
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Worktree path exists but is not a Git worktree/u);
    assert.doesNotMatch(runGit(targetRoot, ["worktree", "list", "--porcelain"]), new RegExp(worktreePath, "u"));
  });
});

test("create worktree initializes a plain local folder before creating the worktree", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await Promise.all([
      writeProjectFile(targetRoot, ".gitignore", [
        ".vibe64/",
        ".vibe64-local/"
      ].join("\n")),
      writeProjectFile(targetRoot, "README.md", "# Plain local target\n")
    ]);

    const sessionRoot = path.join(targetRoot, ".vibe64-local", "sessions", "active", "plain-local");
    const worktreePath = path.join(sessionRoot, "worktree");
    const resultFile = path.join(path.dirname(targetRoot), "command-result.tsv");
    const session = {
      metadata: {},
      sessionId: "plain-local",
      sessionRoot,
      targetRoot
    };
    const spec = await createCppTargetAdapter().createCommandTerminalSpec("create_worktree", {
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.base_branch, "");
    assert.equal(spec.successMetadata.base_commit, "");

    runCommand(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        GIT_AUTHOR_EMAIL: "studio-test@example.com",
        GIT_AUTHOR_NAME: "Studio Test",
        GIT_COMMITTER_EMAIL: "studio-test@example.com",
        GIT_COMMITTER_NAME: "Studio Test",
        VIBE64_COMMAND_RESULT_FILE: resultFile
      }
    });

    const baseCommit = runGit(targetRoot, ["rev-parse", "--verify", "HEAD"]);
    const facts = decodeCommandFacts(await readFile(resultFile, "utf8"));
    assert.equal(facts.base_branch, "main");
    assert.equal(facts.base_commit, baseCommit);
    assert.equal(runGit(worktreePath, ["rev-parse", "--verify", "HEAD"]), baseCommit);
    assert.equal(runGit(worktreePath, ["branch", "--show-current"]), "vibe64/plain-local");
  });
});

test("create worktree terminal specs branch existing PR sessions from the source PR head", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "stacked-pr");
    const session = {
      metadata: {
        source_pr_head_ref: "feature-base",
        source_pr_head_repo: "example/project",
        source_pr_head_sha: "abc123",
        source_pr_number: "77",
        source_pr_update_mode: "stacked",
        source_pr_url: "https://github.com/example/project/pull/77",
        work_source: "existing_pr"
      },
      sessionId: "stacked-pr",
      sessionRoot,
      targetRoot
    };
    const spec = await createGenericNodeWebTargetAdapter().createCommandTerminalSpec("create_worktree", {
      session,
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.successMetadata.base_branch, "feature-base");
    assert.equal(spec.successMetadata.base_commit, "abc123");

    const script = spec.args.at(-1);
    assert.match(script, /git -C .* fetch origin "pull\/\$SOURCE_PR_NUMBER\/head:\$PR_FETCH_REF"/u);
    assert.match(script, /FETCHED_PR_SHA=/u);
    assert.match(script, /Existing PR #%s moved from %s to %s/u);
    assert.match(script, /worktree add -b .* "\$PR_FETCH_REF"/u);
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

test("create worktree runs the adapter preparation script without overwriting session edits", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const sessionRoot = path.join(targetRoot, ".vibe64", "sessions", "active", "prepare-env");
    const worktreePath = path.join(sessionRoot, "worktree");
    const adapter = createJskitTargetAdapter();
    const session = {
      metadata: {},
      sessionId: "prepare-env",
      sessionRoot,
      targetRoot
    };

    const firstSpec = await adapter.createCommandTerminalSpec("create_worktree", {
      session,
      targetRoot
    });
    assert.equal(firstSpec.ok, true);
    assert.deepEqual(firstSpec.mounts, [
      {
        readOnly: true,
        source: path.dirname(JSKIT_PREPARE_WORKTREE_SCRIPT_PATH),
        target: path.dirname(JSKIT_PREPARE_WORKTREE_SCRIPT_PATH)
      }
    ]);
    runCommand(firstSpec.command, firstSpec.args, {
      cwd: firstSpec.cwd
    });

    assert.equal(await readFile(path.join(worktreePath, ".env"), "utf8"), "SECRET=from-target\n");

    await writeProjectFile(worktreePath, ".env", "SECRET=session-edit\n");
    await writeProjectFile(targetRoot, ".env", "SECRET=changed-target\n");
    const secondSpec = await adapter.createCommandTerminalSpec("create_worktree", {
      session: {
        ...session,
        metadata: {
          worktree_path: worktreePath
        }
      },
      targetRoot
    });
    assert.equal(secondSpec.ok, true);
    runCommand(secondSpec.command, secondSpec.args, {
      cwd: secondSpec.cwd
    });

    assert.equal(await readFile(path.join(worktreePath, ".env"), "utf8"), "SECRET=session-edit\n");
  });
});
