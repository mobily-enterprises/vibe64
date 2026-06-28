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
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  ensureSessionSourceGitAlternatesDissociated,
  sessionSourceGitAlternatesPath
} from "@local/vibe64-runtime/server/sessionSourceGit";
import {
  createService
} from "../../packages/vibe64-terminals/src/server/service.js";
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

test("Codex thread reconciliation repairs session source alternates from summaries", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { sourcePath } = await createReferencedSessionSource(targetRoot);
    const alternatesPath = await sessionSourceGitAlternatesPath(sourcePath);
    assert.equal(await pathExists(alternatesPath), true);

    const threadId = "00000000-0000-4000-8000-000000000701";
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.createSession({
      initialStep: "source_created",
      metadata: {
        agent_identity_conversation_id: threadId,
        agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_workdir: sourcePath,
        codex_app_server_provider: "codex_app_server",
        codex_thread_id: threadId,
        codex_workdir: sourcePath,
        source_path: sourcePath
      },
      sessionId: "unit-session"
    });

    const providerCalls = {
      listLoadedThreads: 0,
      subscribe: 0
    };
    const terminalService = createService({
      codexTerminalController: {
        codexToolHomeRequired: false,
        codexAppServerProviderFactory() {
          return {
            async ensureAvailable() {
              return {
                ok: true
              };
            },
            async ensureRuntime() {
              return {
                endpoint: `unix://${path.join(targetRoot, "codex-app-server.sock")}`,
                runtimeDir: path.join(targetRoot, "codex-app-server-runtime"),
                socketPath: path.join(targetRoot, "codex-app-server.sock"),
                transport: "unix"
              };
            },
            async listLoadedThreads() {
              providerCalls.listLoadedThreads += 1;
              return {
                data: [threadId],
                nextCursor: null
              };
            },
            subscribe() {
              providerCalls.subscribe += 1;
              return () => null;
            }
          };
        },
        codexAppServerProviderOptions: {
          useDocker: false
        }
      },
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {};
        }
      }
    });

    const result = await terminalService.reconcileCodexThreads([
      {
        sessionId: "unit-session"
      }
    ]);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.results[0].status, "loaded");
    assert.equal(providerCalls.listLoadedThreads, 1);
    assert.equal(providerCalls.subscribe, 1);
    assert.equal(await pathExists(alternatesPath), false);
  });
});
