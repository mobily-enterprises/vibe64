import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("all project HTTP operations share canonical actions and current authority with automation", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const owner = { username: "owner", role: "owner" };
    let user = owner;
    let allowed = true;
    const calls = [];
    const events = [];
    const review = { repository: "example/project", number: 42, headBranch: "work", headCommit: "a".repeat(40), baseBranch: "main", baseCommit: "b".repeat(40), headRepository: "example/project" };
    const cases = [
      ["GET", "/repository/remote", "repository.remote.read", "repositoryRemote", {}],
      ["GET", "/repository/branches", "repository.branches.read", "repositoryBranches", {}],
      ["PUT", "/repository/workflow", "repository.workflow.save", "saveRepositoryWorkflow", { requirePullRequest: true }],
      ["POST", "/repository/remote", "repository.remote", "repositoryRemote", { action: "pull", review: { head: "reviewed-head" }, merge: false }],
      ["GET", "/issues", "issues.list", "githubIssues", { state: "all", search: "layout", cursor: null, labels: ["bug", "help wanted"] }],
      ["POST", "/issues", "issues.create", "githubIssues", { title: "Report", body: "A description", labels: ["bug"] }],
      ["GET", "/issue-labels", "issues.labels", "githubIssues", {}],
      ["POST", "/issue-labels", "issues.create-label", "githubIssues", { name: "Review", color: "aabbcc" }],
      ["GET", "/issue-mentions", "issues.mentions", "githubIssues", { number: "42" }],
      ["PUT", "/issues/:number/labels", "issues.set-labels", "githubIssues", { labels: [], labelMode: "replace" }],
      ["GET", "/issues/:number", "issues.read", "githubIssues", { cursor: "older-comments" }],
      ["POST", "/issues/:number/comments", "issues.comment", "githubIssues", { body: "Exact comment\n", originId: "browser" }],
      ["PATCH", "/issues/:number", "issues.state", "githubIssues", { state: "closed" }],
      ["PUT", "/issues/:number", "issues.edit", "githubIssues", { title: "New title", body: "" }],
      ["PATCH", "/issues/:number/comments/:commentId", "issues.edit-comment", "githubIssues", { body: "Revised comment" }],
      ["GET", "/pull-requests", "pull-requests.list", "githubPullRequests", { state: "merged", search: "layout", cursor: null }],
      ["GET", "/pull-requests/:number", "pull-requests.read", "githubPullRequests", {}],
      ["POST", "/pull-requests/:number/ready", "pull-requests.ready", "githubPullRequests", { review }],
      ["POST", "/pull-requests/:number/update-branch", "pull-requests.update-branch", "githubPullRequests", { review }],
      ["POST", "/pull-requests/:number/merge", "pull-requests.merge", "githubPullRequests", { review, mergeMethod: "squash" }],
      ["GET", "/projects", "projects.list", "listProjects", {}],
      ["POST", "/projects", "projects.create", "createProject", { name: "Example", slug: "example" }],
      ["POST", "/projects/select", "projects.select", "selectProject", { slug: "example" }],
      ["GET", "/onboarding", "onboarding.read", "readOnboarding", { sessionId: "session-1" }],
      ["POST", "/templates/apply", "templates.apply", "applyTemplate", { sessionId: "session-1", templateId: "jskit:public" }],
      ["GET", "/env", "env.read", "readEnv", { environment: "dev", sessionId: "session-1" }],
      ["POST", "/env/reveal", "env.secret.reveal", "revealEnvSecret", { key: "API_KEY", sessionId: "session-1" }],
      ["PUT", "/env/user-values", "env.user-values.save", "saveEnvUserValues", { values: { ACCEPTANCE: { value: "test", secret: false } }, sessionId: "session-1" }],
      ["GET", "/settings", "settings.read", "readSettings", { sessionId: "session-1" }],
      ["PUT", "/settings/collaboration", "collaboration.save", "saveCollaborationSettings", { experience: "comfortable", explanationStyle: "concise", responseLength: "concise", tone: "direct", requirements: "", sessionId: "session-1" }],
      ["PUT", "/settings/prompt-hints", "prompt-hints.save", "savePromptHints", { promptHints: false }],
      ["PUT", "/settings/development-database", "development-database.scope.save", "saveDevelopmentDatabaseScope", { scope: "project" }],
      ["GET", "/settings/engineering", "engineering.read", "readEngineeringSettings", { sessionId: "session-1" }],
      ["PUT", "/settings/engineering", "engineering.profile.save", "saveEngineeringProfile", { sessionId: "session-1", profile: "focused.v1" }],
      ["GET", "/preview-identities", "preview-identities.read", "readPreviewApplicationIdentities", { sessionId: "session-1" }],
      ["PUT", "/preview-identities", "preview-identities.save", "savePreviewApplicationIdentities", { identities: [], sessionId: "session-1" }]
    ];
    const project = Object.fromEntries(cases.map(([, , , method]) => [method, async (...args) => {
      const context = currentProjectRequestContext();
      calls.push({ method, args, actor: context.vibe64User, project: context.slug });
      if (["createProject", "selectProject"].includes(method)) return { ok: true, project: { slug: args[0].slug } };
      return { ok: true };
    }]));
    const actions = createActionCatalogue({ events: { async publish(event) { events.push(event); } } });
    actions.register({ contributorId: "project", domain: "project", actions: createProjectActions({ project }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
    });
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    assert.equal(app.registeredRoutes.length, cases.length);
    assert.equal(actions.listDefinitions().length, cases.length);
    for (const [method, suffix, operation, serviceMethod, data] of cases) {
      const actionId = `vibe64.project.${operation}`;
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${suffix}` });
      let actionInput;
      const request = { params: routeProjectParams({ number: "42", commentId: "IC_actual" }), input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: actualId, input }) {
          assert.equal(actualId, actionId);
          assert.equal(Object.hasOwn(input, "vibe64User"), false);
          actionInput = input;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = { ...testReply(), header() { return this; } };
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true, operation);
      const fromHttp = calls.at(-1);
      assert.equal(fromHttp.method, serviceMethod);
      assert.equal(fromHttp.actor, owner);
      assert.equal(fromHttp.project, slug);
      const execute = (input = { ...actionInput, projectSlug: slug }) => actions.execute({ actionId, input, context: { channel: "automation", surface: "app" } });
      await execute();
      assert.deepEqual(calls.at(-1), fromHttp, operation);
      if (actions.getDefinition(actionId).events.length) {
        assert.equal(events.at(-1).entityId, events.at(-2).entityId, operation);
        assert.deepEqual(events.at(-1).realtime, events.at(-2).realtime, operation);
        if (["projects.create", "projects.select"].includes(operation)) {
          assert.equal(events.at(-1).entityId, "example");
          assert.equal(events.at(-1).realtime.payload.projectSlug, "example");
        }
      }
      assert.equal(actions.getDefinition(actionId).input.mode, "create");
      const count = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      await assert.rejects(execute(), { statusCode: 403 });
      assert.equal(calls.length, count);
      allowed = true;
      await assert.rejects(execute({ ...actionInput, projectSlug: slug, vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
      if (["repository.workflow.save", "env.secret.reveal", "collaboration.save", "prompt-hints.save"].includes(operation)) {
        user = { username: "member", role: "member" };
        await assert.rejects(route.handler(request, reply), { code: "vibe64_owner_required", statusCode: 403 });
        await assert.rejects(execute(), { code: "vibe64_owner_required", statusCode: 403 });
        assert.equal(calls.length, count);
        user = owner;
      }
    }
    const count = calls.length;
    for (const [operation, input] of [
      ["issues.comment", { number: 42 }], ["issues.set-labels", { number: 42 }],
      ["issues.create", { title: "Title", labels: [{}] }], ["issues.state", { number: 42, state: "merged" }],
      ["issues.create", { title: "Title", labels: Array(101).fill("bug") }], ["issues.read", { number: Number.MAX_SAFE_INTEGER + 1 }],
      ["pull-requests.merge", { number: 42, mergeMethod: "squash" }],
      ["pull-requests.merge", { number: 42, review, mergeMethod: "force" }],
      ["env.secret.reveal", {}], ["env.user-values.save", {}], ["prompt-hints.save", {}], ["templates.apply", { sessionId: "session-1" }]
    ]) await assert.rejects(actions.execute({ actionId: `vibe64.project.${operation}`, input: { ...input, projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" }, operation);
    assert.equal(calls.length, count);
    assert.equal(currentProjectRequestContext(), null);
  }));
});
