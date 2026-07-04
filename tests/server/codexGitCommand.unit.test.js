import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE
} from "@local/vibe64-core/server/projectRepository";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createCodexGitCommandService
} from "@local/vibe64-terminals/server/codexGitCommand";

import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

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

function serviceForSession(session = {}, {
  authorizeActorAccess = null,
  runCommand
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
    runCommand
  });
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
    assert.equal(commandCall.options.targetRoot, session.metadata.source_path);
    assert.equal(commandCall.options.githubToolHomeSource, "");
    assert.equal(commandCall.options.toolHomeSource, homedir());
    assert.equal(commandCall.options.env.HOME, homedir());
    assert.equal(commandCall.options.env.XDG_CONFIG_HOME, path.join(homedir(), ".config"));
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
