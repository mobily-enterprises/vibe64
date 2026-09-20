import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { pathToFileURL } from "node:url";

import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { createService as createProjectService } from "../../packages/vibe64-project/src/server/service.js";
import { createVibe64ProjectChangedPublisher } from "../../packages/vibe64-project/src/server/actions.js";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

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
  logger = null,
  metadataReads = null,
  readCurrentProject,
  refreshGithub,
  runGatewayCommand
} = {}) {
  return createCodexGitCommandService({
    authorizeActorAccess,
    logger,
    projectService: {
      readCurrentProject,
      refreshGithub,
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

test("GitHub refresh uses the managed socket and publishes only its bound project", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const events = [];
    const projects = ["first", "second"].map((slug) => ({ slug, path: path.join(root, slug),
      githubRepository: { fullName: `owner/${slug}` }, repositoryMode: "local_source" }));
    const projectService = createProjectService({
      projectContext: {
        targetRoot: projects[0].path,
        requestContextMatchesSelectedProject: () => false,
        listWorkspaceProjects: async () => ({ projects })
      },
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events: { publish: async (event) => events.push(event) } })
    });
    const service = serviceForSession(session, {
      authorizeActorAccess: async ({ actor }) => ({ ok: actor.sessionId === session.sessionId }),
      refreshGithub: projectService.refreshGithub,
      readCurrentProject: projectService.readCurrentProject,
      runGatewayCommand: async () => { throw new Error("Refresh must not read credentials or execute GitHub commands."); }
    });
    const prepared = await runWithProjectRequestContext({ slug: "second", targetRoot: projects[1].path }, () => prepareCodexGitCommand({
      commandService: service, sessionId: session.sessionId, stateRoot: path.join(root, "state"),
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") }
    }));
    const command = path.join(prepared.hostWrapperDir, "vibe64-github");
    const env = { ...process.env, ...prepared.env };
    const options = { cwd: session.metadata.source_path, env };
    const result = await runWithProjectRequestContext({ slug: "first", targetRoot: projects[0].path }, () =>
      runProcessWithInput(command, ["refresh"], options));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "Vibe64 GitHub refresh requested.\n");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].realtime.payload, { projectSlug: "second", githubRefresh: true, reason: "github-refreshed" });
    await prepareAgentHelperCommand({ wrapperHostDir: prepared.hostWrapperDir });
    const helper = path.join(prepared.hostWrapperDir, "vibe64-helper");
    const help = await runProcessWithInput(helper, ["github", "--help"], options);
    assert.equal(help.exitCode, 0, help.stderr);
    assert.match(help.stdout, /vibe64-helper github refresh/u);
    const link = await runWithProjectRequestContext({ slug: "first", targetRoot: projects[0].path }, () =>
      runProcessWithInput(command, ["issue-link", "43"], options));
    assert.equal(link.exitCode, 0, link.stderr);
    assert.equal(link.stdout, "/app/project/second/dashboard/issues?issue=43\n");
    assert.equal(events.length, 1, "Link lookup must not publish a refresh");
    for (const args of [["issue-link"], ["issue-link", "0"], ["issue-link", "-1"], ["issue-link", "1.5"],
      ["issue-link", "9007199254740992"], ["issue-link", "43", "--project", "first"]]) {
      const rejected = await runProcessWithInput(command, args, options);
      assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr, /Usage: vibe64-helper github/u);
    }
    for (const override of [
      { VIBE64_CODEX_GIT_COMMAND_SESSION_ID: "another-session" },
      { VIBE64_CODEX_GIT_COMMAND_TOKEN: "invalid" },
      { VIBE64_CODEX_GIT_COMMAND_GENERATION: "stale" }
    ]) {
      const rejected = await runProcessWithInput(command, ["refresh"], { ...options, env: { ...env, ...override } });
      assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr, /vibe64_agent_control_unavailable/u);
    }
    const invalid = await runProcessWithInput(command, ["refresh", "--project", "first"], options);
    assert.equal(invalid.exitCode, 1);
    assert.match(invalid.stderr, /Usage: vibe64-helper github refresh/u);
    assert.equal(events.length, 1);
  });
});

test("GitHub refresh rejects non-GitHub sessions and revoked actor access", async () => {
  await withTemporaryRoot(async (root) => {
    for (const session of [sessionSource(root), githubSession(root)]) {
      const service = serviceForSession(session, {
        authorizeActorAccess: async () => ({ ok: false, error: "Access revoked." }),
        refreshGithub: async () => { assert.fail("Rejected sessions must not publish a refresh."); }
      });
      for (const args of [["refresh"], ["issue-link", "43"]]) {
        const result = await service.run({ command: "vibe64-github", args, sessionId: session.sessionId });
        assert.equal(result.ok, false);
        assert.equal(result.statusCode, 403);
      }
    }
  });
});

test("GitHub refresh reports publication failures through the real wrapper", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const prepared = await prepareCodexGitCommand({
      commandService: serviceForSession(session, {
        refreshGithub: async () => { throw new Error("Refresh delivery failed."); }
      }),
      sessionId: session.sessionId, stateRoot: path.join(root, "state"),
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") }
    });
    const result = await runProcessWithInput(path.join(prepared.hostWrapperDir, "vibe64-github"), ["refresh"], {
      cwd: session.metadata.source_path, env: { ...process.env, ...prepared.env }
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Refresh delivery failed/u);
  });
});

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

test("managed Git waits past five seconds and the executor stops work at its 30-second budget", { timeout: 60_000 }, async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root, "command-deadline");
    const cwd = session.metadata.source_path;
    await mkdir(cwd, { recursive: true });
    const calls = [];
    const events = [];
    let script = "setTimeout(() => process.stdout.write('slow success'), 6000)";
    const service = serviceForSession(session, {
      logger: { info: (fields) => events.push(fields), warn: (fields) => events.push(fields) },
      runGatewayCommand(request) {
        calls.push(request);
        return runVibe64Command({ ...request, command: process.execPath, args: ["-e", script] });
      }
    });
    const prepared = await prepareCodexGitCommand({
      commandService: service,
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId: session.sessionId,
      stateRoot: root
    });
    const command = path.join(prepared.hostWrapperDir, "git");
    const options = { cwd, env: { ...process.env, ...prepared.env } };
    const slow = await runProcessWithInput(command, ["status"], options);
    assert.equal(slow.exitCode, 0, slow.stderr);
    assert.equal(slow.stdout, "slow success");
    assert.equal(slow.stderr, "", "Successful output must not gain diagnostics");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].timeout > 29_000 && calls[0].timeout <= 30_000);

    script = "process.stdout.write(String(process.pid)); process.stderr.write('partial stderr'); setInterval(() => {}, 1000)";
    const started = performance.now();
    const timedOut = await runProcessWithInput(command, ["status"], options);
    assert.ok(performance.now() - started >= 29_000, "The command gets the requested budget, not a five-second socket cutoff");
    assert.equal(timedOut.exitCode, 1);
    assert.match(timedOut.stderr, /partial stderr/u);
    assert.match(timedOut.stderr, /vibe64_command_capture_timed_out: Managed Git command timed out/u);
    assert.match(timedOut.stderr, /Check the result before retrying a write/u);
    assert.doesNotMatch(timedOut.stderr, /Reconnect|auth.*unavailable/u);
    const pid = Number(timedOut.stdout);
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "The process must be gone before the wrapper returns");
    assert.equal(events.at(-1).stage, "command");
    assert.equal(events.at(-1).timedOut, true);
    assert.equal(events.at(-1).errorCode, "vibe64_command_capture_timed_out");
    assert.ok(events.at(-1).executionId);
    const diagnostic = JSON.parse(timedOut.stderr.match(/Managed Git diagnostic: (.+)\n/u)[1]);
    assert.equal(diagnostic.stage, "command");
    assert.equal(diagnostic.budgetMs, 30_000);
    assert.equal(diagnostic.commandSubmitted, true);
    assert.equal(diagnostic.executionId, events.at(-1).executionId);
    assert.ok(diagnostic.elapsedMs >= 29_000);
    assert.match(timedOut.stderr, /effects are unconfirmed/u);

    script = "process.stdout.write('still connected')";
    const next = await runProcessWithInput(command, ["status"], options);
    assert.equal(next.exitCode, 0, next.stderr);
    assert.equal(next.stdout, "still connected");
    assert.equal(calls.length, 3, "No command is retried automatically");
  });
});

test("GitHub credential lookup shares the budget and timeouts are not reported as missing authentication", async (t) => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root, "shared-deadline");
    await mkdir(session.metadata.source_path, { recursive: true });
    let now = 0;
    t.mock.method(performance, "now", () => now);
    let tokenDuration = 6000;
    let tokenTimedOut = false;
    const calls = [];
    const events = [];
    const service = serviceForSession(session, {
      logger: { info: (fields) => events.push(fields), warn: (fields) => events.push(fields) },
      async runGatewayCommand(request) {
        calls.push(request);
        if (request.args[0] === "auth") {
          now += tokenDuration;
          return tokenTimedOut
            ? { ok: false, timedOut: true, code: "vibe64_command_capture_timed_out", stdout: "partial-secret", execution: { id: "token-execution" } }
            : { ok: true, stdout: "test-token" };
        }
        return { ok: true, exitCode: 0, stdout: "done" };
      }
    });
    const input = { command: "gh", args: ["issue", "view", "43"], sessionId: session.sessionId };
    assert.equal((await service.run(input)).ok, true);
    assert.deepEqual(calls.map(({ timeout }) => timeout), [30_000, 24_000]);

    calls.length = 0;
    tokenDuration = 30_000;
    const exhausted = await service.run(input);
    assert.equal(exhausted.timedOut, true);
    assert.equal(exhausted.code, "vibe64_codex_git_command_timed_out");
    assert.equal(exhausted.diagnostic.commandSubmitted, false);
    assert.equal(exhausted.diagnostic.stage, "command");
    assert.equal(exhausted.diagnostic.budgetMs, 30_000);
    assert.equal(exhausted.diagnostic.executionId, null);
    assert.equal(calls.length, 1, "An expired budget must not start the requested command");

    calls.length = 0;
    tokenTimedOut = true;
    const failedToken = await service.run(input);
    assert.equal(failedToken.timedOut, true);
    assert.equal(failedToken.code, "vibe64_command_capture_timed_out");
    assert.equal(calls.length, 1);
    assert.equal(events.at(-1).stage, "github-token");
    assert.equal(events.at(-1).executionId, "token-execution");
    assert.doesNotMatch(JSON.stringify([failedToken, events]), /partial-secret|test-token/u);
  });
});

test("model-visible Git failures retain their stage, budget, execution reference and submission state", async () => {
  await withTemporaryRoot(async (root) => {
    const scenarios = [
      { name: "token-timeout", stage: "github-token", commandSubmitted: false, callCount: 1 },
      { name: "auth-rejected", stage: "github-token", commandSubmitted: false, callCount: 1 },
      { name: "command-timeout", stage: "command", commandSubmitted: true, callCount: 2 },
      { name: "access-revoked", stage: "authorization", commandSubmitted: false, callCount: 0 }
    ];
    for (const { name: scenario, stage, commandSubmitted, callCount } of scenarios) {
      const session = githubSession(root, scenario);
      await mkdir(session.metadata.source_path, { recursive: true });
      const calls = [];
      const service = serviceForSession(session, {
        authorizeActorAccess: async () => scenario === "access-revoked"
          ? { ok: false, error: "Project access was revoked." }
          : { ok: true },
        async runGatewayCommand(request) {
          calls.push(request);
          const tokenLookup = request.args[0] === "auth";
          if (tokenLookup && scenario === "command-timeout") return { ok: true, stdout: "private-test-token" };
          return {
            ok: false,
            exitCode: 1,
            timedOut: scenario !== "auth-rejected",
            code: scenario === "auth-rejected" ? "token_access_denied" : "vibe64_command_capture_timed_out",
            stdout: tokenLookup ? "private-test-token" : "partial command output",
            stderr: tokenLookup ? "Credential lookup was denied." : "partial command stderr",
            execution: { id: `${scenario}-execution` }
          };
        }
      });
      const prepared = await prepareCodexGitCommand({
        commandService: service,
        env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
        sessionId: session.sessionId,
        stateRoot: root
      });
      const result = await runProcessWithInput(path.join(prepared.hostWrapperDir, "gh"), ["issue", "comment", "43"], {
        cwd: session.metadata.source_path,
        env: { ...process.env, ...prepared.env }
      });
      assert.equal(result.exitCode, 1, scenario);
      const diagnostic = JSON.parse(result.stderr.match(/Managed Git diagnostic: (.+)\n/u)[1]);
      assert.equal(diagnostic.budgetMs, 30_000);
      assert.ok(diagnostic.elapsedMs >= 0);
      assert.equal(diagnostic.executionId, scenario === "access-revoked" ? null : `${scenario}-execution`);
      assert.equal(diagnostic.stage, stage);
      assert.equal(diagnostic.commandSubmitted, commandSubmitted);
      assert.equal(calls.length, callCount);
      assert.doesNotMatch(result.stderr + result.stdout, /private-test-token|Reconnect/u);
      if (scenario === "command-timeout") {
        assert.match(result.stderr, /Managed Git command timed out/u);
        assert.match(result.stderr, /effects are unconfirmed.*Check the result before retrying a write/u);
        assert.match(result.stderr, /partial command stderr/u);
        assert.equal(result.stdout, "partial command output");
      } else {
        assert.match(result.stderr, /The requested command was not submitted/u);
        assert.doesNotMatch(result.stderr, /effects are unconfirmed/u);
        assert.equal(result.stdout, "");
      }
      if (scenario === "token-timeout") {
        assert.match(result.stderr, /GitHub credential lookup timed out/u);
        assert.doesNotMatch(result.stderr, /github_auth_unavailable|Credential lookup was denied/u);
      }
      if (scenario === "auth-rejected") {
        assert.match(result.stderr, /vibe64_codex_git_command_github_auth_unavailable: Credential lookup was denied/u);
        assert.equal(diagnostic.code, "token_access_denied");
      }
    }
  });
});

test("Git wrapper distinguishes absent control, stale identity and a lost command response", async () => {
  await withTemporaryRoot(async (root) => {
    const prepared = await prepareCodexGitCommand({
      commandService: { run: async () => ({ ok: true, exitCode: 0, stdout: "connected" }) },
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId: "transport-diagnostics",
      stateRoot: root
    });
    const command = path.join(prepared.hostWrapperDir, "gh");
    const options = { cwd: root, env: { ...process.env, ...prepared.env } };
    const refusedSocket = path.join(root, "not-a-socket");
    await writeFile(refusedSocket, "not a socket");
    for (const [override, expected] of [
      [{ VIBE64_CODEX_GIT_COMMAND_SOCKET: path.join(root, "missing.sock") }, /connection failed \(ENOENT\)/u],
      [{ VIBE64_CODEX_GIT_COMMAND_SOCKET: refusedSocket }, /connection failed \((?:ECONNREFUSED|ENOTSOCK)\)/u],
      [{ VIBE64_CODEX_GIT_COMMAND_TOKEN: "" }, /identity is unavailable/u],
      [{ VIBE64_CODEX_GIT_COMMAND_GENERATION: "stale" }, /generation is no longer current/u]
    ]) {
      const result = await runProcessWithInput(command, ["issue", "view", "43"], { ...options, env: { ...options.env, ...override } });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, expected);
      assert.match(result.stderr, /The requested command was not submitted/u);
      assert.doesNotMatch(result.stderr, /command timed out/u);
    }
    let calls = 0;
    const server = http.createServer((request, response) => {
      calls += 1;
      request.resume();
      if (calls === 1) request.socket.destroy();
      else if (calls === 2) response.end(JSON.stringify({ ok: true, exitCode: 0, stdout: "recovered" }));
      else response.end(calls === 3 ? "invalid response" : "{}");
    });
    const socketPath = path.join(root, "dropped.sock");
    server.listen(socketPath);
    await once(server, "listening");
    try {
      options.env.VIBE64_CODEX_GIT_COMMAND_SOCKET = socketPath;
      const lost = await runProcessWithInput(command, ["issue", "view", "43"], options);
      assert.equal(lost.exitCode, 1);
      assert.match(lost.stderr, /vibe64_codex_git_command_transport_lost.*ECONNRESET/u);
      assert.match(lost.stderr, /outcome is unknown/u);
      assert.doesNotMatch(lost.stderr, /Reconnect/u);
      assert.equal(calls, 1);
      const recovered = await runProcessWithInput(command, ["issue", "view", "43"], options);
      assert.equal(recovered.exitCode, 0, recovered.stderr);
      assert.equal(recovered.stdout, "recovered");
      for (const expected of [/unreadable response/u, /incomplete response/u]) {
        const invalid = await runProcessWithInput(command, ["issue", "view", "43"], options);
        assert.equal(invalid.exitCode, 1);
        assert.match(invalid.stderr, /vibe64_codex_git_command_response_invalid/u);
        assert.match(invalid.stderr, expected);
        assert.match(invalid.stderr, /outcome is unknown.*Check the result before retrying a write/u);
        assert.doesNotMatch(invalid.stderr, /not submitted|Reconnect/u);
      }
      assert.equal(calls, 4, "Invalid responses must not trigger automatic retries");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
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
          code: "vibe64_command_capture_failed",
          execution: { id: "failed-token-lookup" },
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
    assert.equal(result.errorCode, "vibe64_command_capture_failed");
    assert.equal(result.executionId, "failed-token-lookup");
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
