import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";
import {
  currentOsUser
} from "@local/vibe64-core/server/osUserIdentity";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createCodexGitCommandService,
  prepareCodexGitCommand
} from "@local/vibe64-terminals/server/codexGitCommand";

import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
}

function runProcessWithInput(command, args = [], {
  cwd = "",
  env = process.env,
  input = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        stderr,
        stdout
      });
    });
    child.stdin.end(input);
  });
}

function localSourceSession(root = "", sessionId = "local-source-session") {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  return {
    id: sessionId,
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      workflow_driver_username: "local-owner",
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
    },
    sessionId,
    sessionRoot: path.join(root, "state", "sessions", "active", sessionId),
    targetRoot: path.join(root, "opened-repo")
  };
}

function githubSession(root = "", sessionId = "github-session") {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  const user = currentOsUser();
  return {
    id: sessionId,
    metadata: {
      github_repository: "owner/repo",
      repository_mode: "github",
      session_git_command_actor_reason: "unit-test",
      session_git_command_actor_scope: "user",
      session_git_command_actor_session_id: sessionId,
      session_git_command_actor_target_root: sourcePath,
      session_git_command_actor_thread_id: "thread-1",
      session_git_command_actor_user_key: user.username,
      session_git_command_actor_workdir: sourcePath,
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      workflow_repository_profile: WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR
    },
    sessionId,
    sessionRoot: path.join(root, "state", "sessions", "active", sessionId),
    targetRoot: path.join(root, "opened-repo")
  };
}

function serviceForSession(session = {}, {
  authorizeActorAccess = null,
  runGatewayCommand
} = {}) {
  return createCodexGitCommandService({
    authorizeActorAccess,
    projectService: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          }
        };
      }
    },
    runGatewayCommand
  });
}

test("Codex git command allows local-source git without GitHub actor metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const session = localSourceSession(root);
    await mkdir(session.metadata.source_path, {
      recursive: true
    });

    let gatewayCall = null;
    const service = serviceForSession(session, {
      authorizeActorAccess: async () => {
        throw new Error("local-source git must not use GitHub actor authorization");
      },
      async runGatewayCommand(request) {
        gatewayCall = request;
        return {
          exitCode: 0,
          ok: true,
          stdout: "clean"
        };
      }
    });

    const result = await service.run({
      args: ["status", "--porcelain"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "clean");
    assert.equal(gatewayCall.actor, "app");
    assert.equal(gatewayCall.command, "git");
    assert.deepEqual(gatewayCall.args, ["status", "--porcelain"]);
    assert.equal(gatewayCall.cwd, session.metadata.source_path);
    assert.equal(gatewayCall.gitTransport, "none");
    assert.equal(gatewayCall.purpose, "codex");
    assert.equal(gatewayCall.userKey, "local-owner");
    assert.equal(gatewayCall.project.tenant, "unit-owner");
    assert.equal(gatewayCall.session.sessionId, session.sessionId);
    assert.equal(gatewayCall.session.targetRoot, session.metadata.source_path);
    assert.equal(gatewayCall.session.metadata.workflow_driver_username, "local-owner");
    assert.deepEqual(gatewayCall.gitSafeDirectories, [
      session.metadata.source_path,
      session.metadata.source_path
    ]);
    assert.deepEqual(gatewayCall.runtimes, ["git", "gh"]);
  });
});

test("Codex git wrapper transports command, args, cwd, stdin, session id, and token", async () => {
  await withTemporaryRoot(async (root) => {
    const sessionId = "wrapper-transport-session";
    const sourcePath = path.join(root, "source");
    await mkdir(sourcePath, {
      recursive: true
    });
    const calls = [];
    const prepared = await prepareCodexGitCommand({
      commandService: {
        async run(input) {
          calls.push(input);
          return {
            exitCode: 0,
            ok: true,
            stderr: "",
            stdout: "transport-ok\n"
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(path.dirname(root), "attachments")
      },
      sessionId,
      stateRoot: path.join(root, "state")
    });

    assert.equal(prepared.ok, true);
    const wrapperPath = path.join(prepared.hostWrapperDir, "git");
    const result = await runProcessWithInput(wrapperPath, ["status", "--short"], {
      cwd: sourcePath,
      env: {
        ...process.env,
        ...prepared.env
      },
      input: "stdin payload"
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "transport-ok\n");
    assert.equal(result.stderr, "");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "git");
    assert.deepEqual(calls[0].args, ["status", "--short"]);
    assert.equal(calls[0].cwd, sourcePath);
    assert.equal(Buffer.from(calls[0].inputBase64, "base64").toString("utf8"), "stdin payload");
    assert.equal(calls[0].sessionId, sessionId);
    assert.equal(calls[0].token, prepared.env.VIBE64_CODEX_GIT_COMMAND_TOKEN);
  });
});

test("Codex git command preparation does not rewrite unchanged wrapper files", async () => {
  await withTemporaryRoot(async (root) => {
    const options = {
      commandService: {
        async run() {
          return {
            exitCode: 0,
            ok: true,
            stdout: ""
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(path.dirname(root), "attachments")
      },
      sessionId: "idempotent-wrapper-session",
      stateRoot: path.join(root, "state")
    };

    const first = await prepareCodexGitCommand(options);
    const firstGitStat = await stat(path.join(first.hostWrapperDir, "git"));
    const firstGhStat = await stat(path.join(first.hostWrapperDir, "gh"));
    const second = await prepareCodexGitCommand(options);
    const secondGitStat = await stat(path.join(second.hostWrapperDir, "git"));
    const secondGhStat = await stat(path.join(second.hostWrapperDir, "gh"));

    assert.equal(second.hostWrapperDir, first.hostWrapperDir);
    assert.equal(secondGitStat.mtimeMs, firstGitStat.mtimeMs);
    assert.equal(secondGhStat.mtimeMs, firstGhStat.mtimeMs);
  });
});

test("Codex git command rejects gh for local-source sessions", async () => {
  await withTemporaryRoot(async (root) => {
    const session = localSourceSession(root);
    const service = serviceForSession(session, {
      async runGatewayCommand() {
        throw new Error("local-source gh must not run");
      }
    });

    const result = await service.run({
      args: ["auth", "status"],
      command: "gh",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_git_command_github_unavailable");
    assert.equal(result.statusCode, 403);
  });
});

test("Codex git command gives local-source commits gateway fallback identity without repo git config", async () => {
  await withTemporaryRoot(async (root) => {
    const session = localSourceSession(root, "local-source-commit-session");
    await mkdir(session.metadata.source_path, {
      recursive: true
    });
    await git(session.metadata.source_path, ["init"]);

    const service = serviceForSession(session);
    const result = await service.run({
      args: ["commit", "--allow-empty", "-m", "gateway fallback identity"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, true, result.stderr || result.error || "");
    const log = await git(session.metadata.source_path, [
      "log",
      "-1",
      "--format=%an <%ae>|%cn <%ce>"
    ]);
    assert.equal(
      log.stdout.trim(),
      "local-owner via Vibe64 <local-owner@unit-owner.users.vibe64.invalid>|Vibe64 <vibe64@unit-owner.users.vibe64.invalid>"
    );
  });
});

test("Codex git command runs GitHub repository commands as the stored OS actor", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, {
      recursive: true
    });

    let gatewayCall = null;
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCall = request;
        return {
          exitCode: 0,
          ok: true,
          stdout: "remote"
        };
      }
    });

    const result = await service.run({
      args: ["ls-remote", "origin", "refs/heads/main"],
      command: "git",
      inputBase64: Buffer.from("stdin").toString("base64"),
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "remote");
    assert.equal(gatewayCall.actor, "owner-user");
    assert.equal(gatewayCall.command, "git");
    assert.deepEqual(gatewayCall.args, ["ls-remote", "origin", "refs/heads/main"]);
    assert.equal(gatewayCall.cwd, session.metadata.source_path);
    assert.equal(gatewayCall.gitTransport, "github-https");
    assert.equal(gatewayCall.input.toString("utf8"), "stdin");
    assert.equal(gatewayCall.purpose, "github");
    assert.equal(gatewayCall.userKey, user.username);
    assert.equal(gatewayCall.project.ownerUserKey, user.username);
    assert.equal(gatewayCall.project.tenant, "unit-owner");
    assert.equal(gatewayCall.session.sessionId, session.sessionId);
    assert.equal(gatewayCall.session.metadata.session_git_command_actor_user_key, user.username);
    assert.deepEqual(gatewayCall.allowedRoots, [
      session.metadata.source_path
    ]);
    assert.deepEqual(gatewayCall.gitSafeDirectories, [
      session.metadata.source_path,
      session.metadata.source_path
    ]);
  });
});

test("Codex gh command runs GitHub repository commands as the stored OS actor", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root, "github-gh-session");
    await mkdir(session.metadata.source_path, {
      recursive: true
    });

    let gatewayCall = null;
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCall = request;
        return {
          exitCode: 0,
          ok: true,
          stdout: "github.com\n"
        };
      }
    });

    const result = await service.run({
      args: ["auth", "status"],
      command: "gh",
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "github.com\n");
    assert.equal(gatewayCall.actor, "owner-user");
    assert.equal(gatewayCall.command, "gh");
    assert.deepEqual(gatewayCall.args, ["auth", "status"]);
    assert.equal(gatewayCall.cwd, session.metadata.source_path);
    assert.equal(gatewayCall.gitTransport, "github-https");
    assert.equal(gatewayCall.purpose, "github");
    assert.equal(gatewayCall.userKey, user.username);
    assert.equal(gatewayCall.project.ownerUserKey, user.username);
    assert.equal(gatewayCall.session.metadata.session_git_command_actor_user_key, user.username);
  });
});
