import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";

import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";
import { createCodexGitCommandService } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";
import { readSessionAuthorityHeads } from "../../packages/vibe64-terminals/src/server/sessionWorkUpdate.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

// Load review 2026-10-29: every project in use asks every 30 s whether its
// sessions need an update. For a GitHub project that read was a managed
// `git ls-remote` job: sudo, the root exec helper, systemd-run, the managed
// runner, git and its HTTPS helper, two Node starts and about a second, twice a
// minute per project. GitHub answers the same branch listing to one Git
// protocol v2 ls-refs request, which the server now makes itself.
const H0 = "0".repeat(40);
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);

function packet(text) {
  return `${(Buffer.byteLength(text) + 4).toString(16).padStart(4, "0")}${text}`;
}

function lsRefsAnswer(lines = []) {
  return `${lines.map((line) => packet(`${line}\n`)).join("")}0000`;
}

async function fakeGithub(t) {
  const requests = [];
  const state = {
    answer: () => ({ body: lsRefsAnswer([`${H1} refs/heads/main`]), status: 200 }),
    requests
  };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ body: Buffer.concat(chunks).toString("utf8"), headers: request.headers, method: request.method, url: request.url });
    const answer = state.answer(request);
    if (answer === null) return; // never answers
    response.writeHead(answer.status, {
      "content-type": answer.contentType || "application/x-git-upload-pack-result",
      ...(answer.headers || {})
    });
    response.end(answer.body || "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  state.fetchCalls = 0;
  // Production asks https://github.com; the test serves that origin locally.
  state.fetch = (url, init) => {
    state.fetchCalls += 1;
    return globalThis.fetch(String(url).replace("https://github.com", base), init);
  };
  return state;
}

function githubSession(root, sessionId = "alpha-1") {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  const user = currentOsUser();
  return {
    id: sessionId,
    metadata: {
      base_commit: H0,
      github_repository: "owner/repo",
      session_git_command_actor_reason: "unit-test",
      session_git_command_actor_scope: "user",
      session_git_command_actor_session_id: sessionId,
      session_git_command_actor_source_root: sourcePath,
      session_git_command_actor_thread_id: "thread-1",
      session_git_command_actor_user_key: user.username,
      session_git_command_actor_workdir: sourcePath,
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      source_remote_url: "https://github.com/owner/repo.git"
    },
    sessionId,
    sourcePath,
    status: "active"
  };
}

function githubProject(cloneUrl = "https://github.com/owner/repo.git") {
  const github = { cloneUrl, fullName: "owner/repo" };
  return { githubRepository: github, repository: { defaultBranch: "main", github, mode: "github" }, repositoryMode: "github", slug: "alpha" };
}

// The person's token is read through the gateway as the person; any other
// gateway request is a Git command the head read was not meant to run.
function gateway() {
  const state = { commands: [], tokens: 0 };
  state.runGatewayCommand = async (request) => {
    if (request.command === "gh" && request.args[0] === "auth") {
      state.tokens += 1;
      return { exitCode: 0, ok: true, stdout: `token-${state.tokens}\n` };
    }
    state.commands.push(request);
    return { exitCode: 0, ok: true, stdout: `${H1}\trefs/heads/main\n` };
  };
  return state;
}

function service({ env = process.env, fetch, runGatewayCommand }) {
  return createCodexGitCommandService({ env, fetch, projectService: {}, runGatewayCommand });
}

async function githubFixture(t, root) {
  const session = githubSession(root);
  await mkdir(session.sourcePath, { recursive: true });
  const github = await fakeGithub(t);
  const commands = gateway();
  const git = service({ fetch: github.fetch, runGatewayCommand: commands.runGatewayCommand });
  const read = (options = {}) => readSessionAuthorityHeads({
    executionFor: options.executionFor || ((listed) => git.sessionWorkSaveContext({ session: listed })),
    project: githubProject(options.cloneUrl),
    sessions: [session]
  });
  return { commands, git, github, read, session };
}

function basicToken(header = "") {
  return Buffer.from(String(header).replace(/^Basic /u, ""), "base64").toString("utf8");
}

test("a GitHub project's heads come from one ls-refs request with the actor's token, and no command runs", async (t) => {
  await withTemporaryRoot(async (root) => {
    const { commands, github, read, session } = await githubFixture(t, root);
    // ls-refs lists every ref starting with a prefix; only the exact branch counts.
    github.answer = () => ({ body: lsRefsAnswer([`${H2} refs/heads/main-old`, `${H1} refs/heads/main`]), status: 200 });

    const heads = await read();

    assert.deepEqual(heads.get(session.sessionId), { head: H1 });
    assert.deepEqual(commands.commands, [], "no git ls-remote or other managed job runs");
    assert.equal(commands.tokens, 1, "the actor's token is read once, as the person");
    assert.equal(github.requests.length, 1);
    const [request] = github.requests;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/owner/repo.git/git-upload-pack");
    assert.equal(request.headers["content-type"], "application/x-git-upload-pack-request");
    assert.equal(request.headers.accept, "application/x-git-upload-pack-result");
    assert.equal(request.headers["git-protocol"], "version=2");
    assert.equal(basicToken(request.headers.authorization), "x-access-token:token-1");
    assert.equal(request.body, `${packet("command=ls-refs\n")}0001${packet("ref-prefix refs/heads/main\n")}0000`);
  });
});

test("invalid or refused GitHub evidence fails that authority's read, as ls-remote's would", async (t) => {
  await withTemporaryRoot(async (root) => {
    const { commands, github, read, session } = await githubFixture(t, root);
    const failure = async () => (await read()).get(session.sessionId);

    github.answer = () => ({ body: lsRefsAnswer([`not-an-object-id refs/heads/main`]), status: 200 });
    assert.equal((await failure()).code, "vibe64_session_update_refs_invalid");
    github.answer = () => ({ body: lsRefsAnswer([`${H1} refs/heads/main`, `${H2} refs/heads/main`]), status: 200 });
    assert.equal((await failure()).code, "vibe64_session_update_refs_invalid", "a branch listed twice is not evidence");
    github.answer = () => ({ body: "<html>sign in</html>", contentType: "text/html", status: 200 });
    assert.equal((await failure()).code, "vibe64_session_update_refs_invalid");
    github.answer = () => ({ body: packet(`${H1} refs/heads/main\n`), status: 200 });
    assert.equal((await failure()).code, "vibe64_session_update_refs_invalid", "a listing without its flush is incomplete");
    github.answer = () => ({ body: lsRefsAnswer(["ERR upload-pack: not our ref"]), status: 200 });
    assert.match((await failure()).error, /not our ref/u);
    github.answer = () => ({ headers: { location: "https://elsewhere.example/owner/repo.git/git-upload-pack" }, status: 307 });
    assert.equal((await failure()).code, "vibe64_session_update_check_failed");
    assert.equal(github.requests.length, 6, "a redirect is not followed with the token");
    github.answer = () => ({ body: "Repository not found.", contentType: "text/plain", status: 404 });
    assert.equal((await failure()).code, "vibe64_session_update_check_failed");
    assert.deepEqual(commands.commands, []);
    assert.equal(commands.tokens, 1, "only GitHub's rejection of the credential drops it");
  });
});

test("GitHub's rejection drops the actor's cached token so the next probe reads it again", async (t) => {
  await withTemporaryRoot(async (root) => {
    const { commands, github, read, session } = await githubFixture(t, root);
    github.answer = () => ({ body: "Repository not found.", contentType: "text/plain", status: 401 });

    const refused = (await read()).get(session.sessionId);
    assert.equal(refused.code, "vibe64_session_update_authentication_failed");
    assert.equal(commands.tokens, 1);

    github.answer = () => ({ body: lsRefsAnswer([`${H1} refs/heads/main`]), status: 200 });
    assert.deepEqual((await read()).get(session.sessionId), { head: H1 });
    assert.equal(commands.tokens, 2, "the rejected token is not reused");
    assert.equal(basicToken(github.requests.at(-1).headers.authorization), "x-access-token:token-2");
    assert.deepEqual((await read()).get(session.sessionId), { head: H1 });
    assert.equal(commands.tokens, 2, "an accepted token is kept");
  });
});

test("a GitHub head read is bounded by the probe's 20 s head-read limit", async (t) => {
  await withTemporaryRoot(async (root) => {
    const { git, github, read, session } = await githubFixture(t, root);
    const limits = [];
    const heads = await read({
      async executionFor(listed) {
        const execution = await git.sessionWorkSaveContext({ session: listed });
        return { ...execution, readRemoteHeads: (url, refs, options) => {
          limits.push(options.timeoutMs);
          return execution.readRemoteHeads(url, refs, options);
        } };
      }
    });
    assert.deepEqual(heads.get(session.sessionId), { head: H1 });
    assert.deepEqual(limits, [20_000]);

    github.answer = () => null;
    const execution = await git.sessionWorkSaveContext({ session });
    const started = Date.now();
    await assert.rejects(execution.readRemoteHeads("https://github.com/owner/repo.git", ["refs/heads/main"], { timeoutMs: 200 }),
      { code: "vibe64_session_update_check_timed_out" });
    assert.ok(Date.now() - started < 5_000, "a silent server cannot hold the read past its limit");
  });
});

test("a managed or non-GitHub authority still lists its heads with git ls-remote", async (t) => {
  await withTemporaryRoot(async (root) => {
    const { commands, github, read, session } = await githubFixture(t, root);

    // The token is never offered to another host, as Git's credential helper is scoped.
    const elsewhere = await read({ cloneUrl: "https://git.example.test/owner/repo.git" });
    assert.deepEqual(elsewhere.get(session.sessionId), { head: H1 });
    assert.deepEqual(commands.commands.map((request) => request.args.slice(0, 2)), [["ls-remote", "--heads"]]);

    commands.commands.length = 0;
    const canonical = path.join(root, "canonical", "repository.git");
    const managed = { ...githubSession(root, "managed-1") };
    managed.metadata = { base_commit: H0, repository_mode: "managed_git", source_kind: "session_clone",
      source_path: managed.sourcePath, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      source_remote_url: canonical };
    await mkdir(managed.sourcePath, { recursive: true });
    const git = service({ env: { ...process.env, VIBE64_GITHUB_ACCOUNT_MODE: "user" }, fetch: github.fetch,
      runGatewayCommand: commands.runGatewayCommand });
    const heads = await readSessionAuthorityHeads({
      executionFor: (listed) => git.sessionWorkSaveContext({ session: listed }),
      project: { canonicalRepositoryPath: canonical, repository: { defaultBranch: "main", mode: "managed_git" },
        repositoryMode: "managed_git", slug: "alpha" },
      sessions: [managed]
    });
    assert.deepEqual(heads.get("managed-1"), { head: H1 });
    assert.deepEqual(commands.commands.map((request) => request.args.slice(0, 3)), [["ls-remote", "--heads", canonical]]);
    assert.equal(github.fetchCalls, 0, "nothing but GitHub is asked over HTTPS");
  });
});
