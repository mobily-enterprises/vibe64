import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { registerVibe64ActionContext, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

function fixture({ ownerRequired = false, projectScoped = true, allowDeleting = false } = {}) {
  const calls = [];
  const state = { user: { username: "member", uid: 42, role: "member" }, allowed: true, deleting: false };
  const actions = createActionCatalogue();
  const definition = withVibe64ActionContext({
    id: "vibe64.test.read", kind: "query", channels: ["api", "automation"], surfaces: ["app"],
    input: { schema: createSchema({ text: { type: "string", required: true }, vibe64User: { type: "object" } }), mode: "create" },
    async execute(input) {
      const project = currentProjectRequestContext();
      await Promise.resolve();
      assert.equal(currentProjectRequestContext(), project);
      calls.push({ input, project });
      return { ok: true, projectSlug: project?.slug, username: input.vibe64User?.username };
    }
  }, { ownerRequired, projectScoped, allowDeleting });
  actions.register({ contributorId: "test", domain: "vibe64-test", actions: [definition] });
  registerVibe64ActionContext(actions, {
    projectContext: {
      projectsRoot: "/test/projects",
      async readWorkspaceProject({ slug, allowDeleting }) {
        if (state.deleting && !allowDeleting) throw Object.assign(new Error("Deleting"), { code: "vibe64_project_deleting" });
        return { project: { path: `/test/projects/${slug}` } };
      }
    },
    resolveUser: async () => state.user,
    async authorizeProject({ slug, user }) {
      assert.equal(user, state.user);
      if (!state.allowed || slug === "denied") throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
    }
  });
  const execute = (input, context = {}) => actions.execute({
    actionId: definition.id, input, context: { channel: "automation", surface: "app", ...context }
  });
  return { actions, calls, definition, execute, state };
}

test("HTTP and automation establish the same project and trusted actor", async () => {
  const { calls, definition, execute } = fixture();
  assert.equal(Object.hasOwn(definition.input.schema.getFieldDefinitions(), "vibe64User"), false);
  const api = await execute({ text: "hello" }, {
    channel: "api", requestMeta: { request: { params: { slug: "alpha" } } }
  });
  const automation = await execute({ text: "hello", projectSlug: "alpha" });
  assert.deepEqual(automation, api);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.input.vibe64User.username, "member");
    assert.equal(call.input.projectSlug, undefined);
    assert.equal(call.project.slug, "alpha");
    assert.equal(call.project.targetRoot, "/test/projects/alpha");
  }
  assert.equal(currentProjectRequestContext(), null);
});

test("project and actor authority cannot be supplied in operation input or override its URL", async () => {
  const { calls, execute, state } = fixture();
  await assert.rejects(execute({ text: "hello", projectSlug: "beta" }, {
    channel: "api", requestMeta: { request: { params: { slug: "alpha" } } }
  }), { code: "vibe64_action_project_mismatch" });
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha" }, {
    vibe64Action: { user: { role: "owner" } }
  }), { code: "vibe64_action_context_reserved" });
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha", vibe64User: { role: "owner" } }), {
    code: "ACTION_VALIDATION_FAILED"
  });
  state.user = null;
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha", vibe64User: { role: "owner" } }), {
    statusCode: 401
  });
  assert.equal(calls.length, 0);
});

test("revoked access and invalid input fail before the service executes", async () => {
  const { calls, execute, state } = fixture();
  await execute({ text: "hello", projectSlug: "alpha" });
  state.allowed = false;
  await assert.rejects(execute({ text: "hello", projectSlug: "alpha" }), { statusCode: 403 });
  state.allowed = true;
  await assert.rejects(execute({ projectSlug: "alpha" }));
  await assert.rejects(execute({ text: "hello", projectSlug: "../alpha" }));
  assert.equal(calls.length, 1);
});

test("concurrent projects keep their action contexts isolated", async () => {
  const { calls, execute } = fixture();
  await Promise.all([execute({ text: "a", projectSlug: "alpha" }), execute({ text: "b", projectSlug: "beta" })]);
  assert.deepEqual(calls.map(({ input, project }) => [input.text, project.slug]).sort(), [["a", "alpha"], ["b", "beta"]]);
  assert.equal(currentProjectRequestContext(), null);
});

test("global owner operations need current owner authority but no project", async () => {
  const { calls, execute, state } = fixture({ projectScoped: false, ownerRequired: true });
  await assert.rejects(execute({ text: "hello", vibe64User: { role: "owner" } }), { statusCode: 403 });
  state.user = { ...state.user, role: "owner" };
  await execute({ text: "hello" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].project, null);
});

test("only an action's declared lifecycle scope can enter a deleting project", async () => {
  const ordinary = fixture();
  ordinary.state.deleting = true;
  await assert.rejects(ordinary.execute({ text: "hello", projectSlug: "alpha" }), { code: "vibe64_project_deleting" });
  await assert.rejects(ordinary.execute({ text: "hello", projectSlug: "alpha", allowDeleting: true }));
  assert.equal(ordinary.calls.length, 0);
  const archive = fixture({ allowDeleting: true, ownerRequired: true });
  archive.state.deleting = true;
  archive.state.user.role = "owner";
  await archive.execute({ text: "resume", projectSlug: "alpha" });
  assert.equal(archive.calls[0].project.slug, "alpha");
});
