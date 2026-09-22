import assert from "node:assert/strict";
import test from "node:test";
import { githubIssues } from "../../packages/vibe64-project/src/server/githubIssues.js";
import getPlacements from "../../src/placement.js";

const project = { repositoryMode: "github", githubRepository: { fullName: "example/project" } };
const user = { username: "alice", home: "/home/alice", uid: 1001, gid: 1001 };
const issue = { id: "I_seven", number: 7, state: "OPEN", viewerCanClose: true, viewerCanReopen: true,
  comments: { nodes: [], totalCount: 0, pageInfo: { hasPreviousPage: false } } };
const success = (body) => ({ ok: true, stdout: JSON.stringify(body) });

test("Issues is project-wide and both navigation surfaces hide it without GitHub", () => {
  const placement = getPlacements().find((entry) => entry.id === "vibe64.issues.link");
  assert.equal(placement.owner, "app-dashboard");
  assert.equal(placement.target, "page.section-nav");
  for (const visible of [placement.when, placement.props.visibleWhen]) {
    assert.equal(visible({}), false);
    assert.equal(visible({ projectContext: { repositoryMode: "managed_git" } }), false);
    assert.equal(visible({ projectContext: project }), true);
    assert.equal(visible({ projectContext: { repositoryMode: "local_source", githubRepository: project.githubRepository } }), true);
  }
});

function fixture(replies) {
  const calls = [];
  return { calls, options: { env: { VIBE64_GITHUB_ACCOUNT_MODE: "user" },
    async runCommand(request) {
      calls.push(request);
      assert.ok(replies.length, "Unexpected GitHub request");
      return replies.shift();
    }
  } };
}

test("mention suggestions paginate participants and collaborators using the acting account and deduplicate logins", async () => {
  const page = (nodes, cursor = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(cursor), endCursor: cursor } });
  const f = fixture([
    success({ data: { repository: { issue: { participants: page([{ login: "alice" }, null], "older-people") } } } }),
    success({ data: { repository: { issue: { participants: page([{ login: "early-commenter", name: "Early commenter" }]) } } } }),
    success({ data: { repository: { collaborators: page([{ login: "Alice" }], "more-collaborators") } } }),
    success({ data: { repository: { collaborators: page([{ login: "tamiastewart123", name: "Tamia" }]) } } })
  ]);
  const result = await githubIssues(project, { operation: "mentions", number: 7, vibe64User: user }, f.options);
  assert.deepEqual(result.users, [
    { login: "Alice", name: "" }, { login: "early-commenter", name: "Early commenter" }, { login: "tamiastewart123", name: "Tamia" }
  ]);
  assert.equal(result.warning, "");
  const queries = f.calls.map((call) => JSON.parse(call.input));
  assert.deepEqual(queries.map(({ variables }) => variables.cursor), [null, "older-people", null, "more-collaborators"]);
  assert.equal(queries[0].variables.number, 7);
  assert.match(queries[0].query, /participants\(first:100/u);
  assert.match(queries[2].query, /collaborators\(first:100, after:\$cursor, affiliation:ALL\)/u);
  for (const [index, call] of f.calls.entries()) {
    assert.equal(call.actor, "named-user");
    assert.equal(call.userKey, "alice");
    assert.equal(queries[index].variables.owner, "example");
    assert.equal(queries[index].variables.name, "project");
  }
});

test("new issue mentions load collaborators without an issue, and validate supplied issue numbers", async () => {
  const f = fixture([success({ data: { repository: { collaborators: {
    nodes: [{ login: "tamiastewart123" }], pageInfo: { hasNextPage: false }
  } } } })]);
  const result = await githubIssues(project, { operation: "mentions", vibe64User: user }, f.options);
  assert.equal(result.users[0].login, "tamiastewart123");
  assert.doesNotMatch(JSON.parse(f.calls[0].input).query, /participants|\$number/u);
  const invalid = fixture([]);
  for (const number of [0, -1, "", "../../7", 1.5]) {
    await assert.rejects(githubIssues(project, { operation: "mentions", number, vibe64User: user }, invalid.options),
      { code: "vibe64_issue_input_invalid" });
  }
  assert.equal(invalid.calls.length, 0);
});

test("restricted collaborator lists retain issue participants with a warning; total failure remains retryable", async () => {
  const denied = { ok: false, stderr: "403 Resource not accessible" };
  const f = fixture([
    success({ data: { repository: { issue: { participants: { nodes: [{ login: "early-commenter" }], pageInfo: { hasNextPage: false } } } } } }),
    denied
  ]);
  const result = await githubIssues(project, { operation: "mentions", number: 7, vibe64User: user }, f.options);
  assert.deepEqual(result.users, [{ login: "early-commenter", name: "" }]);
  assert.match(result.warning, /collaborators could not load/u);
  const failed = fixture([denied, denied]);
  await assert.rejects(githubIssues(project, { operation: "mentions", number: 7, vibe64User: user }, failed.options),
    { code: "vibe64_github_issues_failed" });
  assert.equal(failed.calls.length, 2);
});

test("mention pagination stops on an invalid cursor and preserves already loaded people with a warning", async () => {
  const f = fixture([
    success({ data: { repository: { collaborators: { nodes: [{ login: "alice" }], pageInfo: { hasNextPage: true, endCursor: "same" } } } } }),
    success({ data: { repository: { collaborators: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } } } })
  ]);
  const result = await githubIssues(project, { operation: "mentions", vibe64User: user }, f.options);
  assert.deepEqual(result.users, [{ login: "alice", name: "" }]);
  assert.match(result.warning, /collaborators could not load/u);
  assert.equal(f.calls.length, 2);
});

test("lists only the selected repository's issues with bounded pagination and actor credentials", async () => {
  const f = fixture([success({ data: { search: { nodes: [{ number: 7 }, {}], issueCount: 26,
    pageInfo: { hasNextPage: true, endCursor: "next" } } } })]);
  const result = await githubIssues(project, { vibe64User: user, search: 'broken " repo:other/private', cursor: "page-two" }, f.options);
  assert.deepEqual(result.issues, [{ number: 7 }]);
  assert.equal(result.pageInfo.endCursor, "next");
  const request = f.calls[0];
  assert.equal(request.actor, "named-user");
  assert.equal(request.userKey, "alice");
  assert.equal(request.credentialHome.home, "/home/alice");
  assert.equal(request.cwd, "/home/alice");
  assert.equal(request.purpose, "github-api");
  assert.deepEqual(request.args, ["api", "--hostname", "github.com", "graphql", "--method", "POST", "--input", "-"]);
  const payload = JSON.parse(request.input);
  assert.equal(payload.variables.cursor, "page-two");
  assert.equal(payload.variables.search, 'repo:example/project is:issue is:open "broken   repo:other/private" in:title,body sort:updated-desc');
  assert.match(payload.query, /first:25/u);
  assert.equal(result.searchLimit, 1000);
});

test("browses repository issues beyond 1,000 without using capped search", async () => {
  const f = fixture([success({ data: { repository: { issues: {
    nodes: [{ number: 1001 }], totalCount: 1250,
    pageInfo: { hasNextPage: true, endCursor: "after-1025" }
  } } } })]);
  const result = await githubIssues(project, {
    vibe64User: user, cursor: "after-1000", state: "closed", labels: "help wanted"
  }, f.options);
  const payload = JSON.parse(f.calls[0].input);
  assert.match(payload.query, /issues\(first:25/u);
  assert.doesNotMatch(payload.query, /search\(/u);
  assert.deepEqual(payload.variables, {
    owner: "example", name: "project", cursor: "after-1000", states: ["CLOSED"], labels: ["help wanted"]
  });
  assert.equal(result.total, 1250);
  assert.equal(result.searchLimit, null);
  assert.deepEqual(result.issues, [{ number: 1001 }]);
  assert.deepEqual(result.pageInfo, { hasNextPage: true, endCursor: "after-1025" });
});

test("bare and hash-prefixed issue numbers use exact repository lookup, independent of title and body", async () => {
  for (const search of ["43", "#43", " #43 "]) {
    const f = fixture([success({ number: 43, title: "Daily Overview", state: "open",
      html_url: "https://github.com/example/project/issues/43", user: { login: "alice" },
      comments: 2, labels: [{ name: "bug", color: "d73a4a" }] })]);
    const result = await githubIssues(project, { vibe64User: user, search, cursor: "old-page" }, f.options);
    assert.equal(result.total, 1);
    assert.equal(result.issues[0].number, 43);
    assert.equal(result.issues[0].state, "OPEN");
    assert.equal(result.issues[0].comments.totalCount, 2);
    assert.equal(result.issues[0].labels.totalCount, 1);
    assert.equal(result.searchLimit, null);
    assert.equal(result.pageInfo.hasNextPage, false);
    assert.equal(f.calls[0].args[3], "repos/example/project/issues/43");
    assert.equal(f.calls[0].args[5], "GET");
    assert.equal(f.calls[0].userKey, "alice");
  }
});

test("number lookup respects state and every label, excludes pull requests and returns an empty missing result", async () => {
  const found = { number: 43, title: "Daily Overview", state: "closed", labels: [{ name: "bug" }, { name: "important" }] };
  for (const [response, filters, count] of [
    [success(found), {}, 0],
    [success(found), { state: "all" }, 1],
    [success(found), { state: "closed", labels: ["BUG", "important"] }, 1],
    [success(found), { state: "closed", labels: ["bug", "missing"] }, 0],
    [success({ ...found, pull_request: {} }), { state: "all" }, 0],
    [{ ok: false, stdout: JSON.stringify({ message: "Not Found", status: "404" }) }, {}, 0]
  ]) {
    const f = fixture([response]);
    const result = await githubIssues(project, { vibe64User: user, search: "#43", ...filters }, f.options);
    assert.equal(result.issues.length, count);
    assert.equal(result.total, count);
  }
  for (const search of ["0", "#0", "9007199254740992"]) {
    const f = fixture([]);
    await assert.rejects(githubIssues(project, { vibe64User: user, search }, f.options), { code: "vibe64_issue_input_invalid" });
    assert.equal(f.calls.length, 0);
  }
  const denied = fixture([{ ok: false, stderr: "HTTP 403" }]);
  await assert.rejects(githubIssues(project, { vibe64User: user, search: "43" }, denied.options), /permissions/u);
});

test("unfiltered browsing leaves the GitHub label filter unset in every state", async () => {
  for (const state of ["open", "closed", "all"]) {
    for (const labels of [undefined, []]) {
      const f = fixture([success({ data: { repository: { issues: {
        nodes: [{ number: 7 }], totalCount: 1, pageInfo: { hasNextPage: false }
      } } } })]);
      const result = await githubIssues(project, { vibe64User: user, state, labels }, f.options);
      const payload = JSON.parse(f.calls[0].input);
      assert.deepEqual(payload.variables.states, state === "all" ? null : [state.toUpperCase()]);
      assert.equal(payload.variables.labels, null);
      assert.doesNotMatch(payload.query, /search\(/u);
      assert.deepEqual(result.issues, [{ number: 7 }]);
      assert.equal(result.total, 1);
    }
  }
});

test("multiple labels require every label and disclose the search limit with or without text", async () => {
  for (const search of ["", "broken layout"]) {
    const f = fixture([success({ data: { search: {
      nodes: [{ number: 7 }], issueCount: 1234, pageInfo: { hasNextPage: true, endCursor: "next" }
    } } })]);
    const result = await githubIssues(project, {
      vibe64User: user, state: "all", labels: ["bug", "help wanted"], search, cursor: "next-25"
    }, f.options);
    const payload = JSON.parse(f.calls[0].input);
    assert.match(payload.query, /search\(/u);
    assert.match(payload.variables.search, /label:"bug" label:"help wanted"/u);
    assert.doesNotMatch(payload.variables.search, /is:open|is:closed/u);
    assert.equal(payload.variables.cursor, "next-25");
    assert.equal(result.total, 1234);
    assert.equal(result.searchLimit, 1000);
    if (search) assert.match(payload.variables.search, /"broken layout" in:title,body/u);
  }
});

test("label search values cannot introduce repository or state qualifiers", async () => {
  const labels = ['needs "review"', 'path\\name repo:other/private'];
  const f = fixture([success({ data: { search: {
    nodes: [], issueCount: 0, pageInfo: { hasNextPage: false }
  } } })]);
  await githubIssues(project, { vibe64User: user, labels }, f.options);
  const search = JSON.parse(f.calls[0].input).variables.search;
  assert.ok(search.startsWith("repo:example/project is:issue is:open "));
  assert.ok(search.includes('label:"needs \\"review\\""'));
  assert.ok(search.includes('label:"path\\\\name repo:other/private"'));
});

test("invalid label filters fail before contacting GitHub", async () => {
  const f = fixture([]);
  for (const labels of [{ name: "bug" }, [null], [""], ["   "], ["bug\nrepo:other/private"], Array(101).fill("bug")]) {
    await assert.rejects(githubIssues(project, { vibe64User: user, labels }, f.options), {
      code: "vibe64_issue_input_invalid"
    });
  }
  assert.equal(f.calls.length, 0);
});

test("rejects non-GitHub projects, absent hosted identity and invalid input before executing", async () => {
  const f = fixture([]);
  for (const target of [{}, { ...project, repositoryMode: "managed_git" }, { githubRepository: { fullName: "../other/path" } }]) {
    await assert.rejects(githubIssues(target, { vibe64User: user }, f.options), { code: "vibe64_github_project_required" });
  }
  await assert.rejects(githubIssues(project, {}, f.options), { code: "vibe64_os_user_required" });
  for (const input of [{ operation: "read", number: "../../2" }, { operation: "state", number: 7, state: "all" },
    { operation: "comment", number: 7, body: " " }, { operation: "comment", number: 7, body: "a".repeat(65537) },
    { search: "a".repeat(201) }, { cursor: {} }]) {
    await assert.rejects(githubIssues(project, { ...input, vibe64User: user }, f.options), { code: "vibe64_issue_input_invalid" });
  }
  assert.equal(f.calls.length, 0);
});

test("reads latest comments and requests older pages without treating pull requests as issues", async () => {
  const rendered = { ...issue, body: "![Image](https://github.com/user-attachments/assets/example)",
    bodyHTML: '<p><img src="https://private-user-images.githubusercontent.com/example?jwt=signed"></p>',
    comments: { ...issue.comments, nodes: [{ id: "comment", body: "**Update**", bodyHTML: "<p><strong>Update</strong></p>" }] } };
  const f = fixture([success({ data: { repository: { issue: rendered } } }), success({ data: { repository: { issue: null } } })]);
  const result = await githubIssues(project, { operation: "read", number: 7, cursor: "older", vibe64User: user }, f.options);
  assert.equal(result.issue.number, 7);
  assert.equal(result.issue.body, rendered.body);
  assert.equal(result.issue.bodyHTML, rendered.bodyHTML);
  assert.deepEqual(result.issue.comments.nodes, rendered.comments.nodes);
  const payload = JSON.parse(f.calls[0].input);
  assert.deepEqual(payload.variables, { owner: "example", name: "project", number: 7, cursor: "older" });
  assert.match(payload.query, /comments\(last:25, before:\$cursor\)/u);
  assert.match(payload.query, /title body bodyHTML/u);
  assert.match(payload.query, /id body bodyHTML createdAt/u);
  await assert.rejects(githubIssues(project, { operation: "comment", number: 9, body: "test", vibe64User: user }, f.options),
    { code: "vibe64_issue_not_found" });
  assert.equal(f.calls.length, 2);
});

test("close and reopen respect GitHub viewer permissions before mutating the fixed repository", async () => {
  for (const state of ["closed", "open"]) {
    const denied = fixture([success({ data: { repository: { issue: { ...issue, viewerCanClose: false, viewerCanReopen: false } } } })]);
    await assert.rejects(githubIssues(project, { operation: "state", number: 7, state, vibe64User: user }, denied.options),
      { code: "vibe64_issue_permission_denied" });
    assert.equal(denied.calls.length, 1);
    const f = fixture([success({ data: { repository: { issue } } }), success({ state, state_reason: "completed" })]);
    const result = await githubIssues(project, { operation: "state", number: 7, state, vibe64User: user }, f.options);
    assert.equal(result.state, state.toUpperCase());
    assert.equal(f.calls[1].args[3], "repos/example/project/issues/7");
    assert.equal(f.calls[1].args[5], "PATCH");
    assert.deepEqual(JSON.parse(f.calls[1].input), { state, state_reason: state === "closed" ? "completed" : "reopened" });
  }
});

test("comments preserve Markdown literally through stdin and never retry an uncertain write", async () => {
  const body = "A `code` sample, $(literal), @mention\n\nThanks!";
  const f = fixture([success({ data: { repository: { issue } } }), success({ node_id: "comment-id", body, user: { login: "alice" } })]);
  const result = await githubIssues(project, { operation: "comment", number: 7, body, vibe64User: user }, f.options);
  assert.equal(result.comment.body, body);
  assert.deepEqual(JSON.parse(f.calls[1].input), { body });
  assert.equal(f.calls[1].args.includes(body), false);
  const failed = fixture([success({ data: { repository: { issue } } }), { ok: false, stderr: "private raw diagnostics" }]);
  await assert.rejects(githubIssues(project, { operation: "comment", number: 7, body, vibe64User: user }, failed.options),
    /Refresh the conversation before posting again/u);
  assert.equal(failed.calls.length, 2);
});

test("upstream failures expose an actionable message without raw GitHub output", async () => {
  for (const result of [{ ok: false, stderr: "HTTP 401 ghp_private" }, success({ errors: [{ message: "private details" }] }),
    { ok: true, stdout: "not json" }, success({ data: {} })]) {
    const f = fixture([result]);
    await assert.rejects(githubIssues(project, { vibe64User: user }, f.options), (error) => {
      assert.equal(error.code, "vibe64_github_issues_failed");
      assert.doesNotMatch(error.message, /private|not json/u);
      return true;
    });
  }
});

const bug = { id: "LA_bug", name: "bug", color: "d73a4a", description: "Something isn't working" };
const documentation = { name: "documentation", color: "0075ca", description: "Documentation improvements" };
function labelPage(nodes, viewerPermission = "WRITE", pageInfo = { hasNextPage: false, endCursor: "" }) {
  return success({ data: { repository: { viewerPermission, labels: { nodes, pageInfo } } } });
}

test("repository labels retain GitHub colors and include every page", async () => {
  const f = fixture([
    labelPage([bug], "TRIAGE", { hasNextPage: true, endCursor: "next-labels" }),
    labelPage([documentation], "TRIAGE")
  ]);
  const result = await githubIssues(project, { operation: "labels", vibe64User: user }, f.options);
  assert.deepEqual(result.labels, [bug, documentation]);
  assert.equal(result.canEditLabels, true);
  assert.equal(result.canCreateWithLabels, false);
  assert.equal(JSON.parse(f.calls[1].input).variables.cursor, "next-labels");
  assert.match(JSON.parse(f.calls[0].input).query, /labels\(first:100/u);
});

test("create issue publishes literal title, Markdown and existing labels in the selected repository", async () => {
  const title = "Investigate $(literal) and `code`";
  const body = "## What happened\n\nA description with **Markdown**.";
  const f = fixture([labelPage([bug]), success({ number: 12, html_url: "https://github.com/example/project/issues/12" })]);
  const result = await githubIssues(project, { operation: "create", title, body, labels: ["bug"], vibe64User: user }, f.options);
  assert.equal(result.issue.number, 12);
  assert.equal(f.calls[1].args[3], "repos/example/project/issues");
  assert.equal(f.calls[1].args[5], "POST");
  assert.deepEqual(JSON.parse(f.calls[1].input), { title, body, labels: ["bug"] });
  assert.equal(f.calls[1].args.includes(title), false);
});

test("creating without labels is allowed; denied or missing labels never silently disappear", async () => {
  const unlabelled = fixture([success({ number: 12, html_url: "https://github.com/example/project/issues/12" })]);
  await githubIssues(project, { operation: "create", title: "New issue", vibe64User: user }, unlabelled.options);
  assert.deepEqual(JSON.parse(unlabelled.calls[0].input), { title: "New issue", body: "", labels: [] });
  for (const [permission, labels, code] of [
    ["READ", ["bug"], "vibe64_issue_permission_denied"],
    ["TRIAGE", ["bug"], "vibe64_issue_permission_denied"],
    ["WRITE", ["removed-label"], "vibe64_issue_input_invalid"]
  ]) {
    const f = fixture([labelPage([bug], permission)]);
    await assert.rejects(githubIssues(project, { operation: "create", title: "New issue", labels, vibe64User: user }, f.options), { code });
    assert.equal(f.calls.length, 1);
  }
});

test("triage can replace or clear issue labels; PR numbers and read-only accounts cannot", async () => {
  for (const labels of [["bug"], []]) {
    const f = fixture([labelPage([bug], "TRIAGE"), success({ data: { repository: { issue } } }), success([])]);
    await githubIssues(project, { operation: "set-labels", number: 7, labels, vibe64User: user }, f.options);
    assert.equal(f.calls[2].args[3], "repos/example/project/issues/7/labels");
    assert.equal(f.calls[2].args[5], "PUT");
    assert.deepEqual(JSON.parse(f.calls[2].input), { labels });
  }
  const denied = fixture([labelPage([bug], "READ")]);
  await assert.rejects(githubIssues(project, { operation: "set-labels", number: 7, labels: [], vibe64User: user }, denied.options), { code: "vibe64_issue_permission_denied" });
  const pr = fixture([labelPage([bug]), success({ data: { repository: { issue: null } } })]);
  await assert.rejects(githubIssues(project, { operation: "set-labels", number: 9, labels: ["bug"], vibe64User: user }, pr.options), { code: "vibe64_issue_not_found" });
});

test("invalid new issues and label payloads are rejected before requests; uncertain creation is never retried", async () => {
  const invalid = fixture([]);
  for (const input of [
    { operation: "create", title: " " }, { operation: "create", title: "a".repeat(257) },
    { operation: "create", title: "Valid", body: "a".repeat(65537) },
    { operation: "create", title: "Valid", labels: [null] },
    { operation: "set-labels", number: 7 }, { operation: "set-labels", number: 7, labels: [""] },
    { operation: "set-labels", number: 7, labels: Array(101).fill("bug") }
  ]) {
    await assert.rejects(githubIssues(project, { ...input, vibe64User: user }, invalid.options), { code: "vibe64_issue_input_invalid" });
  }
  assert.equal(invalid.calls.length, 0);
  const failed = fixture([{ ok: false, stderr: "upstream timeout" }]);
  await assert.rejects(githubIssues(project, { operation: "create", title: "New issue", vibe64User: user }, failed.options), /Refresh the issue list before trying again/u);
  assert.equal(failed.calls.length, 1);
});


test("issue editing checks the acting viewer and updates only title and description", async () => {
  const f = fixture([
    success({ data: { repository: { issue: { ...issue, viewerCanUpdate: true } } } }), success({ number: 7 })
  ]);
  const result = await githubIssues(project, {
    operation: "edit", number: 7, title: "  Revised title  ", body: "", labels: ["unrelated"], vibe64User: user
  }, f.options);
  assert.equal(result.issue.number, 7);
  assert.equal(f.calls[1].args[3], "repos/example/project/issues/7");
  assert.equal(f.calls[1].args[5], "PATCH");
  assert.deepEqual(JSON.parse(f.calls[1].input), { title: "Revised title", body: "" });
  assert.match(JSON.parse(f.calls[0].input).query, /viewerCanUpdate/u);
  const denied = fixture([success({ data: { repository: { issue: { ...issue, viewerCanUpdate: false } } } })]);
  await assert.rejects(githubIssues(project, {
    operation: "edit", number: 7, title: "Revised", body: "Description", vibe64User: user
  }, denied.options), { code: "vibe64_issue_permission_denied" });
  assert.equal(denied.calls.length, 1);
});

test("comment editing verifies its repository, issue and viewer even for older comment pages", async () => {
  const commentId = "IC_older_comment";
  const body = "Updated **Markdown** and @alice";
  const parent = { number: 7, repository: { nameWithOwner: "example/project" } };
  const updated = { id: commentId, body, viewerCanUpdate: true };
  const f = fixture([
    success({ data: { node: { viewerCanUpdate: true, issue: parent } } }),
    success({ data: { updateIssueComment: { issueComment: updated } } })
  ]);
  const result = await githubIssues(project, { operation: "edit-comment", number: 7, commentId, body, vibe64User: user }, f.options);
  assert.deepEqual(result.comment, updated);
  assert.deepEqual(JSON.parse(f.calls[0].input).variables, { id: commentId });
  assert.deepEqual(JSON.parse(f.calls[1].input).variables, { input: { id: commentId, body } });
  assert.equal(f.calls[1].userKey, "alice");
  for (const [node, code] of [
    [null, "vibe64_issue_not_found"],
    [{ issue: { ...parent, number: 8 }, viewerCanUpdate: true }, "vibe64_issue_not_found"],
    [{ issue: { ...parent, repository: { nameWithOwner: "other/project" } }, viewerCanUpdate: true }, "vibe64_issue_not_found"],
    [{ issue: parent, viewerCanUpdate: false }, "vibe64_issue_permission_denied"]
  ]) {
    const denied = fixture([success({ data: { node } })]);
    await assert.rejects(githubIssues(project, { operation: "edit-comment", number: 7, commentId, body, vibe64User: user }, denied.options), { code });
    assert.equal(denied.calls.length, 1);
  }
});

test("add and remove labels use catalog ids and leave unrelated issue labels untouched", async () => {
  for (const labelMode of ["add", "remove"]) {
    const f = fixture([
      labelPage([bug, { id: "LA_other", name: "other" }], "TRIAGE"),
      success({ data: { repository: { issue } } }), success({ data: {} })
    ]);
    await githubIssues(project, { operation: "set-labels", number: 7, labels: ["bug"], labelMode, vibe64User: user }, f.options);
    const payload = JSON.parse(f.calls[2].input);
    assert.match(payload.query, new RegExp(`${labelMode}Labels${labelMode === "add" ? "To" : "From"}Labelable`));
    assert.deepEqual(payload.variables, { input: { labelableId: "I_seven", labelIds: ["LA_bug"] } });
    assert.equal(f.calls[2].args[3], "graphql");
    assert.equal(f.calls[2].userKey, "alice");
  }
});

test("invalid edit inputs and bulk label modes make no GitHub calls", async () => {
  const f = fixture([]);
  for (const input of [
    { operation: "edit", number: 7, title: " " },
    { operation: "edit", number: 7, title: "a".repeat(257) },
    { operation: "edit", number: 7, title: "Title", body: "a".repeat(65537) },
    { operation: "edit-comment", number: 7, commentId: "", body: "Text" },
    { operation: "edit-comment", number: 7, commentId: "id", body: " " },
    { operation: "edit-comment", number: 7, commentId: "id", body: "a".repeat(65537) },
    { operation: "set-labels", number: 7, labelMode: "unknown", labels: [] }
  ]) await assert.rejects(githubIssues(project, { ...input, vibe64User: user }, f.options), { code: "vibe64_issue_input_invalid" });
  assert.equal(f.calls.length, 0);
});
