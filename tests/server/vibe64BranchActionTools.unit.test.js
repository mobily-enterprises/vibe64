import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("branch tools bound discovery, preserve exact source reviews and reject caller authority", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    let allowed = true;
    const calls = [];
    const actor = { username: "owner", role: "owner" };
    const branches = Array.from({ length: 23 }, (_, i) => ({ name: `branch-${i}`, commit: "a".repeat(40), private: "private-branch" }));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "branches", domain: "project", actions: [
      ...createProjectActions({ project: { async repositoryBranches(input) {
        calls.push({ input, context: currentProjectRequestContext() });
        return { ok: true, defaultBranch: "main", branches, private: "private-repository" };
      } } }),
      ...createSessionActions({ sessions: { async createSession(input) {
        calls.push({ input, context: currentProjectRequestContext() });
        return { ok: true, sessionId: "new-session", workspaceSetup: { status: "running" }, sourcePath: "/private/source" };
      } } })
    ].map(action => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (actionId, input = {}) => {
      const tool = toolSet.tools.find(tool => tool.actionId === actionId);
      assert.ok(tool, actionId);
      assert.equal(Object.hasOwn(catalog.toOpenAiToolSchema(tool).function.parameters.properties, "vibe64User"), false);
      return catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, ...input }) });
    };
    const read = "vibe64.project.repository.branches.read";
    const create = "vibe64.sessions.create";
    const listed = await execute(read);
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.equal(listed.result.branches.length, 10);
    assert.equal(listed.result.total, 23);
    assert.equal(listed.result.nextOffset, 10);
    assert.equal(JSON.stringify(listed).includes("private"), false);
    await execute(read, { name: "feature/exact", offset: 0, limit: 10 });
    assert.equal(calls.at(-1).input.name, "feature/exact");
    assert.equal(calls.at(-1).context.vibe64User, actor);
    const selection = { name: "feature/another", fromBranch: "main", expectedCommit: "a".repeat(40) };
    const created = await execute(create, { repositoryBranch: selection });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.deepEqual(calls.at(-1).input.repositoryBranch, selection);
    assert.equal(created.result.sessionId, "new-session");
    assert.equal(created.result.workspaceSetupStatus, "running");
    assert.equal(JSON.stringify(created).includes("private"), false);
    const count = calls.length;
    for (const input of [ { repositoryBranch: {} }, { repositoryBranch: { name: "branch" } },
      { repositoryBranch: { ...selection, expectedCommit: "latest" } },
      { repositoryBranch: { ...selection, name: "" } },
      { repositoryBranch: { ...selection, fromBranch: "" } },
      { repositoryBranch: { ...selection, force: true } },
      { repositoryBranch: selection, vibe64User: { username: "invented" } } ]) {
      assert.equal((await execute(create, input)).ok, false);
    }
    for (const input of [{ offset: -1 }, { limit: 11 }, { name: "" }, { selection }]) assert.equal((await execute(read, input)).ok, false);
    allowed = false;
    assert.equal((await execute(read)).ok, false);
    assert.equal((await execute(create, { repositoryBranch: selection })).ok, false);
    assert.equal(calls.length, count, "invalid or revoked calls never reach the operation");
  });
});
