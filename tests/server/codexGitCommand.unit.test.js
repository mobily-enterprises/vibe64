import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";

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

const SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES = Object.freeze([
  "base_commit",
  "canonical_commit",
  "repository_mode",
  "source",
  "source_kind",
  "source_path",
  "source_path_authority",
  "source_removed"
]);

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
    const stderrChunks = [];
    const stdoutChunks = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      const stdoutBytes = Buffer.concat(stdoutChunks);
      const stderrBytes = Buffer.concat(stderrChunks);
      resolve({ exitCode, signal, stderr: stderrBytes.toString("utf8"), stdout: stdoutBytes.toString("utf8"), stderrBytes, stdoutBytes });
    });
    child.stdin.end(input);
  });
}

function sessionSource(root = "", sessionId = "session-1", metadata = {}) {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  return {
    id: sessionId,
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      ...metadata
    },
    sessionId
  };
}

function githubSession(root = "", sessionId = "github-session") {
  const user = currentOsUser();
  const session = sessionSource(root, sessionId, {
    github_repository: "owner/repo",
    source_remote_url: "https://github.com/owner/repo.git"
  });
  Object.assign(session.metadata, {
    session_git_command_actor_reason: "unit-test",
    session_git_command_actor_scope: "user",
    session_git_command_actor_session_id: sessionId,
    session_git_command_actor_source_root: session.metadata.source_path,
    session_git_command_actor_thread_id: "thread-1",
    session_git_command_actor_user_key: user.username,
    session_git_command_actor_workdir: session.metadata.source_path
  });
  return session;
}

function serviceForSession(session = {}, {
  authorizeActorAccess = null,
  metadataReads = null,
  runGatewayCommand
} = {}) {
  return createCodexGitCommandService({
    authorizeActorAccess,
    projectService: {
      async createSessionStore() {
        return {
          async readMetadataValue(sessionId, name) {
            assert.equal(sessionId, session.sessionId);
            metadataReads?.push(name);
            return session.metadata?.[name] || "";
          },
          async readSessionSourceDescriptor(sessionId) {
            assert.equal(sessionId, session.sessionId);
            return {
              metadata: Object.fromEntries(
                SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES.map((name) => [
                  name,
                  session.metadata?.[name] || ""
                ])
              ),
              sessionId
            };
          }
        };
      }
    },
    runGatewayCommand
  });
}

test("Codex runs local Git inside the managed session source", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    let gatewayCall = null;
    const metadataReads = [];
    const service = serviceForSession(session, {
      metadataReads,
      authorizeActorAccess: async () => {
        throw new Error("Local Git must not require GitHub authorization.");
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
    assert.equal(gatewayCall.outputEncoding, "base64");
    assert.equal(gatewayCall.session.sessionId, session.sessionId);
    assert.ok(metadataReads.includes("github_repository"));
    assert.ok(metadataReads.includes("source_remote_url"));
  });
});

test("Codex recognizes a GitHub session from its source remote URL", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    delete session.metadata.github_repository;
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        return request.command === "gh"
          ? {
              exitCode: 0,
              ok: true,
              stdout: "secret-github-token\n"
            }
          : {
              exitCode: 0,
              ok: true,
              stdout: "fetched"
            };
      }
    });

    const result = await service.run({
      args: ["fetch", "origin", "main"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 2);
    assert.equal(gatewayCalls[0].command, "gh");
    assert.equal(gatewayCalls[1].command, "git");
    assert.equal(gatewayCalls[1].gitTransport, "github-token");
    assert.equal(gatewayCalls[1].gitAuthToken, "secret-github-token");
  });
});

test("Codex Git wrapper transports the complete command request", async () => {
  await withTemporaryRoot(async (root) => {
    const sessionId = "wrapper-session";
    const sourcePath = path.join(root, "source");
    await mkdir(sourcePath, { recursive: true });
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
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
      },
      sessionId,
      stateRoot: path.join(root, "state")
    });

    const result = await runProcessWithInput(
      path.join(prepared.hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...prepared.env
        },
        input: "stdin payload"
      }
    );

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "transport-ok\n");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "git");
    assert.deepEqual(calls[0].args, ["status", "--short"]);
    assert.equal(calls[0].cwd, sourcePath);
    assert.equal(Buffer.from(calls[0].inputBase64, "base64").toString("utf8"), "stdin payload");
    assert.equal(calls[0].sessionId, sessionId);

    const directChild = await new Promise((resolve, reject) => {
      const child = spawn(path.join(prepared.hostWrapperDir, "git"), ["status", "--short"], {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...prepared.env,
          VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID: String(process.pid)
        },
        stdio: ["pipe", "pipe", "pipe"]
      });
      let fallbackEndedInput = false;
      let stderr = "";
      let stdout = "";
      const fallback = setTimeout(() => {
        fallbackEndedInput = true;
        child.stdin.end("late input");
      }, 5000);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.stdin.on("error", () => {});
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        clearTimeout(fallback);
        child.stdin.destroy();
        resolve({ exitCode, fallbackEndedInput, signal, stderr, stdout });
      });
    });

    assert.equal(directChild.exitCode, 0, directChild.stderr);
    assert.equal(directChild.signal, null);
    assert.equal(directChild.stdout, "transport-ok\n");
    assert.equal(directChild.fallbackEndedInput, false);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].inputBase64, "");
  });
});

test("Codex Git command preparation preserves unchanged wrappers", async () => {
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
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
      },
      sessionId: "stable-wrapper-session",
      stateRoot: path.join(root, "state")
    };

    const first = await prepareCodexGitCommand(options);
    const firstGit = await stat(path.join(first.hostWrapperDir, "git"));
    const firstGh = await stat(path.join(first.hostWrapperDir, "gh"));
    const second = await prepareCodexGitCommand(options);
    const secondGit = await stat(path.join(second.hostWrapperDir, "git"));
    const secondGh = await stat(path.join(second.hostWrapperDir, "gh"));

    assert.equal(second.hostWrapperDir, first.hostWrapperDir);
    assert.equal(secondGit.mtimeMs, firstGit.mtimeMs);
    assert.equal(secondGh.mtimeMs, firstGh.mtimeMs);
  });
});

test("Codex Git command preparation coalesces concurrent socket startup and replacement", async () => {
  await withTemporaryRoot(async (root) => {
    const env = {
      VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
    };
    const sessionId = "concurrent-wrapper-session";
    const stateRoot = path.join(root, "state");
    const sourcePath = path.join(root, "source");
    await mkdir(sourcePath, { recursive: true });
    let firstServiceCalls = 0;
    const firstService = {
      async run() {
        firstServiceCalls += 1;
        return {
          exitCode: 0,
          ok: true,
          stdout: "first-service\n"
        };
      }
    };
    const prepareMany = (commandService) => Promise.all(Array.from({ length: 8 }, () => (
      prepareCodexGitCommand({
        commandService,
        env,
        sessionId,
        stateRoot
      })
    )));

    const initial = await prepareMany(firstService);
    assert.equal(initial.every(({ ok }) => ok === true), true);
    assert.equal(new Set(initial.map(({ hostSocketPath }) => hostSocketPath)).size, 1);
    assert.deepEqual(
      initial.map(({ env: commandEnv }) => commandEnv),
      Array.from({ length: initial.length }, () => initial[0].env)
    );

    const firstRun = await runProcessWithInput(
      path.join(initial[0].hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...initial[0].env
        }
      }
    );
    assert.equal(firstRun.exitCode, 0, firstRun.stderr);
    assert.equal(firstRun.stdout, "first-service\n");
    assert.equal(firstServiceCalls, 1);

    let replacementServiceCalls = 0;
    const replacementService = {
      async run() {
        replacementServiceCalls += 1;
        return {
          exitCode: 0,
          ok: true,
          stdout: "replacement-service\n"
        };
      }
    };
    const replacements = await prepareMany(replacementService);
    assert.equal(replacements.every(({ ok }) => ok === true), true);
    assert.deepEqual(
      replacements.map(({ env: commandEnv }) => commandEnv),
      Array.from({ length: replacements.length }, () => replacements[0].env)
    );

    const replacementRun = await runProcessWithInput(
      path.join(replacements[0].hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...replacements[0].env
        }
      }
    );
    assert.equal(replacementRun.exitCode, 0, replacementRun.stderr);
    assert.equal(replacementRun.stdout, "replacement-service\n");
    assert.equal(firstServiceCalls, 1);
    assert.equal(replacementServiceCalls, 1);
  });
});

test("Codex Git preparation repairs a missing cached socket once and fences the old generation", async () => {
  await withTemporaryRoot(async (root) => {
    const sourcePath = path.join(root, "source");
    await mkdir(sourcePath, { recursive: true });
    const options = {
      commandService: {
        async run() {
          return {
            exitCode: 0,
            ok: true,
            stdout: "healthy-generation\n"
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
      },
      sessionId: "missing-socket-session",
      stateRoot: path.join(root, "state")
    };
    const first = await prepareCodexGitCommand(options);
    await rm(first.hostSocketPath, { force: true });

    const repaired = await Promise.all(Array.from({ length: 8 }, () => (
      prepareCodexGitCommand(options)
    )));
    assert.equal(new Set(repaired.map((entry) => entry.controlGenerationId)).size, 1);
    assert.notEqual(repaired[0].controlGenerationId, first.controlGenerationId);
    assert.equal((await stat(repaired[0].hostSocketPath)).isSocket(), true);

    const stale = await runProcessWithInput(
      path.join(first.hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...first.env
        }
      }
    );
    assert.equal(stale.exitCode, 1);
    assert.match(stale.stderr, /vibe64_agent_control_unavailable/u);

    const current = await runProcessWithInput(
      path.join(repaired[0].hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...repaired[0].env
        }
      }
    );
    assert.equal(current.exitCode, 0, current.stderr);
    assert.equal(current.stdout, "healthy-generation\n");
  });
});

test("Codex rejects gh for a non-GitHub session", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root);
    const service = serviceForSession(session, {
      async runGatewayCommand() {
        throw new Error("Non-GitHub gh must not run.");
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

test("Codex keeps local Git filesystem work on the daemon identity", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        return {
          exitCode: 0,
          ok: true,
          stdout: "staged"
        };
      }
    });

    const result = await service.run({
      args: ["add", "-A"],
      command: "git",
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0].actor, "app");
    assert.equal(gatewayCalls[0].gitTransport, "none");
    assert.equal(gatewayCalls[0].gitAuthToken, "");
    assert.equal(gatewayCalls[0].userKey, user.username);
    assert.equal(gatewayCalls[0].project.ownerUserKey, user.username);
  });
});

test("Codex separates GitHub authorization from the Git filesystem identity", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        if (request.command === "gh") {
          return {
            exitCode: 0,
            ok: true,
            stdout: "secret-github-token\n"
          };
        }
        return {
          exitCode: 0,
          ok: true,
          stdout: "remote"
        };
      }
    });

    const result = await service.run({
      args: ["ls-remote", "origin"],
      command: "git",
      inputBase64: Buffer.from("stdin").toString("base64"),
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 2);
    assert.equal(gatewayCalls[0].actor, "owner-user");
    assert.equal(gatewayCalls[0].command, "gh");
    assert.deepEqual(gatewayCalls[0].args, ["auth", "token"]);
    assert.equal(gatewayCalls[0].cwd, user.home);
    assert.equal(gatewayCalls[0].purpose, "github-api");
    assert.equal(gatewayCalls[0].session.sourcePath, undefined);
    assert.equal(gatewayCalls[1].actor, "app");
    assert.equal(gatewayCalls[1].command, "git");
    assert.equal(gatewayCalls[1].gitTransport, "github-token");
    assert.equal(gatewayCalls[1].gitAuthToken, "secret-github-token");
    assert.equal(gatewayCalls[1].input.toString("utf8"), "stdin");
    assert.equal(gatewayCalls[1].session.sourcePath, session.metadata.source_path);
    assert.equal(gatewayCalls[1].userKey, user.username);
    assert.equal(gatewayCalls[1].project.ownerUserKey, user.username);
    assert.equal(gatewayCalls[1].session.metadata.session_git_command_actor_user_key, user.username);
  });
});

test("Codex reports the underlying GitHub token lookup failure", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const service = serviceForSession(session, {
      async runGatewayCommand() {
        return {
          exitCode: 2,
          ok: false,
          stderr: "GitHub token lookup failed in the user home."
        };
      }
    });

    const result = await service.run({
      args: ["fetch", "origin", "main"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_git_command_github_auth_unavailable");
    assert.equal(result.error, "GitHub token lookup failed in the user home.");
  });
});


test("the real Git gateway and generated wrapper preserve bytes and command failures", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root, "byte-output");
    const cwd = session.metadata.source_path;
    await mkdir(cwd, { recursive: true });
    let commandOverride = null;
    const service = serviceForSession(session, {
      runGatewayCommand: (request) => runVibe64Command({ ...request, ...commandOverride })
    });
    const prepared = await prepareCodexGitCommand({
      commandService: service,
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId: session.sessionId,
      stateRoot: root
    });
    const env = { ...process.env, ...prepared.env };
    const git = (args, input = "") => runProcessWithInput(path.join(prepared.hostWrapperDir, "git"), args, { cwd, env, input });
    assert.equal((await git(["init", "--quiet"])).exitCode, 0);
    for (const expected of [
      Buffer.alloc(0), Buffer.from("no final newline"), Buffer.from(" \t\nline\n\n \t"),
      Buffer.from([0, 255, 128, 0, 10, 13]), Buffer.alloc(1024 * 1024, 0xff)
    ]) {
      const stored = await git(["hash-object", "-w", "--stdin"], expected);
      assert.equal(stored.exitCode, 0, stored.stderr);
      const output = await git(["cat-file", "blob", stored.stdout.trim()]);
      assert.equal(output.exitCode, 0, output.stderr);
      assert.deepEqual(output.stdoutBytes, expected);
      assert.deepEqual(output.stderrBytes, Buffer.alloc(0));
    }
    const names = [" leading space", "embedded\nnewline", "trailing space "];
    for (const name of names) await writeFile(path.join(cwd, name), "file");
    await git(["add", "--", ...names]);
    const listed = await git(["ls-files", "-z"]);
    assert.deepEqual(listed.stdoutBytes, Buffer.from(names.sort().join("\0") + "\0"));
    const failed = await git(["-c", "alias.probe=!printf ' \\tno newline' >&2; exit 7", "probe"]);
    assert.equal(failed.exitCode, 7);
    assert.equal(failed.stderr, " \tno newline");
    assert.equal(failed.stdout, "");
    const silentFailure = await git(["-c", "alias.probe=!printf 'stdout only'; exit 7", "probe"]);
    assert.equal(silentFailure.exitCode, 7);
    assert.equal(silentFailure.stdout, "stdout only");
    assert.equal(silentFailure.stderr, "");
    const denied = await service.run({ command: "git", args: ["status"], sessionId: session.sessionId, cwd: path.dirname(cwd) });
    assert.equal(denied.ok, false);
    assert.match(denied.error, /inside the active project/u);
    commandOverride = { command: path.join(root, "missing-git") };
    const unavailable = await git(["status"]);
    assert.equal(unavailable.exitCode, 1);
    assert.match(unavailable.stderr, /ENOENT/u);
    commandOverride = { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], timeout: 100 };
    const timedOut = await git(["status"]);
    assert.equal(timedOut.exitCode, 1);
    assert.match(timedOut.stderr, /timed out/u);
  });
});

test("Genesis verification stays current through the actual Git wrapper until source changes", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root, "genesis-verification");
    const cwd = session.metadata.source_path;
    await mkdir(cwd, { recursive: true });
    const initial = await runProcessWithInput("git", ["init", "--quiet"], { cwd });
    assert.equal(initial.exitCode, 0, initial.stderr);
    await initializeGenesisProject({ projectRoot: cwd });
    await writeFile(path.join(cwd, "genesis/blueprint.md"), "# Blueprint\n\nA verification fixture.\n");
    await writeFile(path.join(cwd, "genesis/stack.md"), '# Stack\n\n## Components\n\n## Verification\n\n- Verify `fixture`: `node` `-e` `process.exit(0)`\n');
    await writeFile(path.join(cwd, ".gitignore"), "node_modules/\n");
    await writeFile(path.join(cwd, "value.js"), "export const value = 1;\n");
    const require = createRequire(new URL("../../packages/vibe64-genesis/package.json", import.meta.url));
    const compiler = pathToFileURL(require.resolve("genesis-compiler")).href;
    const prepared = await prepareCodexGitCommand({
      commandService: serviceForSession(session, { runGatewayCommand: runVibe64Command }),
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId: session.sessionId, stateRoot: root
    });
    const proof = await runProcessWithInput(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { execFileSync } from "node:child_process";
      import { writeFile } from "node:fs/promises";
      import { check, verify } from ${JSON.stringify(compiler)};
      const projectRoot = ${JSON.stringify(cwd)};
      for (const tracked of [false, true]) {
        await writeFile(projectRoot + "/value.js", "export const value = 1;\\n");
        const verified = await verify({ projectRoot });
        assert.equal(verified.status, "passed", JSON.stringify(verified));
        if (tracked) execFileSync("git", ["add", "-f", ".genesis/verification.json"], { cwd: projectRoot });
        for (let i = 0; i < 2; i++) {
          assert.equal((await verify({ projectRoot })).status, "passed");
          assert.equal((await check({ projectRoot })).verification, "current");
          assert.equal((await check({ projectRoot })).verification, "current");
        }
        await writeFile(projectRoot + "/value.js", "export const value = 2;\\n");
        assert.equal((await check({ projectRoot })).verification, "stale");
      }
    `], { cwd, env: { ...process.env, ...prepared.env, PATH: `${prepared.hostWrapperDir}${path.delimiter}${process.env.PATH}` } });
    assert.equal(proof.exitCode, 0, proof.stderr);
  });
});
