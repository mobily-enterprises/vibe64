import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  ensureSessionSourceGitAlternatesDissociated,
  sessionSourceGitAlternatesPath
} from "@local/vibe64-runtime/server/sessionSourceGit";
import {
  startCommandTerminalProcess
} from "../../packages/vibe64-terminals/src/server/commandTerminal.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: 30_000
    });
    return String(result.stdout || "").trim();
  } catch (error) {
    throw new Error(String(error.stderr || error.stdout || error.message || error));
  }
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createGitProject(root) {
  await mkdir(root, {
    recursive: true
  });
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "vibe64@example.test"]);
  await git(root, ["config", "user.name", "Vibe64 Test"]);
  await writeProjectFile(root, "app.txt", "initial\n");
  await git(root, ["add", "app.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["branch", "-M", "main"]);
}

async function createReferencedSessionSource(targetRoot) {
  const parentRoot = path.dirname(targetRoot);
  const originPath = path.join(parentRoot, "origin");
  const cachePath = path.join(parentRoot, "git-cache", "repository.git");
  const sourcePath = path.join(parentRoot, "sessions", "active", "unit-session", "source");
  await createGitProject(originPath);
  await mkdir(path.dirname(cachePath), {
    recursive: true
  });
  await git(parentRoot, ["clone", "--bare", originPath, cachePath]);
  await mkdir(path.dirname(sourcePath), {
    recursive: true
  });
  await git(parentRoot, [
    "clone",
    "--reference-if-able",
    cachePath,
    originPath,
    sourcePath
  ]);
  return {
    cachePath,
    sourcePath
  };
}

test("session source Git helper removes runtime git-cache alternates", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { cachePath, sourcePath } = await createReferencedSessionSource(targetRoot);
    const alternatesPath = await sessionSourceGitAlternatesPath(sourcePath);
    assert.equal(await pathExists(alternatesPath), true);

    const result = await ensureSessionSourceGitAlternatesDissociated(sourcePath);
    assert.equal(result.ok, true);
    assert.equal(result.repaired, true);
    assert.equal(await pathExists(alternatesPath), false);

    await rename(cachePath, `${cachePath}.removed`);
    assert.match(await git(sourcePath, ["rev-parse", "--verify", "HEAD"]), /^[0-9a-f]{40}$/u);
    assert.equal(await git(sourcePath, ["status", "--short"]), "");
  });
});

test("command terminal launch repairs session source alternates before container start", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { sourcePath } = await createReferencedSessionSource(targetRoot);
    const alternatesPath = await sessionSourceGitAlternatesPath(sourcePath);
    assert.equal(await pathExists(alternatesPath), true);

    const startedTerminals = [];
    const result = await startCommandTerminalProcess({
      containerName: "unit-command-terminal",
      ensureRuntimeNetwork: async () => "unit-network",
      namespace: "unit-command-terminal",
      namespaceLimitPrefix: "unit-command-terminal",
      projectService: {
        async projectConfigEnvironment() {
          return {};
        },
        async projectRuntimeConfigEnvironment() {
          return {};
        }
      },
      resolveToolchainImage: async () => ({
        image: "unit-toolchain:latest",
        label: "Unit toolchain",
        ok: true
      }),
      runtime: {
        adapter: {
          id: "unit",
          async listRuntimeContainers() {
            return [];
          }
        }
      },
      session: {
        metadata: {
          source_path: sourcePath
        },
        sessionId: "unit-session",
        sessionRoot: path.dirname(sourcePath),
        targetRoot: sourcePath
      },
      spec: {
        args: ["-lc", "true"],
        command: "bash",
        cwd: sourcePath
      },
      startTerminal: async (options = {}) => {
        startedTerminals.push(options);
        assert.equal(await pathExists(alternatesPath), false);
        return {
          id: "terminal-1",
          ok: true,
          status: "running"
        };
      },
      target: "command",
      targetRoot: sourcePath
    });

    assert.equal(result.ok, true);
    assert.equal(startedTerminals.length, 1);
    assert.equal(await pathExists(alternatesPath), false);
  });
});
