import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";

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
  createCodexGitCommandService
} from "@local/vibe64-terminals/server/codexGitCommand";

import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";
process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

function localSourceSession(root = "", sessionId = "local-source-session") {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  return {
    id: sessionId,
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
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
  runCommand,
  runUserCommand
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
    runCommand,
    runUserCommand
  });
}

function gitConfigEnvEntries(env = {}) {
  const count = Number(env.GIT_CONFIG_COUNT || 0);
  return Array.from({
    length: Number.isSafeInteger(count) && count > 0 ? count : 0
  }, (_, index) => ({
    key: env[`GIT_CONFIG_KEY_${index}`],
    value: env[`GIT_CONFIG_VALUE_${index}`]
  }));
}

test("Codex git command allows local-source git without GitHub actor metadata", async () => {
  await withTemporaryRoot(async (root) => {
    const session = localSourceSession(root);
    await mkdir(session.metadata.source_path, {
      recursive: true
    });

    let commandCall = null;
    const service = serviceForSession(session, {
      authorizeActorAccess: async () => {
        throw new Error("local-source git must not use GitHub actor authorization");
      },
      async runCommand(command, args, options) {
        commandCall = {
          args,
          command,
          options
        };
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
    assert.equal(commandCall.command, "git");
    assert.deepEqual(commandCall.args, ["status", "--porcelain"]);
    assert.equal(commandCall.options.cwd, session.metadata.source_path);
    assert.equal(commandCall.options.env.HOME, homedir());
    assert.equal(commandCall.options.env.XDG_CONFIG_HOME, path.join(homedir(), ".config"));
    assert.equal(commandCall.options.env.GIT_CONFIG_COUNT, "1");
    assert.equal(commandCall.options.env.GIT_CONFIG_KEY_0, "safe.directory");
    assert.equal(commandCall.options.env.GIT_CONFIG_VALUE_0, session.metadata.source_path);
  });
});

test("Codex git command rejects gh for local-source sessions", async () => {
  await withTemporaryRoot(async (root) => {
    const session = localSourceSession(root);
    const service = serviceForSession(session, {
      async runCommand() {
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

test("Codex git command runs GitHub repository commands as the stored OS actor", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, {
      recursive: true
    });

    let directCommandCalled = false;
    let userCommandCall = null;
    const service = serviceForSession(session, {
      async runCommand() {
        directCommandCalled = true;
        throw new Error("GitHub git must use host user execution");
      },
      async runUserCommand(command, args, options) {
        userCommandCall = {
          args,
          command,
          options
        };
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
    assert.equal(directCommandCalled, false);
    assert.equal(userCommandCall.command, "git");
    assert.deepEqual(userCommandCall.args, ["ls-remote", "origin", "refs/heads/main"]);
    assert.equal(userCommandCall.options.cwd, session.metadata.source_path);
    assert.equal(userCommandCall.options.home, user.home);
    assert.equal(userCommandCall.options.input.toString("utf8"), "stdin");
    assert.equal(userCommandCall.options.operation, "github-workflow-command");
    assert.equal(userCommandCall.options.uid, user.uid);
    assert.equal(userCommandCall.options.gid, user.gid);
    assert.equal(userCommandCall.options.username, user.username);
    assert.equal(userCommandCall.options.env.HOME, user.home);
    assert.equal(userCommandCall.options.env.XDG_CONFIG_HOME, path.join(user.home, ".config"));
    assert.ok(gitConfigEnvEntries(userCommandCall.options.env).some((entry) => (
      entry.key === "safe.directory" && entry.value === session.metadata.source_path
    )));
  });
});
