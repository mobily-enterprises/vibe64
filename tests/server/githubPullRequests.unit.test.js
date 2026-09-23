import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { githubPullRequests, pullRequestSessionSource, preparePullRequestSource, publishSessionPullRequest } from "../../packages/vibe64-project/src/server/githubPullRequests.js";
import { assertSessionRepositoryReview, sessionRepositoryDestination, sessionRepositoryProject, readProjectRepositoryWorkflow, saveProjectRepositoryWorkflow } from "../../packages/vibe64-core/src/server/projectRepository.js";
import { repositoryBranches } from "../../packages/vibe64-project/src/server/repositoryBranches.js";
import { prepareSessionPullRequestBranch, saveSessionWorkDirect, checkSessionUpdatesDirect } from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import { createSessionSource } from "../../packages/vibe64-terminals/src/server/sessionSource.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import getPlacements from "../../src/placement.js";

const user = { username: "alice", home: "/home/alice", uid: 1001, gid: 1001 };
const project = { repositoryMode: "github", repository: { defaultBranch: "main", mode: "github" },
  githubRepository: { fullName: "example/project", cloneUrl: "https://github.com/example/project.git" } };
const pr = { number: 7, title: "Improve search", body: "A description", url: "https://github.com/example/project/pull/7",
  state: "OPEN", headRefName: "feature/search", headRefOid: "a".repeat(40), headRef: { name: "feature/search" },
  baseRefName: "main", baseRepository: { nameWithOwner: "example/project" },
  headRepository: { nameWithOwner: "alice/project", viewerPermission: "WRITE", isArchived: false } };
const success = (body) => ({ ok: true, stdout: JSON.stringify(body) });
test("local destination review stays bound to the session after the project folder switches branches", () => {
  const project = { sourceRoot: "/project", repositoryMode: "local_source", repository: { mode: "local_source", defaultBranch: "feature/new" } };
  const session = { sessionId: "old", metadata: { local_source_branch: "main" } };
  const review = { sessionId: "old", mode: "local_source", repository: "/project", branch: "main" };
  assert.deepEqual(sessionRepositoryDestination(project, session), review);
  assert.doesNotThrow(() => assertSessionRepositoryReview(project, session, review));
  assert.equal(sessionRepositoryProject(project, session).repository.defaultBranch, "feature/new");
});

test("session destination reviews fail closed when repository, branch or session changes", () => {
  const session = { sessionId: "one", metadata: { repository_branch: "feature/search" } };
  const review = sessionRepositoryDestination(project, session);
  assert.equal(review.branch, "feature/search");
  assert.equal(review.repository, "example/project");
  assert.deepEqual(assertSessionRepositoryReview(project, session, review), review);
  for (const changed of [undefined, { ...review, branch: "main" }, { ...review, repository: "other/project" }, { ...review, sessionId: "two" }]) {
    assert.throws(() => assertSessionRepositoryReview(project, session, changed), { code: "vibe64_session_repository_review_changed" });
  }
  const managed = { slug: "project", repository: { mode: "managed_git", defaultBranch: "main" } };
  assert.equal(sessionRepositoryProject(managed, session).repository.defaultBranch, "feature/search");
  assert.throws(() => sessionRepositoryProject(managed, { metadata: { repository_branch: "../main" } }));
});
function fixture(replies) {
  const calls = [];
  return { calls, options: { env: { VIBE64_GITHUB_ACCOUNT_MODE: "user" }, async runCommand(request) {
    calls.push(request); assert.ok(replies.length, "Unexpected GitHub request"); return replies.shift();
  } } };
}

test("GitHub branch choices validate the reviewed commit and never overwrite an existing branch", async () => {
  const rows = [{ name: "main", commit: { sha: "a".repeat(40) } }];
  const branchProject = { ...project, projectRuntimeRoot: "/test/project" };
  const f = fixture([success(rows), success({ ref: "refs/heads/feature/new" })]);
  const options = { ...f.options, runExclusive: async (_root, operation) => operation() };
  const result = await repositoryBranches(branchProject, { vibe64User: user,
    selection: { name: "feature/new", fromBranch: "main", expectedCommit: "a".repeat(40) } }, options);
  assert.deepEqual(result, { name: "feature/new", commit: "a".repeat(40) });
  assert.deepEqual(JSON.parse(f.calls[1].input), { ref: "refs/heads/feature/new", sha: "a".repeat(40) });
  assert.equal(f.calls[1].actor, "named-user");
  for (const selection of [
    { name: "main", expectedCommit: "b".repeat(40) },
    { name: "main", fromBranch: "main", expectedCommit: "a".repeat(40) },
    { name: "../bad", fromBranch: "main", expectedCommit: "a".repeat(40) }
  ]) {
    const rejected = fixture([success(rows)]);
    await assert.rejects(repositoryBranches(branchProject, { vibe64User: user, selection },
      { ...rejected.options, runExclusive: options.runExclusive }));
    assert.equal(rejected.calls.length, 1);
  }
});

test("PR workflow settings default without backfilling and reject malformed persisted state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-repository-workflow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readProjectRepositoryWorkflow(root), { requirePullRequest: false });
  assert.deepEqual(await readdir(root), []);
  await saveProjectRepositoryWorkflow(root, true);
  assert.deepEqual(await readProjectRepositoryWorkflow(root), { requirePullRequest: true });
  await assert.rejects(saveProjectRepositoryWorkflow(root, "false"));
  await writeFile(path.join(root, "settings", "repository-workflow.json"), '{"requirePullRequest":"false"}');
  await assert.rejects(readProjectRepositoryWorkflow(root));
});

test("PR navigation shares the project-wide GitHub-only Issues/PR entry", () => {
  const placements = getPlacements();
  const link = placements.find((item) => item.id === "vibe64.issues.link");
  assert.equal(placements.some((item) => item.id === "vibe64.pull-requests.link"), false);
  assert.equal(link.owner, "app-dashboard");
  assert.equal(link.props.label, "Issues/PR");
  for (const visible of [link.when, link.props.visibleWhen]) {
    assert.equal(visible({}), false);
    assert.equal(visible({ projectContext: project }), true);
    assert.equal(visible({ projectContext: { ...project, repositoryMode: "managed_git" } }), false);
  }
});

test("PR list scopes search to the project and separates closed from merged", async () => {
  const f = fixture([success({ data: { search: { nodes: [pr], issueCount: 1, pageInfo: {} } } })]);
  const result = await githubPullRequests(project, { state: "closed", search: 'repo:other/private " hi', vibe64User: user }, f.options);
  assert.equal(result.pullRequests[0].number, 7);
  assert.equal(f.calls[0].actor, "named-user");
  const payload = JSON.parse(f.calls[0].input);
  assert.match(payload.variables.search, /^repo:example\/project is:pr is:closed is:unmerged "repo:other\/private/u);
  assert.match(payload.query, /first:25/u);
  await assert.rejects(githubPullRequests(project, { operation: "read", number: "../7" }, f.options));
});

test("opening a PR uses its real head repository and rejects deleted, closed and unwritable heads", async () => {
  for (const [change, available] of [[{}, true], [{ state: "MERGED" }, false], [{ headRef: null }, false],
    [{ headRepository: { ...pr.headRepository, viewerPermission: "READ" } }, false]]) {
    const f = fixture([success({ data: { repository: { pullRequest: { ...pr, ...change } } } })]);
    const result = await githubPullRequests(project, { operation: "read", number: 7, vibe64User: user }, f.options);
    if (available) {
      const source = pullRequestSessionSource(result.pullRequest);
      const resolved = sessionRepositoryProject({ ...project, githubMirrorPath: "/base/mirror" }, { metadata: { github_pull_request: JSON.stringify(source) } });
      assert.equal(resolved.repository.defaultBranch, "feature/search");
      assert.equal(resolved.githubRepository.cloneUrl, "https://github.com/alice/project.git");
      assert.equal(resolved.githubMirrorPath, "");
    } else assert.throws(() => pullRequestSessionSource(result.pullRequest));
  }
  assert.throws(() => sessionRepositoryProject(project, { metadata: { github_pull_request: "broken" } }), { code: "vibe64_pull_request_authority_invalid" });
  assert.throws(() => sessionRepositoryProject(project, { metadata: { github_pull_request: JSON.stringify({ ...pullRequestSessionSource(pr), baseRepository: "other/project" }) } }));
});

test("create PR checks current GitHub write access and retries by finding the existing PR", async () => {
  const session = { sessionId: "session-1", metadata: { base_commit: "a".repeat(40) } };
  const input = { title: "Literal `title`", body: "$(no shell)\nMarkdown", draft: true, vibe64User: user };
  const f = fixture([success({ permissions: { push: true } }), success([]),
    success({ number: 12, html_url: "https://github.com/example/project/pull/12", title: input.title, body: input.body }),
    success([{ number: 12, html_url: "https://github.com/example/project/pull/12", title: input.title, body: input.body }])]);
  const source = await preparePullRequestSource(project, session, input, f.options);
  assert.equal(source.headBranch, "vibe64/pr-session-1");
  const created = await publishSessionPullRequest(source, input, f.options);
  const retried = await publishSessionPullRequest(source, input, f.options);
  assert.equal(created.number, 12); assert.equal(retried.number, 12);
  const writes = f.calls.filter((call) => call.args.includes("POST"));
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].input), { title: input.title, body: input.body, draft: true, base: "main", head: "example:vibe64/pr-session-1" });
  const denied = fixture([success({ permissions: { push: false } })]);
  await assert.rejects(preparePullRequestSource(project, session, input, denied.options), { code: "vibe64_pull_request_permission_denied" });
});

async function command(request) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, { cwd: request.cwd, env: { ...process.env,
      GIT_AUTHOR_NAME: "PR Test", GIT_AUTHOR_EMAIL: "pr@example.test", GIT_COMMITTER_NAME: "PR Test", GIT_COMMITTER_EMAIL: "pr@example.test", ...request.env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ ok: false, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    child.stdin.end(request.input);
  });
}
async function git(cwd, args) {
  const result = await command({ command: "git", cwd, args });
  assert.equal(result.ok, true, result.stderr); return result.stdout.trim();
}

for (const withPullRequest of [true, false]) {
test(`${withPullRequest ? "PR" : "Named branch"} sessions clone the head and keep Save and Update off main`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-pr-"));
  try {
    const remote = path.join(root, "remote.git"), seed = path.join(root, "seed");
    await git(root, ["init", "--bare", "--initial-branch=main", remote]);
    await git(root, ["clone", remote, seed]);
    await writeFile(path.join(seed, "file.txt"), "base\n");
    await git(seed, ["add", "."]); await git(seed, ["commit", "-m", "base"]); await git(seed, ["push", "origin", "main"]);
    const main = await git(seed, ["rev-parse", "HEAD"]);
    await git(seed, ["checkout", "-b", "feature/search"]);
    await writeFile(path.join(seed, "feature.txt"), "PR head\n");
    await git(seed, ["add", "."]); await git(seed, ["commit", "-m", "feature"]); await git(seed, ["push", "origin", "feature/search"]);
    const head = await git(seed, ["rev-parse", "HEAD"]);
    const source = { ...pullRequestSessionSource(pr), headCommit: head };
    const session = { sessionId: "session-1", metadata: withPullRequest
      ? { github_pull_request: JSON.stringify(source) } : { repository_branch: "feature/search" } };
    const remoteUrl = withPullRequest ? "https://github.com/alice/project.git" : "https://github.com/example/project.git";
    const calls = [];
    const runCommand = (request) => {
      calls.push(request);
      return command({ ...request, args: request.args.map((arg) => [remoteUrl, "https://github.com/alice/project.git"].includes(arg) ? remote : arg) });
    };
    await createSessionSource({ project, session, expectedCommit: head, runCommand,
      env: { VIBE64_GITHUB_ACCOUNT_MODE: "local" },
      runtime: { projectContextRoot: root, projectSessionSourceRoot: path.join(root, "sessions") },
      store: { async writeMetadataValue(_id, name, value) { session.metadata[name] = value; } } });
    session.sourcePath = session.metadata.source_path;
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), head);
    await writeFile(path.join(session.sourcePath, "file.txt"), "changed in session\n");
    const saved = await saveSessionWorkDirect({ project, session, runCommand, message: "Improve PR", refreshDerivedArtifacts: async () => ({}) });
    assert.equal(saved.ok, true);
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "main"]), main);
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "feature/search"]), saved.saveCommit);
    session.metadata.base_commit = saved.saveCommit; session.metadata.canonical_commit = saved.saveCommit;
    const checked = await checkSessionUpdatesDirect({ project, session, runCommand });
    assert.equal(checked.canonicalCommit, saved.saveCommit);
    assert.ok(calls.some((request) => request.args.includes(remoteUrl)));
    // Creating a PR from a normal session supports baselines that have only been committed locally.
    await writeFile(path.join(session.sourcePath, "local.txt"), "locally committed\n");
    await git(session.sourcePath, ["add", "."]); await git(session.sourcePath, ["commit", "-m", "local baseline"]);
    const localCommit = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    session.metadata.base_commit = localCommit;
    session.metadata.github_pull_request = JSON.stringify({ ...source, number: null, headBranch: "vibe64/pr-session-1" });
    await prepareSessionPullRequestBranch({ project, session, runCommand });
    await prepareSessionPullRequestBranch({ project, session, runCommand });
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "vibe64/pr-session-1"]), localCommit);
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "main"]), main);
    assert.equal(calls.filter((request) => request.args.some((arg) => arg.startsWith("--force-with-lease="))).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

}

test("PR update notifications reach only sessions sharing the same source branch", async () => {
  const metadata = { github_pull_request: JSON.stringify(pullRequestSessionSource(pr)) };
  const sessions = [{ sessionId: "pr-one", metadata }, { sessionId: "pr-two", metadata },
    { sessionId: "main", metadata: {} }, { sessionId: "other-pr", metadata: { github_pull_request: JSON.stringify({ ...pullRequestSessionSource(pr), headBranch: "other" }) } }];
  const writes = [];
  const runtime = { async getSession(id) { return sessions.find((item) => item.sessionId === id); },
    async listSessionSummaries() { return sessions; },
    store: { async writeMetadataValue(id, name, value) { writes.push([id, name, value]); },
      async writeBackgroundTaskEvent() { return {}; }, async readBackgroundTask() { return null; } } };
  const service = createService({ project: { async createRuntime() { return runtime; }, async readCurrentProject() { return project; } },
    async publishSessionChanged() {}, terminals: { async requireAssistantAccess() {},
      async saveSessionWork(_id, input) { await input.onRepositoryWriteAcquired(); return { ok: true, saveCommit: "new", reconciled: true }; } } });
  const result = await service.saveSessionWork("pr-one");
  assert.equal(result.ok, true, result.error);
  assert.ok(writes.some(([id]) => id === "pr-two"));
  assert.ok(writes.every(([id]) => id === "pr-one" || id === "pr-two"));
});
