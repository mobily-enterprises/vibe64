import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createVibe64ProjectChangedPublisher } from "../../packages/vibe64-project/src/server/actions.js";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";

test("confirmed GitHub mutations refresh their captured project without making notification failure retryable", async (t) => {
  const osUser = os.userInfo();
  const vibe64User = { username: osUser.username, home: osUser.homedir, uid: osUser.uid, gid: osUser.gid };
  const project = { slug: "first", repositoryMode: "github", githubRepository: { fullName: "example/project" } };
  let selectedProject = project;
  let replies = [];
  let failNotification = false;
  const commands = [];
  const events = [];
  const warnings = [];
  t.after(installVibe64ManagedExecutionProvider({
    stopExecution() { assert.fail("No process starts in this test."); },
    async runCommand(request, context) {
      commands.push(request);
      assert.equal(request.command, "gh");
      assert.equal(context.actor.user.username, vibe64User.username);
      // A different selected project cannot retarget the notification after publication.
      selectedProject = { ...project, slug: "second" };
      if (request.args.some(arg => arg.includes("/compare/"))) return { ok: true, stdout: JSON.stringify({ behind_by: 1 }) };
      assert.ok(replies.length, "Unexpected GitHub request");
      const reply = replies.shift();
      return reply === "fail" ? { ok: false, stderr: "403 Resource not accessible" } : { ok: true, stdout: JSON.stringify(reply) };
    }
  }));
  const service = createService({
    env: { VIBE64_GITHUB_ACCOUNT_MODE: "user" },
    projectContext: { async listProjects() { return { currentProject: selectedProject, projects: [selectedProject] }; } },
    logger: { warn(...args) { warnings.push(args); } },
    publishProjectChanged: createVibe64ProjectChangedPublisher({ events: { async publish(event) {
      if (failNotification) throw new Error("Notification transport unavailable");
      events.push(event);
    } } })
  });
  const issue = { id: "I_7", number: 7, viewerCanUpdate: true, viewerCanClose: true, viewerCanReopen: true };
  const comment = { id: "IC_7", body: "private-body", author: { login: "author" } };
  const issueRead = { data: { repository: { issue } } };
  const labelsRead = { data: { repository: { viewerPermission: "WRITE", labels: {
    nodes: [{ id: "L_1", name: "bug", color: "aabbcc" }], pageInfo: { hasNextPage: false }
  } } } };
  const review = { repository: "example/project", number: 7, headRepository: "example/project", headBranch: "work",
    headCommit: "a".repeat(40), baseBranch: "main", baseCommit: "b".repeat(40) };
  const pr = { id: "PR_7", number: 7, state: "OPEN", isDraft: false, headRefName: "work", baseRefName: "main",
    headRefOid: review.headCommit, headRef: { target: { oid: review.headCommit } }, baseRef: { target: { oid: review.baseCommit } },
    headRepository: { nameWithOwner: review.headRepository, viewerPermission: "WRITE" },
    baseRepository: { nameWithOwner: review.repository, viewerPermission: "WRITE", squashMergeAllowed: true },
    viewerCanUpdate: true, viewerCanUpdateBranch: true, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
  const prRead = { data: { repository: { pullRequest: pr } } };
  const cases = [
    ["githubIssues", { operation: "create", title: "Issue", body: "private-body" }, [{ number: 7, html_url: "https://github.com/example/project/issues/7" }]],
    ["githubIssues", { operation: "edit", number: 7, title: "Issue", body: "private-body" }, [issueRead, {}]],
    ["githubIssues", { operation: "comment", number: 7, body: "private-body", originId: "browser-1" }, [issueRead, { node_id: "IC_7", body: "private-body", user: { login: "author" } }]],
    ["githubIssues", { operation: "edit-comment", number: 7, commentId: "IC_7", body: "private-body" }, [
      { data: { node: { viewerCanUpdate: true, issue: { number: 7, repository: { nameWithOwner: "example/project" } } } } },
      { data: { updateIssueComment: { issueComment: comment } } }
    ]],
    ["githubIssues", { operation: "state", number: 7, state: "closed" }, [issueRead, { state: "closed", state_reason: "completed" }]],
    ["githubIssues", { operation: "create-label", name: "new-label", color: "aabbcc" }, [labelsRead, { node_id: "L_2", name: "new-label", color: "aabbcc" }]],
    ["githubIssues", { operation: "set-labels", number: 7, labels: ["bug"], labelMode: "add" }, [labelsRead, issueRead, { data: { addLabelsToLabelable: {} } }]],
    ["githubPullRequests", { operation: "ready", number: 7, review }, [{ data: { repository: { pullRequest: { ...pr, isDraft: true } } } },
      { data: { markPullRequestReadyForReview: { pullRequest: { id: "PR_7", isDraft: false } } } }]],
    ["githubPullRequests", { operation: "update-branch", number: 7, review }, [prRead, { message: "Accepted" }]],
    ["githubPullRequests", { operation: "merge", number: 7, review, mergeMethod: "squash" }, [prRead, { merged: true }]],
    ["publishSessionPullRequest", { title: "Requested PR", body: "private-body" }, [[], { number: 7, html_url: "https://github.com/example/project/pull/7", title: "Requested PR" }]]
  ];
  const source = { baseRepository: "example/project", baseBranch: "main", headRepository: "example/project", headBranch: "work" };
  for (const notifyFailure of [false, true]) {
    failNotification = notifyFailure;
    for (const [method, input, responses] of cases) {
      selectedProject = project;
      replies = [...responses];
      const beforeCommands = commands.length;
      const beforeEvents = events.length;
      const beforeWarnings = warnings.length;
      const result = method === "publishSessionPullRequest"
        ? await service[method](source, { ...input, vibe64User }) : await service[method]({ ...input, vibe64User });
      assert.equal(method === "publishSessionPullRequest" ? result.number === 7 : result.ok, true, JSON.stringify(result));
      if (input.operation === "update-branch") assert.equal(result.pending, true);
      assert.equal(replies.length, 0);
      assert.equal(commands.length - beforeCommands, responses.length + (method === "githubPullRequests" ? 1 : 0), "no GitHub retry");
      assert.equal(events.length - beforeEvents, notifyFailure ? 0 : 1);
      assert.equal(warnings.length - beforeWarnings, notifyFailure ? 1 : 0);
      if (!notifyFailure) {
        const payload = events.at(-1).realtime.payload;
        assert.equal(payload.projectSlug, "first");
        assert.equal(events.at(-1).entityId, "first");
        assert.equal(JSON.stringify(payload).includes("private"), false);
        if (input.operation === "comment") {
          assert.deepEqual(payload.issueComment, { number: 7, id: "IC_7", author: "author" });
          assert.equal(payload.originId, "browser-1");
        } else assert.equal(payload.githubRefresh, true);
      }
    }
  }
  failNotification = false;
  for (const [method, input, responses] of [
    ["githubIssues", { operation: "read", number: 7 }, [issueRead]],
    ["githubPullRequests", { operation: "read", number: 7 }, [prRead]],
    ["githubIssues", { operation: "edit", number: 7, title: "No permission", body: "" }, ["fail"]],
    ["githubPullRequests", { operation: "merge", number: 7, review, mergeMethod: "squash" }, ["fail"]]
  ]) {
    selectedProject = project;
    replies = [...responses];
    const count = events.length;
    const result = await service[method]({ ...input, vibe64User });
    assert.equal(result.ok, input.operation === "read");
    assert.equal(events.length, count, "reads and failed writes do not publish changes");
  }
  failNotification = true;
  await assert.rejects(service.refreshGithub(), /Notification transport unavailable/u, "an explicit refresh still reports its own delivery failure");
});
