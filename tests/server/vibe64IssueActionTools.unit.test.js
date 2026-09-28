import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("issue tools preserve exact requested writes, bounded reads and fresh project authority", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const actor = { username: "owner", role: "owner" };
    let allowed = true;
    const calls = [];
    const labels = Array.from({ length: 23 }, (_, i) => ({ name: `label-${i}`, color: "aabbcc", id: "private-label" }));
    const comment = { id: "IC_exact", body: "A comment\n".repeat(200), author: { login: "owner", email: "private-email" },
      bodyHTML: "private-rendered-html", viewerCanUpdate: true };
    const issue = { number: 7, title: "Requested issue", body: "Issue text\n".repeat(500), state: "OPEN", url: "https://github.com/example/project/issues/7",
      author: { login: "owner" }, viewerCanClose: true, viewerCanReopen: false, viewerCanUpdate: true, canEditLabels: true,
      labels: { nodes: labels.slice(0, 10), totalCount: 23 },
      comments: { totalCount: 50, nodes: Array(25).fill(comment), pageInfo: { hasPreviousPage: true, startCursor: "older-comments" } },
      id: "private-issue", bodyHTML: "private-rendered-html" };
    const results = {
      list: { ok: true, issues: [{ ...issue, body: undefined, comments: { totalCount: 50 } }], total: 1001, searchLimit: 1000,
        repository: "example/project", pageInfo: { hasNextPage: true, endCursor: "next-list" } },
      read: { ok: true, repository: "example/project", issue },
      create: { ok: true, issue: { number: 7, url: issue.url } },
      edit: { ok: true, issue: { number: 7 } }, comment: { ok: true, comment }, "edit-comment": { ok: true, comment },
      state: { ok: true, state: "CLOSED", stateReason: "completed" },
      labels: { ok: true, labels, canCreateLabels: true, canCreateWithLabels: true, canEditLabels: true },
      "create-label": { ok: true, label: labels[0] }, "set-labels": { ok: true, issue: { number: 7 } },
      mentions: { ok: true, users: Array.from({ length: 23 }, (_, i) => ({ login: `person-${i}`, name: `Person ${i}`, email: "private-email" })), warning: "Some collaborators could not load." }
    };
    const actions = createActionCatalogue();
    actions.register({ contributorId: "issues", domain: "project", actions: createProjectActions({ project: {
      async githubIssues(input) {
        calls.push({ input, actor: currentProjectRequestContext().vibe64User, slug: currentProjectRequestContext().slug });
        return results[input.operation];
      }
    } }).map(action => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    const cases = [
      ["list", "GET", "/issues", { state: "all", search: "test", cursor: "next-list", labels: ["label-0"] }, {}],
      ["read", "GET", "/issues/:number", { cursor: "older-comments" }, { number: 7 }],
      ["create", "POST", "/issues", { title: "Requested issue", body: "Full text\n", labels: ["label-0"] }, {}],
      ["edit", "PUT", "/issues/:number", { title: "New title", body: "" }, { number: 7 }],
      ["comment", "POST", "/issues/:number/comments", { body: "Exact `text` $(literal)\n" }, { number: 7 }],
      ["edit-comment", "PATCH", "/issues/:number/comments/:commentId", { body: "Revised complete comment\n" }, { number: 7, commentId: "IC_exact" }],
      ["state", "PATCH", "/issues/:number", { state: "closed" }, { number: 7 }],
      ["labels", "GET", "/issue-labels", { search: "label", offset: 0, limit: 20 }, {}],
      ["create-label", "POST", "/issue-labels", { name: "label-0", color: "aabbcc" }, {}],
      ["set-labels", "PUT", "/issues/:number/labels", { labels: ["label-0"], labelMode: "add" }, { number: 7 }],
      ["mentions", "GET", "/issue-mentions", { number: 7, search: "Person", offset: 0, limit: 20 }, {}]
    ];
    for (const [operation, method, path, data, ids] of cases) {
      const actionId = `vibe64.project.issues.${operation}`;
      const tool = toolSet.tools.find(tool => tool.actionId === actionId);
      assert.ok(tool, actionId);
      assert.equal(Object.hasOwn(catalog.toOpenAiToolSchema(tool).function.parameters.properties, "vibe64User"), false);
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${path}` });
      const request = { params: routeProjectParams(ids), input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: actual, input }) {
          assert.equal(actual, actionId);
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload, results[operation]);
      const httpCall = calls.at(-1);
      const execute = (patch = {}) => catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, ...ids, ...data, ...patch }) });
      const actual = await execute();
      assert.equal(actual.ok, true, JSON.stringify(actual));
      assert.deepEqual(calls.at(-1), httpCall);
      assert.equal(httpCall.actor, actor);
      assert.equal(httpCall.slug, slug);
      if (data.body != null) assert.equal(httpCall.input.body, data.body);
      assert.equal(JSON.stringify(actual).includes("private"), false);
      if (operation === "list") {
        assert.equal(actual.result.searchLimit, 1000);
        assert.equal(actual.result.pageInfo.endCursor, "next-list");
        assert.equal(actual.result.issues[0].labelsTruncated, true);
      }
      if (operation === "read") {
        assert.equal(actual.result.issue.body.length, 4000);
        assert.equal(actual.result.issue.bodyTruncated, true);
        assert.equal(actual.result.issue.comments.nodes.length, 25);
        assert.equal(actual.result.issue.comments.nodes[0].body.length, 1000);
        assert.equal(actual.result.issue.comments.nodes[0].bodyTruncated, true);
        assert.equal(actual.result.issue.comments.pageInfo.startCursor, "older-comments");
        assert.equal(actual.result.issue.viewerCanUpdate, true);
      }
      if (["comment", "edit-comment"].includes(operation)) assert.equal(actual.result.comment.id, "IC_exact");
      if (["labels", "mentions"].includes(operation)) {
        assert.equal(actual.result[operation === "labels" ? "labels" : "users"].length, 20);
        assert.equal(actual.result.total, 23);
        assert.equal(actual.result.nextOffset, 20);
      }
      const count = calls.length;
      allowed = false;
      assert.equal((await execute()).ok, false);
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      allowed = true;
      assert.equal((await execute({ vibe64User: { username: "invented" } })).ok, false);
      assert.equal((await execute({ repository: "another/project" })).ok, false);
      if (operation === "edit") assert.equal((await execute({ body: undefined })).ok, false);
      if (operation === "create-label") assert.equal((await execute({ color: "zzzzzz" })).ok, false);
      if (["labels", "mentions"].includes(operation)) {
        assert.equal((await execute({ offset: -1 })).ok, false);
        assert.equal((await execute({ limit: 21 })).ok, false);
      }
      assert.equal(calls.length, count);
    }
  }));
});
