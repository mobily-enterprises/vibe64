import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { githubPullRequests, pullRequestSessionSource, preparePullRequestSource, publishSessionPullRequest } from "../../packages/vibe64-project/src/server/githubPullRequests.js";
import { assertSessionRepositoryReview, sessionRepositoryDestination, sessionRepositoryProject, readProjectRepositoryWorkflow, saveProjectRepositoryWorkflow } from "../../packages/vibe64-core/src/server/projectRepository.js";
import { repositoryBranches } from "../../packages/vibe64-project/src/server/repositoryBranches.js";
import { createService as createProjectService } from "../../packages/vibe64-project/src/server/service.js";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { prepareSessionPullRequestBranch, saveSessionWorkDirect, checkSessionUpdatesDirect, updateSessionWorkDirect } from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import { createSessionSource } from "../../packages/vibe64-terminals/src/server/sessionSource.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";
import getPlacements from "../../src/placement.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

const user = { username: "alice", home: "/home/alice", uid: 1001, gid: 1001 };
const project = { repositoryMode: "github", repository: { defaultBranch: "main", mode: "github" },
  githubRepository: { fullName: "example/project", cloneUrl: "https://github.com/example/project.git" } };
const pr = { number: 7, title: "Improve search", body: "A description", url: "https://github.com/example/project/pull/7",
  state: "OPEN", headRefName: "feature/search", headRefOid: "a".repeat(40), headRef: { name: "feature/search", target: { oid: "a".repeat(40) } },
  baseRefOid: "b".repeat(40), baseRef: { name: "main", target: { oid: "b".repeat(40) } },
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
function fixture(replies, behindBase = 1) {
  const calls = [];
  return { calls, options: { env: { VIBE64_GITHUB_ACCOUNT_MODE: "user" }, async runCommand(request) {
    calls.push(request);
    if (request.args.some((arg) => arg.includes("/compare/"))) return success({ behind_by: behindBase });
    assert.ok(replies.length, "Unexpected GitHub request"); return replies.shift();
  } } };
}

test("branch listing and session selection honor the host's per-user credential policy", async (t) => {
  const previousMode = process.env.VIBE64_GITHUB_ACCOUNT_MODE;
  process.env.VIBE64_GITHUB_ACCOUNT_MODE = "local";
  t.after(() => {
    if (previousMode === undefined) delete process.env.VIBE64_GITHUB_ACCOUNT_MODE;
    else process.env.VIBE64_GITHUB_ACCOUNT_MODE = previousMode;
  });
  const service = createProjectService({
    env: { VIBE64_GITHUB_ACCOUNT_MODE: "user" },
    projectContext: { async listProjects() { return { currentProject: branchProject, projects: [branchProject] }; } }
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-branch-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const branchProject = { ...project, projectRuntimeRoot: root };
  // A missing web-user identity must fail before looking for the daemon's GitHub login.
  const listed = await service.repositoryBranches();
  assert.equal(listed.ok, false);
  assert.equal(listed.errors[0].code, "vibe64_os_user_required");
  await assert.rejects(service.resolveSessionBranch({ selection: {
    name: "feature/new", fromBranch: "main", expectedCommit: "a".repeat(40)
  } }), { code: "vibe64_os_user_required" });
  const osUser = os.userInfo();
  const vibe64User = { username: osUser.username, home: osUser.homedir, uid: osUser.uid, gid: osUser.gid };
  const calls = [];
  t.after(installVibe64ManagedExecutionProvider({
    async stopExecution() { throw new Error("No process should start in this test."); },
    async runCommand(request, context) {
      calls.push(request);
      assert.equal(request.actor, "named-user");
      assert.equal(context.actor.user.username, osUser.username);
      assert.equal(request.credentialHome.home, osUser.homedir);
      return success(request.args.includes("POST")
        ? { ref: "refs/heads/feature/new" }
        : [{ name: "main", commit: { sha: "a".repeat(40) } }]);
    }
  }));
  assert.equal((await service.repositoryBranches({ vibe64User })).ok, true);
  assert.deepEqual(await service.resolveSessionBranch({ vibe64User, selection: {
    name: "feature/new", fromBranch: "main", expectedCommit: "a".repeat(40)
  } }), { name: "feature/new", commit: "a".repeat(40) });
  assert.equal(calls.length, 3);
});

test("branch credential policy failures are reported without asking the user to reconnect", async () => {
  const f = fixture([{ ok: false, code: "vibe64_github_user_credentials_required",
    error: "GitHub work requires a signed-in user's credentials. The workspace service account cannot be used." }]);
  await assert.rejects(repositoryBranches({ ...project, projectRuntimeRoot: "/test/project" }, { vibe64User: user },
    { ...f.options, runExclusive: async (_root, operation) => operation() }),
  { code: "vibe64_github_user_credentials_required", message: /workspace service account cannot be used/u });
});

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

const mergeablePr = {
  ...pr, id: "PR_current", isDraft: false,
  baseRepository: { ...pr.baseRepository, viewerPermission: "WRITE", isArchived: false,
    mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false },
  viewerCanUpdate: true, viewerCanUpdateBranch: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED", commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] }
};
const review = { repository: "example/project", number: 7, headRepository: "alice/project",
  headBranch: "feature/search", headCommit: "a".repeat(40), baseBranch: "main", baseCommit: "b".repeat(40) };
const readPr = (value = mergeablePr) => success({ data: { repository: { pullRequest: value } } });

test("PR details expose reviewed authority, checks and the repository's merge methods", async () => {
  const f = fixture([readPr()]);
  const result = await githubPullRequests(project, { operation: "read", number: 7, vibe64User: user }, f.options);
  assert.deepEqual(result.pullRequest.review, review);
  assert.deepEqual(result.pullRequest.mergeMethods, ["merge", "squash"]);
  assert.equal(result.pullRequest.actions.merge, "");
  assert.equal(result.pullRequest.actions["update-branch"], "");
  assert.equal(result.pullRequest.checksState, "SUCCESS");
});

test("PR updates compare live refs even when GitHub's summary and update suggestion lag", async () => {
  const current = { ...mergeablePr, viewerCanUpdateBranch: false,
    baseRef: { name: "main", target: { oid: "c".repeat(40) } } };
  const f = fixture([readPr(current), readPr(current), success({ message: "Updating pull request branch." })]);
  const { pullRequest } = await githubPullRequests(project, { operation: "read", number: 7, vibe64User: user }, f.options);
  assert.equal(pullRequest.review.baseCommit, "c".repeat(40));
  assert.equal(pullRequest.actions["update-branch"], "");
  assert.equal(pullRequest.behindBase, 1);
  assert.ok(f.calls[1].args.includes(`repos/example/project/compare/${"c".repeat(40)}...${"a".repeat(40)}?per_page=1`));
  const result = await githubPullRequests(project, { operation: "update-branch", number: 7,
    review: pullRequest.review, vibe64User: user }, f.options);
  assert.equal(result.pending, true);
  const caughtUp = fixture([readPr(current)], 0);
  const fresh = await githubPullRequests(project, { operation: "read", number: 7, vibe64User: user }, caughtUp.options);
  assert.match(fresh.pullRequest.actions["update-branch"], /already includes/u);
  const movedHead = fixture([readPr({ ...current, headRef: { name: "feature/search", target: { oid: "d".repeat(40) } } })]);
  const moving = await githubPullRequests(project, { operation: "read", number: 7, vibe64User: user }, movedHead.options);
  assert.equal(moving.pullRequest.review.headCommit, "d".repeat(40));
  assert.match(moving.pullRequest.actions.merge, /still updating/u);
});

test("PR actions use the signed-in actor, current PR ID and reviewed head without retries", async () => {
  for (const [operation, current, response] of [
    ["ready", { ...mergeablePr, isDraft: true }, success({ data: {
      markPullRequestReadyForReview: { pullRequest: { id: "PR_current", isDraft: false } }
    } })],
    ["update-branch", mergeablePr, success({ message: "Updating pull request branch." })],
    ["merge", mergeablePr, success({ merged: true, sha: "c".repeat(40) })]
  ]) {
    const f = fixture([readPr(current), response]);
    const result = await githubPullRequests(project, { operation, number: 7, review,
      mergeMethod: "squash", vibe64User: user, id: "PR_forged", repository: "other/project" }, f.options);
    assert.equal(result.ok, true);
    assert.equal(f.calls.length, 3);
    for (const call of f.calls) {
      assert.equal(call.actor, "named-user");
      assert.equal(call.credentialHome.username, "alice");
    }
    const sent = JSON.parse(f.calls[2].input);
    if (operation === "ready") {
      assert.deepEqual(sent.variables, { id: "PR_current" });
    } else {
      assert.ok(f.calls[2].args.includes(`repos/example/project/pulls/7/${operation}`));
      assert.deepEqual(sent, operation === "merge"
        ? { sha: review.headCommit, merge_method: "squash" } : { expected_head_sha: review.headCommit });
    }
    assert.equal(result.pending, operation === "update-branch" ? true : undefined);
    if (result.pending) assert.match(result.message, /accepted.*Refresh/u);
  }
});

test("PR actions refuse stale or missing reviews before mutating GitHub", async () => {
  for (const operation of ["ready", "update-branch", "merge"]) {
    for (const change of [null, ...Object.keys(review).map((key) => ({ ...review, [key]: "changed" }))]) {
      const f = fixture([readPr({ ...mergeablePr, isDraft: operation === "ready" })]);
      await assert.rejects(githubPullRequests(project, { operation, number: 7, review: change,
        mergeMethod: "merge", vibe64User: user }, f.options), { code: "vibe64_pull_request_review_changed" });
      assert.equal(f.calls.length, 2);
    }
  }
});

test("PR merge refuses drafts, conflicts, restrictions and unknown state without bypassing them", async () => {
  for (const change of [
    { state: "CLOSED" }, { state: "MERGED" }, { isDraft: true }, { baseRef: null }, { headRef: null },
    { baseRepository: { ...mergeablePr.baseRepository, viewerPermission: "READ" } },
    { baseRepository: { ...mergeablePr.baseRepository, isArchived: true } },
    { mergeable: "CONFLICTING" }, { mergeable: "UNKNOWN" }, { mergeStateStatus: "UNKNOWN" },
    { mergeStateStatus: "BEHIND" }, { mergeStateStatus: "BLOCKED" },
    { reviewDecision: "REVIEW_REQUIRED" }, { reviewDecision: "CHANGES_REQUESTED" },
    { baseRepository: { ...mergeablePr.baseRepository, mergeCommitAllowed: false, squashMergeAllowed: false } }
  ]) {
    const f = fixture([readPr({ ...mergeablePr, ...change, viewerCanMergeAsAdmin: true })]);
    await assert.rejects(githubPullRequests(project, { operation: "merge", number: 7, review,
      mergeMethod: "merge", vibe64User: user }, f.options), { code: "vibe64_pull_request_action_unavailable" });
    assert.ok(f.calls.length <= 2);
  }
  const f = fixture([readPr()]);
  await assert.rejects(githubPullRequests(project, { operation: "merge", number: 7, review,
    mergeMethod: "rebase", vibe64User: user }, f.options), { code: "vibe64_pull_request_input_invalid" });
  assert.equal(f.calls.length, 2);
});

test("PR updates and readiness obey GitHub capability checks", async () => {
  for (const [operation, change] of [
    ["update-branch", { viewerCanUpdateBranch: false, headRepository: { ...pr.headRepository, viewerPermission: "READ" } }],
    ["update-branch", { headRepository: { ...pr.headRepository, isArchived: true } }],
    ["update-branch", { mergeable: "CONFLICTING" }],
    ["ready", { isDraft: true, viewerCanUpdate: false }], ["ready", { isDraft: false }]
  ]) {
    const f = fixture([readPr({ ...mergeablePr, ...change })]);
    await assert.rejects(githubPullRequests(project, { operation, number: 7, review, vibe64User: user }, f.options),
      { code: "vibe64_pull_request_action_unavailable" });
    assert.equal(f.calls.length, 2);
  }
});

test("GitHub races and unconfirmed writes remain explicit failures and are not retried", async () => {
  for (const [operation, response, expected] of [
    ["merge", { ok: false, stderr: "HTTP 409", stdout: JSON.stringify({ message: "Head branch was modified." }) }, /Head branch was modified/u],
    ["merge", success({ merged: false }), /did not confirm/u],
    ["update-branch", success({}), /did not confirm/u],
    ["merge", { ok: false, stdout: "", stderr: "timeout" }, /could not be confirmed/u],
    ["ready", success({ data: { markPullRequestReadyForReview: { pullRequest: { id: "PR_other", isDraft: false } } } }), /could not be confirmed/u]
  ]) {
    const f = fixture([readPr({ ...mergeablePr, isDraft: operation === "ready" }), response]);
    await assert.rejects(githubPullRequests(project, { operation, number: 7, review,
      mergeMethod: "merge", vibe64User: user }, f.options), expected);
    assert.equal(f.calls.length, 3);
  }
});

test("PR mutation routes bind the action, project, number and identity to the authenticated request", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const app = testRouteApp();
    let received;
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app",
      project: { async githubPullRequests(input) { received = input; return { ok: true }; } } });
    for (const operation of ["ready", "update-branch", "merge"]) {
      const route = findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/pull-requests/:number/${operation}` });
      const body = { review, mergeMethod: "merge", operation: "forged", number: 999,
        repository: "other/project", vibe64User: { username: "daemon" } };
      const reply = testReply();
      await route.handler({ body, input: { body }, params: routeProjectParams({ number: "7" }), vibe64User: user }, reply);
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(received, { operation, number: "7", review, mergeMethod: "merge", vibe64User: user });
    }
  }));
  for (const operation of ["ready", "update-branch", "merge"]) {
    const f = fixture([]);
    await assert.rejects(githubPullRequests(project, { operation, number: 7, review }, f.options),
      { code: "vibe64_os_user_required" });
    await assert.rejects(githubPullRequests({ ...project, repositoryMode: "managed_git" },
      { operation, number: 7, review, vibe64User: user }, f.options), { code: "vibe64_github_project_required" });
    assert.equal(f.calls.length, 0);
  }
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
    // GitHub's Update branch merges main into the head. Ordinary session Update
    // must then load it without losing unsaved files or publishing them to main.
    await git(seed, ["checkout", "main"]);
    await writeFile(path.join(seed, "from-main.txt"), "main advanced\n");
    await git(seed, ["add", "."]); await git(seed, ["commit", "-m", "Advance main"]);
    await git(seed, ["push", "origin", "main"]);
    const newerMain = await git(seed, ["rev-parse", "HEAD"]);
    await git(seed, ["checkout", "feature/search"]);
    await git(seed, ["pull", "--ff-only", "origin", "feature/search"]);
    await git(seed, ["merge", "--no-ff", "main", "-m", "Update branch from main"]);
    await git(seed, ["push", "origin", "feature/search"]);
    const updatedHead = await git(seed, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "unsaved.txt"), "keep this draft\n");
    assert.equal((await checkSessionUpdatesDirect({ project, session, runCommand })).updateAvailable, true);
    const updated = await updateSessionWorkDirect({ project, session, runCommand });
    assert.equal(updated.status, "updated");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), updatedHead);
    assert.equal(await readFile(path.join(session.sourcePath, "from-main.txt"), "utf8"), "main advanced\n");
    assert.equal(await readFile(path.join(session.sourcePath, "unsaved.txt"), "utf8"), "keep this draft\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /unsaved.txt/u);
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "main"]), newerMain);
    // Creating a PR from a normal session supports baselines that have only been committed locally.
    await writeFile(path.join(session.sourcePath, "local.txt"), "locally committed\n");
    await git(session.sourcePath, ["add", "."]); await git(session.sourcePath, ["commit", "-m", "local baseline"]);
    const localCommit = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    session.metadata.base_commit = localCommit;
    session.metadata.github_pull_request = JSON.stringify({ ...source, number: null, headBranch: "vibe64/pr-session-1" });
    await prepareSessionPullRequestBranch({ project, session, runCommand });
    await prepareSessionPullRequestBranch({ project, session, runCommand });
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "vibe64/pr-session-1"]), localCommit);
    assert.equal(await git(root, ["--git-dir", remote, "rev-parse", "main"]), newerMain);
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
