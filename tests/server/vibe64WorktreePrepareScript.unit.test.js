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
