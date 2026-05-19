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
} from "../../server/lib/aiStudio/adapters/cpp/index.js";
import {
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  createGenericNodeWebTargetAdapter
} from "../../server/lib/aiStudio/adapters/node-web/index.js";
import {
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  createJskitTargetAdapter
} from "../../server/lib/aiStudio/adapters/jskit/index.js";
import {
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  createLaravelTargetAdapter
} from "../../server/lib/aiStudio/adapters/laravel/index.js";
import {
  NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
  createNextjsTargetAdapter
} from "../../server/lib/aiStudio/adapters/nextjs/index.js";
import {
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  createVinextTargetAdapter
} from "../../server/lib/aiStudio/adapters/vinext/index.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

function runCommand(command, args, {
  cwd
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
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

async function createGitTarget(root) {
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "Studio Test"]);
  runGit(root, ["config", "user.email", "studio-test@example.com"]);
  await Promise.all([
    writeProjectFile(root, ".gitignore", [
      ".ai-studio/",
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

test("create worktree runs the adapter preparation script without overwriting session edits", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitTarget(targetRoot);
    const sessionRoot = path.join(targetRoot, ".ai-studio", "sessions", "active", "prepare-env");
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
