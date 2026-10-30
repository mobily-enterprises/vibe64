import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("work tools retain exact review identities and project authority through HTTP and native discovery", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const actor = { username: "owner", role: "owner" };
    let allowed = true;
    const calls = [];
    const destination = { sessionId: "session-1", mode: "local_source", repository: "/a local project", branch: "main" };
    const historyReview = Object.fromEntries(["baseCommit", "canonicalCommit", "sessionHead", "worktreeTree"].map((key, i) => [key, String(i).repeat(40)]));
    const native = { ok: true, sessionId: "session-1", unsaved: true, updateAvailable: true, ahead: 1, behind: 2,
      destination: { ...destination, private: "private-destination" }, historyReview: { ...historyReview, private: "private-history" },
      changedPaths: Array.from({ length: 45 }, (_, i) => `file-${i}`), worktreePath: "/private/worktree", canonicalSource: { repository: "private-native-remote" },
      operation: { status: "ready", operationId: "save-1", events: [{ text: "private-log" }] },
      updateOperation: { status: "failed", code: "update-conflict", error: "Resolve the conflict first.",
        conflictRecovery: { reviewId: "review-1", private: "private-checkpoint" } },
      cacheMaintenance: { status: "retryable", retryable: true, message: "The work was saved; its clone cache needs refresh.", private: "private-cache" } };
    const cases = [
      ["GET", "/work", "work.inspect", "inspectSessionWork", {}],
      ["POST", "/save", "work.save", "saveSessionWork", { destinationReview: destination }],
      ["POST", "/updates/check", "updates.check", "checkSessionUpdates", { force: true }],
      ["POST", "/updates/apply", "updates.apply", "updateSessionWork", { historyReview, reviewedConflictId: "review-1",
        requestId: "11111111-1111-4111-8111-111111111111" }]
    ];
    const sessions = Object.fromEntries(cases.map(([, , , name]) => [name, async (...args) => {
      const context = currentProjectRequestContext();
      // Save and inspect also receive their caller's action context; HTTP and
      // tool calls differ only in channel, so compare the operation inputs.
      calls.push({ args: args.filter(arg => !arg?.requestMeta), actor: context.vibe64User, project: context.slug });
      return native;
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "work", domain: "sessions", actions: createSessionActions({ sessions }).map(action => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    for (const [method, suffix, name, , body] of cases) {
      const actionId = `vibe64.sessions.${name}`;
      const tool = toolSet.tools.find(item => item.actionId === actionId);
      assert.ok(tool, actionId);
      const parameters = catalog.toOpenAiToolSchema(tool).function.parameters;
      assert.ok(parameters.required.includes("sessionId"));
      assert.equal(Object.hasOwn(parameters.properties, "vibe64User"), false);
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/sessions/:sessionId${suffix}` });
      const request = { params: routeProjectParams({ sessionId: "session-1" }), input: { body },
        executeAction({ actionId: actual, input }) {
          assert.equal(actual, actionId);
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload, native, "HTTP retains its full result");
      const httpCall = calls.at(-1);
      const execute = (patch = {}) => catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "session-1", ...body, ...patch }) });
      const result = await execute();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(calls.at(-1), httpCall);
      assert.equal(httpCall.actor, actor);
      assert.equal(httpCall.project, slug);
      assert.deepEqual(result.result.destination, destination);
      assert.deepEqual(result.result.historyReview, historyReview);
      assert.equal(result.result.changedPathCount, 45);
      assert.equal(result.result.changedPaths.length, 40);
      assert.equal(result.result.changedPathsTruncated, true);
      assert.equal(result.result.updateOperation.conflictReviewId, "review-1");
      assert.deepEqual(result.result.repositoryProblem, { code: "update-conflict", failedAt: "", label: "Repository needs help",
        message: "Resolve the conflict first.", nextStep: "Choose Fix it with AI on the Update notice, or fix the cause and update again.",
        operation: "update", status: "failed" });
      assert.equal(result.result.cacheMaintenance.retryable, true);
      assert.equal(JSON.stringify(result).includes("private"), false);
      const count = calls.length;
      allowed = false;
      assert.equal((await execute()).ok, false, "cached discovery cannot bypass revoked access");
      allowed = true;
      assert.equal((await execute({ vibe64User: { username: "invented", role: "owner" } })).ok, false);
      assert.equal((await execute({ sessionId: "" })).ok, false);
      if (name === "work.save") assert.equal((await execute({ destinationReview: { sessionId: "session-1" } })).ok, false);
      if (name === "updates.apply") assert.equal((await execute({ historyReview: { baseCommit: "0".repeat(40) } })).ok, false);
      assert.equal(calls.length, count, "invalid or unauthorized inputs never reach the service");
    }
  }));
});

test("Incoming actions share receiving authority, preserve exact reviews and keep diffs out of Colleague", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const actor = { username: "receiver", role: "member" };
    let allowed = true;
    const calls = [];
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const review = { repository: "example/library", targetBranch: "main", targetHead: "a".repeat(40),
      id, activeHead: "b".repeat(40), discardedHead: "" };
    const native = { ok: true, repository: review.repository, targetBranch: review.targetBranch, targetHead: review.targetHead,
      pendingCount: 1, totalCount: 1, nextOffset: null, actions: { merge: "", discard: "" },
      contributions: [{ id, branch: `vibe64-incoming/${id}`, head: review.activeHead, status: "pending", title: "Improve library",
        fileCount: 1, review, files: ["private-source.js"], diff: { content: "private-source" } }], credential: "private-credential" };
    const sessions = Object.fromEntries(["inspectIncomingContributions", "changeIncomingContribution"].map(name => [name,
      async (...args) => { calls.push({ name, args, actor: currentProjectRequestContext().vibe64User, project: currentProjectRequestContext().slug }); return native; }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "incoming", domain: "sessions", actions: createSessionActions({ sessions }).map(action => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Receiving project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    assert.equal(toolSet.tools.some(tool => tool.actionId === "vibe64.repository.incoming.review"), false);
    for (const operation of ["inspect", "change"]) {
      const actionId = `vibe64.repository.incoming.${operation}`;
      const tool = toolSet.tools.find(item => item.actionId === actionId);
      assert.ok(tool);
      const input = { sessionId: "session-1", ...(operation === "change" ? { id, action: "discard", review } : { state: "pending", limit: 1 }) };
      const route = findRegisteredRoute(app, { method: operation === "change" ? "POST" : "GET",
        path: `${apiRouteBase}/vibe64/incoming${operation === "change" ? "/:id" : ""}` });
      const request = { params: routeProjectParams({ id }), query: input, input: { body: input, query: input },
        executeAction({ actionId: actual, input: args }) {
          assert.equal(actual, actionId);
          return actions.execute({ actionId, input: args, context: { channel: "api", surface: "app", requestMeta: { request } } });
        } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload, native);
      const httpCall = calls.at(-1);
      const execute = patch => catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, ...input, ...patch }) });
      const result = await execute();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(calls.at(-1), httpCall);
      assert.deepEqual(result.result.contributions[0].review, review);
      assert.equal(JSON.stringify(result).includes("private"), false);
      const count = calls.length;
      allowed = false;
      assert.equal((await execute()).ok, false);
      allowed = true;
      assert.equal((await execute({ vibe64User: { role: "owner" } })).ok, false);
      if (operation === "change") {
        assert.equal((await execute({ review: { ...review, targetHead: "" } })).ok, false);
        assert.equal((await execute({ action: "delete" })).ok, false);
      }
      assert.equal(calls.length, count);
    }
  }));
});
