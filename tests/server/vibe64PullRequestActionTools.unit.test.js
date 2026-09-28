import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { registerRoutes as projectRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { registerRoutes as sessionRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("PR tools preserve reviewed targets and HTTP behavior with bounded native results", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const actor = { username: "owner", role: "owner" };
    let allowed = true;
    let missingHead = false;
    const calls = [];
    const review = { repository: "example/project", number: 7, headRepository: "owner/project",
      headBranch: `feature/${"x".repeat(270)}`, headCommit: "a".repeat(40), baseBranch: "main", baseCommit: "b".repeat(40) };
    const destination = { sessionId: "session-1", mode: "github", repository: "example/project", branch: "main" };
    const pr = { number: 7, title: "A requested change", body: "Description\n".repeat(500), url: "https://github.com/example/project/pull/7",
      author: { login: "author", email: "private-author" }, state: "OPEN", isDraft: true, headRefName: review.headBranch, baseRefName: review.baseBranch,
      unavailableReason: "", actions: { ready: "", "update-branch": "", merge: "Mark this draft ready for review before merging." },
      mergeMethods: ["squash", "merge"], review: { ...review, internal: "private-review" },
      checksState: "PENDING", reviewDecision: "REVIEW_REQUIRED", behindBase: 2, additions: 2, deletions: 1, changedFiles: 1,
      commits: { nodes: [{ private: "private-native" }] }, internal: "private-pr" };
    const results = {
      list: { ok: true, repository: review.repository, pullRequests: Array.from({ length: 25 }, (_, i) => ({ ...pr, number: i + 1 })),
        total: 26, pageInfo: { hasNextPage: true, endCursor: "next-page", internal: "private-cursor" } },
      read: { ok: true, repository: review.repository, pullRequest: pr },
      ready: { ok: true, message: "Pull request marked ready for review." },
      "update-branch": { ok: true, pending: true, message: "GitHub accepted the update. Refresh to check its progress." },
      merge: { ok: true, message: "Merged into main." },
      create: { ok: true, saveCommit: "c".repeat(40), pullRequest: { ...pr, ...review, headCommit: "old-source-identity",
        baseRepository: review.repository }, worktreePath: "/private/worktree" }
    };
    const record = (input) => calls.push({ input, actor: currentProjectRequestContext().vibe64User, project: currentProjectRequestContext().slug });
    const actions = createActionCatalogue();
    actions.register({ contributorId: "pull-requests", domain: "project", actions: [
      ...createProjectActions({ project: { async githubPullRequests(input) {
        record(input);
        if (input.operation === "read" && missingHead) return { ...results.read, pullRequest: { ...pr,
          review: { ...review, headCommit: "" }, unavailableReason: "The source branch is no longer available." } };
        return results[input.operation];
      } } }),
      ...createSessionActions({ sessions: {
        async createSessionPullRequest(sessionId, input) { record({ sessionId, ...input }); return results.create; },
        async createSession(input) { record(input); return { ok: true, sessionId: "opened-pr", workspaceSetup: { status: "running" } }; }
      } })
    ].map(action => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const app = testRouteApp();
    projectRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    sessionRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    const cases = [
      ["list", "GET", "/pull-requests", { state: "open", search: "change", cursor: "previous-page" }],
      ["read", "GET", "/pull-requests/:number", {}],
      ["ready", "POST", "/pull-requests/:number/ready", { review }],
      ["update-branch", "POST", "/pull-requests/:number/update-branch", { review }],
      ["merge", "POST", "/pull-requests/:number/merge", { review, mergeMethod: "squash" }],
      ["create", "POST", "/sessions/:sessionId/pull-request", { title: "A requested change", body: "Exact description\n", destinationReview: destination }]
    ];
    for (const [operation, method, path, input] of cases) {
      const isCreate = operation === "create";
      const actionId = isCreate ? "vibe64.sessions.pull-request.create" : `vibe64.project.pull-requests.${operation}`;
      const tool = toolSet.tools.find(tool => tool.actionId === actionId);
      assert.ok(tool, actionId);
      const parameters = catalog.toOpenAiToolSchema(tool).function.parameters;
      assert.equal(Object.hasOwn(parameters.properties, "vibe64User"), false);
      if (input.review) {
        const reference = parameters.properties.review.allOf[0].$ref.split("/").at(-1);
        assert.deepEqual([...parameters.definitions[reference].required].sort(), Object.keys(review).sort());
      }
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${path}` });
      const request = { params: routeProjectParams({ number: "7", sessionId: "session-1" }), input: { [method === "GET" ? "query" : "body"]: input },
        executeAction({ actionId: actual, input }) {
          assert.equal(actual, actionId);
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload, results[operation], "HTTP keeps full service results");
      const httpCall = calls.at(-1);
      const execute = (patch = {}) => catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, ...(isCreate ? { sessionId: "session-1" } : operation === "list" ? {} : { number: 7 }), ...input, ...patch }) });
      const actual = await execute();
      assert.equal(actual.ok, true, JSON.stringify(actual));
      assert.deepEqual(calls.at(-1), httpCall);
      assert.equal(httpCall.actor, actor);
      assert.equal(httpCall.project, slug);
      assert.equal(JSON.stringify(actual).includes("private"), false);
      if (operation === "list") {
        assert.equal(actual.result.pullRequests.length, 25);
        assert.equal(actual.result.total, 26);
        assert.deepEqual(actual.result.pageInfo, { hasNextPage: true, endCursor: "next-page" });
        assert.equal(Object.hasOwn(actual.result.pullRequests[0], "body"), false);
      }
      if (operation === "read") {
        assert.deepEqual(actual.result.pullRequest.review, review, "review identities are never truncated");
        assert.equal(actual.result.pullRequest.body.length, 4000);
        assert.equal(actual.result.pullRequest.bodyTruncated, true);
        assert.equal(actual.result.pullRequest.checksState, "PENDING");
        assert.equal(actual.result.pullRequest.actions.merge, pr.actions.merge);
        missingHead = true;
        const missing = await execute();
        assert.equal(missing.ok, true, JSON.stringify(missing));
        assert.equal(missing.result.pullRequest.unavailableReason, "The source branch is no longer available.");
        assert.equal(Object.hasOwn(missing.result.pullRequest, "review"), false);
        missingHead = false;
      }
      if (operation === "update-branch") assert.equal(actual.result.pending, true);
      if (isCreate) {
        assert.equal(actual.result.saveCommit, "c".repeat(40));
        assert.equal(actual.result.pullRequest.number, 7);
        assert.equal(Object.hasOwn(actual.result.pullRequest, "headCommit"), false, "old creation baseline cannot masquerade as current PR head");
      }
      const count = calls.length;
      allowed = false;
      assert.equal((await execute()).ok, false);
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      allowed = true;
      assert.equal((await execute({ vibe64User: { username: "invented", role: "owner" } })).ok, false);
      if (input.review) {
        for (const key of Object.keys(review)) {
          const incomplete = { ...review };
          delete incomplete[key];
          assert.equal((await execute({ review: incomplete })).ok, false, `missing ${key}`);
        }
        for (const patch of [{ review: { ...review, headCommit: "latest" } }, { review: { ...review, baseBranch: "" } },
          { review: { ...review, force: true } }, { number: 0 }]) assert.equal((await execute(patch)).ok, false);
      }
      if (isCreate) {
        for (const patch of [{ title: "" }, { sessionId: "" }, { destinationReview: {} }]) assert.equal((await execute(patch)).ok, false);
      }
      assert.equal(calls.length, count, "invalid and revoked calls cannot reach the service");
    }
    const createSession = toolSet.tools.find(tool => tool.actionId === "vibe64.sessions.create");
    const opened = await catalog.executeToolCall({ toolName: createSession.name, toolSet, context,
      argumentsText: JSON.stringify({ projectSlug: slug, pullRequestNumber: 7 }) });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(calls.at(-1).input.pullRequestNumber, 7);
    assert.equal(opened.result.sessionId, "opened-pr");
    assert.equal(opened.result.workspaceSetupStatus, "running");
  }));
});
